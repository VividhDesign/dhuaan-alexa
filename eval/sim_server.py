"""Backend for the local "Alexa+ experience simulator" web app.

This is a stand-in orchestrator (Strands Agents + a local or Bedrock model + the real Dhuaan MCP
server), not Alexa+. It serves ../ui/dist/sim.html and a small JSON API:

  GET  /            the simulator page (../ui/dist/sim.html)
  GET  /api/info    model, agent, MCP URL, protocolVersion, serverInfo and tool names (live initialize + tools/list)
  GET  /api/card    the MCP Apps card via resources/read
  POST /api/ask     {session_id, text, replay_date|null} -> {reply:{text, language}, tool_calls, ms_total, model}
  POST /api/tts     {text, language} -> Polly neural Kajal mp3 as base64
  POST /api/reset   {session_id}

Usage:
  uv run sim_server.py --url <MCP_URL> --model ollama:gemma4:12b [--port 8787]
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import threading
import time
import traceback
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import boto3

from agent_common import (DEFAULT_MODEL, DEFAULT_URL, DEVANAGARI, OLLAMA_PREFIX, REGION, ToolRecorder,
                          build_system_prompt, is_ollama, make_agent, make_mcp_client, pick_model)

HERE = Path(__file__).resolve().parent
UI_DIST = HERE.parent / "ui" / "dist"
CARD_URI = "ui://dhuaan/forecast-card.html"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TTS_MAX_CHARS = 1500
CONTEXT_TTL_S = 60  # re-read tools + instructions at most once a minute, so a server redeploy is picked up


def sim_model_label(spec: str) -> str:
    if is_ollama(spec):
        return f"{spec[len(OLLAMA_PREFIX):]} (Ollama)"
    if "nova-2-lite" in spec:
        return "Nova 2 Lite (Amazon Bedrock)"
    return f"{spec} (Amazon Bedrock)"


def jsonrpc(url: str, method: str, params: dict | None = None, timeout: float = 20) -> dict:
    body = {"jsonrpc": "2.0", "id": 1, "method": method, **({"params": params} if params is not None else {})}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        "content-type": "application/json", "accept": "application/json, text/event-stream"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode()
    if raw.lstrip().startswith("event:") or raw.lstrip().startswith("data:"):  # SSE fallback
        raw = next(l[5:].strip() for l in raw.splitlines() if l.startswith("data:"))
    msg = json.loads(raw)
    if "error" in msg:
        raise RuntimeError(f"{method}: {msg['error']}")
    return msg["result"]


def initialize(url: str) -> dict:
    return jsonrpc(url, "initialize", {"protocolVersion": "2025-11-25", "capabilities": {},
                                       "clientInfo": {"name": "dhuaan-sim", "version": "0.1.0"}})


class Sim:
    def __init__(self, url: str, spec: str) -> None:
        self.url = url
        self.spec = spec
        self.label = sim_model_label(spec)
        self.client = make_mcp_client(url)
        self.client.start()
        self.sessions: dict[str, dict] = {}
        self.lock = threading.Lock()
        self.tts_cache: dict[tuple[str, str], str] = {}
        self.polly = boto3.client("polly", region_name=REGION)
        self._ctx: tuple[float, list, str, dict] | None = None
        self.context()

    def context(self) -> tuple[list, str, dict]:
        """(tools, system_prompt, initialize result), refreshed at most every CONTEXT_TTL_S."""
        with self.lock:
            if self._ctx and time.time() - self._ctx[0] < CONTEXT_TTL_S:
                return self._ctx[1], self._ctx[2], self._ctx[3]
        init = initialize(self.url)
        tools = self.client.list_tools_sync()
        prompt = build_system_prompt(init.get("instructions") or self.client.server_instructions, skill=True)
        with self.lock:
            self._ctx = (time.time(), tools, prompt, init)
        return tools, prompt, init

    def info(self) -> dict:
        tools, _, init = self.context()
        si = init.get("serverInfo") or {}
        return {"model": self.label, "agent": "Strands Agents", "mcp_url": self.url,
                "protocolVersion": init.get("protocolVersion"),
                "serverInfo": {"name": si.get("name"), "title": si.get("title"), "version": si.get("version")},
                "tools": [t.tool_name for t in tools]}

    def card(self) -> dict:
        res = jsonrpc(self.url, "resources/read", {"uri": CARD_URI})
        c = res["contents"][0]
        return {"uri": c.get("uri", CARD_URI), "mimeType": c.get("mimeType"), "html": c.get("text", "")}

    def session(self, sid: str) -> dict:
        with self.lock:
            s = self.sessions.get(sid)
        if s:
            return s
        tools, prompt, _ = self.context()
        rec = ToolRecorder()
        s = {"agent": make_agent(tools, self.spec, prompt, rec, REGION), "rec": rec, "lock": threading.Lock()}
        with self.lock:
            return self.sessions.setdefault(sid, s)

    HINGLISH = re.compile(r"\b(kal|aaj|raat|subah|mein|kya|hai|hoga|kitna|kitni|kaise|kab|kahan|aayega|dhuaan|parali|ke liye|karo|batao)\b", re.I)

    def with_language_hint(self, text: str) -> str:
        """Pin the reply language to the user's latest message so earlier turns can't drag it elsewhere."""
        if DEVANAGARI.search(text):
            return text + "\n\n[Reply in Hindi, in Devanagari script.]"
        if self.HINGLISH.search(text):
            return text + "\n\n[Reply in Hindi, in Devanagari script, because the user is speaking Hinglish.]"
        return text + "\n\n[Reply in English.]"

    def ask(self, sid: str, text: str, replay_date: str | None) -> dict:
        s = self.session(sid)
        with s["lock"]:
            rec: ToolRecorder = s["rec"]
            rec.reset_turn()
            rec.replay_date = replay_date
            t0 = time.perf_counter()
            try:
                answer = str(s["agent"](self.with_language_hint(text))).strip()
            except Exception:
                self.reset(sid)  # a failed turn can leave the history unusable; start that session fresh
                raise
            ms_total = round((time.perf_counter() - t0) * 1000)
            calls = [{"name": c["name"], "input": c["input"], "ms": c["ms"], "result": c["result"]} for c in rec.calls]
        key = (calls[0]["name"], str(calls[0]["input"].get("place"))) if calls else None
        if len(calls) == 1 and key != s.get("last_call") and not calls[0]["result"].get("isError") and calls[0]["result"].get("text"):
            answer = calls[0]["result"]["text"].strip()  # speak the tool's own summary: exact numbers, no model drift
        if calls:
            s["last_call"] = key  # a repeat call is a follow-up: keep the model's own wording, which can use the fuller data
        return {"reply": {"text": answer, "language": "hi" if DEVANAGARI.search(answer) else "en"},
                "tool_calls": calls, "ms_total": ms_total, "model": self.label}

    def reset(self, sid: str) -> bool:
        with self.lock:
            return self.sessions.pop(sid, None) is not None

    def tts(self, text: str, language: str | None) -> dict:
        text = (text or "").strip()[:TTS_MAX_CHARS]
        if not text:
            raise ValueError("text is empty")
        lang = language if language in ("hi", "en") else ("hi" if DEVANAGARI.search(text) else "en")
        key = (text, lang)
        b64 = self.tts_cache.get(key)
        if b64 is None:
            out = self.polly.synthesize_speech(Text=text, VoiceId="Kajal", Engine="neural",
                                               LanguageCode="hi-IN" if lang == "hi" else "en-IN", OutputFormat="mp3")
            b64 = base64.b64encode(out["AudioStream"].read()).decode()
            self.tts_cache[key] = b64
        return {"audio_b64": b64, "mimeType": "audio/mpeg", "voice": "Kajal", "engine": "neural"}


def make_handler(sim: Sim):
    class Handler(BaseHTTPRequestHandler):
        server_version = "dhuaan-sim/0.1"

        def log_message(self, fmt, *args):  # one short line per request
            sys.stderr.write(f"{time.strftime('%H:%M:%S')} {self.command} {self.path} {fmt % args}\n")

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(body)))
            self.send_header("access-control-allow-origin", "*")
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj) -> None:
            self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

        def _body(self) -> dict:
            n = int(self.headers.get("content-length") or 0)
            data = json.loads(self.rfile.read(n) or b"{}")
            if not isinstance(data, dict):
                raise ValueError("body must be a JSON object")
            return data

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("access-control-allow-origin", "*")
            self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
            self.send_header("access-control-allow-headers", "content-type")
            self.end_headers()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            try:
                if path in ("/", "/index.html", "/sim.html"):
                    page = UI_DIST / "sim.html"
                    if not page.exists():
                        return self._send(200, b"build ui first (cd ui && npm run build)\n", "text/plain; charset=utf-8")
                    return self._send(200, page.read_bytes(), "text/html; charset=utf-8")
                if path == "/api/info":
                    return self._json(200, sim.info())
                if path == "/api/card":
                    return self._json(200, sim.card())
                if path == "/api/health":
                    return self._json(200, {"ok": True})
                # other built assets, if the UI build ever emits any
                f = (UI_DIST / path.lstrip("/")).resolve()
                if UI_DIST.resolve() in f.parents and f.is_file():
                    ctype = {".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml",
                             ".png": "image/png", ".json": "application/json"}.get(f.suffix, "application/octet-stream")
                    return self._send(200, f.read_bytes(), ctype)
                return self._json(404, {"error": "not found"})
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                return self._json(502, {"error": f"{type(e).__name__}: {e}"})

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            try:
                body = self._body()
            except Exception as e:  # noqa: BLE001
                return self._json(400, {"error": f"bad JSON body: {e}"})
            try:
                if path == "/api/ask":
                    sid = str(body.get("session_id") or "default")
                    text = str(body.get("text") or "").strip()
                    rd = body.get("replay_date") or None
                    if not text:
                        return self._json(400, {"error": "text is required"})
                    if rd is not None and not (isinstance(rd, str) and DATE_RE.match(rd)):
                        return self._json(400, {"error": "replay_date must be YYYY-MM-DD or null"})
                    return self._json(200, sim.ask(sid, text, rd))
                if path == "/api/tts":
                    return self._json(200, sim.tts(str(body.get("text") or ""), body.get("language")))
                if path == "/api/reset":
                    existed = sim.reset(str(body.get("session_id") or "default"))
                    return self._json(200, {"ok": True, "existed": existed})
                return self._json(404, {"error": "not found"})
            except ValueError as e:
                return self._json(400, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                return self._json(500, {"error": f"{type(e).__name__}: {e}"})

    return Handler


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    a = ap.parse_args()

    spec = pick_model(a.model, REGION)
    sim = Sim(a.url, spec)
    httpd = ThreadingHTTPServer((a.host, a.port), make_handler(sim))
    httpd.daemon_threads = True
    print(f"stand-in orchestrator ({sim.label}; Strands Agents) on http://{a.host}:{a.port}  MCP {a.url}", file=sys.stderr)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        sim.client.stop(None, None, None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
