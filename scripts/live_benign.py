"""INC-0413 through the public API: harmless case, approved task must be completed before closing."""
import time

from live_full import call, wait

cid = call("POST", "/cases/INC-0413/rerun", expect=201)["id"]
print("case", cid)
call("POST", f"/cases/{cid}/investigate", expect=202)
c = wait(cid, lambda c: c["waiting_for"] == "approval" and not c["busy"], "awaiting approval")
print("  briefing:", c["state"]["briefing"]["headline"][:160])
print("  controls:", [(x["test"], x["status"]) for x in c["state"]["controls"]])
print("  actions:", [(a["kind"], a["target_ids"]) for a in c["state"]["actions"]])
call("POST", f"/cases/{cid}/decisions", {"persona": "finance_director",
     "decisions": {a["id"]: {"decision": "approved", "reason": ""} for a in c["state"]["actions"]}}, expect=202)
wait(cid, lambda c: c["waiting_for"] == "remediation" and not c["busy"], "remediation")
call("POST", f"/cases/{cid}/close", {"persona": "finance_director", "override_reason": ""}, expect=202)
time.sleep(4)
c = wait(cid, lambda c: not c["busy"], "close attempted")
print("  status after close:", c["status"], [(x["test"], x["status"]) for x in (c["state"].get("verification") or {}).get("checks", [])])
for a in c["state"]["actions"]:
    if a["status"] == "task_open":
        persona = {"Ana Petrov": "warehouse", "Grace Liu": "procurement", "Elena Brandt": "ap_lead", "Rafael Moreno": "internal_audit"}[a["owner"].split(",")[0]]
        print("  wrong owner:", call("POST", f"/cases/{cid}/tasks/{a['id']}/complete", {"persona": "ap_lead" if persona != "ap_lead" else "warehouse", "note": "trying someone else's task"}, expect=403)["detail"])
        call("POST", f"/cases/{cid}/tasks/{a['id']}/complete", {"persona": persona, "note": "All three phases received and inspected; GRN-631/633/635 match."}, expect=200)
call("POST", f"/cases/{cid}/close", {"persona": "finance_director", "override_reason": ""}, expect=202)
c = wait(cid, lambda c: c["status"].startswith("closed"), "closed")
print("final", c["status"], c["cost"])
