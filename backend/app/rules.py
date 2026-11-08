"""The deterministic engine. Every number, match, policy result and closure decision is code.

Agents choose what to test and explain results; they never compute pass/fail or money.
Each function returns plain dicts that cite the record IDs they used.
"""
from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict
from itertools import combinations


def _ts(value: str) -> dt.datetime:
    v = value.replace("Z", "+00:00")
    if len(v) == 10:
        v += "T00:00:00+00:00"
    return dt.datetime.fromisoformat(v)


def _domain_root(email: str) -> str:
    domain = email.split("@")[-1].lower()
    return domain.split(".")[0]


def _normalise(name: str) -> str:
    return re.sub(r"[^a-z]", "", name.lower().replace("0", "o").replace("1", "l"))


class World:
    """Read-only view over the ERP simulator's records."""

    def __init__(self, records: dict[str, list[dict]], meta: dict):
        self.records = records
        self.meta = meta
        self.by_id = {r["id"]: (kind, r) for kind, rows in records.items() for r in rows}

    def get(self, record_id: str) -> dict | None:
        hit = self.by_id.get(record_id)
        return hit[1] if hit else None

    def kind(self, record_id: str) -> str | None:
        hit = self.by_id.get(record_id)
        return hit[0] if hit else None

    def find(self, kind: str, **filters) -> list[dict]:
        return [r for r in self.records.get(kind, []) if all(r.get(k) == v for k, v in filters.items())]

    @property
    def limit(self) -> float:
        return self.meta["approval_limit"]

    @property
    def run(self) -> dict:
        return self.meta["payment_run"]

    def chain(self, invoice_id: str) -> dict:
        inv = self.get(invoice_id)
        po = self.get(inv["po_id"]) if inv else None
        pr = self.get(po["request_id"]) if po else None
        grns = self.find("goods_receipt", po_id=po["id"]) if po else []
        pays = self.find("payment", invoice_id=invoice_id)
        return {"invoice": inv, "po": po, "request": pr, "receipts": grns, "payments": pays,
                "supplier": self.get(inv["supplier_id"]) if inv else None}


# ---------------------------------------------------------------- relationships

ATTRS = [
    ("bank_account_token", "strong", "same bank account"),
    ("phone", "medium", "same phone number"),
    ("address", "medium", "same address"),
]


def shared_attributes(world: World, supplier_ids: list[str] | None = None) -> list[dict]:
    """Pairs of suppliers that share an identifying attribute, with match strength.

    An address at a registered multi-tenant site counts as weak: sharing a business park
    with 63 other companies is not a relationship.
    """
    sups = [s for s in world.records["supplier"] if not supplier_ids or s["id"] in supplier_ids]
    sites = {s["address"]: s for s in world.records.get("site", [])}
    links = []
    for a, b in combinations(sups, 2):
        for field, strength, label in ATTRS:
            if a.get(field) and a.get(field) == b.get(field):
                s = strength
                note = label
                site = sites.get(a[field]) if field == "address" else None
                if site and site["type"].startswith("multi-tenant"):
                    s, note = "weak", f"same address, but it is a {site['type']} with {site['registered_businesses']} businesses ({site['id']})"
                links.append({"id": f"LNK-{a['id']}-{b['id']}-{field}", "from": a["id"], "to": b["id"], "attribute": field,
                              "value": a[field], "strength": s, "explanation": note,
                              "records": [a["id"], b["id"]] + ([site["id"]] if site else [])})
    return links


def lookalike_domains(world: World) -> list[dict]:
    """Emails whose sender domain imitates a supplier's real domain (for example 0 for o)."""
    out = []
    for d in world.meta.get("documents", []):
        if d["kind"] != "email":
            continue
        m = re.search(r"<([^>]+@[^>]+)>", d["text"])
        if not m:
            continue
        sender = m.group(1).split("@")[1].lower()
        for s in world.records["supplier"]:
            real = s["contact_email"].split("@")[1].lower()
            if sender != real and _normalise(sender) == _normalise(real):
                out.append({"document_id": d["id"], "sender_domain": sender, "supplier_id": s["id"], "real_domain": real})
    return out


def supplier_groups(world: World, min_strength: str = "medium") -> list[set[str]]:
    rank = {"weak": 0, "medium": 1, "strong": 2}
    parent: dict[str, str] = {s["id"]: s["id"] for s in world.records["supplier"]}

    def root(x):
        while parent[x] != x:
            x = parent[x]
        return x

    for link in shared_attributes(world):
        if rank[link["strength"]] >= rank[min_strength]:
            parent[root(link["from"])] = root(link["to"])
    groups = defaultdict(set)
    for sid in parent:
        groups[root(sid)].add(sid)
    return list(groups.values())


# ---------------------------------------------------------------- control tests

def _result(test, policy, status, explanation, records, **inputs):
    return {"test": test, "policy": policy, "status": status, "explanation": explanation,
            "records": sorted(set(records)), "inputs": inputs}


def split_purchase(world: World, invoice_ids: list[str], exemption_contract: str | None = None) -> dict:
    window = next(p for p in world.records["policy"] if p["id"] == "POL-02")["window_days"]
    chains = [world.chain(i) for i in invoice_ids if world.get(i)]
    reqs = [c["request"] for c in chains]
    if len(reqs) < 2:
        return _result("split_purchase", "POL-02", "not_applicable", "Fewer than two requests.", invoice_ids)
    times = sorted(_ts(r["created_at"]) for r in reqs)
    span_days = (times[-1] - times[0]).total_seconds() / 86400
    total = sum(r["amount"] for r in reqs)
    all_below = all(r["amount"] <= world.limit for r in reqs)
    recs = [r["id"] for r in reqs] + invoice_ids
    span_text = f"{span_days * 24 * 60:.0f} minutes" if span_days < 1 else f"{span_days:.1f} days"
    if not (span_days <= window and total > world.limit and all_below):
        return _result("split_purchase", "POL-02", "pass",
                       f"{len(reqs)} requests over {span_text}, total ${total:,.2f}; not a split pattern.", recs,
                       total=total, span_days=round(span_days, 3))
    if exemption_contract:
        c = world.get(exemption_contract)
        approver = world.get(c["approved_by"]) if c else None
        sups = {r["supplier_id"] for r in reqs}
        ok = (c is not None and world.kind(exemption_contract) == "contract" and sups == {c["supplier_id"]}
              and total <= c["total_value"] and approver and approver["approval_limit"] >= total
              and all(r.get("contract_id") == c["id"] for r in reqs))
        if ok:
            return _result("split_purchase", "POL-02", "exempt",
                           f"Covered by {c['id']} ({c['title']}), value ${c['total_value']:,.0f}, approved by {approver['name']} "
                           f"whose limit is ${approver['approval_limit']:,.0f}. Each request references the agreement.",
                           recs + [c["id"], approver["id"]], total=total, contract=c["id"])
        recs.append(exemption_contract)
        why = "does not exist" if c is None else "does not cover these requests, suppliers or amount"
        return _result("split_purchase", "POL-02", "exception",
                       f"Claimed exemption {exemption_contract} {why}. {len(reqs)} requests within {span_text}, each under "
                       f"${world.limit:,.0f}, total ${total:,.2f}.", recs, total=total, span_days=round(span_days, 3))
    return _result("split_purchase", "POL-02", "exception",
                   f"{len(reqs)} requests within {span_text}, each under the ${world.limit:,.0f} limit, together ${total:,.2f}. "
                   f"Approved by {', '.join(sorted({world.get(r['approver_id'])['name'] for r in reqs}))}.",
                   recs, total=total, span_days=round(span_days, 3))


def approval_limit(world: World, invoice_ids: list[str]) -> dict:
    bad, recs = [], []
    for i in invoice_ids:
        r = world.chain(i)["request"]
        a = world.get(r["approver_id"])
        recs += [r["id"], a["id"]]
        if r["amount"] > a["approval_limit"]:
            bad.append(f"{r['id']} ${r['amount']:,.2f} > {a['name']}'s limit ${a['approval_limit']:,.0f}")
    if bad:
        return _result("approval_limit", "POL-01", "exception", "; ".join(bad), recs)
    return _result("approval_limit", "POL-01", "pass", "Each request is within its approver's individual limit.", recs)


def segregation_of_duties(world: World, invoice_ids: list[str]) -> dict:
    recs, bad = [], []
    for i in invoice_ids:
        r = world.chain(i)["request"]
        recs.append(r["id"])
        if r["requester_id"] == r["approver_id"]:
            bad.append(r["id"])
    if bad:
        return _result("segregation_of_duties", "POL-05", "exception", f"Requester approved their own request: {', '.join(bad)}", recs)
    return _result("segregation_of_duties", "POL-05", "pass", "Requester and approver differ on every request.", recs)


def bank_change_cooling_off(world: World, invoice_ids: list[str]) -> dict:
    days = next(p for p in world.records["policy"] if p["id"] == "POL-03")["days"]
    pay_at = _ts(world.run["scheduled_for"])
    recs, bad, ok = [], [], []
    for i in invoice_ids:
        sid = world.get(i)["supplier_id"]
        for ch in world.find("supplier_change", supplier_id=sid, field="bank_account_token"):
            age = (pay_at - _ts(ch["changed_at"])).total_seconds() / 86400
            if age < days:
                recs += [ch["id"], sid, i]
                if ch.get("callback_verified"):
                    ok.append(f"{ch['id']} verified by callback ({ch.get('callback_note', 'note on file')})"
                              + (", change reverted" if ch.get("status") == "reverted" else ""))
                else:
                    bad.append(f"{ch['id']}: {sid} bank account changed {ch['old_value']} to {ch['new_value']} "
                               f"{age:.1f} days before the payment run, no callback on record")
    if bad:
        return _result("bank_change_cooling_off", "POL-03", "exception", "; ".join(bad), recs)
    if ok:
        return _result("bank_change_cooling_off", "POL-03", "pass", "; ".join(ok), recs)
    return _result("bank_change_cooling_off", "POL-03", "pass", f"No bank change within {days} days for these suppliers.", invoice_ids)


def three_way_match(world: World, invoice_ids: list[str]) -> dict:
    recs, bad, notes = [], [], []
    for i in invoice_ids:
        c = world.chain(i)
        inv = c["invoice"]
        billed = sum(l["quantity"] for l in inv["lines"])
        received = sum(l["quantity"] for g in c["receipts"] for l in g["lines"])
        price = inv["lines"][0]["unit_price"]
        recs += [i, c["po"]["id"]] + [g["id"] for g in c["receipts"]]
        if billed <= received:
            continue
        supported = received * price
        payable = inv.get("payable_amount", inv["amount"])
        if inv["status"] in ("disputed", "rejected") and payable <= supported + 0.005:
            notes.append(f"{i} {inv['status']}: payable ${payable:,.2f} matches {received} received")
            continue
        bad.append(f"{i}: billed {billed}, received {received}; ${(billed - received) * price:,.2f} unsupported")
    if bad:
        return _result("three_way_match", "POL-04", "exception", "; ".join(bad), recs)
    return _result("three_way_match", "POL-04", "pass",
                   "; ".join(notes) if notes else "Billed quantities are covered by goods receipts.", recs)


def new_supplier_due_diligence(world: World, invoice_ids: list[str]) -> dict:
    days = next(p for p in world.records["policy"] if p["id"] == "POL-06")["days"]
    pay_at = _ts(world.run["scheduled_for"])
    recs, bad = [], []
    for sid in sorted({world.get(i)["supplier_id"] for i in invoice_ids}):
        s = world.get(sid)
        recs.append(sid)
        age = (pay_at - _ts(s["created_at"])).days
        if s.get("status") == "blocked":
            continue
        if age < days and s.get("due_diligence") != "complete":
            bad.append(f"{sid} {s['legal_name']} created {age} days before first payment; due diligence {s.get('due_diligence')}")
    if bad:
        return _result("new_supplier_due_diligence", "POL-06", "exception", "; ".join(bad), recs)
    blocked = [sid for sid in recs if (world.get(sid) or {}).get("status") == "blocked"]
    note = f" Blocked after failed due diligence: {', '.join(blocked)}." if blocked else ""
    return _result("new_supplier_due_diligence", "POL-06", "pass", "No new supplier is payable without due diligence." + note, recs)


CONTROL_TESTS = {
    "split_purchase": split_purchase,
    "approval_limit": approval_limit,
    "segregation_of_duties": segregation_of_duties,
    "bank_change_cooling_off": bank_change_cooling_off,
    "three_way_match": three_way_match,
    "new_supplier_due_diligence": new_supplier_due_diligence,
}


def run_control_test(world: World, test: str, invoice_ids: list[str], exemption_contract: str | None = None) -> dict:
    if test not in CONTROL_TESTS:
        raise ValueError(f"Unknown control test {test}")
    missing = [i for i in invoice_ids if world.kind(i) != "invoice"]
    if missing:
        raise ValueError(f"Not invoice IDs: {missing}")
    if test == "split_purchase":
        return split_purchase(world, invoice_ids, exemption_contract)
    return CONTROL_TESTS[test](world, invoice_ids)


# ---------------------------------------------------------------- exposure

def exposure(world: World, invoice_ids: list[str]) -> dict:
    """Potential exposure, not loss. Every line names its records and arithmetic."""
    pay_at = _ts(world.run["scheduled_for"])
    lines, scheduled_total, unsupported_total, changed_total = [], 0.0, 0.0, 0.0
    for i in sorted(invoice_ids):
        c = world.chain(i)
        inv = c["invoice"]
        price = inv["lines"][0]["unit_price"]
        billed = sum(l["quantity"] for l in inv["lines"])
        received = sum(l["quantity"] for g in c["receipts"] for l in g["lines"])
        scheduled = sum(p["amount"] for p in c["payments"] if p["status"] == "scheduled" and p["run_id"] == world.run["id"])
        held = sum(p["amount"] for p in c["payments"] if p["status"] == "on_hold")
        unsupported = max(0, billed - received) * price
        recent_change = any((pay_at - _ts(ch["changed_at"])).days < 14 and not ch.get("callback_verified")
                            for ch in world.find("supplier_change", supplier_id=inv["supplier_id"], field="bank_account_token"))
        at_risk = scheduled + held
        scheduled_total += at_risk
        unsupported_total += unsupported
        changed_total += at_risk if recent_change else 0
        lines.append({"invoice_id": i, "supplier_id": inv["supplier_id"], "amount": inv["amount"],
                      "in_payment_run": at_risk, "payment_status": "on hold" if held else ("scheduled" if scheduled else "not scheduled"),
                      "billed_qty": billed, "received_qty": received, "unit_price": price,
                      "unsupported_value": unsupported,
                      "formula": f"({billed} billed - {received} received) x ${price:,.2f} = ${unsupported:,.2f}",
                      "to_recently_changed_account": recent_change,
                      "records": [i, c["po"]["id"]] + [g["id"] for g in c["receipts"]] + [p["id"] for p in c["payments"]]})
    pays = [p for i in invoice_ids for p in world.find("payment", invoice_id=i)]
    return {"currency": world.meta["currency"], "run_id": world.run["id"], "lines": lines,
            "invoice_count": len(lines), "invoice_total": sum(l["amount"] for l in lines),
            "pending_payment": sum(p["amount"] for p in pays if p["status"] == "scheduled"),
            "on_hold": sum(p["amount"] for p in pays if p["status"] == "on_hold"),
            "already_paid": sum(p["amount"] for p in pays if p["status"] == "paid"),
            "confirmed_loss": None,
            "includes": f"Invoices {', '.join(sorted(invoice_ids))} scheduled or held in {world.run['id']}; receipt shortfall at invoiced unit price; "
                        "payments to a bank account changed in the last 14 days without a callback.",
            "excludes": "Other invoices from these suppliers, earlier paid invoices, tax, freight and any recovery. "
                        "No loss is confirmed: nothing has been paid and no misconduct is established.",
            "total_in_run": scheduled_total, "unsupported_by_receipts": unsupported_total,
            "to_unverified_changed_account": changed_total,
            "formula": " + ".join(f"${l['in_payment_run']:,.0f}" for l in lines) + f" = ${scheduled_total:,.0f} potentially exposed in {world.run['id']}",
            "note": "Potential exposure pending investigation, not a confirmed loss."}


# ---------------------------------------------------------------- detection

def payment_run_scan(world: World) -> list[dict]:
    """Deterministic trigger. Finds clusters of near-limit invoices in the next payment run
    whose suppliers are the same or linked by a medium or strong shared attribute."""
    near = 0.9 * world.limit
    scheduled = {p["invoice_id"] for p in world.records["payment"] if p["run_id"] == world.run["id"]}
    cands = [i for i in world.records["invoice"] if i["id"] in scheduled and near <= i["amount"] <= world.limit]
    groups = supplier_groups(world)
    incidents = []
    for g in groups:
        invs = sorted(i["id"] for i in cands if i["supplier_id"] in g)
        if len(invs) < 2:
            continue
        total = sum(world.get(i)["amount"] for i in invs)
        sups = sorted({world.get(i)["supplier_id"] for i in invs})
        incidents.append({"invoice_ids": invs, "supplier_ids": sups, "total": total,
                          "trigger": f"{len(invs)} invoices between ${near:,.0f} and ${world.limit:,.0f} in {world.run['id']} "
                                     f"from {'one supplier' if len(sups) == 1 else f'{len(sups)} linked suppliers'}, together ${total:,.0f}"})
    return sorted(incidents, key=lambda x: -x["total"])


# ---------------------------------------------------------------- closure

def containment(world: World, invoice_ids: list[str]) -> dict:
    loose = []
    for i in invoice_ids:
        inv = world.get(i)
        for p in world.find("payment", invoice_id=i):
            if p["status"] == "scheduled" and inv["status"] not in ("rejected",):
                loose.append(f"{p['id']} for {i} still scheduled in {p['run_id']}")
    if loose:
        return _result("containment", "POL-03/POL-04", "exception", "; ".join(loose), invoice_ids)
    return _result("containment", "POL-03/POL-04", "pass", "No affected invoice is still scheduled to pay unreviewed.", invoice_ids)


def closure_checks(world: World, case: dict) -> list[dict]:
    """What has to be true before an incident may close. Code decides; nobody clicks past it."""
    invs = case["invoice_ids"]
    checks = []
    failed_tests = [c["test"] for c in case.get("controls", []) if c["status"] == "exception"]
    if failed_tests:
        checks.append(containment(world, invs))
    for test in failed_tests:
        if test == "split_purchase":
            continue  # a past approval pattern can't be "retested away"; it is closed by escalation
        checks.append(run_control_test(world, test, invs))
    if not failed_tests:
        checks.append(_result("open_exceptions", "all", "pass", "No control exception remains open (exempt results were verified by code).", invs))
    open_tasks = [a for a in case.get("actions", []) if a.get("decision") == "approved" and a.get("status") == "task_open"
                  and a["kind"] != "escalate_to_audit"]
    if any(a.get("decision") == "approved" and a["kind"] != "escalate_to_audit" and a.get("status") in ("task_open", "done")
           and a["kind"] not in ("review_hold", "release_for_payment") for a in case.get("actions", [])):
        checks.append(_result("approved_tasks", "workflow", "exception" if open_tasks else "pass",
                              "Open: " + "; ".join(f"{a['label']} ({a['owner']})" for a in open_tasks) if open_tasks
                              else "Every approved task has been completed by its owner.", invs))
    for a in case.get("actions", []):
        if a["kind"] == "escalate_to_audit" and a.get("decision") == "approved":
            ack = a.get("acknowledged_by")
            checks.append(_result("audit_escalation", "POL-02", "pass" if ack else "exception",
                                  f"Approval pattern acknowledged by Internal Audit ({ack})" if ack else
                                  "Approval-pattern finding not yet acknowledged by Internal Audit.", invs))
    return checks


def may_close(checks: list[dict]) -> bool:
    return all(c["status"] in ("pass", "exempt", "not_applicable") for c in checks)
