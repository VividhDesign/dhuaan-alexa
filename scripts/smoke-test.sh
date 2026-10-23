#!/usr/bin/env bash
# Smoke test a deployed MCP endpoint: initialize, tools/list, tools/call x4, plus /health /privacy /terms.
set -euo pipefail
URL=${1:?usage: smoke-test.sh https://…/mcp}
API=${URL%/mcp}
H=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream')
rpc() { curl -sf "$URL" "${H[@]}" -d "$1"; }
echo "initialize → protocolVersion: $(rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["protocolVersion"])')"
echo "tools/list → $(rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | python3 -c 'import json,sys;print(", ".join(t["name"] for t in json.load(sys.stdin)["result"]["tools"]))')"
for args in '{"name":"get_smoke_forecast","arguments":{"place":"Rohini"}}' \
            '{"name":"get_smoke_forecast","arguments":{"place":"Rohini","replay_date":"2025-10-31"}}' \
            '{"name":"find_clean_air_window","arguments":{"place":"Gurugram","activity":"kids_play","day":"tomorrow"}}' \
            '{"name":"get_farm_fire_activity","arguments":{}}'; do
  rpc "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":$args}" |
    python3 -c 'import json,sys;r=json.load(sys.stdin)["result"];print("tools/call →",r["structuredContent"]["kind"],"|",r["content"][0]["text"])'
done
for p in health privacy terms; do echo "/$p → $(curl -s -o /dev/null -w '%{http_code}' "$API/$p")"; done
echo "GET /mcp → $(curl -s -o /dev/null -w '%{http_code}' "$URL")"
