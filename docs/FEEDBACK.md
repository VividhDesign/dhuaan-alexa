# Feedback for the Alexa+ and AWS teams

From the Dhuaan for Alexa+ team (Amazon Developer Hackathon, 23 Oct 2026). Every hands-on entry is timestamped in [FRICTION_LOG.md](FRICTION_LOG.md).

## 1. Which tools did we use?

- Alexa+ add-on toolkit (alexa-ai CLI): we could not install it. Amazon's tools role rejected AssumeRole from our account (friction log F6), so we hand-wrote addon/addon-package/addon.json from the documented fields. It is not deployed.
- MCP TypeScript SDK v2 (@modelcontextprotocol/server 2.3.1): Streamable HTTP server (protocol 2025-11-25), tools with output schemas, annotations, icons and server instructions.
- MCP Apps (@modelcontextprotocol/ext-apps): the Echo Show 36-hour smoke timeline card, and its AppBridge host in our simulator.
- MCP Inspector: protocol checks.
- Strands Agents SDK (AWS open source): the orchestrator in our Alexa+ experience simulator and eval, using Strands' MCP client and Ollama provider.
- AWS: Lambda, API Gateway (HTTP API), S3, Amazon Location Service (geo-places Geocode), CloudWatch, SAM/CloudFormation for the server; Amazon Polly (neural voice Kajal) for the spoken answers. The forecast pipeline uses EventBridge Scheduler, Step Functions, Lambda, S3, DynamoDB and SNS. Amazon Bedrock was blocked for our account (F5).
- Data: NASA FIRMS (VIIRS active fires) and Open-Meteo (GFS winds).

## 2. What worked well?

- MCP standard: the same server works with MCP Inspector, a Strands agent and our simulator without changes, so we could build and test everything before touching Alexa+.
- MCP TypeScript SDK v2 ships 2025-11-25 support, so serving Alexa+'s protocol version took one handler.
- MCP Apps: one self-contained HTML file plus a resource URI is a clean model, and AppBridge let us host the same card in our own page.
- Docs: the 500 ms latency requirement and the auth tiers are stated clearly up front, which shaped our design (precomputed physics, cached grid) from minute one.
- AWS: SAM deploys in minutes; Strands' MCP client connects to a Streamable HTTP server in a few lines; Amazon Location handled Indian locality names, including Hindi, well; Amazon Polly's Kajal voice speaks Hindi and Indian English naturally.

## 3. What needs work?

- Add-on toolkit access (blocker): following "Set Up Your Development Environment", `aws sts get-caller-identity --profile alexa-ai` returns "AccessDenied when calling the AssumeRole operation: User: arn:aws:iam::585008053042:user/vividh-cli is not authorized to perform: sts:AssumeRole on resource: arn:aws:iam::372468808636:role/AddOn3PDeveloperToolsRead", even with AdministratorAccess on our side. The role's trust policy rejects our account, the CLI isn't on public npm, and the page only hints that the account must be the one given to an Alexa Solutions Architect. Please say so before step 1. (F6)
- Bedrock: every model returned "ValidationException: Operation not allowed" in us-east-1, us-west-2 and ap-south-1 on a PAID-plan account, with no reason given. The availability API says NOT_AUTHORIZED while agreement and entitlement are AVAILABLE. The error should say why and link to the fix. (F5)
- MCP TypeScript SDK v2: the legacy (2025-11-25) path ignores `responseMode: "json"` and answers with an SSE body, and it accepts JSON-RPC batches that 2025-06-18 removed. (F1, F2)
- Add-on docs — locales/marketplaces: the quickstart, setup, test and simulator pages only show en-US/["US"]. We learned from press coverage that Alexa+ launched in India (Hindi/English) on 16 Sep 2026, but couldn't tell from the docs whether en-IN/hi-IN add-ons are supported. We couldn't test it: the CLI install failed before `alexa-ai new mcp`.
- Add-on docs — client capabilities: the quickstart and test pages don't say whether Alexa+ supports elicitation, structuredContent/outputSchema, or which MCP Apps display modes it supports, so we designed defensively (text summary + structured data + card).
- Setup weight: an IAM user, a cross-account AssumeRole, a CodeArtifact login and a CodeCommit git credential helper is heavy for a CLI, and the global git helper can interfere with other Git hosts unless scoped.
- Design guide: the overview page has principles but the concrete numbers (touch targets, contrast, sizes) are spread across sub-pages.

## 4. Onboarding

MCP side: about 10 minutes from an empty folder (19:19) to the first local tools/call (19:28) with the official TypeScript SDK, using an AI pair-programmer.
Alexa+ side: blocked about 2 minutes into the CLI setup, at role assumption, so we never reached hello world.
The biggest time sink was diagnosing account-level gates (the add-on tools role and Bedrock) whose errors don't say why.

## 5. Would we build again?

Yes. Alexa+ speaking Hindi in Indian homes is exactly the channel a smoke forecast needs — people decide about windows, walks and school runs at home, often by voice — and building on the open MCP standard meant our server works with Alexa+ and any other MCP client. We'd build again and would ship to customers if add-ons gain proactive, opt-in alerts and clear en-IN/hi-IN support. We'd also keep using Strands to evaluate tool routing before every release, and Bedrock once our account can use it.

## Feature requests

1. Proactive notifications from MCP add-ons — Critical. Smoke reaches Delhi around 3 AM; a forecast only helps if it can reach a family at 10 PM without them asking. We'd like an add-on to publish a time-bound, opt-in alert ("Smoke expected in Rohini around 3:30 AM — close windows before bed") to users who enabled it.
2. Opt-in location context for add-ons — Important. "Will smoke reach my home?" should work without naming a place. Passing the device's city or postal code, with the customer's permission, would remove the most common clarifying turn.
3. A published locale/marketplace matrix for add-ons, plus en-IN and hi-IN testing in the web simulator — Important. Alexa+ is in Early Access in India in Hindi, but the add-on docs only show en-US/US, so builders can't tell what they can target.
4. A CLI command to send a test utterance and get the routed tool call back (e.g. `alexa-ai invoke --utterance "…"`) — Nice-to-have. It would let us run our routing evaluation against real Alexa+ in CI instead of a stand-in model.
5. Self-serve enablement for the add-on toolkit — Critical. Any developer whose console shows the Alexa+ add-on entry should be able to assume the tools role (or install the CLI from public npm) without an SA, ideally with a clear error naming the missing step. (F6)
