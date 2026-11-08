"""HTTP API. Runs on the Vultr VM behind Caddy."""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app import agents, entity_graph, northstar, rules, scan_upload, views
from app.graph import Engine
from app.llm import models_for
from app.store import Store, now

store = Store.from_env()
store.init()
engine = Engine(store, os.environ["VULTR_INFERENCE_API_KEY"])
engine.recover()
threading.Thread(target=store.documents_with_text, daemon=True).start()  # warm the document cache from Object Storage
app = FastAPI(title="ControlRoom", docs_url="/api/docs", openapi_url="/api/openapi.json")

RUNS_PER_HOUR = int(os.environ.get("RUNS_PER_HOUR", "12"))
_runs: dict[str, deque] = defaultdict(deque)


def _client(request: Request) -> str:
    return request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()


def _limit(request: Request):
    ip, t = _client(request), time.time()
    q = _runs[ip]
    while q and t - q[0] > 3600:
        q.popleft()
    if len(q) >= RUNS_PER_HOUR:
        raise HTTPException(429, f"Limit of {RUNS_PER_HOUR} investigations per hour reached. Try again later.")
    q.append(t)


def _case_or_404(case_id: str) -> dict:
    c = store.case(case_id)
    if not c:
        raise HTTPException(404, "No such case")
    return c


@app.get("/api/health")
def health():
    store.q("SELECT 1")
    return {"ok": True, "database": "Vultr Managed PostgreSQL", "object_storage": store.s3_endpoint,
            "models": {"specialists": models_for("evidence"), "challenge_and_commander": models_for("challenge")}}


def _inbox_row(c: dict) -> dict:
    full = store.case(c["id"])
    return {**c, "potential_exposure": float(c["potential_exposure"]), "cost": store.cost(c["id"]),
            "severity": views.severity(full, full["state"]), "owner": "Elena Brandt, AP Operations Lead"}


@app.get("/api/entity-graph")
def entity_graph_view(case: str = ""):
    """The full entity graph as one case sees it (holds, reverts and blocks included)."""
    if case:
        _case_or_404(case)
    world = store.world(case, docs=True)
    incidents = {}
    for c in store.cases():
        if c["id"] == c.get("template"):
            for sid in c["supplier_ids"]:
                incidents[sid] = {"id": c["id"]}
    return entity_graph.build(world, incidents)


@app.get("/api/suppliers/{supplier_id}")
def supplier_view(supplier_id: str):
    world = store.world(docs=False)
    s = world.get(supplier_id)
    if not s or world.kind(supplier_id) != "supplier":
        raise HTTPException(404, "No such supplier")
    invs = world.find("invoice", supplier_id=supplier_id)
    pays = world.find("payment", supplier_id=supplier_id)
    links = [l for l in rules.shared_attributes(world) if supplier_id in (l["from"], l["to"])]
    incidents = [{"id": c["id"], "title": c["title"]} for c in store.cases() if c["id"] == c.get("template") and supplier_id in c["supplier_ids"]]
    changes = world.find("supplier_change", supplier_id=supplier_id)
    return {"supplier": s, "invoices": invs, "payments": pays, "links": links, "incidents": incidents, "changes": changes,
            "in_run": sum(p["amount"] for p in pays if p["run_id"] == world.run["id"]), "run": world.run}


class ScanRequest(BaseModel):
    suppliers: list[dict]
    invoices: list[dict]
    limit: float = Field(50_000, gt=0, le=10_000_000)


@app.post("/api/scan")
def scan_own_data(body: ScanRequest, request: Request):
    """Deterministic scan of uploaded data. No model call; nothing is stored."""
    try:
        return scan_upload.scan(body.suppliers, body.invoices, body.limit)
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get("/api/scan/sample/{which}")
def scan_sample(which: str):
    sup, inv = scan_upload.sample_csv(store.world(docs=False))
    if which not in ("suppliers.csv", "invoices.csv"):
        raise HTTPException(404, "No such sample")
    return Response(sup if which == "suppliers.csv" else inv, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="northstar-{which}"'})


@app.get("/api/network")
def network():
    """Every supplier, the money each is due in the next payment run, how suppliers are linked,
    and which incidents involve them. Built by code from the base ERP records."""
    world = store.world(docs=False)
    run = world.run
    templates = [c for c in store.cases() if c["id"] == c.get("template")]
    incident_of = {}
    for c in templates:
        full = store.case(c["id"])
        for sid in c["supplier_ids"]:
            incident_of[sid] = {"id": c["id"], "title": c["title"], "severity": views.severity(full, full["state"])["level"],
                                "exposure": float(c["potential_exposure"])}
    pay_at = run["scheduled_for"]
    suppliers = []
    for s in world.records["supplier"]:
        pays = [p for p in world.records["payment"] if p["supplier_id"] == s["id"] and p["run_id"] == run["id"]]
        recent_change = any(ch["field"] == "bank_account_token" and not ch.get("callback_verified")
                            for ch in world.find("supplier_change", supplier_id=s["id"]))
        suppliers.append({"id": s["id"], "name": s["legal_name"], "in_run": sum(p["amount"] for p in pays), "payments": len(pays),
                          "bank": s["bank_account_token"], "new": s["created_at"] >= "2026-10-01", "bank_changed": recent_change,
                          "incident": incident_of.get(s["id"])})
    links = [{"from": l["from"], "to": l["to"], "attribute": l["attribute"], "strength": l["strength"], "explanation": l["explanation"]}
             for l in rules.shared_attributes(world)]
    return {"run": {**run, "total": sum(s["in_run"] for s in suppliers), "payments": sum(s["payments"] for s in suppliers), "at": pay_at},
            "suppliers": suppliers, "links": links, "incidents": [{"id": c["id"], "title": c["title"]} for c in templates]}


@app.get("/api/overview")
def overview():
    world = store.world(docs=False)
    run = world.run
    pays = [p for p in world.records["payment"] if p["run_id"] == run["id"]]
    return {"world_now": world.meta["world_now"], "payment_run": {**run, "payments": len(pays), "total": sum(p["amount"] for p in pays)},
            "approval_limit": world.limit, "currency": world.meta["currency"],
            "counts": {k: len(v) for k, v in world.records.items()}, "documents": len(store.list_documents()),
            "cases": [_inbox_row(c) for c in store.cases()],
            "featured": (store.q("SELECT value FROM meta WHERE key = 'featured'") or [{"value": []}])[0]["value"],
            "infrastructure": {"compute": "Vultr Cloud Compute, Seattle", "database": "Vultr Managed PostgreSQL, Seattle",
                               "object_storage": store.s3_endpoint.replace("https://", "") + " (Vultr Object Storage)",
                               "inference": "Vultr Serverless Inference", "models": {"specialists": models_for("evidence")[0],
                                                                                   "challenge": models_for("challenge")[0],
                                                                                   "backup": models_for("evidence")[1]}}}


@app.get("/api/cases/{case_id}")
def case_view(case_id: str):
    c = _case_or_404(case_id)
    world = store.world(case_id, docs=False)
    invoices = []
    for i in c["invoice_ids"]:
        ch = world.chain(i)
        invoices.append({"invoice": ch["invoice"], "supplier": ch["supplier"], "po": ch["po"], "request": ch["request"],
                         "receipts": ch["receipts"], "payments": ch["payments"],
                         "approver": world.get(ch["request"]["approver_id"]), "requester": world.get(ch["request"]["requester_id"])})
    return {**c, "potential_exposure": float(c["potential_exposure"]), "waiting_for": engine.waiting_for(case_id),
            "busy": engine.busy(case_id), "cost": store.cost(case_id), "invoices": invoices,
            "world_now": world.meta["world_now"], "payment_run": world.run,
            "documents": [{k: d[k] for k in ("id", "kind", "title", "trust", "related", "s3_key", "sha256", "scope")}
                          for d in store.list_documents(case_id)
                          if set(d["related"]) & (set(c["invoice_ids"]) | set(c["supplier_ids"]) | {x["po"]["id"] for x in invoices} | {x["request"]["id"] for x in invoices}) or d["scope"]]}


@app.get("/api/cases/{case_id}/graph")
def case_graph(case_id: str):
    """Nodes and edges for the relationship map, laid out in columns by type.

    Shared-attribute links come from the deterministic matcher, so they show from the moment the
    incident opens. Until the Relationship Agent has assessed them they are marked as matcher-only."""
    c = _case_or_404(case_id)
    st = c["state"]
    world = store.world(case_id, docs=False)
    nodes, edges = {}, []

    def node(id_, kind, label, sub="", col=0, flag=None):
        nodes.setdefault(id_, {"id": id_, "kind": kind, "label": label, "sub": sub, "col": col, "flag": flag})

    assessed = bool(st.get("links"))
    links = st.get("links") or [{**l, "status": "Matcher", "assessment": "awaiting Relationship Agent"}
                                for l in rules.shared_attributes(world, c["supplier_ids"])]
    for i in c["invoice_ids"]:
        ch = world.chain(i)
        s, pr, inv = ch["supplier"], ch["request"], ch["invoice"]
        node(s["id"], "supplier", s["legal_name"], s["id"], 1, "blocked" if s.get("status") == "blocked" else None)
        node(pr["id"], "request", pr["id"], f"${pr['amount']:,.0f} · {pr['created_at'][11:16]}", 2)
        node(inv["id"], "invoice", inv["id"], f"${inv['amount']:,.0f} · ERP: {inv['status'].replace('_', ' ')}", 3)
        edges.append({"from": s["id"], "to": pr["id"], "label": "supplier on", "kind": "fact", "ref": pr["id"]})
        edges.append({"from": pr["id"], "to": inv["id"], "label": f"via {ch['po']['id']}", "kind": "fact", "ref": ch["po"]["id"]})
        for p in ch["payments"]:
            node(p["id"], "payment", p["id"], f"{p['run_id']} · {p['status'].replace('_', ' ')}", 4, "held" if p["status"] == "on_hold" else None)
            edges.append({"from": inv["id"], "to": p["id"], "label": "scheduled", "kind": "fact", "ref": p["id"]})
        for role in ("approver_id", "requester_id"):
            e = world.get(pr[role])
            node(e["id"], "person", e["name"], e["role"], 2)
            edges.append({"from": e["id"], "to": pr["id"], "label": "approved" if role == "approver_id" else "requested", "kind": "fact", "ref": pr["id"]})
    for l in links:
        if l["strength"] == "fact":
            continue
        attr_id = f"{l['attribute']}:{l['value']}"
        label = {"bank_account_token": f"Bank {l['value']}", "phone": l["value"], "address": l["value"].split(",")[0]}[l["attribute"]]
        node(attr_id, l["attribute"], label, f"shared {l['attribute'].replace('_token', '').replace('_', ' ')} · {l['strength']}", 0)
        kind = "matcher" if l["status"] == "Matcher" else ("confirmed" if l["status"] == "Confirmed" else "unconfirmed")
        for sid in (l["from"], l["to"]):
            if not any(e["from"] == attr_id and e["to"] == sid for e in edges):
                edges.append({"from": attr_id, "to": sid, "label": l["explanation"], "kind": kind, "ref": l["id"]})
    for lk in st.get("lookalikes") or []:
        node(lk["document_id"], "email", lk["document_id"], lk["sender_domain"], 0, "lookalike")
        edges.append({"from": lk["document_id"], "to": lk["supplier_id"], "label": f"imitates {lk['real_domain']}", "kind": "warning", "ref": lk["document_id"]})
    return {"nodes": list(nodes.values()), "edges": edges, "investigated": assessed}


@app.get("/api/cases/{case_id}/events")
def case_events(case_id: str, after: int = 0):
    _case_or_404(case_id)
    return [{**e, "at": e["at"].isoformat()} for e in store.events(case_id, after)]


@app.get("/api/cases/{case_id}/stream")
async def case_stream(case_id: str, request: Request, after: int = 0):
    _case_or_404(case_id)

    async def gen():
        last, idle = after, 0
        while not await request.is_disconnected():
            rows = await asyncio.to_thread(store.events, case_id, last)
            for e in rows:
                last = e["seq"]
                yield f"data: {json.dumps({**e, 'at': e['at'].isoformat()}, default=str)}\n\n"
            idle = 0 if rows else idle + 1
            if idle and idle % 15 == 0:
                yield ": keepalive\n\n"
            await asyncio.sleep(0.8)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/cases/{case_id}/rerun", status_code=201)
def rerun(case_id: str, request: Request):
    """A fresh copy of an incident with its own copy of the ERP, so anyone can run it from the start."""
    c = _case_or_404(case_id)
    template = c.get("template") or c["id"]
    new_id = f"{template}-{secrets.token_hex(2).upper()}"
    store.q("""INSERT INTO cases (id, title, status, invoice_ids, supplier_ids, trigger, potential_exposure, template, state)
               VALUES (%s,%s,'new',%s,%s,%s,%s,%s,%s)""",
            (new_id, c["title"], Jsonb(c["invoice_ids"]), Jsonb(c["supplier_ids"]), c["trigger"], c["potential_exposure"], template,
             Jsonb({"summary": None})))
    store.event(new_id, "Payment-run scan", "trigger", c["trigger"], {"invoice_ids": c["invoice_ids"], "copy_of": template})
    return {"id": new_id}


@app.post("/api/cases/{case_id}/investigate", status_code=202)
def investigate(case_id: str, request: Request):
    c = _case_or_404(case_id)
    if c["status"] != "new":
        raise HTTPException(409, "This case has already been investigated. Start a fresh copy to run it again.")
    _limit(request)
    engine.start(case_id)
    return {"started": True}


@app.post("/api/cases/{case_id}/retry", status_code=202)
def retry(case_id: str):
    c = _case_or_404(case_id)
    if c["status"] != "error" or engine.busy(case_id):
        raise HTTPException(409, "Only a failed run can be retried")
    engine.retry(case_id)
    return {"retrying": True}


PERSONAS = {
    "ap_lead": {"name": "Elena Brandt", "role": "AP Operations Lead"},
    "finance_director": {"name": "Tom Okafor", "role": "Finance Director"},
    "internal_audit": {"name": "Rafael Moreno", "role": "Internal Audit Manager"},
    "procurement": {"name": "Grace Liu", "role": "Procurement Lead"},
    "warehouse": {"name": "Ana Petrov", "role": "Warehouse Supervisor"},
}
# Who may do what. Checked here, on the server; the UI only mirrors it.
PERMISSIONS = {
    "decide": {"finance_director"},
    "close": {"finance_director"},
    "override": {"finance_director"},
    "audit_ack": {"internal_audit"},
    "remediation:callback": {"procurement"},
    "remediation:receiving": {"warehouse"},
}


def _actor(case_id: str, persona: str, permission: str) -> str:
    p = PERSONAS.get(persona)
    if not p:
        raise HTTPException(400, "Unknown persona")
    allowed = PERMISSIONS[permission]
    if persona not in allowed:
        need = " or ".join(PERSONAS[a]["role"] for a in sorted(allowed))
        store.event(case_id, f"{p['name']}, {p['role']}", "permission_denied",
                    f"Refused: {permission.replace('_', ' ')} needs the {need}", {"persona": persona, "permission": permission})
        raise HTTPException(403, f"{p['role']} can't do this. It needs the {need}.")
    return f"{p['name']}, {p['role']}"


@app.get("/api/personas")
def personas():
    return {"personas": PERSONAS, "permissions": {k: sorted(v) for k, v in PERMISSIONS.items()},
            "note": "Demo personas, not authentication. Permissions are enforced by the API."}


class Decision(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    reason: str = Field("", max_length=500)


class Decisions(BaseModel):
    persona: str
    decisions: dict[str, Decision]


@app.post("/api/cases/{case_id}/decisions", status_code=202)
def decide(case_id: str, body: Decisions):
    _case_or_404(case_id)
    if engine.waiting_for(case_id) != "approval" or engine.busy(case_id):
        raise HTTPException(409, "The case is not waiting for approval")
    by = _actor(case_id, body.persona, "decide")
    rejected_without_reason = [k for k, v in body.decisions.items() if v.decision == "rejected" and not v.reason.strip()]
    if rejected_without_reason:
        raise HTTPException(422, f"Give a reason for each rejection: {', '.join(rejected_without_reason)}")
    engine.resume(case_id, {"by": by, "decisions": {k: v.model_dump() for k, v in body.decisions.items()}})
    return {"resumed": True}


class Act(BaseModel):
    persona: str


class Remediation(Act):
    kind: str


@app.post("/api/cases/{case_id}/remediation")
def remediation(case_id: str, body: Remediation):
    c = _case_or_404(case_id)
    if body.kind not in northstar.REMEDIATION or c["status"] != "remediation" or c.get("template") != "INC-0412":
        raise HTTPException(409, "No such remediation step for this case")
    who = _actor(case_id, body.persona, f"remediation:{body.kind}")
    engine.add_remediation(case_id, body.kind, who)
    return {"added": body.kind}


@app.post("/api/cases/{case_id}/audit-ack")
def audit_ack(case_id: str, body: Act):
    c = _case_or_404(case_id)
    if c["status"] != "remediation":
        raise HTTPException(409, "Not in remediation")
    engine.acknowledge_audit(case_id, _actor(case_id, body.persona, "audit_ack"))
    return {"acknowledged": True}


class TaskDone(Act):
    note: str = Field(..., min_length=10, max_length=600)


@app.post("/api/cases/{case_id}/tasks/{action_id}/complete")
def complete_task(case_id: str, action_id: str, body: TaskDone):
    """The task's owner records it as done, with a note. Only the owner's persona may do it."""
    c = _case_or_404(case_id)
    a = next((x for x in c["state"].get("actions", []) if x["id"] == action_id), None)
    if not a or c["status"] != "remediation":
        raise HTTPException(409, "No such open task")
    p = PERSONAS.get(body.persona)
    if not p or not a["owner"].startswith(p["name"]):
        who = f"{p['name']}, {p['role']}" if p else body.persona
        store.event(case_id, who, "permission_denied", f"Refused: only {a['owner']} can complete this task", {"action_id": action_id})
        raise HTTPException(403, f"Only the task owner, {a['owner']}, can complete it.")
    try:
        engine.complete_task(case_id, action_id, f"{p['name']}, {p['role']}", body.note.strip())
    except KeyError:
        raise HTTPException(409, "That task isn't open")
    return {"done": action_id}


@app.post("/api/cases/{case_id}/verify", status_code=202)
def verify(case_id: str):
    _case_or_404(case_id)
    if engine.waiting_for(case_id) != "remediation" or engine.busy(case_id):
        raise HTTPException(409, "The case is not waiting for verification")
    engine.resume(case_id, {"action": "verify"})
    return {"resumed": True}


class Close(Act):
    override_reason: str = Field("", max_length=1000)


@app.post("/api/cases/{case_id}/close", status_code=202)
def close(case_id: str, body: Close):
    _case_or_404(case_id)
    if engine.waiting_for(case_id) != "remediation" or engine.busy(case_id):
        raise HTTPException(409, "The case can't be closed from its current state")
    by = _actor(case_id, body.persona, "override" if body.override_reason.strip() else "close")
    if body.override_reason.strip() and len(body.override_reason.strip()) < 20:
        raise HTTPException(422, "An override needs a written reason of at least 20 characters")
    engine.resume(case_id, {"action": "close", "by": by, "override_reason": body.override_reason})
    return {"resumed": True}


@app.get("/api/cases/{case_id}/overview")
def case_overview(case_id: str):
    c = _case_or_404(case_id)
    world = store.world(case_id, docs=False)
    st = c["state"]
    checks = (st.get("verification") or {}).get("checks") or []
    criteria = []
    if st.get("controls") is not None and not checks:
        criteria = rules.closure_checks(world, {**c, **st, "invoice_ids": c["invoice_ids"]})
    return {"overview": views.overview(c, st, store.events(case_id), world),
            "actions": [{**a, "lifecycle": views.lifecycle(a, checks or criteria)} for a in st.get("actions") or []],
            "criteria": criteria}


@app.get("/api/cases/{case_id}/timeline")
def case_timeline(case_id: str):
    c = _case_or_404(case_id)
    world = store.world(case_id, docs=True)
    return {"timeline": views.timeline(c, c["state"], store.events(case_id), world)}


@app.get("/api/cases/{case_id}/lookup/{ref}")
def case_lookup(case_id: str, ref: str):
    c = _case_or_404(case_id)
    world = store.world(case_id, docs=False)
    hit = views.lookup(ref, c, c["state"], world, store, case_id)
    if not hit:
        raise HTTPException(404, f"Nothing called {ref} in this case")
    return hit


@app.get("/api/cases/{case_id}/export")
def export(case_id: str):
    """The full incident record at any stage: state, decisions, every event and the timeline."""
    c = _case_or_404(case_id)
    world = store.world(case_id, docs=True)
    events = store.events(case_id)
    body = {"exported_at": now(), "synthetic_data": True,
            "case": {k: (float(v) if k == "potential_exposure" else v) for k, v in c.items() if k != "state"},
            "state": c["state"], "cost": store.cost(case_id),
            "timeline": views.timeline(c, c["state"], events, world),
            "events": [{**e, "at": e["at"].isoformat()} for e in events]}
    return Response(json.dumps(body, indent=1, default=str), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{case_id}-incident-record.json"'})


@app.get("/api/cases/{case_id}/report")
def report(case_id: str):
    _case_or_404(case_id)
    try:
        body = store.get_report(case_id)
    except Exception:
        raise HTTPException(404, "No report yet")
    return Response(body, media_type="application/json", headers={"Content-Disposition": f'inline; filename="{case_id}-report.json"'})


@app.get("/api/documents/{doc_id}")
def document(doc_id: str, case: str = ""):
    try:
        body, d = store.document_bytes(doc_id, case)
    except KeyError:
        raise HTTPException(404, "No such document")
    media = "application/pdf" if d["format"] == "pdf" else "text/plain; charset=utf-8"
    return Response(body, media_type=media, headers={"X-Object-Key": d["s3_key"], "X-SHA256": d["sha256"],
                                                     "Content-Disposition": f'inline; filename="{d["id"]}.{d["format"]}"'})


@app.get("/api/records/{record_id}")
def record(record_id: str, case: str = ""):
    world = store.world(case, docs=False)
    r = world.get(record_id)
    if not r:
        raise HTTPException(404, "No such record")
    return {"kind": world.kind(record_id), "record": r}


@app.get("/api/signing-key")
def signing_key():
    return {"algorithm": "Ed25519", "public_key": engine.public_key()}


DIST = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
