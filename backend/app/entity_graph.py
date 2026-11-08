"""The whole Northstar ERP as one entity graph, built by code. Used by the network explorer.

Nodes: suppliers, bank accounts, phones, addresses, people, purchase requests, invoices, goods
receipts, payments, supplier changes, emails, contracts. Edges carry a type and, where money
moves, an amount. Flags mark what the deterministic rules consider notable.
"""
from __future__ import annotations

import re
from collections import Counter

from app import rules

_DATE = re.compile(r"Date:\s*(\d{4}-\d{2}-\d{2})")


def build(world: rules.World, incidents: dict[str, dict] | None = None) -> dict:
    incidents = incidents or {}
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    sites = {s["address"]: s for s in world.records.get("site", [])}
    bank_users = Counter(s["bank_account_token"] for s in world.records["supplier"])
    phone_users = Counter(s["phone"] for s in world.records["supplier"])
    addr_users = Counter(s["address"] for s in world.records["supplier"])

    def node(id_, type_, label, **props):
        n = nodes.setdefault(id_, {"id": id_, "type": type_, "label": label, "flags": [], "props": {}})
        n["props"].update({k: v for k, v in props.items() if k != "flags"})
        for f in props.get("flags", []):
            if f not in n["flags"]:
                n["flags"].append(f)
        return n

    def edge(src, dst, type_, amount=None, note=""):
        edges.append({"id": f"{type_}:{src}>{dst}", "source": src, "target": dst, "type": type_, "amount": amount, "note": note})

    for s in world.records["supplier"]:
        flags = []
        if s["created_at"] >= "2026-10-01":
            flags.append("new supplier")
        if s.get("status") == "blocked":
            flags.append("blocked")
        inc = incidents.get(s["id"])
        if inc:
            flags.append(f"in {inc['id']}")
        node(s["id"], "supplier", s["legal_name"], record=s["id"], created=s["created_at"], due_diligence=s.get("due_diligence"),
             status=s.get("status"), incident=inc["id"] if inc else None, flags=flags)
        b = f"BANK:{s['bank_account_token']}"
        node(b, "bank_account", f"Bank {s['bank_account_token']}", bank=s.get("bank_name"),
             flags=["shared by %d suppliers" % bank_users[s["bank_account_token"]]] if bank_users[s["bank_account_token"]] > 1 else [])
        edge(s["id"], b, "PAID_INTO")
        ph = f"PHONE:{s['phone']}"
        node(ph, "phone", s["phone"], flags=["shared"] if phone_users[s["phone"]] > 1 else [])
        edge(s["id"], ph, "HAS_PHONE")
        site = sites.get(s["address"])
        ad = f"ADDR:{s['address']}"
        aflags = []
        if addr_users[s["address"]] > 1:
            aflags.append("shared")
        if site and site["type"].startswith("multi-tenant"):
            aflags.append(f"business park, {site['registered_businesses']} tenants")
        node(ad, "address", s["address"].split(",")[0], full=s["address"], flags=aflags)
        edge(s["id"], ad, "LOCATED_AT")

    for ch in world.records.get("supplier_change", []):
        flags = [] if ch.get("callback_verified") else ["no callback"]
        if ch.get("status") == "reverted":
            flags = ["reverted after callback"]
        node(ch["id"], "change", f"{ch['field'].replace('_token', '').replace('_', ' ')} change", record=ch["id"],
             at=ch["changed_at"], old=ch["old_value"], new=ch["new_value"], reason=ch["reason"], flags=flags)
        edge(ch["id"], ch["supplier_id"], "CHANGED")
        if ch["field"] == "bank_account_token":
            nb = f"BANK:{ch['new_value']}"
            if nb in nodes:
                edge(ch["id"], nb, "NEW_ACCOUNT")
        m = re.search(r"\((EML-\d+)\)", ch.get("reason", ""))
        if m:
            edge(m.group(1), ch["id"], "REQUESTED_CHANGE")

    for e in world.records["employee"]:
        node(e["id"], "person", e["name"], role=e["role"], limit=e["approval_limit"], record=e["id"])

    for pr in world.records["purchase_request"]:
        node(pr["id"], "request", pr["id"], amount=pr["amount"], at=pr["created_at"], description=pr["description"], record=pr["id"],
             flags=["near limit"] if 0.9 * world.limit <= pr["amount"] <= world.limit else [])
        edge(pr["requester_id"], pr["id"], "REQUESTED", pr["amount"])
        edge(pr["approver_id"], pr["id"], "APPROVED", pr["amount"])
        edge(pr["id"], pr["supplier_id"], "ORDERED_FROM", pr["amount"])
        if pr.get("contract_id"):
            edge(pr["contract_id"], pr["id"], "COVERS")

    po_req = {po["id"]: po["request_id"] for po in world.records["purchase_order"]}
    billed = {}
    for inv in world.records["invoice"]:
        q = sum(l["quantity"] for l in inv["lines"])
        billed[inv["po_id"]] = q
        node(inv["id"], "invoice", inv["id"], amount=inv["amount"], at=inv["invoice_date"], status=inv["status"], record=inv["id"],
             flags=["near limit"] if 0.9 * world.limit <= inv["amount"] <= world.limit else [])
        edge(inv["supplier_id"], inv["id"], "BILLED", inv["amount"])
        edge(inv["id"], po_req[inv["po_id"]], "FOR_REQUEST", inv["amount"])
    received = Counter()
    for g in world.records["goods_receipt"]:
        q = sum(l["quantity"] for l in g["lines"])
        received[g["po_id"]] += q
        node(g["id"], "receipt", g["id"], quantity=q, at=g["received_at"], record=g["id"])
        edge(g["id"], po_req[g["po_id"]], "RECEIVED_FOR")
    for po, q in billed.items():
        if received[po] < q:
            inv = next(i for i in world.records["invoice"] if i["po_id"] == po)
            nodes[inv["id"]]["flags"].append(f"{q - received[po]} of {q} units not received")

    by_supplier = {s["id"]: s for s in world.records["supplier"]}
    for p in world.records["payment"]:
        sup = by_supplier[p["supplier_id"]]
        node(p["id"], "payment", p["id"], amount=p["amount"], status=p["status"], run=p["run_id"], record=p["id"],
             flags=["on hold"] if p["status"] == "on_hold" else [])
        edge(p["id"], p["invoice_id"], "SETTLES", p["amount"])
        edge(p["id"], f"BANK:{sup['bank_account_token']}", "SENDS_MONEY_TO", p["amount"],
             note=f"{p['run_id']} {p['status'].replace('_', ' ')}")

    for c in world.records.get("contract", []):
        node(c["id"], "contract", c["id"], title=c["title"], value=c["total_value"], record=c["id"])
        edge(c["id"], c["supplier_id"], "AGREEMENT_WITH", c["total_value"])

    looks = {l["document_id"]: l for l in rules.lookalike_domains(world)}
    for d in world.meta.get("documents", []):
        if d["kind"] != "email" or not d["related"]:
            continue
        m = _DATE.search(d.get("text", ""))
        flags = []
        if d["trust"] != "internal":
            flags.append("external, unverified")
        if d["id"] in looks:
            flags.append(f"look-alike domain {looks[d['id']]['sender_domain']}")
        node(d["id"], "email", d["id"], title=d["title"], at=m.group(1) if m else None, record=d["id"], flags=flags)
        for r in d["related"]:
            if r in nodes and r != d["id"] and not r.startswith("CHG-"):
                edge(d["id"], r, "MENTIONS")
        if d["id"] in looks:
            edge(d["id"], looks[d["id"]]["supplier_id"], "IMITATES")

    deg = Counter()
    for e in edges:
        deg[e["source"]] += 1
        deg[e["target"]] += 1
    for n in nodes.values():
        n["degree"] = deg[n["id"]]
    edges = [e for e in edges if e["source"] in nodes and e["target"] in nodes]
    return {"nodes": list(nodes.values()), "edges": edges}
