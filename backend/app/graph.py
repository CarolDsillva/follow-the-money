"""The LangGraph workflow. State lives in Postgres: case data in `cases`, checkpoints in LangGraph's tables.

commander_plan -> evidence -> (relationships || controls) -> exposure -> challenge -> briefing
  -> resolution -> [approval interrupt] -> execute -> [remediation interrupt] <-> verify / close
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import os
import threading
import traceback
from pathlib import Path
from typing import TypedDict

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from app import agents, northstar, rules
from app.llm import Gateway, LLMError
from app.store import Store, now


class S(TypedDict, total=False):
    case_id: str
    closed: bool


class Engine:
    def __init__(self, store: Store, api_key: str):
        self.store = store
        self.api_key = api_key
        self.saver = PostgresSaver(store.pool)
        self.saver.setup()
        self.graph = self._build().compile(checkpointer=self.saver)
        self.running: dict[str, threading.Thread] = {}
        self.key = self._signing_key()

    # -------------------------------------------------------------- helpers
    def ctx(self, case_id: str) -> agents.Ctx:
        return agents.Ctx(self.store, Gateway(self.api_key), case_id)

    def _signing_key(self) -> Ed25519PrivateKey:
        path = Path(os.environ.get("SIGNING_KEY_PATH", Path(__file__).resolve().parents[2] / ".secrets" / "signing.key"))
        if path.exists():
            return serialization.load_pem_private_key(path.read_bytes(), None)
        key = Ed25519PrivateKey.generate()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        return key

    def public_key(self) -> str:
        raw = self.key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        return base64.b64encode(raw).decode()

    # -------------------------------------------------------------- nodes
    def _node(self, fn):
        def run(state: S):
            fn(self.ctx(state["case_id"]))
            return {}
        return run

    def _approval(self, state: S):
        decision = interrupt({"waiting_for": "approval"})
        ctx = self.ctx(state["case_id"])
        st = ctx.state()
        actions = st.get("actions", [])
        by = decision.get("by", "Reviewer")
        for a in actions:
            d = decision.get("decisions", {}).get(a["id"])
            if d:
                a["decision"] = d.get("decision")
                a["decided_by"] = by
                a["decided_at"] = now()
                a["reason"] = d.get("reason", "")
                ctx.emit(by, "decision", f"{a['decision'].capitalize()}: {a['label']} ({', '.join(a['target_ids'])})",
                         {"action_id": a["id"], "decision": a["decision"], "reason": a["reason"]})
        self.store.merge_state(state["case_id"], {"actions": actions})
        return {}

    def _execute(self, state: S):
        """Applies approved actions to the ERP simulator. This is the only writer, and it has no payment action."""
        ctx = self.ctx(state["case_id"])
        st = ctx.state()
        actions = st.get("actions", [])
        for a in actions:
            if a.get("decision") != "approved":
                a["status"] = "rejected" if a.get("decision") == "rejected" else "not decided"
                continue
            if a["kind"] == "review_hold":
                for inv in a["target_ids"]:
                    for p in ctx.world.find("payment", invoice_id=inv):
                        if p["status"] == "scheduled":
                            self.store.update_record(state["case_id"], p["id"], {"status": "on_hold", "hold_reason": f"{state['case_id']} review"})
                    self.store.update_record(state["case_id"], inv, {"status": "on_review_hold"})
                a["status"] = "done"
                a["executed_at"] = now()
                held = [p["id"] for inv in a["target_ids"] for p in ctx.world.find("payment", invoice_id=inv)]
                a["execution"] = f"Simulated in the ERP simulator: {', '.join(held)} set to on hold; invoices set to review hold. No bank or ERP outside the demo was touched."
                ctx.emit("Action executor", "action_done", f"Review hold placed on {', '.join(a['target_ids'])}. Payments removed from {ctx.world.run['id']}.", a)
            elif a["kind"] == "release_for_payment":
                a["status"] = "done"
                a["executed_at"] = now()
                a["execution"] = "Simulated: invoices left scheduled in the payment run. ControlRoom never pays anyone."
                ctx.emit("Action executor", "action_done", f"{', '.join(a['target_ids'])} left in {ctx.world.run['id']} unchanged.", a)
            else:
                a["status"] = "task_open"
                a["task_opened_at"] = now()
                ctx.emit("Action executor", "task_created", f"Task for {a['owner']}: {a['label']} ({', '.join(a['target_ids'])})", a)
        self.store.merge_state(state["case_id"], {"actions": actions}, status="remediation")
        return {}

    def _remediation(self, state: S):
        command = interrupt({"waiting_for": "remediation"})
        ctx = self.ctx(state["case_id"])
        if command.get("action") == "close":
            return self._close(ctx, command)
        self._verify(ctx)
        return {}

    def _verify(self, ctx: agents.Ctx) -> list[dict]:
        st = ctx.state()
        checks = rules.closure_checks(ctx.world, {**ctx.case, **st, "invoice_ids": ctx.case["invoice_ids"]})
        ok = rules.may_close(checks)
        ctx.emit("Verification engine", "checks", f"{sum(c['status'] in ('pass', 'exempt') for c in checks)} of {len(checks)} closure checks pass",
                 {"checks": checks})
        new_docs = st.get("remediation_docs", [])
        try:
            v = agents.verification_agent(ctx, checks, new_docs)
        except LLMError as e:
            v = {"recommendation": "keep_open", "reasons": [f"Verification Agent unavailable: {e}"]}
        if v.get("recommendation") == "close" and not ok:
            ctx.emit("Verification engine", "override_blocked", "The agent recommended closing, but code found failing checks. The case stays open.", {})
            v["recommendation"] = "keep_open"
        self.store.merge_state(ctx.case_id, {"verification": {"checks": checks, "may_close": ok, "agent": v, "at": now()}})
        ctx.emit("Verification Agent", "verification", ("Ready to close: " if ok else "Keep open: ") + "; ".join(v.get("reasons", []))[:500], v)
        return checks

    def _close(self, ctx: agents.Ctx, command: dict):
        st = ctx.state()
        checks = rules.closure_checks(ctx.world, {**ctx.case, **st, "invoice_ids": ctx.case["invoice_ids"]})
        ok = rules.may_close(checks)
        by = command.get("by", "Reviewer")
        reason = (command.get("override_reason") or "").strip()
        if not ok and not reason:
            failing = [c for c in checks if c["status"] == "exception"]
            ctx.emit("Closure gate", "close_refused", f"Close refused: {len(failing)} of {len(checks)} closure checks fail.",
                     {"failing": failing, "by": by})
            self.store.merge_state(ctx.case_id, {"verification": {**st.get("verification", {}), "checks": checks, "may_close": False,
                                                                  "last_refusal": now()}})
            return {}
        report = self._report(ctx, checks, by, reason if not ok else "")
        status = "closed" if ok else "closed_override"
        self.store.merge_state(ctx.case_id, {"closure": report["closure"], "report": report["stored"]}, status=status)
        ctx.emit(by, "closed", ("Closed after verification" if ok else f"Closed by override: {reason}") +
                 f". Signed report stored in Vultr Object Storage ({report['stored']['key']}).", report["stored"])
        return {"closed": True}

    def _report(self, ctx: agents.Ctx, checks, by, override) -> dict:
        st = ctx.state()
        closure = {"by": by, "at": now(), "override_reason": override or None, "checks": checks}
        body = {"case": {k: ctx.case[k] for k in ("id", "title", "invoice_ids", "supplier_ids", "trigger")},
                "synthetic_data": True, "plan": st.get("plan"), "evidence": st.get("evidence"), "links": st.get("links"),
                "controls": st.get("controls"), "exposure": st.get("exposure"), "hypotheses": st.get("hypotheses"),
                "briefing": st.get("briefing"), "actions": st.get("actions"), "verification": st.get("verification"),
                "closure": closure, "events": [{k: str(v) if k == "at" else v for k, v in e.items()} for e in self.store.events(ctx.case_id)]}
        payload = json.dumps(body, sort_keys=True, default=str).encode()
        digest = hashlib.sha256(payload).hexdigest()
        sig = base64.b64encode(self.key.sign(payload)).decode()
        signed = json.dumps({"report": body, "sha256": digest, "signature_ed25519": sig, "public_key": self.public_key()},
                            default=str, indent=1).encode()
        key = self.store.put_report(ctx.case_id, signed)
        return {"closure": closure, "stored": {"key": key, "sha256": digest, "bytes": len(signed)}}

    def _after_remediation(self, state: S):
        return END if state.get("closed") else "remediation"

    def _build(self) -> StateGraph:
        g = StateGraph(S)
        g.add_node("commander_plan", self._node(agents.commander_plan))
        g.add_node("evidence", self._node(agents.evidence_agent))
        g.add_node("relationships", self._node(agents.relationship_agent))
        g.add_node("controls", self._node(agents.control_agent))
        g.add_node("exposure", self._node(agents.exposure_engine))
        g.add_node("challenge", self._node(agents.challenge_agent))
        g.add_node("briefing", self._node(agents.commander_brief))
        g.add_node("resolution", self._node(agents.resolution_agent))
        g.add_node("approval", self._approval)
        g.add_node("execute", self._execute)
        g.add_node("remediation", self._remediation)
        g.add_edge(START, "commander_plan")
        g.add_edge("commander_plan", "evidence")
        g.add_edge("evidence", "relationships")
        g.add_edge("evidence", "controls")
        g.add_edge(["relationships", "controls"], "exposure")
        g.add_edge("exposure", "challenge")
        g.add_edge("challenge", "briefing")
        g.add_edge("briefing", "resolution")
        g.add_edge("resolution", "approval")
        g.add_edge("approval", "execute")
        g.add_edge("execute", "remediation")
        g.add_conditional_edges("remediation", self._after_remediation, ["remediation", END])
        return g

    # -------------------------------------------------------------- running
    def _config(self, case_id: str) -> dict:
        return {"configurable": {"thread_id": case_id}, "recursion_limit": 100}

    def busy(self, case_id: str) -> bool:
        t = self.running.get(case_id)
        return bool(t and t.is_alive())

    def _spawn(self, case_id: str, payload):
        if self.busy(case_id):
            raise RuntimeError("This case is already running a step")

        def work():
            try:
                self.graph.invoke(payload, self._config(case_id))
            except Exception as e:  # recorded on the case, never silent
                self.store.event(case_id, "System", "error", f"{type(e).__name__}: {str(e)[:300]}", {"trace": traceback.format_exc()[-2000:]})
                self.store.set_status(case_id, "error")
        t = threading.Thread(target=work, daemon=True)
        self.running[case_id] = t
        t.start()

    def start(self, case_id: str):
        self.store.set_status(case_id, "investigating")
        self.store.event(case_id, "System", "run_started", "Investigation started", {})
        self._spawn(case_id, {"case_id": case_id})

    def waiting_for(self, case_id: str) -> str | None:
        snap = self.graph.get_state(self._config(case_id))
        for task in snap.tasks:
            for intr in task.interrupts:
                return intr.value.get("waiting_for")
        return None

    def retry(self, case_id: str):
        """Continue a failed run from its last Postgres checkpoint. Finished agent steps are not repeated."""
        snap = self.graph.get_state(self._config(case_id))
        self.store.set_status(case_id, "investigating")
        self.store.event(case_id, "System", "resumed", f"Retrying from the last checkpoint: {', '.join(snap.next) or 'start'}", {"next": list(snap.next)})
        self._spawn(case_id, None if snap.next else {"case_id": case_id})

    def resume(self, case_id: str, value: dict):
        self._spawn(case_id, Command(resume=value))

    def recover(self):
        """After a restart: a case stuck mid-step resumes from its last Postgres checkpoint."""
        for c in self.store.q("SELECT id FROM cases WHERE status = 'investigating'"):
            snap = self.graph.get_state(self._config(c["id"]))
            if snap.next and not any(t.interrupts for t in snap.tasks):
                self.store.event(c["id"], "System", "resumed", "API restarted. Resuming from the last checkpoint in Postgres.", {"next": list(snap.next)})
                self._spawn(c["id"], None)

    def add_remediation(self, case_id: str, kind: str, by: str):
        rem = northstar.REMEDIATION[kind]
        from app.seed import upload
        upload(self.store, rem["document"], scope=case_id)
        for rk, rid, changes in rem["updates"]:
            self.store.update_record(case_id, rid, changes)
        st = self.store.case(case_id)["state"]
        docs = sorted(set(st.get("remediation_docs", [])) | {rem["document"]["id"]})
        completes = {"callback": ("supplier_callback", "due_diligence"), "receiving": ("receiving_confirmation",)}[kind]
        actions = st.get("actions", [])
        for a in actions:
            if a["kind"] in completes and a.get("decision") == "approved":
                a["status"] = "done"
                a["completed_by"] = by
                a["completed_at"] = now()
                a["evidence_doc"] = rem["document"]["id"]
        self.store.merge_state(case_id, {"remediation_docs": docs, "actions": actions})
        self.store.event(case_id, by, "remediation_evidence", f"{rem['label']}: {rem['document']['title']} uploaded to Object Storage",
                         {"document_id": rem["document"]["id"], "updates": [[r, i] for r, i, _ in rem["updates"]]})

    def complete_task(self, case_id: str, action_id: str, by: str, note: str):
        st = self.store.case(case_id)["state"]
        actions = st.get("actions", [])
        a = next((x for x in actions if x["id"] == action_id), None)
        if not a or a.get("decision") != "approved" or a.get("status") != "task_open":
            raise KeyError(action_id)
        a.update(status="done", completed_by=by, completed_at=now(), completion_note=note)
        self.store.merge_state(case_id, {"actions": actions})
        self.store.event(case_id, by, "task_done", f"Completed: {a['label']} ({', '.join(a['target_ids'])}). Note: {note}", {"action_id": action_id})

    def acknowledge_audit(self, case_id: str, by: str):
        st = self.store.case(case_id)["state"]
        for a in st.get("actions", []):
            if a["kind"] == "escalate_to_audit" and a.get("decision") == "approved":
                a["acknowledged_by"] = by
                a["completed_at"] = now()
                a["status"] = "done"
        self.store.merge_state(case_id, {"actions": st.get("actions", [])})
        self.store.event(case_id, by, "audit_acknowledged", "Internal Audit acknowledged the approval-pattern finding and opened a review.", {})
