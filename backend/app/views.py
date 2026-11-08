"""Read models for the UI, built in code from records, case state and events. No model calls here.

overview()   answers the seven questions a finance user asks first
timeline()   dated events across ERP records, documents and the case, each with its source
lifecycle()  per action: proposed, decided, executed or task opened, verified
severity()   from scan facts and open exceptions
lookup()     resolves any cited ID to something a reviewer can read
"""
from __future__ import annotations

import re

from app import rules

CHECK_FOR = {"review_hold": "containment", "supplier_callback": "bank_change_cooling_off", "receiving_confirmation": "three_way_match",
             "due_diligence": "new_supplier_due_diligence", "escalate_to_audit": "audit_escalation", "release_for_payment": "open_exceptions"}

ROLE_OF_STEP = {
    "new": ("Start the investigation", "Elena Brandt, AP Operations Lead"),
    "investigating": ("Agents are investigating; no decision needed yet", "ControlRoom agents"),
    "awaiting_approval": ("Approve or reject the proposed actions", "Tom Okafor, Finance Director"),
    "error": ("Retry the failed step from its checkpoint", "Elena Brandt, AP Operations Lead"),
}


def severity(case: dict, state: dict) -> dict:
    exceptions = [c["test"] for c in state.get("controls") or [] if c["status"] == "exception"]
    total = float(case["potential_exposure"])
    if case["status"].startswith("closed"):
        return {"level": "Resolved", "reason": "Closed after verification" if case["status"] == "closed" else "Closed by override"}
    if state.get("controls") is not None and not exceptions:
        return {"level": "Low", "reason": "No open control exceptions after investigation"}
    linked = len(case["supplier_ids"]) > 1
    if exceptions:
        level = "High" if (len(exceptions) >= 2 or "bank_change_cooling_off" in exceptions) and total >= 50_000 else "Medium"
        return {"level": level, "reason": f"{len(exceptions)} open control exceptions, {total:,.0f} USD in the payment run"}
    return {"level": "High" if linked and total >= 100_000 else "Medium",
            "reason": ("Linked suppliers, " if linked else "One supplier, ") + f"{total:,.0f} USD near the approval limit"}


def lifecycle(action: dict, checks: list[dict]) -> list[dict]:
    """Separate states, never merged: a recommendation is not an approval, and an approval is not a result."""
    check = next((c for c in checks if c["test"] == CHECK_FOR.get(action["kind"])), None)
    if check is None and action["kind"] not in ("review_hold", "release_for_payment"):
        check = next((c for c in checks if c["test"] == "approved_tasks"), None)
    stages = [{"stage": "Proposed", "state": "done", "by": "Resolution Agent", "at": action.get("proposed_at")}]
    d = action.get("decision")
    if d is None:
        stages.append({"stage": "Decision", "state": "waiting", "by": action.get("approver_role", "Finance Director")})
        return stages
    stages.append({"stage": "Approved" if d == "approved" else "Rejected", "state": "done" if d == "approved" else "stopped",
                   "by": action.get("decided_by"), "at": action.get("decided_at"), "note": action.get("reason") or None})
    if d != "approved":
        return stages
    if action["kind"] in ("review_hold", "release_for_payment"):
        stages.append({"stage": "Executed (simulated ERP)", "state": "done" if action.get("status") == "done" else "waiting",
                       "by": "Action executor", "at": action.get("executed_at"), "note": action.get("execution")})
    else:
        done = action.get("status") == "done" or bool(action.get("acknowledged_by"))
        stages.append({"stage": "Task done" if done else "Task open", "state": "done" if done else "waiting", "by": action.get("owner")})
    if check:
        stages.append({"stage": "Verified" if check["status"] in ("pass", "exempt") else "Not yet verified",
                       "state": "done" if check["status"] in ("pass", "exempt") else "waiting",
                       "by": "Closure check (code)", "note": f"{check['test'].replace('_', ' ')}: {check['explanation']}"})
    else:
        stages.append({"stage": "Verification", "state": "waiting", "by": "Closure check (code)", "note": "Run verification to check"})
    return stages


def overview(case: dict, state: dict, events: list[dict], world: rules.World) -> dict:
    ex = rules.exposure(world, case["invoice_ids"])  # live: reflects holds and disputes made since the investigation
    passed = {c["test"] for c in (state.get("verification") or {}).get("checks") or [] if c["status"] in ("pass", "exempt")}
    exceptions = [c for c in state.get("controls") or [] if c["status"] == "exception" and c["test"] not in passed]
    briefing = state.get("briefing") or {}
    findings = briefing.get("findings") or [
        {"statement": c["explanation"], "label": "Confirmed", "cites": [c.get("id", c["test"])]} for c in exceptions]
    hyps = state.get("hypotheses") or []
    unknowns = list(state.get("unknowns") or [])
    status = case["status"]
    verification = state.get("verification") or {}
    if status in ROLE_OF_STEP:
        step, owner = ROLE_OF_STEP[status]
    elif status == "remediation":
        open_tasks = [a for a in state.get("actions") or [] if a.get("decision") == "approved" and a.get("status") == "task_open" and not a.get("acknowledged_by")]
        failing = [c for c in verification.get("checks") or [] if c["status"] == "exception"]
        if open_tasks:
            step = "Complete: " + "; ".join(f"{a['label']} ({', '.join(a['target_ids'])})" for a in open_tasks)
            owner = ", ".join(sorted({a["owner"] for a in open_tasks}))
        elif failing:
            step, owner = f"Resolve {len(failing)} failing closure checks, then run verification", "Tom Okafor, Finance Director"
        else:
            step, owner = "Run verification, then close the incident", "Tom Okafor, Finance Director"
    else:
        step, owner = "None. The incident is closed.", "—"
    raised_rule = next((e["data"].get("rule") for e in events if e["type"] == "trigger"), None)
    return {
        "what_happened": briefing.get("headline") or f"Not yet investigated. {case['trigger']}.",
        "why_raised": f"{case['trigger']}. The payment-run scan (code, not a model) flags invoices at 90 to 100% of the "
                      f"${world.limit:,.0f} approval limit (POL-01) and groups those from the same supplier or from suppliers linked by a "
                      f"shared bank account, phone or address, in the same run. Grouped requests within 7 days that together exceed the limit "
                      f"are tested against the split-purchasing policy (POL-02). A pattern is a reason to look, not proof of a bypass.",
        "threshold": {"limit": world.limit, "policy": "POL-01", "band": "90-100%", "grouping": "same or linked supplier, same payment run"},
        "how_much": {"potential_exposure": ex["total_in_run"], "invoice_total": ex["invoice_total"], "invoice_count": ex.get("invoice_count", len(case["invoice_ids"])),
                     "unsupported_by_receipts": ex["unsupported_by_receipts"], "to_unverified_changed_account": ex["to_unverified_changed_account"],
                     "pending_payment": ex.get("pending_payment"), "on_hold": ex.get("on_hold"), "already_paid": ex.get("already_paid"),
                     "confirmed_loss": None, "label": "Potential exposure, not a confirmed loss"},
        "evidence": findings[:6],
        "competing": [{"id": h["id"], "kind": h["kind"], "status": h["status"], "statement": h["statement"]} for h in hyps],
        "unknowns": unknowns[:6] or (["Investigation not started"] if status == "new" else []),
        "next_step": step, "owner": owner,
        "exceptions_open": [c["test"] for c in exceptions],
        "severity": severity(case, state),
    }


_DATE = re.compile(r"Date:\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})")


def timeline(case: dict, state: dict, events: list[dict], world: rules.World) -> list[dict]:
    items = []

    def add(at, kind, text, source, provenance, flag=None):
        if at:
            items.append({"at": at if "T" in at else at + "T00:00:00Z", "kind": kind, "text": text, "source_id": source,
                          "provenance": provenance, "flag": flag})

    sups = set(case["supplier_ids"])
    for sid in sups:
        s = world.get(sid)
        add(s["created_at"], "supplier", f"{s['legal_name']} created in the supplier master", sid, "ERP: supplier",
            "new supplier" if s["created_at"] >= "2026-10-01" else None)
    for ch in world.records.get("supplier_change", []):
        if ch["supplier_id"] in sups:
            add(ch["changed_at"], "change", f"{ch['supplier_id']} {ch['field'].replace('_', ' ')} changed {ch['old_value']} → {ch['new_value']} ({ch['reason']})",
                ch["id"], "ERP: supplier change log", None if ch.get("callback_verified") else "no callback")
    for i in case["invoice_ids"]:
        c = world.chain(i)
        pr, po, inv = c["request"], c["po"], c["invoice"]
        add(pr["created_at"], "request", f"{pr['id']} requested by {world.get(pr['requester_id'])['name']}: {pr['description']}, ${pr['amount']:,.0f}", pr["id"], "ERP: purchase request")
        add(pr["approved_at"], "approval", f"{pr['id']} approved by {world.get(pr['approver_id'])['name']} (limit ${world.get(pr['approver_id'])['approval_limit']:,.0f})", pr["id"], "ERP: purchase request")
        add(po["issued_at"], "po", f"{po['id']} issued for {po['lines'][0]['quantity']} × {po['lines'][0]['item']}", po["id"], "ERP: purchase order")
        for g in c["receipts"]:
            add(g["received_at"], "receipt", f"{g['id']} received {g['lines'][0]['quantity']} of {po['lines'][0]['quantity']} against {po['id']}", g["id"], "ERP: goods receipt",
                "short" if g["lines"][0]["quantity"] < po["lines"][0]["quantity"] else None)
        if not c["receipts"]:
            add(inv["invoice_date"], "receipt", f"No goods receipt exists for {po['id']}", po["id"], "ERP: goods receipt (absent)", "missing")
        add(inv["invoice_date"], "invoice", f"{inv['id']} invoiced ${inv['amount']:,.0f}, due {inv['due_date']}", inv["id"], "Object Storage: invoice PDF")
        for p in c["payments"]:
            add(p["scheduled_date"], "payment", f"{p['id']} {p['status'].replace('_', ' ')} in {p['run_id']} for ${p['amount']:,.0f}", p["id"], "ERP: payment schedule",
                "held" if p["status"] == "on_hold" else None)
    related = sups | set(case["invoice_ids"])
    for d in world.meta.get("documents", []):
        if d["kind"] == "email" and set(d["related"]) & related:
            m = _DATE.search(d.get("text", ""))
            if m:
                add(f"{m.group(1)}T{m.group(2)}:00Z", "email", d["title"], d["id"], "Object Storage: email",
                    "untrusted" if d["trust"] != "internal" else None)
    for e in events:
        if e["type"] in ("trigger", "decision", "action_done", "remediation_evidence", "audit_acknowledged", "close_refused", "closed"):
            items.append({"at": e["at"].isoformat() if hasattr(e["at"], "isoformat") else e["at"], "kind": "case",
                          "text": f"{e['agent']}: {e['text']}", "source_id": f"event #{e['seq']}", "provenance": "ControlRoom audit log (real time)",
                          "flag": "refused" if e["type"] == "close_refused" else None})
    items.sort(key=lambda x: x["at"])
    return items


def lookup(ref: str, case: dict, state: dict, world: rules.World, store, case_id: str) -> dict | None:
    for e in state.get("evidence") or []:
        if e["id"] == ref:
            return {"kind": "evidence", "title": f"{ref}: {e['fact']}", "label": e["label"], "excerpt": e["excerpt"],
                    "source_id": e["source_id"], "records": [e["source_id"]]}
    for c in (state.get("controls") or []) + ((state.get("verification") or {}).get("checks") or []):
        if c.get("id") == ref or f"CTL-{c['test']}" == ref:
            return {"kind": "control", "title": f"{c['test'].replace('_', ' ')} ({c['policy']}): {c['status']}", "label": c["status"],
                    "excerpt": c["explanation"], "records": c.get("records", []), "note": c.get("run_by") or "Computed by code"}
    if ref.startswith("CTL-split_purchase-"):
        r = rules.run_control_test(world, "split_purchase", case["invoice_ids"], ref.split("CTL-split_purchase-", 1)[1])
        return {"kind": "control", "title": f"split purchase with exemption {ref.split('-', 2)[2]}: {r['status']}", "label": r["status"],
                "excerpt": r["explanation"], "records": r["records"], "note": "Recomputed by code now"}
    for l in (state.get("links") or []) + [{**x, "status": "Found by matcher, awaiting assessment"}
                                            for x in rules.shared_attributes(world, case["supplier_ids"])]:
        if l["id"] == ref:
            return {"kind": "link", "title": f"{l['from']} ↔ {l['to']}: {l['explanation']}", "label": l.get("status"),
                    "excerpt": f"Shared {l['attribute'].replace('_', ' ')}: {l.get('value', '')}. Strength {l['strength']}. "
                               f"Agent assessment: {l.get('assessment', 'n/a')}. {l.get('rationale', '')}",
                    "records": l.get("records", [])}
    for h in state.get("hypotheses") or []:
        if h["id"] == ref:
            return {"kind": "hypothesis", "title": h["statement"], "label": h["status"], "excerpt": h["what_would_settle_it"],
                    "records": h["supporting"] + h["contradicting"]}
    d = store.document(ref, case_id)
    if d:
        text = store.document_text(ref, case_id)
        return {"kind": "document", "title": d["title"], "label": d["trust"], "excerpt": text[:2500], "records": d["related"],
                "note": f"Original in Vultr Object Storage: {d['s3_key']} (sha256 {d['sha256'][:16]}…)", "open": f"/api/documents/{ref}?case={case_id}"}
    r = world.get(ref)
    if r:
        return {"kind": world.kind(ref), "title": f"{world.kind(ref).replace('_', ' ')} {ref}", "label": "ERP record", "fields": r, "records": []}
    return None
