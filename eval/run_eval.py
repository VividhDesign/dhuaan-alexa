"""Eval: does a stand-in orchestrator (Strands Agents + an LLM) pick the right Dhuaan tools?

Usage:
  uv run run_eval.py --url <MCP_URL> --out results.md [--tag v1] [--model ollama:gemma4:12b | <bedrock id>]

Runs are kept in results.json (keyed by tag) and results.md is regenerated with every run,
so v1 and v2 both stay in the report.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import statistics
import sys
from pathlib import Path

from agent_common import (DEFAULT_MODEL, DEFAULT_URL, REGION, build_system_prompt, make_mcp_client, model_label,
                          orchestrator_label, pick_model, run_one)

HERE = Path(__file__).parent
TIME_RE = re.compile(r"\b\d{1,2}:\d{2}\b|बजे")
TIMED_TOOLS = {"get_smoke_forecast", "find_clean_air_window"}


def pct(xs: list[bool]) -> float | None:
    return round(100 * sum(xs) / len(xs), 1) if xs else None


def p95(xs: list[float]) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    k = max(0, min(len(s) - 1, round(0.95 * (len(s) - 1))))
    return round(s[k], 2)


def score(u: dict, r: dict) -> dict:
    calls = r["calls"]
    first = calls[0] if calls else None
    et = u["expect_tool"]
    if et is None:
        tool_ok = (not calls) or any(c.get("kind") == "clarify" for c in calls)
    else:
        tool_ok = bool(first) and first["name"] == et
    match = next((c for c in calls if c["name"] == et), first) if calls else None
    place_ok = None
    if u.get("expect_place"):
        place_ok = bool(match) and match.get("place_id") == u["expect_place"]
    act_ok = None
    if u.get("expect_activity"):
        act_ok = bool(match) and (match.get("input") or {}).get("activity") == u["expect_activity"]
    kind_ok = None
    if u.get("expect_kind") and et is not None:
        kind_ok = bool(match) and match.get("kind") == u["expect_kind"]
    has_time = bool(TIME_RE.search(r["answer"] or ""))
    return {"tool_ok": tool_ok, "place_ok": place_ok, "activity_ok": act_ok, "kind_ok": kind_ok, "has_time": has_time}


def summarize(rows: list[dict]) -> dict:
    tool_lat = [c["tool_s"] for r in rows for c in r["calls"] if c.get("tool_s") is not None]
    walls = [r["wall_s"] for r in rows if not r["error"]]
    timed = [r["score"]["has_time"] for r in rows if r["expect_tool"] in TIMED_TOOLS]
    return {
        "n": len(rows),
        "errors": sum(1 for r in rows if r["error"]),
        "tool_acc": pct([r["score"]["tool_ok"] for r in rows]),
        "place_acc": pct([r["score"]["place_ok"] for r in rows if r["score"]["place_ok"] is not None]),
        "place_n": sum(1 for r in rows if r["score"]["place_ok"] is not None),
        "activity_acc": pct([r["score"]["activity_ok"] for r in rows if r["score"]["activity_ok"] is not None]),
        "activity_n": sum(1 for r in rows if r["score"]["activity_ok"] is not None),
        "kind_acc": pct([r["score"]["kind_ok"] for r in rows if r["score"]["kind_ok"] is not None]),
        "time_pct": pct(timed),
        "time_n": len(timed),
        "wall_p50_s": round(statistics.median(walls), 2) if walls else None,
        "wall_p95_s": p95(walls),
        "tool_p50_s": round(statistics.median(tool_lat), 3) if tool_lat else None,
        "tool_p95_s": p95(tool_lat),
        "by_lang": {
            lang: pct([r["score"]["tool_ok"] for r in rows if r["lang"] == lang])
            for lang in sorted({r["lang"] for r in rows})
        },
    }


def fmt(v, suffix=""):
    return "n/a" if v is None else f"{v}{suffix}"


def ok(v):
    return "" if v is None else ("✓" if v else "✗")


def md_cell(s: str) -> str:
    return (s or "").replace("|", "\\|").replace("\n", " ")


def render(runs: list[dict]) -> str:
    out = [
        "# Dhuaan tool-selection eval",
        "",
        "Orchestrator: a **stand-in orchestrator** (Strands Agents + the model named per run). It tests whether an LLM "
        "picks the right MCP tools and arguments; it is not Alexa+. System prompt = the §11.2 stand-in prompt "
        "plus the MCP server's `instructions` from initialize.",
        "",
        "## Summary",
        "",
        "| Run | When (IST) | Model | N | Tool acc | Place acc | Activity acc | Kind acc | Answers with a time | Agent p50 / p95 (s) | Tool p50 / p95 (s) | Errors |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for run in runs:
        s = run["summary"]
        out.append(
            f"| {run['tag']} | {run['started']} | {run.get('model_label', run['model_id'])} | {s['n']} | {fmt(s['tool_acc'], '%')} | "
            f"{fmt(s['place_acc'], '%')} (n={s['place_n']}) | {fmt(s['activity_acc'], '%')} (n={s['activity_n']}) | "
            f"{fmt(s['kind_acc'], '%')} | {fmt(s['time_pct'], '%')} (n={s['time_n']}) | "
            f"{fmt(s['wall_p50_s'])} / {fmt(s['wall_p95_s'])} | {fmt(s['tool_p50_s'])} / {fmt(s['tool_p95_s'])} | {s['errors']} |"
        )
    out += ["", "Tool accuracy by language: " + "; ".join(
        f"{run['tag']}: " + ", ".join(f"{k} {fmt(v, '%')}" for k, v in run["summary"]["by_lang"].items()) for run in runs
    ), "", "\"Answers with a time\" counts forecast/window utterances whose answer matches `h:mm` or `बजे`. "
        "Place, activity and kind accuracy are computed only where the utterance sets an expectation.", ""]
    for run in runs:
        out += [f"## Run {run['tag']}: per utterance", "",
                "| id | lang | text | expected | got tool | input | kind / place | tool | place | act | time | wall s | answer |",
                "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for r in run["rows"]:
            c = r["calls"][0] if r["calls"] else {}
            exp = " / ".join(str(x) for x in [r["expect_tool"], r["expect_place"], r["expect_activity"]] if x) or "(no tool)"
            got = ", ".join(x["name"] for x in r["calls"]) or "(none)"
            out.append(
                f"| {r['id']} | {r['lang']} | {md_cell(r['text'])} | {md_cell(exp)} | {got} | "
                f"`{md_cell(json.dumps(c.get('input'), ensure_ascii=False)) if c else ''}` | "
                f"{c.get('kind') or ''} / {c.get('place_id') or ''} | {ok(r['score']['tool_ok'])} | {ok(r['score']['place_ok'])} | "
                f"{ok(r['score']['activity_ok'])} | {ok(r['score']['has_time'])} | {r['wall_s']} | "
                f"{md_cell(r['error'] or r['answer'])[:220]} |"
            )
        fails = [r for r in run["rows"] if r["error"] or r["score"]["tool_ok"] is False or r["score"]["place_ok"] is False
                 or r["score"]["activity_ok"] is False or r["score"]["kind_ok"] is False]
        out += ["", f"### Run {run['tag']}: failures ({len(fails)})", ""]
        if not fails:
            out.append("None.")
        for r in fails:
            what = [k for k in ("tool_ok", "place_ok", "activity_ok", "kind_ok") if r["score"][k] is False]
            calls = "; ".join(f"{c['name']}({json.dumps(c.get('input'), ensure_ascii=False)}) -> {c.get('kind')}/{c.get('place_id')}"
                              for c in r["calls"]) or "no tool call"
            out.append(f"- **{r['id']}** \"{r['text']}\": failed {', '.join(what) or 'error'}. "
                       f"Expected {r['expect_tool']} / {r['expect_place']} / {r['expect_activity']}; got {calls}."
                       + (f" Error: {r['error']}" if r["error"] else ""))
        out.append("")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", default="results.md")
    ap.add_argument("--tag", default="v1")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--utterances", default=str(HERE / "utterances.jsonl"))
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    model_id = pick_model(a.model, REGION)
    print(f"model: {model_id} ({model_label(model_id)})", file=sys.stderr)
    utts = [json.loads(l) for l in Path(a.utterances).read_text().splitlines() if l.strip()]
    if a.limit:
        utts = utts[: a.limit]

    started = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).strftime("%Y-%m-%d %H:%M")
    rows = []
    with make_mcp_client(a.url) as client:
        tools = client.list_tools_sync()
        system_prompt = build_system_prompt(client.server_instructions)
        for u in utts:
            r = run_one(tools, model_id, u["text"], system_prompt, REGION)
            row = {**u, **r}
            row["score"] = score(u, r)
            rows.append(row)
            s = row["score"]
            print(f"{u['id']:5} tool={ok(s['tool_ok'])} place={ok(s['place_ok'])} act={ok(s['activity_ok'])} "
                  f"{r['wall_s']:5.1f}s {[c['name'] for c in r['calls']]} {(r['error'] or r['answer'])[:80]}", file=sys.stderr)

    run = {"tag": a.tag, "started": started, "model_id": model_id, "model_label": model_label(model_id), "url": a.url,
           "orchestrator": orchestrator_label(model_id), "system_prompt": system_prompt,
           "summary": summarize(rows), "rows": rows}
    out_md = Path(a.out)
    out_json = out_md.with_suffix(".json")
    data = {"runs": []}
    if out_json.exists():
        data = json.loads(out_json.read_text())
    data["runs"] = [r for r in data["runs"] if r["tag"] != a.tag] + [run]
    out_json.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    out_md.write_text(render(data["runs"]))
    print(json.dumps(run["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
