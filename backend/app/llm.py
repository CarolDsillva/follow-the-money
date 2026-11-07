"""The only module that calls a model. Every call goes to Vultr Serverless Inference."""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Callable

import httpx

BASE_URL = "https://api.vultrinference.com/v1"
MAX_TOKENS = 4000


class LLMError(RuntimeError):
    pass


@dataclass
class Call:
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float | None
    seconds: float


@dataclass
class Reply:
    tool: str | None
    arguments: dict
    text: str
    call: Call
    raw_message: dict = field(default_factory=dict)


def fetch_prices() -> dict[str, tuple[float, float]]:
    try:
        data = httpx.get(f"{BASE_URL}/models", timeout=20).json()
    except (httpx.HTTPError, ValueError):
        return {}
    prices = {}
    for m in data.get("data", []):
        p = c = None
        for mod in m.get("input_modalities") or []:
            for e in (mod.get("pricing") or []) if isinstance(mod, dict) else []:
                if e.get("type") == "prompt" and e.get("unit") == "token":
                    p = float(e["cost_usd"])
        for mod in m.get("output_modalities") or []:
            for e in (mod.get("pricing") or []) if isinstance(mod, dict) else []:
                if e.get("type") == "completion" and e.get("unit") == "token":
                    c = float(e["cost_usd"])
        if p is not None and c is not None:
            prices[m["id"]] = (p, c)
    return prices


class Gateway:
    def __init__(self, api_key: str, on_call: Callable[[Call], None] | None = None,
                 transport: httpx.BaseTransport | None = None):
        self.http = httpx.Client(base_url=BASE_URL, headers={"Authorization": f"Bearer {api_key}"},
                                 timeout=150, transport=transport)
        self.prices = fetch_prices() if transport is None else {}
        self.on_call = on_call or (lambda c: None)

    def chat(self, models: tuple[str, ...], messages: list[dict], tools: list[dict]) -> Reply:
        """One turn. The model must call one of `tools`. Tries each model once, in order."""
        failures = []
        for model in models:
            for choice in ("required", "auto"):
                try:
                    reply = self._chat(model, messages, tools, choice)
                except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as e:
                    failures.append(f"{model}/{choice}: {type(e).__name__}: {str(e)[:160]}")
                    break
                if reply.tool:
                    return reply
                failures.append(f"{model}/{choice}: no tool call")
        raise LLMError("; ".join(failures))

    def _chat(self, model, messages, tools, choice) -> Reply:
        body = {"model": model, "messages": messages, "tools": tools, "tool_choice": choice,
                "max_tokens": MAX_TOKENS, "temperature": 0.1}
        t0 = time.monotonic()
        r = self.http.post("/chat/completions", json=body)
        if r.status_code == 400 and choice == "required":
            raise ValueError(f"400 {r.text[:200]}")
        r.raise_for_status()
        payload = r.json()
        usage = payload.get("usage") or {}
        pt, ct = int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)
        rate = self.prices.get(model)
        call = Call(model, pt, ct, (pt * rate[0] + ct * rate[1]) if rate else None, time.monotonic() - t0)
        self.on_call(call)
        msg = payload["choices"][0]["message"]
        names = {t["function"]["name"] for t in tools}
        for tc in msg.get("tool_calls") or []:
            if tc["function"]["name"] in names:
                args = tc["function"].get("arguments") or "{}"
                args = json.loads(args) if isinstance(args, str) else args
                if isinstance(args, dict):
                    msg = {"role": "assistant", "content": msg.get("content") or "",
                           "tool_calls": [{"id": tc.get("id") or "call_0", "type": "function",
                                           "function": {"name": tc["function"]["name"], "arguments": json.dumps(args)}}]}
                    return Reply(tc["function"]["name"], args, msg["content"], call, msg)
        return Reply(None, {}, msg.get("content") or "", call, msg)


def tool(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {
        "type": "object", "properties": properties, "required": required if required is not None else list(properties)}}}


def models_for(role: str) -> tuple[str, ...]:
    fast = os.environ.get("FAST_MODEL", "qwen3.8-flash-next")
    strong = os.environ.get("STRONG_MODEL", "glm-5.3")
    backup = os.environ.get("BACKUP_MODEL", "qwen3.8-27b")
    return (strong, backup) if role in ("challenge", "commander") else (fast, backup)
