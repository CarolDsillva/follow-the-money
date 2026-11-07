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

from app import agents, northstar, rules
from app.graph import Engine
from app.llm import models_for
from app.store import Store

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


@app.get("/api/overview")
def overview():
    world = store.world(docs=False)
    run = world.run
    pays = [p for p in world.records["payment"] if p["run_id"] == run["id"]]
    return {"world_now": world.meta["world_now"], "payment_run": {**run, "payments": len(pays), "total": sum(p["amount"] for p in pays)},
            "approval_limit": world.limit, "currency": world.meta["currency"],
            "counts": {k: len(v) for k, v in world.records.items()}, "documents": len(store.list_documents()),
            "cases": [{**c, "potential_exposure": float(c["potential_exposure"]), "cost": store.cost(c["id"])} for c in store.cases()],
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
    """Nodes and edges for the relationship map, laid out in columns by type."""
    c = _case_or_404(case_id)
    st = c["state"]
    world = store.world(case_id, docs=False)
    nodes, edges = {}, []

    def node(id_, kind, label, sub="", col=0, flag=None):
        nodes.setdefault(id_, {"id": id_, "kind": kind, "label": label, "sub": sub, "col": col, "flag": flag})

    links = st.get("links") or []
    for i in c["invoice_ids"]:
        ch = world.chain(i)
        s, pr, inv = ch["supplier"], ch["request"], ch["invoice"]
        node(s["id"], "supplier", s["legal_name"], s["id"], 1, "blocked" if s.get("status") == "blocked" else None)
        node(pr["id"], "request", pr["id"], f"${pr['amount']:,.0f} · {pr['created_at'][11:16]}", 2)
        node(inv["id"], "invoice", inv["id"], f"${inv['amount']:,.0f} · {inv['status'].replace('_', ' ')}", 3)
        edges.append({"from": s["id"], "to": pr["id"], "label": "supplier on", "kind": "fact"})
        edges.append({"from": pr["id"], "to": inv["id"], "label": f"via {ch['po']['id']}", "kind": "fact"})
        for p in ch["payments"]:
            node(p["id"], "payment", p["id"], f"{p['run_id']} · {p['status'].replace('_', ' ')}", 4, "held" if p["status"] == "on_hold" else None)
            edges.append({"from": inv["id"], "to": p["id"], "label": "scheduled", "kind": "fact"})
        if links:
            for role in ("approver_id", "requester_id"):
                e = world.get(pr[role])
                node(e["id"], "person", e["name"], e["role"], 2.5 if role == "approver_id" else 2.5)
                edges.append({"from": e["id"], "to": pr["id"], "label": "approved" if role == "approver_id" else "requested", "kind": "fact"})
    for l in links:
        if l["strength"] == "fact":
            continue
        attr_id = f"{l['attribute']}:{l['value']}"
        label = {"bank_account_token": f"Bank {l['value']}", "phone": l["value"], "address": l["value"].split(",")[0]}[l["attribute"]]
        node(attr_id, l["attribute"], label, l["attribute"].replace("_", " ").replace("token", ""), 0)
        for sid in (l["from"], l["to"]):
            if not any(e["from"] == attr_id and e["to"] == sid for e in edges):
                edges.append({"from": attr_id, "to": sid, "label": l["explanation"], "kind": l["status"].lower(), "link_id": l["id"]})
    for lk in st.get("lookalikes") or []:
        node(lk["document_id"], "email", lk["document_id"], lk["sender_domain"], 0, "lookalike")
        edges.append({"from": lk["document_id"], "to": lk["supplier_id"], "label": f"imitates {lk['real_domain']}", "kind": "warning"})
    return {"nodes": list(nodes.values()), "edges": edges, "investigated": bool(links)}


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


class Decision(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    reason: str = Field("", max_length=500)


class Decisions(BaseModel):
    by: str = Field(..., min_length=2, max_length=80)
    decisions: dict[str, Decision]


@app.post("/api/cases/{case_id}/decisions", status_code=202)
def decide(case_id: str, body: Decisions):
    _case_or_404(case_id)
    if engine.waiting_for(case_id) != "approval" or engine.busy(case_id):
        raise HTTPException(409, "The case is not waiting for approval")
    engine.resume(case_id, {"by": body.by, "decisions": {k: v.model_dump() for k, v in body.decisions.items()}})
    return {"resumed": True}


class Remediation(BaseModel):
    kind: str
    by: str = "Demo operator"


@app.post("/api/cases/{case_id}/remediation")
def remediation(case_id: str, body: Remediation):
    c = _case_or_404(case_id)
    if body.kind not in northstar.REMEDIATION or c["status"] != "remediation" or c.get("template") != "INC-0412":
        raise HTTPException(409, "No such remediation step for this case")
    who = {"callback": "Grace Liu, Procurement Lead", "receiving": "Ana Petrov, Warehouse Supervisor"}[body.kind]
    engine.add_remediation(case_id, body.kind, who)
    return {"added": body.kind}


@app.post("/api/cases/{case_id}/audit-ack")
def audit_ack(case_id: str):
    c = _case_or_404(case_id)
    if c["status"] != "remediation":
        raise HTTPException(409, "Not in remediation")
    engine.acknowledge_audit(case_id, "Rafael Moreno, Internal Audit Manager")
    return {"acknowledged": True}


@app.post("/api/cases/{case_id}/verify", status_code=202)
def verify(case_id: str):
    _case_or_404(case_id)
    if engine.waiting_for(case_id) != "remediation" or engine.busy(case_id):
        raise HTTPException(409, "The case is not waiting for verification")
    engine.resume(case_id, {"action": "verify"})
    return {"resumed": True}


class Close(BaseModel):
    by: str = Field(..., min_length=2, max_length=80)
    override_reason: str = Field("", max_length=1000)


@app.post("/api/cases/{case_id}/close", status_code=202)
def close(case_id: str, body: Close):
    _case_or_404(case_id)
    if engine.waiting_for(case_id) != "remediation" or engine.busy(case_id):
        raise HTTPException(409, "The case can't be closed from its current state")
    engine.resume(case_id, {"action": "close", "by": body.by, "override_reason": body.override_reason})
    return {"resumed": True}


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
