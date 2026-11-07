"""Create (or find) ControlRoom's Vultr Managed PostgreSQL and Object Storage.

Reads VULTR_API_KEY from ../agent-rush/.secrets/vultr.env (or .secrets/vultr.env).
Writes connection details to .secrets/controlroom.env. Never prints a secret.

  python scripts/provision.py            create anything missing, then wait and write the env file
  python scripts/provision.py --status   show what exists
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRETS = ROOT / ".secrets"
DB_LABEL = "controlroom-pg"
OS_LABEL = "controlroom-objects"
REGION = "sea"
DB_PLAN = "vultr-dbaas-hobbyist-cc-1-25-1"
VM_IP = "137.220.32.178"
OS_REGION = "sjc"
OS_TIER = "tier_008h_0600m"


def read_env(path: Path) -> dict[str, str]:
    out = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def api_key() -> str:
    for p in (SECRETS / "vultr.env", ROOT.parent / "agent-rush" / ".secrets" / "vultr.env"):
        key = read_env(p).get("VULTR_API_KEY")
        if key:
            return key
    sys.exit("VULTR_API_KEY not found")


KEY = api_key()


def call(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        "https://api.vultr.com/v2" + path, data=data, method=method,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} failed: {e.code} {e.read().decode()[:300]}")


def my_ip() -> str:
    return urllib.request.urlopen("https://api.ipify.org", timeout=20).read().decode().strip()


def find_db():
    for d in call("GET", "/databases").get("databases", []):
        if d.get("label") == DB_LABEL:
            return d
    return None


def find_os():
    for o in call("GET", "/object-storage").get("object_storages", []):
        if o.get("label") == OS_LABEL:
            return o
    return None


def status() -> None:
    d, o = find_db(), find_os()
    print("postgres:", (d["id"], d["status"], d["region"], d["plan"]) if d else "none")
    print("object storage:", (o["id"], o["status"], o.get("region")) if o else "none")


def create() -> None:
    d = find_db()
    if not d:
        d = call("POST", "/databases", {
            "database_engine": "pg", "database_engine_version": "16",
            "region": REGION, "plan": DB_PLAN, "label": DB_LABEL,
            "trusted_ips": [f"{VM_IP}/32", f"{my_ip()}/32"],
        })["database"]
        print("postgres: creating", d["id"])
    o = find_os()
    if not o:
        # The cheapest tier isn't offered in Seattle; San Jose is the nearest region that has it.
        tier = next(t for t in call("GET", "/object-storage/tiers")["tiers"] if t["slug"] == OS_TIER)
        cluster = next(c for c in call("GET", "/object-storage/clusters")["clusters"] if c["region"] == OS_REGION)
        o = call("POST", "/object-storage", {"cluster_id": cluster["id"], "tier_id": tier["id"], "label": OS_LABEL})["object_storage"]
        print("object storage: creating", o["id"])
    for _ in range(90):
        d = call("GET", f"/databases/{d['id']}")["database"]
        o = call("GET", f"/object-storage/{o['id']}")["object_storage"]
        if d["status"] == "Running" and o["status"] == "active":
            break
        print("waiting:", d["status"], o["status"], flush=True)
        time.sleep(20)
    else:
        sys.exit("timed out waiting; run again later")
    SECRETS.mkdir(exist_ok=True)
    env = {
        "DATABASE_URL": f"postgresql://{d['user']}:{d['password']}@{d['host']}:{d['port']}/{d['dbname']}?sslmode=require",
        "S3_ENDPOINT": f"https://{o['s3_hostname']}",
        "S3_ACCESS_KEY": o["s3_access_key"],
        "S3_SECRET_KEY": o["s3_secret_key"],
        "S3_BUCKET": "controlroom-northstar",
    }
    (SECRETS / "controlroom.env").write_bytes(("\n".join(f"{k}={v}" for k, v in env.items()) + "\n").encode())
    print("ready: wrote .secrets/controlroom.env (values not shown)")
    print("postgres host:", d["host"], "object storage:", o["s3_hostname"])


if __name__ == "__main__":
    status() if "--status" in sys.argv else create()
