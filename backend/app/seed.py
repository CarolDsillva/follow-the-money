"""Load the Northstar world into Vultr Postgres and Object Storage, and open cases from the scan.

  python -m app.seed            reset everything to the starting state
"""
from __future__ import annotations

import sys

from fpdf import FPDF
from psycopg.types.json import Jsonb

from app import northstar, rules
from app.store import Store


def render_pdf(title: str, text: str) -> bytes:
    pdf = FPDF(format="Letter")
    pdf.set_auto_page_break(True, margin=18)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(150, 30, 30)
    pdf.cell(0, 6, "SYNTHETIC DEMONSTRATION DOCUMENT - Northstar Manufacturing Group is fictional", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "B", 13)
    pdf.multi_cell(0, 7, title.encode("latin-1", "replace").decode("latin-1"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font("Courier", "", 10)
    for line in text.splitlines():
        pdf.multi_cell(0, 5, line.encode("latin-1", "replace").decode("latin-1") or " ", new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def upload(store: Store, d: dict, scope: str = ""):
    if d["format"] == "pdf":
        store.put_document(d, render_pdf(d["title"], d["text"]), "application/pdf", scope)
    else:
        store.put_document(d, d["text"].encode(), "message/rfc822", scope)


def ensure_bucket(store: Store):
    names = [b["Name"] for b in store.s3.list_buckets().get("Buckets", [])]
    if store.bucket not in names:
        store.s3.create_bucket(Bucket=store.bucket)


def open_cases(store: Store):
    world = store.world()
    titles = {
        ("SUP-A", "SUP-B", "SUP-C"): "Linked suppliers, near-limit invoices before payment run",
        ("SUP-H",): "Repeated near-limit invoices from Cascade Fluid Systems",
    }
    for n, inc in enumerate(rules.payment_run_scan(world)):
        cid = f"INC-{412 + n:04d}"
        title = titles.get(tuple(inc["supplier_ids"]), "Near-limit invoice cluster")
        store.q("""INSERT INTO cases (id, title, status, invoice_ids, supplier_ids, trigger, potential_exposure, template, state)
                   VALUES (%s,%s,'new',%s,%s,%s,%s,%s,%s)""",
                (cid, title, Jsonb(inc["invoice_ids"]), Jsonb(inc["supplier_ids"]), inc["trigger"], inc["total"], cid,
                 Jsonb({"summary": None})))
        store.event(cid, "Payment-run scan", "trigger", inc["trigger"], {"invoice_ids": inc["invoice_ids"], "rule": "near-limit cluster, linked suppliers"})


def reset(store: Store, upload_docs: bool = True):
    if upload_docs:
        store.q("DROP TABLE IF EXISTS documents, cases")
    store.init()
    data = northstar.build()
    with store.pool.connection() as c:
        c.execute("TRUNCATE erp_records, erp_overrides, meta, cases, events")
        c.execute("DELETE FROM documents WHERE scope <> ''")
        if upload_docs:
            c.execute("TRUNCATE documents")
        for kind, rows in data["records"].items():
            for r in rows:
                c.execute("INSERT INTO erp_records (id, kind, data) VALUES (%s,%s,%s)", (r["id"], kind, Jsonb(r)))
        for key in ("world_now", "payment_run", "approval_limit", "currency"):
            c.execute("INSERT INTO meta (key, value) VALUES (%s,%s)", (key, Jsonb(data[key])))
    if upload_docs:
        ensure_bucket(store)
        for d in data["documents"]:
            upload(store, d)
    open_cases(store)
    # LangGraph checkpoints from earlier runs belong to deleted cases.
    for t in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
        try:
            store.q(f"TRUNCATE {t}")
        except Exception:
            pass


def reseed_records(store: Store):
    """Replace the base ERP records and world settings only. Cases, runs, events and documents stay."""
    data = northstar.build()
    with store.pool.connection() as c:
        c.execute("TRUNCATE erp_records, meta")
        for kind, rows in data["records"].items():
            for r in rows:
                c.execute("INSERT INTO erp_records (id, kind, data) VALUES (%s,%s,%s)", (r["id"], kind, Jsonb(r)))
        for key in ("world_now", "payment_run", "approval_limit", "currency"):
            c.execute("INSERT INTO meta (key, value) VALUES (%s,%s)", (key, Jsonb(data[key])))


if __name__ == "__main__":
    s = Store.from_env()
    if "--records-only" in sys.argv:
        reseed_records(s)
        print("records:", s.q("select count(*) n from erp_records")[0]["n"], "cases kept:", len(s.cases()))
        sys.exit(0)
    reset(s, upload_docs="--keep-docs" not in sys.argv)
    print("cases:", [(c["id"], c["title"], float(c["potential_exposure"])) for c in s.cases()])
    print("documents:", len(s.list_documents()))
