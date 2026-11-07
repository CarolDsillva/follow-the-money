import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
for line in Path(r"D:\Claude\agent-rush\.secrets\vultr.env").read_text().splitlines():
    if line.startswith("VULTR_INFERENCE_API_KEY="):
        os.environ["VULTR_INFERENCE_API_KEY"] = line.split("=", 1)[1].strip()
from app.llm import Gateway, tool
g = Gateway(os.environ["VULTR_INFERENCE_API_KEY"])
t = [tool("get_record", "Fetch a record", {"id": {"type": "string"}}), tool("submit", "Finish", {"answer": {"type": "string"}})]
for m in ["glm-5.3", "qwen3.8-flash-next", "qwen3.8-27b"]:
    try:
        r = g.chat((m,), [{"role": "user", "content": "Look up record INV-104 using a tool."}], t)
        print(m, r.tool, r.arguments, r.call)
    except Exception as e:
        print(m, "FAIL", e)
