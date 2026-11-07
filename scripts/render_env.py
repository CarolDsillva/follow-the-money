"""Print the API env file for the VM to stdout (piped over SSH). Never echoed to a terminal by deploy.sh."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
out = {}
for f, keys in ((ROOT / ".secrets" / "controlroom.env", None), (ROOT.parent / "agent-rush" / ".secrets" / "vultr.env", ["VULTR_INFERENCE_API_KEY"])):
    for line in f.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            if keys is None or k.strip() in keys:
                out[k.strip()] = v.strip()
out["SIGNING_KEY_PATH"] = "/var/lib/controlroom/signing.key"
print("\n".join(f"{k}={v}" for k, v in out.items()))
