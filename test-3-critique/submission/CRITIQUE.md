# Critique: Mary Scoring v5 — Confidence-Calibrated Unified Scoring RFC

**Reviewer:** Senior AI Platform Engineer, Northern Coast Beverages  
**Document Under Review:** `RFC — Mary scoring v5: Confidence-calibrated unified scoring` (Date: 2026-05-08)  
**Status:** Evaluation & Recommendation  

---

## 1. Score the RFC

| Dimension | Score (1–5) | One-Line Rationale |
| :--- | :---: | :--- |
| **Problem Framing** | **3 / 5** | Identifies a genuine business friction (rigid gate cutoffs missing high-value tail accounts), but misdiagnoses retrospective closed-deal size as a first-touch qualification failure without defining observable first-touch predictors. |
| **Evidence Quality** | **1 / 5** | Catastrophically underpowered: conclusions rely on 14 staging samples where percentage gains represent a single sample flip ($10 \to 11$), with uncalibrated metrics and zero statistical confidence intervals. |
| **Architectural Fit** | **2 / 5** | Replaces modular, inspectable, and deterministic business logic with a non-deterministic monolithic LLM prompt, destroying per-gate auditability and entangling evidence extraction with scoring. |
| **Migration Risk** | **2 / 5** | Proposes an ill-defined 14-day shadow window with vague cutover criteria ("shadow accuracy $\ge$ production accuracy"), no rollback playbook, and an irreconcilable timeline (deleting code in week 4 while decommissioning in month 3). |
| **Recommendation Supportability** | **1 / 5** | Recommending a full production replacement and gate decommission based on 14 cherry-picked staging samples without paired holdout evaluations or sales capacity budgets is commercially irresponsible. |

---

## 2. Load-Bearing Claims Audit

### Claim 1: "The L009 incident reveals a structural flaw in the gate model that a unified LLM call solves."
- **RFC Passage**: Lines 14–15: *"The L009 incident (Andean Distribuciones, Brazil) is the canonical example — scored Warm (67) at first touch, ultimately closed for $500K (would have been Hot if the system understood deal size)."*
- **Evidence & Evaluation**: **UNSUPPORTED (Retrospective Hindsight & Survivorship Bias)**
  - In wholesale beverage distribution, new enterprise buyers rarely disclose their full annual purchasing power in an opening WhatsApp message. Evaluating a first-touch qualification decision against the eventual $500K closed deal size is a textbook retrospective fallacy.
  - Furthermore, scoring L009 as Warm (67) did **not** lose the deal; Warm leads enter the nurture pool, where Andean Distribuciones was successfully nurtured and converted to a closed transaction.
  - If Northern Coast wants to prioritize leads with strong regional footprints earlier, the gate model's weights can be adjusted (e.g., granting more points to distributor networks or adding an explicit whale escalation heuristic) without abandoning deterministic rules.

### Claim 2: "The calibrated LLM improves tier accuracy from 71% to 79%."
- **RFC Passage**: Line 37 in Evidence Table: *Old (gates) 71% vs. New (calibrated LLM) 79% across 14 staging conversations.*
- **Evidence & Evaluation**: **UNSUPPORTED (The Single-Sample Illusion)**
  - In a sample size of exactly $N=14$:
    $$\frac{10}{14} = 71.43\% \approx 71\%, \quad \frac{11}{14} = 78.57\% \approx 79\%$$
  - The entire claimed 8% improvement across the staging dataset represents **exactly ONE conversation changing classification from wrong to right** ($10 \to 11$).
  - For $N=14$, the 95% binomial confidence interval for $11/14$ spans roughly 49% to 95% ($p > 0.40$). Claiming statistical superiority or production readiness based on a single sample flip is mathematically indefensible.

### Claim 3: "Tail detection improved 3.6× (14% → 50%), proving it will catch L009-shaped opportunities."
- **RFC Passage**: Lines 38–41: *"Tail detection (Warm with score >70): 14% -> 50%... Tail detection improved 3.6× in the sample — sufficient to expect this would have caught L009-shaped opportunities in the wild."*
- **Evidence & Evaluation**: **UNSUPPORTED (Score Inflation vs. Real Recall & Missing Capacity Costs)**
  - The RFC defines tail detection circularly as "Warm leads with score >70". Out of 14 samples, how many were true commercial whales? If only 2 were true tail leads, $14.3\% \approx 2/14$ and $50\% = 1/2$ (a difference of 1 lead caught).
  - If the prompt simply shifts the model's score distribution upward by 5–10 points across all inputs, more leads cross the arbitrary 70 threshold without improving true recall of commercially viable whales.
  - The RFC completely omits False Positive Rate and precision. Tripling the volume of leads scoring $>70$ risks overwhelming Key Account Managers (KAMs) with unready buyers, diluting sales focus on verified high-value accounts.

### Claim 4: "Confidence calibration (Brier score 0.18) enables reliable tail routing."
- **RFC Passage**: Lines 27–28, 39: *"when the model is confident a lead is in the tail (e.g., scoring 85±2)... Confidence calibration (Brier score): 0.18."*
- **Evidence & Evaluation**: **UNSUPPORTED (Ill-Posed Metric & Underperforming Naive Guessing)**
  - A Brier score ($BS = \frac{1}{N} \sum (f_t - o_t)^2$) strictly measures the accuracy of probabilistic forecasts for a **binary outcome** ($o_t \in \{0, 1\}$). However, the RFC outputs a score interval (e.g. "75 ± 12"), not a probability! What was $o_t$? Did it represent "lead closed $> \$100K$", "converted to Hot", or "human agreement"?
  - On a baseline where tail leads represent 1 out of 14 cases ($p = 0.071$), a zero-intelligence naive model predicting $P=0$ for all leads yields a Brier score of:
    $$BS_{\text{naive}} = \frac{13}{14}(0 - 0)^2 + \frac{1}{14}(0 - 1)^2 = 0.071$$
    Even assuming 2 tail cases ($p = 0.143$), the naive baseline is $0.143$. The RFC's reported score of **0.18 is substantially WORSE than naive base-rate guessing**. Citing 0.18 as evidence of superior calibration indicates fundamental statistical misunderstanding.

### Claim 5: "Removing the per-gate evaluation removes ~400 lines of code and reduces system complexity."
- **RFC Passage**: Lines 28–30: *"removing the per-gate evaluation removes ~400 lines of scoring code and eliminates the gate-by-gate eval surface, which has been a maintenance burden."*
- **Evidence & Evaluation**: **UNSUPPORTED (Transferring Complexity to Prompt Opacity)**
  - Deterministic code is modular, lintable, and unit-testable. An end-to-end LLM prompt is an opaque, stochastic matrix.
  - Under the gate model, misclassifications can be isolated to a specific gate (e.g. Volume gate received 0 points). In a single monolithic prompt, tweaking instructions to capture L009 risks unintended behavioral regressions on routine leads.
  - Moreover, Section 4 specifies *"Remove the gate-based scoring code (week 4)"*, while Section 6 recommends *"Decommission gate scoring at month 3"*. Deleting the code in week 4 while decommissioning in month 3 creates an irreconcilable operational contradiction that eliminates rollback capability.

---

## 3. What Is Missing

### Consideration 1: Hybrid Architecture (LLM Structured Extraction + Deterministic Scoring Gates)
The RFC presents a false dichotomy between keyword-based gates and an opaque, end-to-end LLM scoring call. The proven architecture for enterprise qualification is a **hybrid pipeline**:
- Use the LLM strictly to parse unstructured conversational text into typed, verifiable entity facts (`import_license_status`, `monthly_fcl_volume`, `years_in_business`, `retail_account_network`).
- Pass these structured facts to a deterministic scoring engine with transparent arithmetic weights and hard guardrail caps.
- **Why it matters**: This captures nuanced natural language context while retaining 100% auditability, zero stochastic scoring variance, sub-millisecond scoring execution, and the ability to A/B test individual signal weights without prompt re-engineering.

### Consideration 2: Tail Escalation Rules & Asynchronous External Enrichment
Missing occasional high-value whales does not justify dismantling the core qualification architecture for the 98% of routine inquiries.
- **Tail Override Heuristic**: A simple deterministic escalation rule (e.g. if demonstrated import history $\ge 5$ years OR distribution footprint $\ge 100$ accounts, route to `senior_kam_review` regardless of missing portal fields) captures L009-shaped accounts with zero model migration risk.
- **External Enrichment**: An LLM cannot reliably infer true commercial scale from a 2-sentence WhatsApp greeting. True whale identification requires asynchronous lookups against global trade and customs databases (e.g. Panjiva, ImportGenius, UAE Chamber of Commerce registries) triggered post-capture.

### Consideration 3: Statistically Powered Evaluation & Sales Capacity Budgeting
- **Sample Power**: Drawing architecture conclusions from $N=14$ conversations is statistically invalid ($p > 0.40$ on the single-sample shift from 10/14 to 11/14). The proposal requires a frozen holdout benchmark of $N \ge 300$ historical conversations with double-blind ground-truth labeling (with deal outcome redacted to prevent label leakage).
- **Sales Capacity Constraints**: The RFC reports a 3.6× increase in leads scoring $>70$, but completely omits the False Positive Rate. If the model triples the volume of leads routed to high-touch KAMs, it risks overwhelming the sales team with unready buyers, degrading response times on true whales. Any routing change must include an incremental sales review load budget.

---

## 4. Decision: Send-Back-to-Author

**Decision**: **`send-back-to-author`** (~215 words)

While improving the capture of high-value tail opportunities like L009 is a critical commercial priority, this proposal is premature and presents unacceptable architectural and operational risks. The evaluation evidence is fundamentally unpowered—relying on just 14 staging samples where the entire 71% to 79% accuracy gain represents a single conversation changing outcome, with an undefined Brier metric that underperforms naive baseline guessing. Furthermore, replacing inspectable deterministic gates with an opaque monolithic LLM prompt destroys root-cause debuggability and introduces uncontrolled score variance.

**Required Changes for Re-Submission:**
1. **Statistically Powered Benchmark**: Evaluate against a frozen holdout of $N \ge 300$ conversations with double-blind human labels (with deal outcomes redacted to prevent label leakage), reporting paired accuracy, tail recall, precision, and false-positive rates.
2. **Benchmark Simpler Baselines**: Evaluate against a hybrid model (LLM evidence extraction with deterministic scoring) and an explicit tail escalation heuristic.
3. **Rigorous Calibration**: Define the exact binary target variable for probability calibration, provide reliability curves, and benchmark against the climatological base rate.
4. **Sales Capacity Modeling**: Quantify incremental KAM handoff volume and establish an agreed workload threshold with commercial leadership.
5. **Reconciled Migration & Rollback**: Maintain legacy code in production behind a feature flag until Month 3 decommission, establishing automated rollback thresholds for latency and tier drift.

*Conditions that would change the decision*: If paired testing on 300 holdout cases demonstrates $\ge 25\%$ higher tail recall at equal precision without increasing false positives, and preserves automated rollback, we would approve with revisions.

---

## 5. Senior Engineer Debrief Questions

### Question 1 (First-Touch Signal Analysis & Selection Bias)
> *"At first touch, what specific signals were present in L009's opening message, and why was scoring Warm (67)—which entered nurture and successfully closed for $500K—a failure of the gate model rather than normal B2B sales progression?"*
- **Interviewer Signal**: Strong senior engineers understand that buyers rarely reveal their full budget upfront and recognize that a lead converting from Warm to Closed indicates the nurture funnel worked. Weak candidates will assert that first-touch scoring should magically predict final contract value.

### Question 2 (Statistical Power & Sample Size)
> *"In your 14-sample staging pilot, the shift from 71% to 79% accuracy represents exactly one conversation changing classification ($10/14 \to 11/14$). How did you calculate statistical significance, and what sample size and minimum detectable effect size have you budgeted for the 14-day shadow phase?"*
- **Interviewer Signal**: Strong seniors will acknowledge the sample was an underpowered directional smoke test and define sample sizing with confidence intervals and power calculations ($\beta \ge 0.80$). Weak candidates will defend 79% as a proven empirical gain.

### Question 3 (Probabilistic Calibration & Baseline Anchoring)
> *"What exact binary target event ($o_t \in \{0, 1\}$) was used to compute the 0.18 Brier score, what was the staging sample base rate, and how did you benchmark that against a naive climatological forecast (which yields a Brier score of 0.071 on a 1/14 base rate)?"*
- **Interviewer Signal**: Reveals whether the author actually understands probabilistic scoring rules and calibration, or merely ran an off-the-shelf library function and copy-pasted a number into the RFC.

### Question 4 (Sales Capacity & Precision/Recall Trade-offs)
> *"Your tail detection metric measures Warm leads scoring $>70$, which increased 3.6×. If this triples the volume of leads flagged for KAM review, what is your false positive rate, and what capacity modeling did you conduct with sales leadership to prevent KAM burnout?"*
- **Interviewer Signal**: Tests whether the candidate thinks end-to-end about business impact. Strong platform engineers know that routing 3× more leads to KAMs destroys sales efficiency unless precision remains high.

### Question 5 (Migration Contradiction & Rollback Engineering)
> *"Your migration plan deletes the legacy 5-gate scoring code in Week 4, but Section 6 states decommissioning occurs at Month 3. If the shadow service experiences unexpected latency spikes or prompt drift in Week 5, how do you execute rollback without the legacy code?"*
- **Interviewer Signal**: Tests operational maturity and disaster recovery design. Strong seniors immediately spot the timeline contradiction and insist on maintaining active fallbacks until full decommissioning sign-off.
