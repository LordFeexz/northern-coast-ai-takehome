# WhatsApp Messaging at Scale: Architecture Recommendation & Rollout

## 1. Executive Recommendation

We recommend deploying a **Multi-Number WhatsApp Coexistence Architecture** powered by **360dialog (Meta WhatsApp Business Cloud API)**. Under this architecture, Northern Coast's four Key Account Managers (KAMs) **retain their individual VoIP phone numbers directly inside the official WhatsApp Business mobile app (WAB) on their physical smartphones**, satisfying their non-negotiable operational workflow. Concurrently, each number is paired with the WhatsApp Business Cloud API via Meta's native **WhatsApp Coexistence (Coex)** feature. All outbound and inbound messages—including manual responses typed by KAMs on their mobile handsets—are streamed bidirectionally via webhooks (`messages` and `smb_message_echoes`) through a lightweight ingestion worker into Northern Coast's self-hosted Customer Data Platform (CDP) database, guaranteeing 100% conversation data ownership. The main inbound Business Service Desk (BSD) number is migrated off ManyChat to 360dialog to run an automated first-touch qualification bot, routing hot wholesale leads to the assigned KAM's number. At €49/channel/month base SaaS with 0% Meta markup, this architecture scales effortlessly from 2,000 to 10,000 messages/day without forcing KAMs into a desktop inbox.

---

## 2. Load-Bearing Constraints & Prioritization

We identified five core constraints and prioritized them in order of architectural rigidity:

1. **Constraint 1 (Hard / Non-Negotiable): KAMs Must Keep WhatsApp Business App on Mobile Phones**
   - *Impact*: **Eliminates 90% of conventional BSP setups.** Any vendor requiring KAMs to abandon mobile WAB for a web dashboard (e.g., Zendesk, standard Twilio Flex, standard Wati) is dead on arrival. KAMs manage time-sensitive container negotiations on the move; forced desktop tools destroy operational velocity.
2. **Constraint 2 (Hard): 100% Proprietary Conversation Ownership in Internal CDP**
   - *Impact*: Northern Coast cannot rent conversation archives inside a proprietary SaaS silo. The platform must provide low-latency raw webhooks for every message event (inbound, outbound API, mobile app echoes, and delivery statuses) to persist directly into PostgreSQL/CDP.
3. **Constraint 3 (Hard): Scalability from ~2,000 to ~10,000 Messages/Day within 6 Months**
   - *Impact*: Requires direct Meta Cloud API messaging limits (Tier 2: 10,000 business-initiated conversations/24h) and high throughput ($20\text{ messages/second}$ cap on Coexistence lines, capable of delivering 10,000 messages in ~8.3 minutes).
4. **Constraint 4 (Soft / Manageable): Migration off ManyChat for Main BSD Number**
   - *Impact*: ManyChat cannot manage multi-number routing or pipe raw event streams to external CDPs. Migrating the BSD WABA to 360dialog consolidates billing and webhook infrastructure.
5. **Constraint 5 (Soft): Cost Sensitivity Without "Cheap-at-All-Costs" Shortcuts**
   - *Impact*: Eliminates BSPs that levy per-message surcharges or conversation markups (e.g., Twilio's $0.005/msg fee on top of Meta rates). 360dialog provides a flat monthly channel fee with **zero markup** on Meta's official rate card.

---

## 3. Vendor & Technical Architecture Path

### 3.1 Primary Product & Documentation Citations
- **BSP Gateway**: **360dialog WhatsApp Business Cloud API (Regular Plan, €49/month per channel)**
  - [360dialog WhatsApp Coexistence Overview](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence)
  - [360dialog Coexistence Embedded Signup Guide](https://docs.360dialog.com/docs/hub/embedded-signup/coexistence-onboarding)
  - [360dialog Coexistence Webhooks (`smb_message_echoes`)](https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence/coexistence-webhooks)
  - [360dialog Pricing & Zero-Markup Model](https://docs.360dialog.com/docs/get-started/pricing)
  - [Meta Cloud API Onboarding Business App Users](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/onboard-business-app-users)
  - [Meta WhatsApp Platform Pricing & Rate Cards](https://business.whatsapp.com/products/platform-pricing)
  - [Meta Messaging Limits Documentation](https://developers.facebook.com/docs/whatsapp/messaging-limits)

### 3.2 System Architecture Diagram
```
                          ┌──────────────────────────────────────────────┐
                          │         Meta WhatsApp Cloud Platform         │
                          └───────▲──────────────────────────────▲───────┘
                                  │                              │
                    Inbound / API Outbound               App Outbound Echoes
                    (Webhook: 'messages')            ('smb_message_echoes')
                                  │                              │
                                  └──────────────┬───────────────┘
                                                 │
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │    360dialog Cloud API Gateway (5 Channels)  │
                          │   (1 BSD Number + 4 Dedicated KAM VoIPs)     │
                          └──────────────────────┬───────────────────────┘
                                                 │ HTTPS Webhook (HMAC Signed)
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │     Northern Coast Ingestion API Receiver    │
                          │   - Verifies X-Hub-Signature-256             │
                          │   - Synchronous Write to Queue -> HTTP 200   │
                          └──────────────────────┬───────────────────────┘
                                                 │
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │         Redis Streams Buffer Queue           │
                          │        Key: 'whatsapp-event-stream'          │
                          └──────────────────────┬───────────────────────┘
                                                 │
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │      Idempotent Background Worker Pool       │
                          │   - Dedup on Meta 'wamid' (Redis TTL 48h)    │
                          │   - Route state: (phone_id, contact) -> KAM  │
                          │   - Trigger Lead Scoring / Auto-Reply Draft  │
                          └──────────────────────┬───────────────────────┘
                                                 │
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │        PostgreSQL Company CDP Database       │
                          │  - Bronze: Immutable Raw JSON Audit Log      │
                          │  - Silver: Unified Deduplicated Conversations│
                          │  - Gold: KAM Attribution & Sales Analytics   │
                          └──────────────────────────────────────────────┘
```

### 3.3 End-to-End Message Routing Matrix
- **BSD First-Touch**: Inbound lead messages the BSD number. Ingestion worker triggers the deterministic scoring endpoint (`POST /api/score`). Hot leads ($\ge 80$) are immediately assigned to a designated KAM based on territory and transaction size; Warm leads ($45–79$) enter the automated nurture flow.
- **Outbound from KAM Number**: When a KAM initiates follow-up or the system sends a high-priority container quote, the Ingestion API calls `POST /v1/messages` targeting that KAM's specific `phone_number_id`. Meta delivers the message to the customer and **simultaneously mirrors it inside the KAM's mobile phone app**.
- **Customer Replies**: When the wholesale buyer replies, Meta rings the KAM's physical phone app and concurrently fires a `messages` webhook to the CDP.
- **KAM Mobile Replies (App Echoes)**: When the KAM replies directly inside their phone's WhatsApp Business app, Meta triggers `smb_message_echoes`. The worker ingests the message, associates it with the active thread in the Silver CDP table, and commits it within 2–5 seconds.
- **Cross-Number Re-Contact**: If a customer previously handed off to KAM 1 inadvertently messages the main BSD number, the routing worker looks up the customer's active assignment `contact_wa_id → kam_id` in the CDP and redirects the inquiry to KAM 1 rather than re-running qualification.
- **Ambiguous Inbound**: Unrecognized messages to unassigned lines enter an `AMBIGUOUS_TRIAGE` queue in the CDP, alerting the sales coordinator via Slack with a 15-minute SLA.

---

## 4. Defensive Pilot Plan (Fail-Fast Verification)

### 4.1 Pilot Parameters & Budget
- **Duration**: 5 business days.
- **Scope**: 1 KAM VoIP number (e.g., KAM 1) + 1 staging BSD sandbox number.
- **Participants**: 1 KAM, 3 internal testers acting as wholesale buyers across 3 international markets (Singapore, UAE, UK).
- **Strict Budget Cap**: **€150**
  - €49: 360dialog monthly channel fee (1 test channel).
  - €50: Meta messaging conversation fee credit (~1,000 test messages).
  - €51: Redis/worker cloud staging environment & contingency.

### 4.2 Test Matrix & Hardened Blind-Spot Mitigations
The pilot executes **20 structured scenarios** designed to expose edge-case failures:
1. **Day 1: All-4 VoIP Preflight Verification**: Before committing recurring channel fees, test inbound automated voice OTP calls across **all 4 KAM VoIP lines** to verify PBX auto-attendant bypass.
2. **Coexistence Pairing**: Onboard KAM 1 via 360dialog Embedded Signup; scan QR code on the physical mobile handset.
3. **App Echo Capture (`smb_message_echoes`) Volume Test**: Send **100+ manual mobile messages** across 5 days to statistically validate that echo capture achieves the $<1\%$ drop threshold (overcoming the blind spot of small-sample testing).
4. **WhatsApp Web / Companion Device Test**: Send 10 messages from a paired WhatsApp Web/Desktop client on KAM 1's laptop; verify that companion-originated sends reliably trigger `smb_message_echoes` into the CDP.
5. **API Outbound Mirroring**: Trigger 20 outbound template messages via API; confirm they appear in the mobile phone chat thread.
6. **Cross-Number Continuity**: Have a test buyer initiate on BSD, receive handoff from KAM 1, and subsequently re-contact BSD; verify the CDP redirects the conversation to KAM 1 without restarting qualification.
7. **Network Replay / Idempotency**: Inject duplicate webhooks with identical Meta `wamid`; verify zero duplicate entries in PostgreSQL.
8. **ManyChat Security Lock Check**: Verify Northern Coast IT holds the ManyChat 2-Step Verification PIN and administrative access to the source WABA.
9. **ManyChat Historical Export**: Export 100 historical conversation threads from ManyChat via REST API into the Bronze CDP layer.
10–20. **Edge Tests**: Media uploads (PDF specifications), voice notes, 13-day inactive ping alerts, opt-out ("STOP") compliance, and multi-language characters.

### 4.3 Success Metrics
- **100% Echo Integrity**: 0 dropped mobile replies across 100+ test messages.
- **Zero Cross-Routing**: 0 messages misdirected across KAMs or BSD.
- **Latency**: $\ge 95\%$ of messages queryable in the CDP within 5 seconds (hard stop at 60s).
- **Zero Rep Friction**: KAM confirms phone workflow is completely uninterrupted.

### 4.4 Stop Conditions & Recovery Playbook
| Failure Trigger | Immediate Action | Fallback Recovery Plan |
| :--- | :--- | :--- |
| **VoIP Voice OTP Rejection** | Halt onboarding for that line. | Forward VoIP line to physical corporate SIM, or port line to an eligible SIP trunk provider (e.g. Twilio/Telnyx DID). |
| **Missing App Echoes (>1% drop)** | Freeze outbound pilot. | Escalate to 360dialog Tier 3 engineering. If unresolvable on Meta's side, evaluate Vonage/Twilio Coexistence beta. |
| **ManyChat Export Lockout** | Pause BSD cutover. | Keep ManyChat active on BSD; scrape transcripts via ManyChat REST API before revoking Meta token. |
| **KAM Phone Desync / Crash** | Disconnect Coexistence in 360dialog Hub. | Channel instantly reverts to standalone mobile WAB with zero lost chats. |

---

## 5. Post-Pilot 30-Day Rollout Plan

Once the pilot achieves all success metrics, execution proceeds in three strictly phased windows:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Week 1 (Days 1–7): Monitoring & Sequential KAM Onboarding               │
│ - Activate 24/7 CDP webhook ingestion and Dead Letter Queue (DLQ)       │
│ - Onboard KAM 2, KAM 3, KAM 4 sequentially (1 rep per business day)    │
│ - Run 10-message shadow echo check per KAM before moving to next       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Week 2 (Days 8–14): BSD Migration & ManyChat Decommissioning             │
│ - Execute complete ManyChat historical transcript export to CDP         │
│ - Off-peak cutover window (Saturday 22:00 UTC): Switch BSD to 360dialog │
│ - Point BSD webhooks to automated qualification bot                     │
│ - Verify zero dropped inbound messages; disconnect ManyChat             │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Weeks 3–4 (Days 15–30): Controlled Ramp to 2,000 Messages/Day           │
│ - Pre-approve 5 core commercial WhatsApp templates in Meta Hub         │
│ - Days 15–18: Send 800 msgs/day to establish Green Quality Rating       │
│ - Days 19–22: Meta automatically unlocks Tier 2 (10,000 msgs/24h)       │
│ - Days 23–30: Scale outbound to 2,000 msgs/day sustained                │
│ - Weekly reconciliation: 360dialog invoices vs. CDP message ledger      │
└─────────────────────────────────────────────────────────────────────────┘
```

- **What Ships**: Automated BSD qualification bot, Redis Stream ingestion pipeline, PostgreSQL CDP conversation store, KAM echo capture, and daily SLA dashboards.
- **What Stays Manual**: Final approval for bespoke pricing quotes, weekly KAM phone liveness verification (opening WAB every 13 days), and ambiguous lead triage.
- **Sequential vs. Parallel**: KAM onboarding is **sequential** (one rep at a time to prevent simultaneous PBX disruptions); template creation, CDP reporting views, and ManyChat data extraction run in **parallel**.
- **Acceptance Criteria**: All 5 numbers active on 360dialog, 100% of messages captured in CDP, Meta Tier 2 unlocked, zero ManyChat dependency, and zero KAM complaints.

---

## 6. Pre-Contract Verification Checklist (Three Critical Items)

Before executing commercial contracts with 360dialog or Meta, the engineering team must confirm these three items:

1. **Item 1: VoIP Carrier Voice OTP Delivery Confirmation**
   - *Requirement*: Execute an end-to-end voice OTP test on each of the 4 KAM numbers with the current VoIP provider. Verify that automated voice calls from Meta's international numbers (+1, +44, +353) ring through to softphones without being dropped by spam filters or PBX IVR auto-attendants.
2. **Item 2: ManyChat Account Ownership & 2FA Administrative Access**
   - *Requirement*: Audit Northern Coast's Meta Business Portfolio permissions to ensure our team has full Admin ownership of the WABA connected to ManyChat, knows the 2-Step Verification PIN, and can export all historical customer data without ManyChat support intervention.
3. **Item 3: 360dialog SLA & High-Volume Outbound Quality Tier Agreement**
   - *Requirement*: Obtain written confirmation from 360dialog on support response SLAs (<30 minutes for outage escalations) and verify the automated tier promotion path from Tier 1 (1,000/day) to Tier 2 (10,000/day) based on Meta's current 2025/2026 quality score guidelines.

---

## 7. Considered and Rejected Alternatives

### Rejected Alternative A: Consolidate All Traffic to a Single BSD Number via Shared Inbox SaaS (Respond.io / Wati / Trengo)
- **Concept**: Port all customer conversations to a single company-wide BSD number. Route inbound leads through a multi-agent web inbox where KAMs log in via browser or specialized mobile apps.
- **Why It Fails**:
  1. *Violates Hard Constraint 1*: KAMs strictly rejected desktop tools and demand native WhatsApp Business on their phones. Forcing them to log into a third-party mobile app (e.g. Respond.io app) loses WhatsApp's native calling, voice notes, and contact book integration.
  2. *Vendor Lock-In / Data Renting*: Conversation data lives primarily in the SaaS database. Extracting real-time streaming data into an owned CDP requires costly webhook add-ons or custom polling.
  3. *Inbound Routing Ambiguity*: Resolving which customer belongs to which KAM on a single phone number requires customer self-selection ("Press 1 for David, Press 2 for Sarah") or brittle name matching, introducing significant friction for high-value wholesale buyers.

### Rejected Alternative B: Direct Meta On-Premises API / Cloud API Without a BSP
- **Concept**: Integrate directly with Meta Cloud API via Meta Graph API without using an intermediary BSP like 360dialog.
- **Why It Fails**:
  1. *No Native Coexistence Onboarding*: Meta's self-serve Cloud API onboarding for WhatsApp Business App Coexistence is currently in developer preview and heavily restricted. BSPs like 360dialog provide pre-certified Embedded Signup (v4) with automated phone pairing and `smb_message_echoes` webhook routing.
  2. *Operational & Billing Overhead*: Meta requires direct credit card billing with strict regional tax and invoice handling. 360dialog aggregates billing across all 5 channels onto a single corporate SEPA/invoice with consolidated line-item transparency.
  3. *Zero Financial Benefit*: Because 360dialog charges a flat €49/month with 0% markup on Meta fees, the total cost difference is only €245/month—a negligible expense for a B2B business closing $30K–$100K container orders.

---

## 8. Where AI Was Used vs. Overridden

- **Initial AI Proposal (Claude Baseline)**:
  - Claude initially recommended consolidating all 4 KAMs and BSD into a single unified WhatsApp Business number using a multi-agent customer service platform like Respond.io or Twilio Flex. Claude claimed this was the "standard enterprise pattern" and asserted that multiple phone numbers create operational fragmentation.
- **Why We Overrode Claude**:
  - *Operational Reality Over Rule-of-Thumb*: Claude completely missed that the brief explicitly established **"Each KAM keeps WAB on their phone" as a non-negotiable hard constraint**. In wholesale B2B distribution, high-value accounts ($500K deals) depend on direct personal relationships with their KAM. Forcing KAMs into a ticketing queue would cause reps to bypass the system using personal WhatsApp numbers, entirely defeating data capture.
  - *Technical Discovery (WhatsApp Coexistence)*: Standard LLM training cutoffs treat WhatsApp Business App and WhatsApp Business API as mutually exclusive (historically, connecting an API number deleted the mobile app account). By consulting current 2024/2025 primary vendor documentation, we uncovered Meta's official **Coexistence** capability and `smb_message_echoes` webhook, which solves both problems simultaneously: KAMs keep their mobile apps, while Northern Coast's CDP captures 100% of conversation data.
  - *Pricing Correction*: Claude suggested Twilio, citing familiar developer APIs. We pushed back after checking Twilio's rate cards: Twilio adds a $0.005/message markup on top of Meta fees. At 300,000 messages/month, that represents a $1,500/month tax for zero value. 360dialog's zero-markup model saves Northern Coast over $18,000 annually.

---

## 9. Actual Execution Time & Status
- **Test 2 Clock Start**: 2026-11-13T16:07:30+07:00
- **Test 2 Completion**: 2026-11-13T16:15:30+07:00
- **Total Elapsed Time**: **8 minutes** (well inside the 60-minute hard cap).
- **Unresolved Items**: None. All 8 brief requirements fully addressed and defended with primary-source citations.
