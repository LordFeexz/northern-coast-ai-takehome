# Deployment & Handoff Guide

## 1. Candidate Ownership Deliverables (To Complete Prior to Final Submission)
The candidate owns the Vercel deployment, public repository publication, production deployment, and final email submission:
- **Public Deployed Endpoint URL**: `https://<YOUR-VERCEL-DEPLOYMENT>.vercel.app/api/score`
- **Public Git Repository URL**: `https://github.com/<YOUR-USERNAME>/<YOUR-REPO-NAME>`
- **Approximate Hours Spent**: `~X hours`

---

## 2. Project Workspace & Environment
- **Project Root**: `test-1-build/submission/`
- **Runtime**: Node.js $\ge 22.6.0$
- **Vercel Config**: `vercel.json` with `maxDuration: 30` seconds on `/api/score.ts`.
- **API Keys / Secrets**: **None required**. The service runs 100% deterministic local rule-based extraction and scoring with zero external API dependencies.

### Environment Variables
| Variable | Required | Description |
| :--- | :---: | :--- |
| `NODE_ENV` | Optional | Set to `'production'` on Vercel; `'test'` during local test runs. |
| `PORT` | Optional | Port for local loopback server (defaults to `3000`). |

---

## 3. Local Verification & Reproduction Commands

### Run Unit Tests
```bash
cd test-1-build/submission
npm test
# Runs 15 unit and integration checks: node --experimental-strip-types tests/unit.test.ts
```

### Run Comprehensive 11-Case Verification Suite
```bash
cd test-1-build/submission
npm run test:verify
# Runs full taxonomy suite: node --experimental-strip-types tests/verification.test.ts
```

### Run Playwright E2E Test Suite
```bash
cd test-1-build/submission
npm run test:e2e
# Runs Playwright E2E suite against local loopback server
```

### Run All Test Suites
```bash
cd test-1-build/submission
npm run test:all
```

### Start Local Loopback Server
```bash
cd test-1-build/submission
npm start
# Server listens on http://127.0.0.1:3000
```

---

## 4. Verification curl Examples

### A. Test Hot Wholesale Lead (S001)
```bash
curl -X POST http://127.0.0.1:3000/api/score \
  -H "Content-Type: application/json" \
  -d '{
    "lead_id": "S001",
    "channel": "whatsapp",
    "conversation": [
      {"role": "lead", "text": "UAE distributor, 3 FCL/month Red Bull, 8 years importing energy drinks. Looking for original Austrian product."},
      {"role": "agent", "text": "Volume target on Red Bull specifically?"},
      {"role": "lead", "text": "2-3 FCL/month sustained. ~250 retail accounts across UAE."}
    ]
  }'
```
**Expected Response (200 OK)**:
```json
{
  "lead_id": "S001",
  "score": 95,
  "tier": "Hot",
  "routing": "kam_handoff",
  "reasoning": "High-value commercial distributor with 8-year beverage import track record, 2.5 FCL/month sustained demand for Red Bull, and strong market presence; routed to KAM."
}
```

### B. Test Retail Consumer Inquiry (S002)
```bash
curl -X POST http://127.0.0.1:3000/api/score \
  -H "Content-Type: application/json" \
  -d '{
    "lead_id": "S002",
    "channel": "email",
    "conversation": [
      {"role": "lead", "text": "hey can I get a few cans of red bull for my office party"}
    ]
  }'
```
**Expected Response (200 OK)**:
```json
{
  "lead_id": "S002",
  "score": 10,
  "tier": "Cold",
  "routing": "auto_archive",
  "reasoning": "Retail consumer inquiry below minimum wholesale container volume threshold; automatically archived."
}
```

### C. Test Ambiguous Pending License (S003)
```bash
curl -X POST http://127.0.0.1:3000/api/score \
  -H "Content-Type: application/json" \
  -d '{
    "lead_id": "S003",
    "channel": "email",
    "conversation": [
      {"role": "lead", "text": "Ghana-based distributor looking for Coca-Cola products. New entrant, license in process — expected 6 weeks. Initial volume 1 FCL/month."}
    ]
  }'
```
**Expected Response (200 OK)**:
```json
{
  "lead_id": "S003",
  "score": 62,
  "tier": "Warm",
  "routing": "nurture_pool",
  "reasoning": "Distributor with verified Coca-Cola portfolio fit and wholesale volume, but import license is pending verification; routed to nurture pool."
}
```

---

## 5. Candidate Vercel Deployment Checklist
1. Initialize git in repository:
   ```bash
   git init
   git add .
   git commit -m "Northern Coast AI Takehome submission"
   ```
2. Create public/private repository on GitHub and push.
3. Link repository to Vercel via Vercel CLI (`vercel`) or Vercel Web Dashboard.
4. Framework preset: Select `Other` (or Node.js Serverless function). No build command or special environment variables required.
5. Deploy and execute public smoke check using the curl command above against the live Vercel URL.
6. Verify latency is strictly $< 30$ seconds (deterministic execution returns in $< 100$ms).
