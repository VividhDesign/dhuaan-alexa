# Friction log: Dhuaan for Alexa+ (Amazon Developer Hackathon, 23 Oct 2026)

Entries D1–D4 are **docs observations** made while planning (19:00–19:10 IST), before any hands-on work. Entries F1 onward come from hands-on work, timestamped as they happened. Nothing here is invented.

### D1 — Supported add-on locales and marketplaces aren't listed   (19:05 IST, severity: Medium, product: docs)
**Task:** Decide which locale to target for an India-first add-on. **Steps:** 1. Read the quickstart, set-up, simulator and test pages. **Expected:** A locale/marketplace matrix. **Actual:** Every page uses only `en-US` / `["US"]`. The set-up page says "Alexa+ supported marketplace" without naming any. We learned about the India Early Access launch (16 Sep 2026, Hindi and English) from press coverage. **Workaround:** Try `en-IN`, then `hi-IN`, then `en-US`. **Suggestion:** Publish a locale × marketplace × stage matrix for add-ons.

### D2 — Client capability support isn't stated where developers look   (19:07 IST, severity: Medium, product: docs)
**Task:** Design tool results for Alexa+. **Steps:** 1. Read the quickstart and test pages. **Expected:** To learn whether Alexa+ supports elicitation, `structuredContent` / `outputSchema`, and which MCP Apps display modes it supports. **Actual:** Not stated there. **Workaround:** Design defensively: a short text summary, plus structured content, plus a card. **Suggestion:** Add a capability table to the quickstart.

### D3 — Heavy set-up for a CLI   (19:08 IST, severity: Medium for hackathon newcomers, product: alexa-ai CLI)
**Task:** Install `@alexa-ai/cli`. **Actual:** It needs an IAM user, a cross-account AssumeRole into Amazon's account (`AddOn3PDeveloperToolsRead`), a CodeArtifact npm login, and a global CodeCommit git credential helper. The page also says to use "the AWS account you gave the Alexa Solutions Architect", which suggests the role only trusts pre-registered accounts. **Suggestion:** Publish to public npm, or offer a one-command `npx` installer that only needs an LWA login.

### D4 — Design Guide overview has principles but no numbers   (19:10 IST, severity: Low, product: docs)
**Actual:** Touch targets, contrast and sizes are spread over sub-pages. **Suggestion:** Put a one-table summary on the overview.

### F1 — MCP TypeScript SDK v2: the legacy (2025-11-25) path ignores `responseMode: "json"`   (19:28 IST, severity: Low, product: MCP SDK)
**Task:** Serve 2025-11-25 clients (Alexa+) with plain JSON responses. **Steps:** 1. `createMcpHandler(factory, { responseMode: "json" })`. 2. POST `initialize` with `protocolVersion: "2025-11-25"` and `accept: application/json, text/event-stream`. **Expected:** `content-type: application/json`. **Actual:** An SSE body (`event: message\ndata: {…}`). The docs say `responseMode` applies to the modern path, and `LegacyStatelessFallbackOptions` only has `maxRequestBodySize`. **Workaround:** Route with `isLegacyRequest()` to a per-request `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`. **Suggestion:** Let the legacy fallback take a response mode too.

### F2 — The 2025 path accepts JSON-RPC batches   (19:35 IST, severity: Low, product: MCP SDK)
**Steps:** POST `[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]` with `protocolVersion` negotiated at 2025-11-25. **Expected:** Rejection (batching was removed in 2025-06-18). **Actual:** 200. **Workaround:** Reject a body starting with `[` before the SDK. **Suggestion:** Reject batches on the legacy path when the negotiated version is 2025-06-18 or later.

### F3 — Provisioned concurrency is impossible on a default-limit account   (19:30 IST, severity: Medium, product: AWS)
**Task:** Keep the MCP Lambda warm for Alexa's 500 ms budget. **Steps:** `sam deploy` with `ProvisionedConcurrencyConfig: {ProvisionedConcurrentExecutions: 1}`. **Actual:** `Specified ConcurrentExecutions for function decreases account's UnreservedConcurrentExecution below its minimum value of [10].` The account's concurrency limit is 10, so the stack rolled back. **Workaround:** A 5-minute EventBridge Schedule ping that also refreshes the forecast cache. Measured warm p95 is 97 ms; cold init is 347 ms. **Suggestion (AWS):** Say in the SAM/Lambda docs that new accounts can't use provisioned concurrency until the limit is raised. **Suggestion (Alexa):** State whether the 500 ms budget applies to cold starts.

### F4 — Executor tooling couldn't run the IAM step   (19:21 IST, severity: Low, product: our tooling, not Amazon's)
Our AI pair-programmer's safety policy refused to add the inline AssumeRole policy for us, so Vividh has to run `scripts/alexa-setup.sh` himself. Not an Amazon issue; recorded for completeness.
