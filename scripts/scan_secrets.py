"""Check staged files for every real secret value. Prints only names and counts, never a value.

  git add -A && python scripts/scan_secrets.py
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
values = {}
for env in (ROOT / ".secrets" / "controlroom.env", ROOT.parent / "agent-rush" / ".secrets" / "vultr.env"):
    if env.exists():
        for line in env.read_text(encoding="utf-8-sig").splitlines():
            m = re.match(r"\s*([A-Z0-9_]+)\s*=(.*)$", line)
            if m and len(m.group(2).strip()) >= 8 and m.group(1) not in ("S3_BUCKET", "S3_ENDPOINT"):  # public names, not secrets
                values[m.group(1)] = m.group(2).strip().encode()
        # the password inside the database URL on its own, too
        for k, v in list(values.items()):
            m = re.match(rb"postgresql://[^:]+:([^@]+)@", v)
            if m:
                values[k + "_PASSWORD"] = m.group(1)
files = [f for f in subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=d", "-z"], capture_output=True, cwd=ROOT).stdout.decode().split("\0") if f]
hits = {f: [k for k, v in values.items() if v in (ROOT / f).read_bytes()] for f in files}
hits = {f: k for f, k in hits.items() if k}
bad = [f for f in files if f.startswith(".secrets") or "node_modules" in f or f.startswith("frontend/dist") or f.endswith((".key", ".env"))]
print("secrets checked:", sorted(values))
print("staged files:", len(files))
print("files containing a secret:", hits)
print("paths that should not be staged:", bad)
sys.exit(1 if hits or bad or not values else 0)
