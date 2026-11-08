"""Full INC-0412 lifecycle through the public API, including permission refusals. Synthetic data only.

  python scripts/live_full.py
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "https://controlroom.137-220-32-178.sslip.io/api"


def call(method, path, body=None, expect=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            code, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, raw = e.code, e.read()
    if expect and code != expect:
        sys.exit(f"{method} {path}: expected {expect}, got {code}: {raw[:300]}")
    try:
        return json.loads(raw)
    except ValueError:
        return raw


def wait(cid, cond, label):
    t0 = time.time()
    while True:
        c = call("GET", f"/cases/{cid}")
        if c["status"] == "error" and not c["busy"]:
            ev = [e for e in call("GET", f"/cases/{cid}/events") if e["type"] == "error"]
            print("ERROR:", ev[-1]["text"] if ev else "?", "-> retrying from checkpoint")
            call("POST", f"/cases/{cid}/retry", expect=202)
        elif cond(c):
            print(f"  {label} after {time.time() - t0:.0f}s")
            return c
        time.sleep(3)


def main():
    t0 = time.time()
    cid = call("POST", "/cases/INC-0412/rerun", expect=201)["id"]
    print("case", cid)
    call("POST", f"/cases/{cid}/investigate", expect=202)
    c = wait(cid, lambda c: c["waiting_for"] == "approval" and not c["busy"], "awaiting approval")
    o = call("GET", f"/cases/{cid}/overview")
    print("  overview next step:", o["overview"]["next_step"], "|", o["overview"]["owner"], "| severity", o["overview"]["severity"])
    print("  actions:", [(a["kind"], [s["stage"] for s in a["lifecycle"]]) for a in o["actions"]])
    decisions = {a["id"]: {"decision": "approved", "reason": ""} for a in c["state"]["actions"]}
    print("  AP lead tries to approve:", call("POST", f"/cases/{cid}/decisions", {"persona": "ap_lead", "decisions": decisions}, expect=403)["detail"])
    call("POST", f"/cases/{cid}/decisions", {"persona": "finance_director", "decisions": decisions}, expect=202)
    wait(cid, lambda c: c["waiting_for"] == "remediation" and not c["busy"], "remediation")
    call("POST", f"/cases/{cid}/close", {"persona": "finance_director", "override_reason": ""}, expect=202)
    c = wait(cid, lambda c: not c["busy"] and c["state"].get("verification", {}).get("last_refusal"), "close refused")
    print("  failing:", [x["test"] for x in c["state"]["verification"]["checks"] if x["status"] == "exception"])
    print("  warehouse tries the callback:", call("POST", f"/cases/{cid}/remediation", {"kind": "callback", "persona": "warehouse"}, expect=403)["detail"])
    call("POST", f"/cases/{cid}/remediation", {"kind": "callback", "persona": "procurement"}, expect=200)
    call("POST", f"/cases/{cid}/verify", expect=202)
    c = wait(cid, lambda c: not c["busy"] and c["waiting_for"] == "remediation" and c["state"].get("verification", {}).get("agent"), "verified once")
    print("  checks:", [(x["test"], x["status"]) for x in c["state"]["verification"]["checks"]])
    call("POST", f"/cases/{cid}/remediation", {"kind": "receiving", "persona": "warehouse"}, expect=200)
    call("POST", f"/cases/{cid}/audit-ack", {"persona": "internal_audit"}, expect=200)
    call("POST", f"/cases/{cid}/verify", expect=202)
    time.sleep(5)
    c = wait(cid, lambda c: not c["busy"] and c["waiting_for"] == "remediation" and c["state"]["verification"].get("may_close"), "all checks pass")
    call("POST", f"/cases/{cid}/close", {"persona": "finance_director", "override_reason": ""}, expect=202)
    c = wait(cid, lambda c: c["status"].startswith("closed"), "closed")
    o = call("GET", f"/cases/{cid}/overview")
    print("  lifecycles:", [(a["kind"], [s["stage"] for s in a["lifecycle"]]) for a in o["actions"]])
    tl = call("GET", f"/cases/{cid}/timeline")["timeline"]
    print("  timeline items:", len(tl), "kinds:", sorted({t["kind"] for t in tl}))
    for ref in ("EV-01", "CTL-three_way_match", "LNK-SUP-A-SUP-B-bank_account_token", "EML-019", "INV-104", "HYP-1"):
        h = call("GET", f"/cases/{cid}/lookup/{ref}")
        print("  lookup", ref, "->", h.get("kind"), "|", str(h.get("title"))[:80])
    exp = call("GET", f"/cases/{cid}/export")
    print("  export keys:", sorted(exp.keys()), "events:", len(exp["events"]))
    print("final", c["status"], c["cost"], round(time.time() - t0), "s")


if __name__ == "__main__":
    main()
