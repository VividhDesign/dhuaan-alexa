# Build log: Dhuaan for Alexa+ (23 Oct 2026, IST)

## Now
Phase 1: MCP server core. Subagents A (card) and B (assets) running.

## Done
- 19:18 Read plan. Fetched live data: run generated 16:19 IST, fires_24h 1012, 400 clusters. Today all 29 places are none/light (max index 29, Jalandhar); no moderate smoke anywhere, so the heavy demo uses replay 2025-10-31.
- 19:22 S3 key layout from dhoop api.py: `public/latest/<name>`, `public/replay/<date>/<name>`, `public/replay/index.json`.
- 19:25 Alexa CLI setup blocked for the executor: the auto-mode classifier refused the IAM inline policy (permission grant). Wrote `scripts/alexa-setup.sh` for Vividh to run himself.
- 19:28 MCP TypeScript SDK is now v2 (split packages). Using `@modelcontextprotocol/server` 2.3.1 + `@modelcontextprotocol/ext-apps` 2.0.3. LATEST_PROTOCOL_VERSION 2025-11-25 in SUPPORTED list; v2 targets spec 2026-07-28 and serves 2025-era clients statelessly by default.

## Blocked
- Alexa CLI setup waits on Vividh running `scripts/alexa-setup.sh`.

## Numbers
- fires_24h (run 16:19 IST, 23 Oct): 1012
