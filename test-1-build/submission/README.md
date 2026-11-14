# Northern Coast Lead Scoring Service

## Architecture & Design
We deploy an HTTP scoring service on Vercel Serverless Functions (`POST /api/score`). To achieve zero external API dependencies, sub-10ms latency, and prompt injection resilience, the engine evaluates transcripts via deterministic, rule-based pattern matching with zero model calls. Transcripts are stripped of instruction tags and directives before extraction.

## Scoring Policy & Routing
Scoring evaluates four signals: Import Readiness (max 35), Product Fit (max 20), Volume (max 30), and Business Network (max 15). Strict caps apply: retail inquiries cap at Cold (≤10), denied or unheld licenses cap at Cold (≤40), zero volume negations cap at Cold (≤40), and pending licenses or spot volumes cap at Warm (≤79). Hot leads (80–100) route to `kam_handoff`, Warm leads (45–79) route to `nurture_pool`, and Cold leads (0–44) route to `auto_archive`.

## Failure Handling
The endpoint validates schemas, enforces 64 KB limits (HTTP 413), returns HTTP 405 (`Allow: POST`), and returns HTTP 400 for malformed JSON or turns. Missing signals never generate fabricated claims.

## AI Attribution
- **Architecture**: GPT-6.1 Sol
- **Implementation**: Gemini Flash 3.8
- **Audit & Review**: GPT-6.1 Sol

## With More Time
1. Integrate customs and registry APIs via webhooks before KAM handoff.
2. Build automated regression test suites over CRM transcripts.
