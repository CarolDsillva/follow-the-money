"""Check every blob in every commit for real secret values, and list large files. Prints names only.

  python scripts/scan_history.py
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
            if m and len(m.group(2).strip()) >= 8 and m.group(1) not in ("S3_BUCKET", "S3_ENDPOINT"):
                values[m.group(1)] = m.group(2).strip().encode()
for k, v in list(values.items()):
    m = re.match(rb"postgresql://[^:]+:([^@]+)@", v)
    if m:
        values[k + "_PASSWORD"] = m.group(1)

run = lambda *a: subprocess.run(["git", *a], capture_output=True, cwd=ROOT).stdout
blobs = set()
for line in run("rev-list", "--objects", "--all").decode().splitlines():
    parts = line.split(" ", 1)
    if len(parts) == 2:
        blobs.add((parts[0], parts[1]))
hits, big = [], []
for sha, path in sorted(blobs, key=lambda x: x[1]):
    if run("cat-file", "-t", sha).strip() != b"blob":
        continue
    data = run("cat-file", "-p", sha)
    if len(data) > 2_000_000:
        big.append((path, len(data)))
    for k, v in values.items():
        if v in data:
            hits.append((path, k))
print("commits:", len(run("rev-list", "--all").split()))
print("blobs checked:", len(blobs), "secrets checked:", sorted(values))
print("blobs containing a secret:", hits)
print("files over 2 MB:", big)
sys.exit(1 if hits else 0)
