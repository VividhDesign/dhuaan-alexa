"""Shared setup for the stand-in orchestrator (Nova 2 Lite via Strands).

This is NOT Alexa+. It is a stand-in LLM orchestrator used to test whether a
model picks the right Dhuaan MCP tools and arguments.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from mcp.client.streamable_http import streamable_http_client
from strands import Agent
from strands.hooks import AfterToolCallEvent, BeforeToolCallEvent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient

DEFAULT_URL = os.environ.get("MCP_URL", "https://nd0fnh12rd.execute-api.ap-south-1.amazonaws.com/mcp")
DEFAULT_MODEL = os.environ.get("EVAL_MODEL_ID", "global.amazon.nova-2-lite-v1:0")
FALLBACK_MODELS = ["global.amazon.nova-2-lite-v1:0", "apac.amazon.nova-2-lite-v1:0"]
REGION = os.environ.get("AWS_REGION", "ap-south-1")
ORCHESTRATOR_NAME = "stand-in orchestrator (Nova 2 Lite via Strands)"

# §11.2 system prompt, verbatim.
SYSTEM_PROMPT = (
    "You are a voice assistant like Alexa+ in India. Use the tools when relevant. "
    "Reply in the user's language in at most two short sentences suitable for speech."
)


def make_mcp_client(url: str) -> MCPClient:
    return MCPClient(lambda: streamable_http_client(url))


def discover_nova_2_lite_profiles(region: str = REGION) -> list[str]:
    import boto3

    try:
        bedrock = boto3.client("bedrock", region_name=region)
        profiles = bedrock.list_inference_profiles(maxResults=1000)["inferenceProfileSummaries"]
        return [p["inferenceProfileId"] for p in profiles if "nova-2-lite" in p["inferenceProfileId"]]
    except Exception:
        return []


def pick_model(preferred: str, region: str = REGION) -> str:
    """Return the first Nova 2 Lite model ID that actually answers a Converse call."""
    import boto3

    rt = boto3.client("bedrock-runtime", region_name=region)
    candidates: list[str] = []
    for m in [preferred, *FALLBACK_MODELS, *discover_nova_2_lite_profiles(region)]:
        if m not in candidates:
            candidates.append(m)
    errors = []
    for m in candidates:
        try:
            rt.converse(modelId=m, messages=[{"role": "user", "content": [{"text": "ping"}]}],
                        inferenceConfig={"maxTokens": 5})
            return m
        except Exception as e:  # noqa: BLE001
            errors.append(f"{m}: {e}")
    raise RuntimeError("No Nova 2 Lite model ID is invokable:\n  " + "\n  ".join(errors))


def _structured_from_result(result: Any) -> dict | None:
    if not isinstance(result, dict):
        return None
    sc = result.get("structuredContent")
    if isinstance(sc, dict):
        return sc
    for c in result.get("content") or []:
        if isinstance(c, dict) and "text" in c:
            try:
                j = json.loads(c["text"])
                if isinstance(j, dict) and "kind" in j:
                    return j
            except Exception:  # noqa: BLE001
                pass
        if isinstance(c, dict) and isinstance(c.get("json"), dict) and "kind" in c["json"]:
            return c["json"]
    return None


def run_one(tools: list, model_id: str, text: str, region: str = REGION) -> dict:
    """Run one utterance through a fresh Agent and return what happened."""
    calls: list[dict] = []
    starts: dict[str, float] = {}

    def before(ev: BeforeToolCallEvent) -> None:
        starts[ev.tool_use["toolUseId"]] = time.perf_counter()

    def after(ev: AfterToolCallEvent) -> None:
        tid = ev.tool_use["toolUseId"]
        sc = _structured_from_result(ev.result)
        calls.append({
            "name": ev.tool_use.get("name"),
            "input": ev.tool_use.get("input"),
            "tool_s": round(time.perf_counter() - starts.get(tid, time.perf_counter()), 3),
            "kind": (sc or {}).get("kind"),
            "place_id": ((sc or {}).get("place") or {}).get("id"),
            "status": ev.result.get("status") if isinstance(ev.result, dict) else None,
        })

    agent = Agent(
        model=BedrockModel(model_id=model_id, region_name=region),
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
        callback_handler=None,
    )
    agent.hooks.add_callback(BeforeToolCallEvent, before)
    agent.hooks.add_callback(AfterToolCallEvent, after)

    t0 = time.perf_counter()
    error = None
    answer = ""
    try:
        answer = str(agent(text)).strip()
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {e}"
    wall = time.perf_counter() - t0

    # Cross-check against agent.messages (the source of truth for toolUse blocks).
    uses = []
    results: dict[str, dict | None] = {}
    for m in agent.messages:
        for b in m.get("content", []):
            if "toolUse" in b:
                uses.append({"id": b["toolUse"]["toolUseId"], "name": b["toolUse"]["name"], "input": b["toolUse"].get("input")})
            if "toolResult" in b:
                results[b["toolResult"]["toolUseId"]] = _structured_from_result(b["toolResult"])
    if not calls and uses:  # hooks missed; rebuild from messages
        for u in uses:
            sc = results.get(u["id"]) or {}
            calls.append({"name": u["name"], "input": u["input"], "tool_s": None,
                          "kind": sc.get("kind"), "place_id": (sc.get("place") or {}).get("id"), "status": None})
    else:
        for c, u in zip(calls, uses):
            if c["kind"] is None:
                sc = results.get(u["id"]) or {}
                c["kind"] = sc.get("kind")
                c["place_id"] = (sc.get("place") or {}).get("id")

    return {"answer": answer, "calls": calls, "wall_s": round(wall, 3), "error": error}
