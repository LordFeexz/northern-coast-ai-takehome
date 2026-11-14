import type { ExtractedEvidence, ScoreRequest, ScoreResponse, ScoreRouting, ScoreTier } from './types.ts';

export function computeScore(request: ScoreRequest, evidence: ExtractedEvidence): ScoreResponse {
  let importScore = 0;
  let productScore = 0;
  let volumeScore = 0;
  let businessScore = 0;

  // 1. Signal 1: Import Readiness (max 35)
  if (evidence.import_status === 'active' && evidence.import_years >= 5) {
    importScore = 35;
  } else if (evidence.import_status === 'active' || evidence.import_years >= 5) {
    importScore = 30;
  } else if (evidence.import_status === 'pending') {
    importScore = 12;
  } else {
    // none_or_unknown or denied
    importScore = 0;
  }

  // 2. Signal 2: Product Fit (max 20)
  if (evidence.product_category === 'portfolio_match') {
    productScore = 20;
  } else if (evidence.product_category === 'general_beverage') {
    productScore = 10;
  } else {
    productScore = 0;
  }

  // 3. Signal 3: Volume & Commitment (max 30)
  if (evidence.volume_commitment === 'recurring') {
    if (evidence.volume_fcl_per_month >= 2) {
      volumeScore = 30;
    } else if (evidence.volume_fcl_per_month >= 0.8) {
      volumeScore = 22; // ~1 FCL/month
    } else {
      volumeScore = 10;
    }
  } else if (evidence.volume_commitment === 'spot_one_off') {
    volumeScore = 10;
  } else {
    volumeScore = 0;
  }

  // 4. Signal 4: Business Evidence (max 15)
  if (evidence.business_type === 'substantial_network') {
    businessScore = 15;
  } else if (evidence.business_type === 'established_distributor') {
    businessScore = 8;
  } else if (evidence.business_type === 'single_signal') {
    businessScore = 6;
  } else {
    businessScore = 0;
  }

  let rawScore = importScore + productScore + volumeScore + businessScore;
  let score = rawScore;
  const limitsApplied: string[] = [];

  // Guardrail 1: Retail consumer disqualifier
  if (evidence.is_retail_consumer || evidence.volume_commitment === 'retail_or_unknown' && volumeScore === 0 && businessScore === 0) {
    if (evidence.is_retail_consumer) {
      score = Math.min(score, 10);
      limitsApplied.push('retail consumer inquiry capped at Cold (<=10)');
    }
  }

  // Guardrail 2: Denied license disqualifier
  if (evidence.import_status === 'denied') {
    score = Math.min(score, 40);
    limitsApplied.push('denied import license capped at Cold (<=40)');
  }

  // Guardrail 3: Pending or Unknown license cap (unless proven track record >= 5 years)
  const hasSubstantialImportHistory = evidence.import_years >= 5;
  if (evidence.import_status === 'pending' || (evidence.import_status === 'none_or_unknown' && !hasSubstantialImportHistory)) {
    if (score > 79) {
      score = 79;
      limitsApplied.push('pending or unverified import licensing capped at Warm (<=79)');
    }
  }

  // Guardrail 4: Non-recurring volume cap (spot purchases cannot qualify for Hot)
  if (evidence.volume_commitment !== 'recurring' || evidence.volume_fcl_per_month < 1) {
    if (score > 79) {
      score = 79;
      limitsApplied.push('sub-FCL or non-recurring spot volume capped at Warm (<=79)');
    }
  }

  // Guardrail 5: Zero container volume with no business distribution footprint capped at Cold (<=40)
  if (evidence.volume_fcl_per_month === 0 && (evidence.volume_commitment === 'retail_or_unknown' || evidence.business_type === 'none_consumer')) {
    if (score > 40) {
      score = 40;
      limitsApplied.push('zero container volume and no distribution footprint capped at Cold (<=40)');
    }
  }

  // Final score clamping
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Determine Tier and Routing strictly per business rules:
  // Hot = ready for KAM call -> kam_handoff
  // Warm = nurture pool -> nurture_pool
  // Cold = auto-archive -> auto_archive
  let tier: ScoreTier;
  let routing: ScoreRouting;

  if (score >= 80) {
    tier = 'Hot';
    routing = 'kam_handoff';
  } else if (score >= 45) {
    tier = 'Warm';
    routing = 'nurture_pool';
  } else {
    tier = 'Cold';
    routing = 'auto_archive';
  }

  // Construct explanatory reasoning
  const reasoning = generateReasoning(evidence, score, tier, routing, limitsApplied);

  return {
    lead_id: request.lead_id,
    score,
    tier,
    routing,
    reasoning,
  };
}

function generateReasoning(
  evidence: ExtractedEvidence,
  score: number,
  tier: ScoreTier,
  routing: ScoreRouting,
  limitsApplied: string[]
): string {
  if (tier === 'Hot') {
    const importNote = evidence.import_years >= 5
      ? `${evidence.import_years}-year beverage import track record`
      : 'verified active import license';
    const volumeNote = evidence.volume_commitment === 'recurring' && evidence.volume_fcl_per_month > 0
      ? `${evidence.volume_fcl_per_month} FCL/month sustained demand`
      : 'commercial container requirements';
    const productNote = evidence.product_names.length > 0 ? evidence.product_names.join(', ') : 'portfolio brands';
    return `High-value commercial distributor with ${importNote}, ${volumeNote} for ${productNote}, and strong market presence; routed to KAM.`;
  }

  if (tier === 'Warm') {
    const product = evidence.product_names.length > 0 ? evidence.product_names[0] : 'portfolio beverage';
    if (evidence.import_status === 'pending') {
      const volStr = evidence.volume_fcl_per_month > 0 ? ` and ${evidence.volume_fcl_per_month} FCL/month volume target` : '';
      return `Distributor with clear ${product} product fit${volStr}, but import license is pending verification; routed to nurture pool.`;
    }
    if (evidence.volume_commitment === 'spot_one_off') {
      const credNote = evidence.import_status === 'active'
        ? (evidence.import_years >= 5 ? 'with 5+ year import track record' : 'with active import license')
        : 'with unverified licensing';
      return `Commercial beverage buyer ${credNote}, but volume is spot/one-off rather than recurring contract; routed to nurture pool.`;
    }
    if (evidence.import_status === 'active') {
      const volStr = evidence.volume_fcl_per_month > 0 ? `${evidence.volume_fcl_per_month} FCL/month recurring volume` : 'commercial volume requirements';
      return `Licensed importer with direct ${product} portfolio fit and ${volStr}; queued for nurture follow-up.`;
    }
    // Unknown or unconfirmed licensing
    const volStr = evidence.volume_fcl_per_month > 0 ? ` and ${evidence.volume_fcl_per_month} FCL/month volume target` : '';
    return `Wholesale inquiry with ${product} portfolio fit${volStr}; import licensing credentials and recurring volume require verification in nurture pool.`;
  }

  // Cold
  if (evidence.is_retail_consumer) {
    return `Retail consumer inquiry below minimum wholesale container volume threshold; automatically archived.`;
  }
  if (evidence.import_status === 'denied') {
    return `Import license denied or invalid, failing mandatory compliance criteria; automatically archived.`;
  }
  if (evidence.product_category === 'portfolio_match') {
    return `Wholesale inquiry with ${evidence.product_names[0] || 'portfolio'} product fit, but lacks verified import license or container volume commitment; automatically archived.`;
  }
  return `Inquiry lacks wholesale commercial qualification or required beverage import credentials; automatically archived.`;
}
