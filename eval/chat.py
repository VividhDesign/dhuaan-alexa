"""Plan B: typed (or dictated) chat with the stand-in orchestrator (Nova 2 Lite via Strands),
spoken aloud with Amazon Polly neural voice Kajal.

Usage:
  uv run chat.py [--url <MCP_URL>] [--model <id>] [--no-audio]
  uv run chat.py --once "Will smoke reach Rohini tonight?"
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile

import boto3

from agent_common import DEFAULT_MODEL, DEFAULT_URL, ORCHESTRATOR_NAME, REGION, make_mcp_client, pick_model, run_one

DEVANAGARI = re.compile(r"[ऀ-ॿ]")


def speak(text: str, region: str = REGION) -> str:
    lang = "hi-IN" if DEVANAGARI.search(text) else "en-IN"
    polly = boto3.client("polly", region_name=region)
    audio = polly.synthesize_speech(Text=text[:2900], VoiceId="Kajal", Engine="neural",
                                    LanguageCode=lang, OutputFormat="mp3")["AudioStream"].read()
    with tempfile.NamedTemporaryFile(prefix="dhuaan-", suffix=".mp3", delete=False) as f:
        f.write(audio)
        path = f.name
    subprocess.run(["afplay", path], check=False)
    return path


def handle(tools, model_id: str, text: str, audio: bool) -> None:
    r = run_one(tools, model_id, text, REGION)
    for c in r["calls"]:
        print(f"  [tool] {c['name']} {c['input']} -> {c.get('kind')} / {c.get('place_id')}", file=sys.stderr)
    if r["error"]:
        print(f"  [error] {r['error']}", file=sys.stderr)
        return
    print(r["answer"])
    print(f"  ({r['wall_s']} s)", file=sys.stderr)
    if audio and r["answer"]:
        speak(r["answer"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--once", help="run a single utterance and exit")
    ap.add_argument("--no-audio", action="store_true")
    a = ap.parse_args()

    model_id = pick_model(a.model, REGION)
    print(f"{ORCHESTRATOR_NAME}: {model_id}", file=sys.stderr)
    with make_mcp_client(a.url) as client:
        tools = client.list_tools_sync()
        if a.once:
            handle(tools, model_id, a.once, not a.no_audio)
            return 0
        print("Type a question (English, Hindi or Hinglish). Ctrl-D to quit.", file=sys.stderr)
        while True:
            try:
                text = input("> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return 0
            if text:
                handle(tools, model_id, text, not a.no_audio)


if __name__ == "__main__":
    sys.exit(main())
