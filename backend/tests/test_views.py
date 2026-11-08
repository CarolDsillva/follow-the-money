"""Overview, timeline, action lifecycle and severity: code-built read models, no network."""
import datetime as dt

from app import northstar, rules, views

A = ["INV-104", "INV-108", "INV-112"]


def world():
    d = northstar.build()
    return rules.World(d["records"], d)


def case(status="new", **state):
    return {"id": "INC-T", "status": status, "invoice_ids": A, "supplier_ids": ["SUP-A", "SUP-B", "SUP-C"],
            "trigger": "3 invoices near the limit", "potential_exposure": 144000, "state": state}


def test_exposure_breakdown_separates_pending_paid_and_loss():
    e = rules.exposure(world(), A)
    assert e["invoice_count"] == 3 and e["invoice_total"] == 144_000
    assert e["pending_payment"] == 144_000 and e["on_hold"] == 0 and e["already_paid"] == 0
    assert e["confirmed_loss"] is None and "not" in e["excludes"].lower()


def test_overview_before_investigation_names_next_step_and_owner():
    c = case()
    o = views.overview(c, c["state"], [], world())
    assert o["next_step"] == "Start the investigation" and "AP Operations Lead" in o["owner"]
    assert o["how_much"]["potential_exposure"] == 144_000 and o["how_much"]["confirmed_loss"] is None
    assert o["severity"]["level"] == "High"


def test_lifecycle_keeps_proposal_approval_execution_and_verification_apart():
    a = {"kind": "review_hold", "decision": None, "proposed_at": "t0", "approver_role": "Finance Director"}
    assert [s["stage"] for s in views.lifecycle(a, [])] == ["Proposed", "Decision"]
    a.update(decision="approved", decided_by="Tom", status="done", executed_at="t1")
    stages = views.lifecycle(a, [{"test": "containment", "status": "pass", "explanation": "ok"}])
    assert [s["stage"] for s in stages] == ["Proposed", "Approved", "Executed (simulated ERP)", "Verified"]
    r = views.lifecycle({**a, "decision": "rejected"}, [])
    assert [s["stage"] for s in r] == ["Proposed", "Rejected"]


def test_task_is_not_verified_until_its_check_passes():
    a = {"kind": "supplier_callback", "decision": "approved", "status": "task_open", "proposed_at": "t0"}
    stages = views.lifecycle(a, [{"test": "bank_change_cooling_off", "status": "exception", "explanation": "no callback"}])
    assert stages[-2]["stage"] == "Task open" and stages[-1]["stage"] == "Not yet verified"


def test_timeline_is_ordered_and_sourced():
    w = world()
    c = case()
    items = views.timeline(c, {}, [{"type": "trigger", "seq": 1, "agent": "scan", "text": "opened",
                                    "at": dt.datetime(2026, 11, 9, tzinfo=dt.timezone.utc), "data": {}}], w)
    assert [i["at"] for i in items] == sorted(i["at"] for i in items)
    assert all(i["source_id"] and i["provenance"] for i in items)
    kinds = {i["kind"] for i in items}
    assert {"supplier", "change", "request", "approval", "receipt", "invoice", "payment", "email", "case"} <= kinds
    assert any(i["source_id"] == "EML-019" and i["flag"] == "untrusted" for i in items)
    assert any(i["source_id"] == "PO-7112" and i["flag"] == "missing" for i in items)
