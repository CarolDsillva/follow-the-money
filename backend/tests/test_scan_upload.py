"""The CSV scan on plain rows, and on the Northstar sample files."""
import csv
import io

from app import northstar, rules, scan_upload


def test_shared_bank_and_near_limit_cluster():
    sups = [{"id": "S1", "name": "A", "bank_account": "111", "phone": "1", "address": "x"},
            {"id": "S2", "name": "B", "bank_account": "111", "phone": "2", "address": "y"},
            {"id": "S3", "name": "C", "bank_account": "333", "phone": "3", "address": "z"}]
    invs = [{"id": "I1", "supplier_id": "S1", "amount": "47000", "date": "2026-10-01", "requester": "Pat"},
            {"id": "I2", "supplier_id": "S2", "amount": "$48,500", "date": "2026-10-02", "requester": "Pat"},
            {"id": "I3", "supplier_id": "S3", "amount": "48000", "date": "2026-10-02", "requester": "Lee"},
            {"id": "I4", "supplier_id": "S9", "amount": "10", "date": "2026-10-02"}]
    r = scan_upload.scan(sups, invs)
    assert any(l["attribute"] == "bank" and l["strength"] == "strong" for l in r["links"])
    cl = [f for f in r["findings"] if f["type"] == "near-limit cluster"]
    assert cl and cl[0]["invoices"] == ["I1", "I2"]
    assert any(f["type"] == "possible split purchase" and f["invoices"] == ["I1", "I2"] for f in r["findings"])
    assert r["problems"] and "S9" in r["problems"][0]


def test_sample_files_find_the_planted_incidents():
    d = northstar.build()
    s, i = scan_upload.sample_csv(rules.World(d["records"], d))
    r = scan_upload.scan(list(csv.DictReader(io.StringIO(s))), list(csv.DictReader(io.StringIO(i))))
    clusters = [f["invoices"] for f in r["findings"] if f["type"] == "near-limit cluster"]
    assert ["INV-104", "INV-108", "INV-112"] in clusters and ["INV-131", "INV-133", "INV-135"] in clusters
