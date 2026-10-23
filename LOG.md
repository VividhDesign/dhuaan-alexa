# Build log: Dhuaan for Alexa+ (23 Oct 2026, IST)

## Now
Plan B (decided 19:47): a local web "Alexa+ experience simulator", the track's own suggested path ("simulate an Alexa+ experience using your preferred agentic tools via a web app", Devpost resources page). Strands Agents + gemma4:12b (Ollama, local) as the orchestrator, Amazon Polly Kajal for voice, and the Echo Show card in a real MCP Apps host (AppBridge). Subagent A: sim frontend. Subagent C: eval on Gemma (v1), then the sim backend.

## Done
- 19:18 Read plan. Fetched live data: run generated 16:19 IST, fires_24h 1012, 400 clusters. All 29 places none/light (max index 29, Jalandhar). No moderate smoke anywhere today, so the heavy demo uses replay 2025-10-31.
- 19:20 S3 key layout from dhoop `backend/src/fn/api.py`: `public/latest/<name>`, `public/replay/<date>/<name>`, `public/replay/index.json`. Replays available: 2025-10-31, 2025-11-05.
- 19:21 Alexa CLI setup blocked for the executor: the auto-mode classifier refused the IAM inline policy (permission grant). Wrote `scripts/alexa-setup.sh` for Vividh to run.
- 19:22 MCP TypeScript SDK is now v2 (split packages). Using `@modelcontextprotocol/server` 2.3.1 + `@modelcontextprotocol/ext-apps` 2.0.3. `LATEST_PROTOCOL_VERSION` = 2025-11-25, in `SUPPORTED_PROTOCOL_VERSIONS`. v2 targets spec 2026-07-28 and serves 2025-era clients through a legacy path.
- 19:22 Repo public: https://github.com/VividhDesign/dhuaan-alexa (MIT).
- 19:24 Subagent B: icons (72/64/88/126/180/241), carousel 600×900, banner 1200×600, Devpost thumb 1500×1000 (sips-verified), privacy and terms pages.
- 19:25 Gazetteer: 90 of 95 localities kept after Amazon Location geocoding with an in-grid and state check (dropped: Vaishali, a wrong match; Gurdaspur, Mathura, Sri Ganganagar and Alwar are outside the grid).
- 19:26 Subagent A: MCP Apps card built to the single file `ui/dist/forecast-card.html` (223 KB), screenshots in `docs/img/`.
- 19:28 First local `tools/call` worked. `createMcpHandler`'s legacy path answered 2025-11-25 clients with SSE even with `responseMode: "json"`, so legacy requests now go through `WebStandardStreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true})`, one per POST.
- 19:30 First `sam deploy` failed: "Specified ConcurrentExecutions for function decreases account's UnreservedConcurrentExecution below its minimum value of [10]". The account's Lambda concurrency limit is 10. Deleted the empty rolled-back stack and replaced provisioned concurrency with a 5-minute EventBridge warm-up ping.
- 19:32 Stack `dhuaan-alexa` live (ap-south-1). MCP_URL https://nd0fnh12rd.execute-api.ap-south-1.amazonaws.com/mcp. Smoke test: initialize → 2025-11-25, tools/list → 3 tools, 4 × tools/call OK, /health /privacy /terms 200, GET /mcp 405.
- 19:33 Latency measured (see Numbers). **G2 passed.**
- 19:36 Tests: 44 passing (forecast maths, parity with Dhuaan's precomputed arrival/clears/peak for 3 places, windows, place resolution, protocol). **G1 passed.** Fixes from tests: "Delhi" resolved to Narela (alias precedence), and JSON-RPC batches were accepted on the 2025 path (now 400).
- 19:34 Subagent C (eval harness + Plan B chat) started.

- 19:39 Vividh ran `scripts/alexa-setup.sh`. The inline policy was added; AssumeRole was denied by Amazon's role (friction F6). vividh-cli already has AdministratorAccess, so the denial is the role's trust policy. `@alexa-ai/cli` isn't on public npm (404). **G0 failed → Plan B.**
- 19:38 Subagent C: eval harness built. Bedrock returns "Operation not allowed" for every model (NOT_AUTHORIZED, friction F5).
- 19:44 Devpost resources page, Alexa+ track: "Build a working MCP (Model Context Protocol) integration on the open standards for Agent Skills and Streamable HTTP transports. You can simulate an Alexa+ experience using your preferred agentic tools via a web app." No mention of the alexa-ai CLI. The Alexa+ support page says SAs and cases have a typical response time of two business days, so no allowlisting tonight.
- 19:46 Bedrock probed in us-east-1, us-west-2 and ap-south-1 (Nova Micro, Lite, 2 Lite): all "Operation not allowed". The account plan is PAID.
- 19:47 Local models: Ollama 0.40.5 with gemma4:12b, qwen3.5 (9.7B) and llama3.2. Probe with the live tool schemas + server instructions (5 utterances): gemma4:12b called the right tool 5/5 (0.6–1.6 s warm). qwen3.5 answered 3 of 5 from memory without tools (hallucinated times and counts), so it's rejected.
- 19:51 `replay_date` added to find_clean_air_window and get_farm_fire_activity; deployed. Replay 2025-10-31: Dwarka school_morning → "move assembly and PE indoors"; fires 1209 (366 Punjab, 28 Haryana).

## Blocked
- Alexa CLI: Amazon's role doesn't trust our account (F6). No fix tonight.
- Bedrock: account NOT_AUTHORIZED (F5). Needs a console fix by Vividh.

## Numbers
- fires_24h: 1012 (run 16:19 IST), then 1228 (next run, seen 19:29 IST).
- Latency, laptop → ap-south-1, tools/call get_smoke_forecast, 50 calls each (first call excluded from percentiles):
  - run 1: first 215 ms, p50 72 ms, p95 97 ms, max 137 ms
  - run 2: first 210 ms, p50 71 ms, p95 88 ms, max 109 ms
- Cold start (CloudWatch): Init Duration 346.87 ms; the first tools/call then loads S3 data in 223 ms. Warm handler time: 0 ms in 99 of 104 logged calls, max 3 ms after the first load.
- Replay 2025-10-31 Rohini: "Moderate smoke … reach Rohini tonight around 3:30 AM, peak tomorrow morning around 6:30 AM and clear by tomorrow morning around 10:30 AM. Mostly from fires near Sangrur and Mansa."
