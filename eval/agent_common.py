"""Shared setup for the stand-in orchestrator (Strands Agents + an LLM + the Dhuaan MCP server).

This is NOT Alexa+. It is a stand-in LLM orchestrator used to test whether a
model picks the right Dhuaan MCP tools and arguments.

Model specs:
  global.amazon.nova-2-lite-v1:0   Amazon Bedrock (default)
  ollama:gemma4:12b                local Ollama model (think disabled)
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.request
from pathlib import Path
from typing import Any

from mcp.client.streamable_http import streamable_http_client
from strands import Agent
from strands.hooks import AfterToolCallEvent, BeforeToolCallEvent
from strands.tools.mcp import MCPClient

DEFAULT_URL = os.environ.get("MCP_URL", "https://nd0fnh12rd.execute-api.ap-south-1.amazonaws.com/mcp")
DEFAULT_MODEL = os.environ.get("EVAL_MODEL_ID", "global.amazon.nova-2-lite-v1:0")
FALLBACK_MODELS = ["global.amazon.nova-2-lite-v1:0", "apac.amazon.nova-2-lite-v1:0"]
REGION = os.environ.get("AWS_REGION", "ap-south-1")
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_PREFIX = "ollama:"
DEVANAGARI = re.compile(r"[ऀ-ॿ]")

# §11.2 stand-in system prompt, verbatim. The MCP server's `instructions` are appended to it,
# the way a real host passes server instructions to its model.
SYSTEM_PROMPT = (
    "You are a voice assistant like Alexa+ in India. Use the tools when relevant. "
    "Reply in the user's language in at most two short sentences suitable for speech."
)


SKILL_PATH = Path(__file__).resolve().parent.parent / "skills" / "dhuaan-smoke" / "SKILL.md"


def load_skill_body(path: Path = SKILL_PATH) -> str:
    """The Agent Skill's Markdown body (frontmatter stripped); empty if the skill file is missing."""
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8")
    return text.split("---", 2)[2].strip() if text.startswith("---") else text.strip()


def build_system_prompt(server_instructions: str | None, skill: bool = False) -> str:
    parts = [SYSTEM_PROMPT]
    if skill and load_skill_body():
        parts.append(load_skill_body())
    if server_instructions:
        parts.append(server_instructions.strip())
    return "\n\n".join(parts)


def is_ollama(spec: str) -> bool:
    return spec.startswith(OLLAMA_PREFIX)


def model_label(spec: str) -> str:
    """Honest, human-readable model label for reports."""
    if is_ollama(spec):
        return f"{spec[len(OLLAMA_PREFIX):]} via Ollama, local"
    if "nova-2-lite" in spec:
        return f"Nova 2 Lite via Amazon Bedrock ({spec})"
    return f"{spec} via Amazon Bedrock"


def orchestrator_label(spec: str) -> str:
    return f"stand-in orchestrator ({model_label(spec)}; Strands Agents)"


def make_mcp_client(url: str) -> MCPClient:
    return MCPClient(lambda: streamable_http_client(url))


def build_model(spec: str, region: str = REGION):
    if is_ollama(spec):
        from strands.models.ollama import OllamaModel

        return OllamaModel(
            host=OLLAMA_HOST,
            model_id=spec[len(OLLAMA_PREFIX):],
            temperature=0.0,
            keep_alive="30m",
            additional_args={"think": False},  # passed straight to ollama.chat(think=False)
        )
    from strands.models import BedrockModel

    return BedrockModel(model_id=spec, region_name=region)


def _ollama_post(path: str, body: dict, timeout: float = 300) -> dict:
    req = urllib.request.Request(OLLAMA_HOST + path, data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def discover_nova_2_lite_profiles(region: str = REGION) -> list[str]:
    import boto3

    try:
        bedrock = boto3.client("bedrock", region_name=region)
        profiles = bedrock.list_inference_profiles(maxResults=1000)["inferenceProfileSummaries"]
        return [p["inferenceProfileId"] for p in profiles if "nova-2-lite" in p["inferenceProfileId"]]
    except Exception:  # noqa: BLE001
        return []


def pick_model(preferred: str, region: str = REGION) -> str:
    """Return a model spec that actually answers. For Ollama this also loads the model (warm-up)."""
    if is_ollama(preferred):
        name = preferred[len(OLLAMA_PREFIX):]
        with urllib.request.urlopen(OLLAMA_HOST + "/api/tags", timeout=10) as r:
            names = [m["name"] for m in json.loads(r.read())["models"]]
        if name not in names and f"{name}:latest" not in names:
            raise RuntimeError(f"Ollama model {name!r} is not pulled; available: {names}")
        _ollama_post("/api/chat", {"model": name, "messages": [{"role": "user", "content": "hi"}],
                                   "stream": False, "think": False, "keep_alive": "30m"})
        return preferred

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


def structured_from_result(result: Any) -> dict | None:
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


def result_text(result: Any) -> str:
    if not isinstance(result, dict):
        return ""
    return "\n".join(c["text"] for c in result.get("content") or [] if isinstance(c, dict) and "text" in c)


class ToolRecorder:
    """Hook callbacks that time and record every tool call; optionally inject replay_date."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.replay_date: str | None = None
        self._starts: dict[str, float] = {}
        self._inputs: dict[str, Any] = {}

    def reset_turn(self) -> None:
        self.calls = []

    def before(self, ev: BeforeToolCallEvent) -> None:
        tid = ev.tool_use["toolUseId"]
        if self.replay_date:
            ev.tool_use = {**ev.tool_use, "input": {**(ev.tool_use.get("input") or {}), "replay_date": self.replay_date}}
        self._inputs[tid] = ev.tool_use.get("input")
        self._starts[tid] = time.perf_counter()

    def after(self, ev: AfterToolCallEvent) -> None:
        tid = ev.tool_use["toolUseId"]
        elapsed = time.perf_counter() - self._starts.pop(tid, time.perf_counter())
        res = ev.result if isinstance(ev.result, dict) else {}
        sc = structured_from_result(res)
        self.calls.append({
            "name": ev.tool_use.get("name"),
            "input": self._inputs.pop(tid, ev.tool_use.get("input")),
            "tool_s": round(elapsed, 3),
            "ms": round(elapsed * 1000),
            "kind": (sc or {}).get("kind"),
            "place_id": ((sc or {}).get("place") or {}).get("id"),
            "status": res.get("status"),
            "result": {
                "text": result_text(res),
                "structuredContent": res.get("structuredContent", sc),
                "isError": bool(res.get("isError")) or res.get("status") == "error",
            },
        })

    def attach(self, agent: Agent) -> None:
        agent.hooks.add_callback(BeforeToolCallEvent, self.before)
        agent.hooks.add_callback(AfterToolCallEvent, self.after)


def make_agent(tools: list, spec: str, system_prompt: str, recorder: ToolRecorder, region: str = REGION) -> Agent:
    agent = Agent(model=build_model(spec, region), tools=tools, system_prompt=system_prompt, callback_handler=None)
    recorder.attach(agent)
    return agent


def run_one(tools: list, spec: str, text: str, system_prompt: str, region: str = REGION) -> dict:
    """Run one utterance through a fresh Agent and return what happened."""
    rec = ToolRecorder()
    agent = make_agent(tools, spec, system_prompt, rec, region)
    t0 = time.perf_counter()
    error = None
    answer = ""
    try:
        answer = str(agent(text)).strip()
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {e}"
    wall = time.perf_counter() - t0

    calls = [{k: v for k, v in c.items() if k != "result"} for c in rec.calls]
    if not calls:  # hooks missed something; rebuild from agent.messages (source of truth for toolUse)
        results: dict[str, dict | None] = {}
        uses = []
        for m in agent.messages:
            for b in m.get("content", []):
                if "toolUse" in b:
                    uses.append(b["toolUse"])
                if "toolResult" in b:
                    results[b["toolResult"]["toolUseId"]] = structured_from_result(b["toolResult"])
        for u in uses:
            sc = results.get(u["toolUseId"]) or {}
            calls.append({"name": u["name"], "input": u.get("input"), "tool_s": None, "ms": None,
                          "kind": sc.get("kind"), "place_id": (sc.get("place") or {}).get("id"), "status": None})
    return {"answer": answer, "calls": calls, "wall_s": round(wall, 3), "error": error}
