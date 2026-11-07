"""The deterministic engine on the seeded Northstar world. No network, no model."""
import copy

import pytest

from app import northstar, rules

A = ["INV-104", "INV-108", "INV-112"]
B = ["INV-131", "INV-133", "INV-135"]


@pytest.fixture()
def data():
    return northstar.build()


def world(data, changes=()):
    d = copy.deepcopy(data)
    for kind, rid, patch in changes:
        next(r for r in d["records"][kind] if r["id"] == rid).update(patch)
    return rules.World(d["records"], d)


def test_ids_are_unique(data):
    ids = [r["id"] for rows in data["records"].values() for r in rows] + [x["id"] for x in data["documents"]]
    assert len(ids) == len(set(ids))


def test_scan_opens_exactly_the_two_planted_incidents(data):
    found = rules.payment_run_scan(world(data))
    assert [f["invoice_ids"] for f in found] == [A, B]
    assert found[0]["total"] == 144_000


def test_business_park_address_is_weak(data):
    links = rules.shared_attributes(world(data))
    park = [l for l in links if l["attribute"] == "address" and "Pacific Commerce Park" in l["value"]]
    assert park and all(l["strength"] == "weak" for l in park)
    assert any(l["attribute"] == "bank_account_token" and l["strength"] == "strong" for l in links)


def test_lookalike_sender_found(data):
    hits = rules.lookalike_domains(world(data))
    assert [(h["document_id"], h["supplier_id"]) for h in hits] == [("EML-019", "SUP-B")]


def test_incident_a_controls(data):
    w = world(data)
    status = {t: rules.run_control_test(w, t, A)["status"] for t in rules.CONTROL_TESTS}
    assert status == {"split_purchase": "exception", "approval_limit": "pass", "segregation_of_duties": "pass",
                      "bank_change_cooling_off": "exception", "three_way_match": "exception", "new_supplier_due_diligence": "exception"}


def test_contract_exempts_b_but_not_a(data):
    w = world(data)
    assert rules.run_control_test(w, "split_purchase", B)["status"] == "exception"
    assert rules.run_control_test(w, "split_purchase", B, "FA-2026-03")["status"] == "exempt"
    assert rules.run_control_test(w, "split_purchase", A, "FA-2026-03")["status"] == "exception"
    assert rules.run_control_test(w, "split_purchase", B, "FA-9999")["status"] == "exception"


def test_exposure_is_exact(data):
    e = rules.exposure(world(data), A)
    assert e["total_in_run"] == 144_000
    assert e["unsupported_by_receipts"] == 80 * 235 + 140 * 350
    assert e["to_unverified_changed_account"] == 48_000


def test_unknown_test_and_bad_ids_rejected(data):
    w = world(data)
    with pytest.raises(ValueError):
        rules.run_control_test(w, "drop_tables", A)
    with pytest.raises(ValueError):
        rules.run_control_test(w, "three_way_match", ["SUP-A"])


def case_a(actions=()):
    return {"invoice_ids": A, "controls": [{"test": t, "status": "exception"} for t in
                                         ("split_purchase", "bank_change_cooling_off", "three_way_match", "new_supplier_due_diligence")],
            "actions": list(actions)}


def test_closure_refused_until_remediated(data):
    esc = {"kind": "escalate_to_audit", "decision": "approved"}
    checks = rules.closure_checks(world(data), case_a([esc]))
    assert not rules.may_close(checks)
    assert {c["test"] for c in checks if c["status"] == "exception"} == {
        "containment", "bank_change_cooling_off", "three_way_match", "new_supplier_due_diligence", "audit_escalation"}

    held = [("payment", p["id"], {"status": "on_hold"}) for p in data["records"]["payment"] if p["invoice_id"] in A]
    fixes = held + [u for r in northstar.REMEDIATION.values() for u in r["updates"]]
    w = world(data, fixes)
    assert not rules.may_close(rules.closure_checks(w, case_a([esc])))  # audit not acknowledged yet
    assert rules.may_close(rules.closure_checks(w, case_a([{**esc, "acknowledged_by": "Rafael Moreno"}])))


def test_benign_case_may_close_when_exempt(data):
    case = {"invoice_ids": B, "controls": [{"test": "split_purchase", "status": "exempt"}], "actions": []}
    assert rules.may_close(rules.closure_checks(world(data), case))
