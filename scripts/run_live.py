"""Run an incident through the public API, the way a judge would. Synthetic data only.

  python scripts/run_live.py INC-0413 [--approve]
"""
import json
import sys
import time
import urllib.request

BASE = "https://followthemoney.137-220-32-178.sslip.io/api"


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


template = sys.argv[1]
cid = call("POST", f"/cases/{template}/rerun")["id"]
call("POST", f"/cases/{cid}/investigate")
print("case", cid, flush=True)
t0 = time.time()
seen = 0


def follow(until):
    global seen
    while True:
        for e in call("GET", f"/cases/{cid}/events?after={seen}"):
            seen = e["seq"]
            if e["type"] not in ("llm_call", "tool_call"):
                print(f"{time.time() - t0:5.0f}s [{e['agent']}] {e['type']}: {e['text'][:200]}", flush=True)
        c = call("GET", f"/cases/{cid}")
        if c["status"] == "error":
            sys.exit("error")
        if until(c):
            return c
        time.sleep(3)


c = follow(lambda c: c["waiting_for"] == "approval" and not c["busy"])
print("cost", c["cost"])
for h in c["state"].get("hypotheses", []):
    print(" HYP", h["kind"], h["status"], h["statement"][:150])
for a in c["state"].get("actions", []):
    print(" ACT", a["kind"], a["target_ids"])
print(" controls", [(x["test"], x["status"]) for x in c["state"]["controls"]])
if "--approve" in sys.argv:
    call("POST", f"/cases/{cid}/decisions", {"persona": "finance_director", "decisions": {a["id"]: {"decision": "approved", "reason": "live test"} for a in c["state"]["actions"]}})
    follow(lambda c: c["waiting_for"] == "remediation" and not c["busy"])
    call("POST", f"/cases/{cid}/close", {"persona": "finance_director", "override_reason": ""})
    c = follow(lambda c: not c["busy"] and (c["status"].startswith("closed") or c["state"].get("verification", {}).get("last_refusal")))
    print("final", c["status"], c["cost"], round(time.time() - t0), "s")
