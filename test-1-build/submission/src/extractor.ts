import type { ExtractedEvidence, ScoreRequest, ConversationTurn } from './types.ts';
import { sanitizeAndVerifyEvidence } from './validation.ts';

/**
 * Sanitizes turn text to strip out adversarial instruction wrappers, XML/bracket tags,
 * and prompt injection override attempts before regex extraction.
 */
function sanitizeTurnText(rawText: string): string {
  // Greedy strip of any instruction/system/transcript/admin tag blocks (handles arbitrarily nested tags)
  let text = rawText
    .replace(/<(?:system|transcript|instruction|prompt|context|admin)[^>]*>[\s\S]*<\/(?:system|transcript|instruction|prompt|context|admin)>/gi, ' ')
    .replace(/\[(?:SYS|SYSTEM|INST)\][\s\S]*\[\/(?:SYS|SYSTEM|INST)\]/gi, ' ');

  // Strip unclosed opening tags to the end
  text = text.replace(/<(?:system|transcript|instruction|prompt|context|admin)[^>]*>[\s\S]*/gi, ' ');
  text = text.replace(/\[(?:SYS|SYSTEM|INST)\][\s\S]*/gi, ' ');

  // Clean up any stray closing or orphan tags
  text = text.replace(/<\/?(?:transcript|system|instruction|prompt|context|admin)[^>]*>/gi, ' ');
  text = text.replace(/\[\/?(?:INST|SYS|SYSTEM)\]/gi, ' ');

  // Strip prompt injection directives attempting to override scoring rules or impersonate system/admin
  const injectionPatterns = [
    /\b(?:system|admin|evaluator|prompt)\s*(?:override|update|instruction|command|directive|note)\s*:?[\s\S]*/gi,
    /\bignore\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions|rules|prompts)[\s\S]*/gi,
    /\boverride\s+(?:all\s+)?(?:rules|instructions)[\s\S]*/gi,
    /\btreat\s+(?:the\s+following|this)\s+as\s+(?:verified|active|a\s+distributor)[\s\S]*/gi,
  ];

  for (const pattern of injectionPatterns) {
    text = text.replace(pattern, ' ');
  }

  return text.trim();
}

/**
 * Deterministic, rule-based evidence extractor.
 * Evaluates inbound conversation transcripts locally with zero external API calls or LLM dependencies.
 * Extracts:
 * - Licensing status (active, pending, denied, none_or_unknown)
 * - Import history (years importing beverages)
 * - Product fit (portfolio match, general beverage, irrelevant)
 * - Volume & commitment (recurring FCL/month, spot one-off, retail/unknown)
 * - Business footprint (substantial network, established distributor, single signal, none)
 * - Retail consumer disqualification
 */
export async function extractEvidence(request: ScoreRequest): Promise<ExtractedEvidence> {
  const turns = request.conversation;

  let import_status: 'active' | 'pending' | 'none_or_unknown' | 'denied' = 'none_or_unknown';
  let import_years = 0;
  let import_evidence_quote: string | undefined;
  let import_turn_index: number | undefined;

  let product_category: 'portfolio_match' | 'general_beverage' | 'irrelevant' = 'irrelevant';
  const product_names: string[] = [];
  let product_evidence_quote: string | undefined;
  let product_turn_index: number | undefined;

  let volume_fcl_per_month = 0;
  let volume_commitment: 'recurring' | 'spot_one_off' | 'retail_or_unknown' = 'retail_or_unknown';
  let volume_evidence_quote: string | undefined;
  let volume_turn_index: number | undefined;

  let business_type: 'substantial_network' | 'established_distributor' | 'single_signal' | 'none_consumer' = 'none_consumer';
  let business_evidence_quote: string | undefined;
  let business_turn_index: number | undefined;

  let is_retail_consumer = false;

  // Process turns in chronological order
  for (let idx = 0; idx < turns.length; idx++) {
    const turn = turns[idx];
    if (turn.role !== 'lead') {
      continue; // Strictly ignore agent turns as factual evidence for lead qualification
    }

    const text = sanitizeTurnText(turn.text);
    if (!text) {
      continue;
    }

    // 1. Retail consumer detection
    const retailPattern = /\b(?:few\s+cans|couple\s+of\s+cans|a\s+few\s+cans|single\s+can|cans?\s+for|office\s+party|house\s+party|birthday|personal\s+use|home\s+use|small\s+pack)\b/i;
    const retailMatch = text.match(retailPattern);
    if (retailMatch) {
      is_retail_consumer = true;
      volume_commitment = 'retail_or_unknown';
      volume_fcl_per_month = 0;
      business_type = 'none_consumer';
      if (!volume_evidence_quote) {
        volume_evidence_quote = retailMatch[0];
        volume_turn_index = idx;
      }
    }

    // 2. Import Licensing & History
    // Check for explicit denial / revocation / cancellation
    const deniedPattern = /\b(?:license|licence|permit|application)\s+(?:was\s+|is\s+)?(?:denied|rejected|revoked|refused|cancelled|canceled|withdrawn|lost)\b|\b(?:license|licence)\s+application\s+failed\b/i;
    const deniedMatch = text.match(deniedPattern);

    // Check for unheld / unlicensed / negative phrasing: e.g. "do not hold an active import license", "not licensed", "unlicensed", "no license"
    const unheldPattern = /\b(?:do\s+not\s+(?:have|hold|possess)|don['’]t\s+(?:have|hold|possess)|no\s+longer\s+hold|without|lack(?:s)?|no|cannot\s+(?:obtain|get))\s+(?:an?\s+)?(?:active\s+|valid\s+)?(?:import\s+)?(?:license|licence|permit)\b|\b(?:not\s+licensed|unlicensed|no\s+(?:import\s+)?(?:license|licence))\b/i;
    const unheldMatch = text.match(unheldPattern);

    if (deniedMatch) {
      import_status = 'denied';
      import_years = 0;
      import_evidence_quote = deniedMatch[0];
      import_turn_index = idx;
    } else if (unheldMatch) {
      import_status = 'denied';
      import_years = 0;
      import_evidence_quote = unheldMatch[0];
      import_turn_index = idx;
    } else {
      // Check for pending / in-process license
      const pendingPattern = /\b(?:license|licence|permit|application)\s+(?:is\s+)?(?:in\s+process|in\s+progress|pending|underway|under\s+review)\b|\b(?:applied\s+for|awaiting|expecting)\s+(?:an?\s+)?(?:import\s+)?(?:license|licence)\b|\b(?:license|licence)\s+expected\s+(?:in\s+)?\d+\s*(?:weeks?|months?|days?)\b/i;
      const pendingMatch = text.match(pendingPattern);
      if (pendingMatch) {
        import_status = 'pending';
        import_years = 0;
        import_evidence_quote = pendingMatch[0];
        import_turn_index = idx;
      } else {
        // Check for active license (only if no negative unheld phrasing)
        const activePattern = /\blicensed\s+(\d+)\s*years?\b|\bactive\s+(?:import\s+)?(?:license|licence)\b|\b(?:have|hold|possess|with)\s+(?:an?\s+)?active\s+(?:import\s+)?(?:license|licence)\b|\b(?:yes[,\s]+)?licensed\b/i;
        const activeMatch = text.match(activePattern);
        if (activeMatch) {
          import_status = 'active';
          if (!import_evidence_quote) {
            import_evidence_quote = activeMatch[0];
            import_turn_index = idx;
          }
        }

        // Check for import track record / years
        const yearsPattern = /\b(\d+)\s*years?\s+(?:of\s+)?importing\b|\blicensed\s+(\d+)\s*years?\b|\bimport(?:ing)?\s+(?:history|experience)(?:\s+of)?\s+(\d+)\s*years?\b|\b(\d+)\s*years?(?:\s+\w+)?\s+(?:import\s+)?(?:license|licence)\b|\b(\d+)\s*years?\s+(?:as|in|of)?\s*(?:beverage\s+)?(?:importer|distributor|distribution)\b/i;
        const yearsMatch = text.match(yearsPattern);
        if (yearsMatch) {
          const yrs = parseInt(yearsMatch[1] || yearsMatch[2] || yearsMatch[3] || yearsMatch[4] || yearsMatch[5], 10);
          if (!isNaN(yrs) && yrs > 0) {
            import_years = yrs;
            import_evidence_quote = yearsMatch[0];
            import_turn_index = idx;
          }
        }
      }
    }

    // 3. Product Fit
    const portfolioMatches: string[] = [];
    let foundProductQuote: string | undefined;

    if (/\bred\s*bull\b/i.test(text)) {
      portfolioMatches.push('Red Bull');
      foundProductQuote = text.match(/\bred\s*bull\b/i)?.[0];
    }
    if (/\bmonster(?:\s+energy)?\b/i.test(text)) {
      portfolioMatches.push('Monster Energy');
      foundProductQuote = foundProductQuote || text.match(/\bmonster(?:\s+energy)?\b/i)?.[0];
    }
    if (/\bcoca[\s-]*cola|\bcoke\b/i.test(text)) {
      portfolioMatches.push('Coca-Cola');
      foundProductQuote = foundProductQuote || text.match(/\bcoca[\s-]*cola|\bcoke\b/i)?.[0];
    }

    if (portfolioMatches.length > 0) {
      product_category = 'portfolio_match';
      for (const p of portfolioMatches) {
        if (!product_names.includes(p)) product_names.push(p);
      }
      product_evidence_quote = foundProductQuote || portfolioMatches[0];
      product_turn_index = idx;
    } else if (product_category === 'irrelevant') {
      const genMatch = text.match(/\b(?:energy\s*drinks?|soft\s*drinks?|sodas?|beverages?|carbonated\s*drinks?|juices?)\b/i);
      if (genMatch) {
        product_category = 'general_beverage';
        product_evidence_quote = genMatch[0];
        product_turn_index = idx;
      }
    }

    // 4. Volume & Demand Commitment
    if (!is_retail_consumer) {
      // Check for volume negation/cancellation
      const volumeNegationPattern = /\b(?:cannot|can['’]t|unable\s+to|no\s+longer)\s+commit\s+to\s+(?:any\s+)?(?:container|fcl|volume)\b|\bno\s+(?:longer\s+need\s+)?(?:container|fcl)\s+volume\b|\bzero\s+(?:fcl|volume)\b|\bcancel\s+(?:any\s+)?(?:volume|order)\b/i;
      const volumeNegationMatch = text.match(volumeNegationPattern);

      if (volumeNegationMatch) {
        volume_fcl_per_month = 0;
        volume_commitment = 'retail_or_unknown';
        volume_evidence_quote = volumeNegationMatch[0];
        volume_turn_index = idx;
      } else {
        // Check for spot / one-off order indicators
        const spotPattern = /\b(?:one[\s-]off|one[\s-]time|single\s+order|spot\s+order|just\s+once|trial\s+order|for\s+an?\s+(?:event|party|festival|expo))\b/i;
        const spotMatch = text.match(spotPattern);

        // Check for recurring commitment indicators
        const recurringPattern = /\b(?:per\s+month|\/month|\/mo|monthly|sustained|regular(?:ly)?|recurring|ongoing|every\s+month)\b/i;
        const recurringMatch = text.match(recurringPattern);

        // Parse container volumes: e.g. "3 FCL/month", "2-3 FCL/month sustained", "1 FCL", "5 containers"
        const fclPattern = /(?:(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?|(\d+))\s*(?:fcl|containers?|teus?|feus?)\b/i;
        const fclMatch = text.match(fclPattern);

        if (fclMatch) {
          if (fclMatch[1] && fclMatch[2]) {
            volume_fcl_per_month = (parseFloat(fclMatch[1]) + parseFloat(fclMatch[2])) / 2;
          } else {
            volume_fcl_per_month = parseFloat(fclMatch[1] || fclMatch[3]);
          }
          volume_evidence_quote = fclMatch[0];
          volume_turn_index = idx;
        }

        const isCorrection = /\b(?:correction|actually|update|instead|rather|wait)\b/i.test(text);
        const isQuoteInquiry = /\b(?:quote|pricing|inquiry|test\s+order|sample)\b/i.test(text);

        if (spotMatch || (fclMatch && !recurringMatch && (isCorrection || isQuoteInquiry || volume_commitment === 'retail_or_unknown'))) {
          volume_commitment = 'spot_one_off';
          volume_evidence_quote = spotMatch ? spotMatch[0] : (fclMatch ? fclMatch[0] : undefined);
          volume_turn_index = idx;
        } else if (recurringMatch) {
          volume_commitment = 'recurring';
          volume_evidence_quote = recurringMatch[0];
          volume_turn_index = idx;
        }
      }
    }

    // 5. Business Footprint & Operating Signals
    if (!is_retail_consumer) {
      // Check for business footprint negation
      const businessNegationPattern = /\b(?:no\s+longer|not|stopped|ceased)\s+(?:distribut(?:e|ing)|in\s+business|wholesal(?:e|ing))\b|\bnot\s+a\s+distributor\b/i;
      const businessNegationMatch = text.match(businessNegationPattern);

      if (businessNegationMatch) {
        business_type = 'none_consumer';
        business_evidence_quote = businessNegationMatch[0];
        business_turn_index = idx;
      } else {
        // Substantial network: ~250 retail accounts, 100+ stores, etc.
        const networkPattern = /(?:\~?\d+\s*retail\s+accounts|\d+\s*(?:supermarkets?|stores?|shops?|outlets?)|nationwide\s+network|regional\s+network|\d+\s*locations?)/i;
        const networkMatch = text.match(networkPattern);
        if (networkMatch) {
          business_type = 'substantial_network';
          business_evidence_quote = networkMatch[0];
          business_turn_index = idx;
        } else if (business_type !== 'substantial_network') {
          // Established distributor: distributor, wholesaler, distribution network
          const estabPattern = /\b(?:distributor|wholesaler|distribution\s+network|commercial\s+warehouse|logistics\s+fleet)\b/i;
          const estabMatch = text.match(estabPattern);
          if (estabMatch) {
            business_type = 'established_distributor';
            business_evidence_quote = estabMatch[0];
            business_turn_index = idx;
          } else if (business_type === 'none_consumer') {
            // Single signal: wholesale supply, import N brands, beverage importer, b2b
            const singlePattern = /\b(?:wholesale(?:\s+supply)?|import\s+\d+\s+brands?|beverage\s+importer|b2b|corporate|company|enterprise|retailer)\b/i;
            const singleMatch = text.match(singlePattern);
            if (singleMatch) {
              business_type = 'single_signal';
              business_evidence_quote = singleMatch[0];
              business_turn_index = idx;
            }
          }
        }
      }
    }
  }

  const rawEvidence: ExtractedEvidence = {
    import_status,
    import_years,
    import_evidence_quote,
    import_turn_index,
    product_category,
    product_names,
    product_evidence_quote,
    product_turn_index,
    volume_fcl_per_month,
    volume_commitment,
    volume_evidence_quote,
    volume_turn_index,
    business_type,
    business_evidence_quote,
    business_turn_index,
    is_retail_consumer,
  };

  // Verify that all extracted positive quotes strictly originated from actual lead turns
  return sanitizeAndVerifyEvidence(turns, rawEvidence);
}
