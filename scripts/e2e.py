"""End-to-end run of one incident against the real Vultr services. Synthetic data only.

  python scripts/e2e.py INC-0412 [--reseed]
Creates a fresh copy of the case, runs the whole lifecycle, prints the event log.
"""
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
for f in (ROOT / ".secrets" / "controlroom.env", ROOT.parent / "agent-rush" / ".secrets" / "vultr.env"):
    if f.exists():
        for line in f.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

from psycopg.types.json import Jsonb  # noqa: E402

from app import seed  # noqa: E402
from app.graph import Engine  # noqa: E402
from app.store import Store  # noqa: E402

template = sys.argv[1] if len(sys.argv) > 1 else "INC-0412"
store = Store.from_env()
if "--reseed" in sys.argv:
    seed.reset(store, upload_docs="--docs" in sys.argv)
engine = Engine(store, os.environ["VULTR_INFERENCE_API_KEY"])
c = store.case(template)
cid = f"{template}-T{int(time.time()) % 10000}"
store.q("""INSERT INTO cases (id, title, status, invoice_ids, supplier_ids, trigger, potential_exposure, template, state)
           VALUES (%s,%s,'new',%s,%s,%s,%s,%s,%s)""",
        (cid, c["title"], Jsonb(c["invoice_ids"]), Jsonb(c["supplier_ids"]), c["trigger"], c["potential_exposure"], template, Jsonb({})))
last = 0


def show():
    global last
    for e in store.events(cid, last):
        last = e["seq"]
        if e["type"] != "llm_call":
            print(f"[{e['agent']}] {e['type']}: {e['text'][:220]}", flush=True)


def wait(target):
    t0 = time.time()
    while engine.busy(cid) or engine.waiting_for(cid) != target:
        show()
        if store.case(cid)["status"] == "error":
            show()
            sys.exit("ERROR")
        if not engine.busy(cid) and engine.waiting_for(cid) is None and store.case(cid)["status"].startswith("closed"):
            return
        time.sleep(2)
        if time.time() - t0 > 900:
            sys.exit("timeout")
    show()


t0 = time.time()
engine.start(cid)
wait("approval")
st = store.case(cid)["state"]
print("\nINVESTIGATION", round(time.time() - t0), "s", store.cost(cid))
print("briefing:", st.get("briefing"))
print("hypotheses:", [(h["id"], h["kind"], h["status"], h["statement"][:100]) for h in st.get("hypotheses", [])])
print("actions:", [(a["id"], a["kind"], a["target_ids"]) for a in st.get("actions", [])])
engine.resume(cid, {"by": "Test operator", "decisions": {a["id"]: {"decision": "approved", "reason": "e2e"} for a in st.get("actions", [])}})
wait("remediation")
engine.resume(cid, {"action": "close", "by": "Test operator", "override_reason": ""})
wait("remediation")
if template == "INC-0412":
    engine.add_remediation(cid, "callback", "Grace Liu")
    engine.resume(cid, {"action": "verify"})
    wait("remediation")
    engine.add_remediation(cid, "receiving", "Ana Petrov")
    engine.acknowledge_audit(cid, "Rafael Moreno")
    engine.resume(cid, {"action": "verify"})
    wait("remediation")
engine.resume(cid, {"action": "close", "by": "Test operator", "override_reason": ""})
time.sleep(3)
while engine.busy(cid):
    time.sleep(2)
show()
print("\nFINAL", store.case(cid)["status"], round(time.time() - t0), "s", store.cost(cid))
