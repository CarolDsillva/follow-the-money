"""Reject two actions, see the case can't close, reconsider them, fix, and close. Uses a fresh test run."""
from live_full import call, wait

cid = call("POST", "/cases/INC-0412/rerun", expect=201)["id"]
print("case", cid)
call("POST", f"/cases/{cid}/investigate", expect=202)
c = wait(cid, lambda c: c["waiting_for"] == "approval" and not c["busy"], "awaiting approval")
dec = {a["id"]: ({"decision": "rejected", "reason": "test: not now"} if a["kind"] in ("supplier_callback", "due_diligence") else {"decision": "approved", "reason": ""})
       for a in c["state"]["actions"]}
call("POST", f"/cases/{cid}/decisions", {"persona": "finance_director", "decisions": dec}, expect=202)
c = wait(cid, lambda c: c["waiting_for"] == "remediation" and not c["busy"], "remediation")
for a in c["state"]["actions"]:
    if a["decision"] == "rejected":
        print("  warehouse tries to reconsider:", call("POST", f"/cases/{cid}/actions/{a['id']}/reconsider", {"persona": "warehouse"}, expect=403)["detail"])
        call("POST", f"/cases/{cid}/actions/{a['id']}/reconsider", {"persona": "finance_director"}, expect=200)
c = call("GET", f"/cases/{cid}")
print("  after reconsider:", [(a["kind"], a["decision"], a["status"]) for a in c["state"]["actions"]])
call("POST", f"/cases/{cid}/remediation", {"kind": "callback", "persona": "procurement"}, expect=200)
if any(a["kind"] == "receiving_confirmation" for a in c["state"]["actions"]):
    call("POST", f"/cases/{cid}/remediation", {"kind": "receiving", "persona": "warehouse"}, expect=200)
if any(a["kind"] == "escalate_to_audit" for a in c["state"]["actions"]):
    call("POST", f"/cases/{cid}/audit-ack", {"persona": "internal_audit"}, expect=200)
c = call("GET", f"/cases/{cid}")
for a in c["state"]["actions"]:
    if a["status"] == "task_open" and a["kind"] != "escalate_to_audit":
        owner = {"Ana Petrov": "warehouse", "Grace Liu": "procurement", "Elena Brandt": "ap_lead"}[a["owner"].split(",")[0]]
        call("POST", f"/cases/{cid}/tasks/{a['id']}/complete", {"persona": owner, "note": "Done during the reconsider test run."}, expect=200)
call("POST", f"/cases/{cid}/close", {"persona": "finance_director", "override_reason": ""}, expect=202)
c = wait(cid, lambda c: not c["busy"] and (c["status"].startswith("closed") or c["state"].get("verification", {}).get("last_refusal")), "close attempted")
print("final", c["status"], [(x["test"], x["status"]) for x in c["state"].get("verification", {}).get("checks", []) if x["status"] != "pass"])
