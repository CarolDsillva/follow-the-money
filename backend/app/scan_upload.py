"""Deterministic scan of a user's own suppliers and invoices (CSV uploaded in the browser).

No model is called and nothing is stored. The same rules as the payment-run scan:
shared identifiers between suppliers, near-limit clusters by linked supplier group,
and split purchasing by one requester within a window.
"""
from __future__ import annotations

import datetime as dt
import re
from collections import Counter, defaultdict
from itertools import combinations

MAX_ROWS = 5000


def _norm(v) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip().lower()


def _date(v):
    try:
        return dt.date.fromisoformat(str(v).strip()[:10])
    except ValueError:
        return None


def scan(suppliers: list[dict], invoices: list[dict], limit: float = 50_000, window_days: int = 7) -> dict:
    if len(suppliers) > MAX_ROWS or len(invoices) > MAX_ROWS:
        raise ValueError(f"At most {MAX_ROWS} rows per file")
    sup = {}
    for s in suppliers:
        sid = str(s.get("id") or "").strip()
        if sid:
            sup[sid] = {"id": sid, "name": str(s.get("name") or sid).strip(), "bank": _norm(s.get("bank_account")),
                        "phone": re.sub(r"\D", "", str(s.get("phone") or "")), "address": _norm(s.get("address"))}
    addr_count = Counter(x["address"] for x in sup.values() if x["address"])
    links = []
    by_key = defaultdict(list)
    for x in sup.values():
        for field in ("bank", "phone", "address"):
            if x[field]:
                by_key[(field, x[field])].append(x["id"])
    for (field, value), ids in by_key.items():
        if len(ids) < 2:
            continue
        strength = {"bank": "strong", "phone": "medium", "address": "medium"}[field]
        if field == "address" and addr_count[value] > 3:
            strength = "weak"
        for a, b in combinations(sorted(ids), 2):
            links.append({"from": a, "to": b, "attribute": field, "value": value, "strength": strength,
                          "explanation": f"same {'bank account' if field == 'bank' else field}" + (" (shared by many: likely a business park)" if strength == "weak" else "")})

    parent = {i: i for i in sup}

    def root(i):
        while parent[i] != i:
            i = parent[i]
        return i

    for l in links:
        if l["strength"] != "weak":
            parent[root(l["from"])] = root(l["to"])

    inv = []
    problems = []
    for r in invoices:
        try:
            amount = float(str(r.get("amount", "")).replace(",", "").replace("$", ""))
        except ValueError:
            problems.append(f"invoice {r.get('id')}: amount '{r.get('amount')}' is not a number")
            continue
        sid = str(r.get("supplier_id") or "").strip()
        if sid not in sup:
            problems.append(f"invoice {r.get('id')}: supplier '{sid}' is not in the suppliers file")
            continue
        inv.append({"id": str(r.get("id") or "").strip(), "supplier_id": sid, "amount": amount, "date": _date(r.get("date")),
                    "requester": str(r.get("requester") or "").strip(), "approver": str(r.get("approver") or "").strip()})

    near = [i for i in inv if 0.9 * limit <= i["amount"] <= limit]
    groups = defaultdict(list)
    for i in near:
        groups[root(i["supplier_id"])].append(i)
    clusters = []
    for g, items in groups.items():
        if len(items) < 2:
            continue
        sids = sorted({i["supplier_id"] for i in items})
        clusters.append({"type": "near-limit cluster", "invoices": sorted(i["id"] for i in items), "suppliers": sids,
                         "total": sum(i["amount"] for i in items),
                         "reason": f"{len(items)} invoices at 90-100% of the ${limit:,.0f} limit from "
                                   f"{'one supplier' if len(sids) == 1 else f'{len(sids)} suppliers linked by shared identifiers'}"})

    splits = []
    by_req = defaultdict(list)
    for i in inv:
        if i["requester"] and i["date"] and 0.5 * limit <= i["amount"] <= limit:
            by_req[i["requester"]].append(i)
    for req, items in by_req.items():
        items.sort(key=lambda x: x["date"])
        best = None
        for k in range(len(items)):
            win = [x for x in items[k:] if (x["date"] - items[k]["date"]).days <= window_days]
            total = sum(x["amount"] for x in win)
            if len(win) >= 2 and total > limit and (best is None or (len(win), total) > (len(best), sum(x["amount"] for x in best))):
                best = win
        if best:
            total = sum(x["amount"] for x in best)
            splits.append({"type": "possible split purchase", "invoices": [x["id"] for x in best],
                           "suppliers": sorted({x["supplier_id"] for x in best}), "total": total,
                           "reason": f"{req} requested {len(best)} purchases within {window_days} days, each under the limit, together ${total:,.0f}. Check for a framework agreement before treating it as a split."})
    splits.sort(key=lambda x: -x["total"])

    # graph in the explorer's format
    nodes, edges = {}, []
    flagged = {s for c in clusters + splits for s in c["suppliers"]}
    linked_ids = {l["from"] for l in links if l["strength"] != "weak"} | {l["to"] for l in links if l["strength"] != "weak"}
    keep = flagged | linked_ids
    for sid in keep:
        x = sup[sid]
        nodes[sid] = {"id": sid, "type": "supplier", "label": x["name"], "flags": ["flagged"] if sid in flagged else [], "props": {"record": sid}, "degree": 0}
        for field, t, pre in (("bank", "bank_account", "BANK"), ("phone", "phone", "PHONE"), ("address", "address", "ADDR")):
            if x[field]:
                nid = f"{pre}:{x[field]}"
                shared = len(by_key[(field, x[field])]) > 1
                nodes.setdefault(nid, {"id": nid, "type": t, "label": x[field][:28], "flags": ["shared"] if shared else [], "props": {}, "degree": 0})
                edges.append({"id": f"{sid}>{nid}", "source": sid, "target": nid, "type": {"bank": "PAID_INTO", "phone": "HAS_PHONE", "address": "LOCATED_AT"}[field], "amount": None, "note": ""})
    for i in inv:
        if i["supplier_id"] in flagged and (0.9 * limit <= i["amount"] <= limit or any(i["id"] in c["invoices"] for c in splits)):
            nodes[i["id"]] = {"id": i["id"], "type": "invoice", "label": i["id"], "flags": ["near limit"] if i["amount"] >= 0.9 * limit else [],
                              "props": {"amount": i["amount"], "date": str(i["date"] or "")}, "degree": 0}
            edges.append({"id": f"{i['supplier_id']}>{i['id']}", "source": i["supplier_id"], "target": i["id"], "type": "BILLED", "amount": i["amount"], "note": ""})
    deg = Counter()
    for e in edges:
        deg[e["source"]] += 1
        deg[e["target"]] += 1
    for n in nodes.values():
        n["degree"] = deg[n["id"]]
    return {"suppliers": len(sup), "invoices": len(inv), "total": sum(i["amount"] for i in inv), "limit": limit,
            "links": links, "findings": clusters + splits, "problems": problems[:20],
            "graph": {"nodes": list(nodes.values()), "edges": edges}, "seeds": sorted(flagged) or sorted(linked_ids)[:6]}


def sample_csv(world) -> tuple[str, str]:
    """A sample pair of CSV files built from the Northstar records, so anyone can try the page."""
    sup_rows = ["id,name,bank_account,phone,address"]
    for s in world.records["supplier"]:
        sup_rows.append(",".join([s["id"], f'"{s["legal_name"]}"', s["bank_account_token"], s["phone"], f'"{s["address"]}"']))
    inv_rows = ["id,supplier_id,amount,date,requester,approver"]
    for i in world.records["invoice"]:
        po = world.get(i["po_id"])
        pr = world.get(po["request_id"]) if po else None
        req = world.get(pr["requester_id"])["name"] if pr else ""
        app = world.get(pr["approver_id"])["name"] if pr else ""
        inv_rows.append(",".join([i["id"], i["supplier_id"], f"{i['amount']:.2f}", i["invoice_date"], f'"{req}"', f'"{app}"']))
    return "\n".join(sup_rows) + "\n", "\n".join(inv_rows) + "\n"
