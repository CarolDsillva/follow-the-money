"""Finish an example run: acknowledge audit, complete open tasks by their owners, close. Then start a live run.

  python scripts/finish_example.py INC-0413-7607
"""
import sys
import time

from live_full import call, wait

OWNER = {"Ana Petrov": "warehouse", "Grace Liu": "procurement", "Elena Brandt": "ap_lead", "Rafael Moreno": "internal_audit"}
cid = sys.argv[1]
c = call("GET", f"/cases/{cid}")
for a in c["state"]["actions"]:
    if a.get("decision") != "approved":
        continue
    if a["kind"] == "escalate_to_audit" and not a.get("acknowledged_by"):
        call("POST", f"/cases/{cid}/audit-ack", {"persona": "internal_audit"}, expect=200)
    elif a["status"] == "task_open":
        call("POST", f"/cases/{cid}/tasks/{a['id']}/complete",
             {"persona": OWNER[a["owner"].split(",")[0]], "note": "Checked against the framework agreement and the goods receipts; all in order."}, expect=200)
call("POST", f"/cases/{cid}/close", {"persona": "finance_director", "override_reason": ""}, expect=202)
c = wait(cid, lambda c: c["status"].startswith("closed") or (not c["busy"] and c["state"].get("verification", {}).get("last_refusal")), "close attempted")
print("final", cid, c["status"], c["cost"])
live = call("POST", "/cases/INC-0412/rerun", expect=201)["id"]
call("POST", f"/cases/{live}/investigate", expect=202)
print("live", live)
