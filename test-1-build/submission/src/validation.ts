import type { ScoreRequest, ConversationTurn, ExtractedEvidence } from './types.ts';

export interface ValidationResult {
  valid: boolean;
  message?: string;
  data?: ScoreRequest;
}

export const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB
export const MAX_TURNS = 50;
export const MAX_TURN_TEXT_LENGTH = 4096;
export const MAX_ID_LENGTH = 64;

export function validateScoreRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, message: 'Request body must be a valid JSON object' };
  }

  const payload = body as Record<string, unknown>;

  // Validate lead_id
  if (typeof payload.lead_id !== 'string' || payload.lead_id.trim().length === 0) {
    return { valid: false, message: "'lead_id' must be a non-empty string" };
  }
  if (payload.lead_id.length > MAX_ID_LENGTH) {
    return { valid: false, message: `'lead_id' exceeds maximum length of ${MAX_ID_LENGTH} characters` };
  }

  // Validate channel (optional)
  if (payload.channel !== undefined) {
    if (typeof payload.channel !== 'string') {
      return { valid: false, message: "'channel' must be a string if provided" };
    }
    if (payload.channel.length > MAX_ID_LENGTH) {
      return { valid: false, message: `'channel' exceeds maximum length of ${MAX_ID_LENGTH} characters` };
    }
  }

  // Validate conversation
  if (!Array.isArray(payload.conversation)) {
    return { valid: false, message: "'conversation' must be an array of turn objects" };
  }
  if (payload.conversation.length === 0) {
    return { valid: false, message: "'conversation' must contain at least 1 turn" };
  }
  if (payload.conversation.length > MAX_TURNS) {
    return { valid: false, message: `'conversation' exceeds maximum limit of ${MAX_TURNS} turns` };
  }

  const turns: ConversationTurn[] = [];
  for (let i = 0; i < payload.conversation.length; i++) {
    const turn = payload.conversation[i];
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
      return { valid: false, message: `Turn at index ${i} must be an object` };
    }
    const role = (turn as Record<string, unknown>).role;
    const text = (turn as Record<string, unknown>).text;

    if (role !== 'lead' && role !== 'agent') {
      return { valid: false, message: `Turn at index ${i} has invalid role '${String(role)}'. Must be 'lead' or 'agent'` };
    }
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { valid: false, message: `Turn at index ${i} must contain non-empty 'text'` };
    }
    if (text.length > MAX_TURN_TEXT_LENGTH) {
      return { valid: false, message: `Turn at index ${i} text exceeds maximum length of ${MAX_TURN_TEXT_LENGTH} characters` };
    }

    turns.push({ role, text: text.trim() });
  }

  return {
    valid: true,
    data: {
      lead_id: payload.lead_id.trim(),
      channel: typeof payload.channel === 'string' ? payload.channel.trim() : undefined,
      conversation: turns,
    },
  };
}

/**
 * Validates that extracted quotes originate verbatim from a lead turn, preventing
 * prompt injection or hallucinations from fabricating B2B signals.
 */
export function sanitizeAndVerifyEvidence(
  conversation: ConversationTurn[],
  evidence: ExtractedEvidence
): ExtractedEvidence {
  const verified = { ...evidence };

  // Helper to check if quote exists in any lead turn
  const verifyQuote = (quote?: string, turnIndex?: number): boolean => {
    if (!quote || quote.trim().length === 0) return false;
    const normalizedQuote = quote.trim().toLowerCase();

    // If turnIndex is specified, verify it points to a lead turn containing the quote
    if (turnIndex !== undefined && turnIndex >= 0 && turnIndex < conversation.length) {
      const turn = conversation[turnIndex];
      if (turn.role === 'lead' && turn.text.toLowerCase().includes(normalizedQuote)) {
        return true;
      }
    }

    // Fallback: search across any lead turn
    return conversation.some(
      (turn) => turn.role === 'lead' && turn.text.toLowerCase().includes(normalizedQuote)
    );
  };

  // If import status is reported positive but quote is invalid/agent-only, drop to none_or_unknown
  if (verified.import_status !== 'none_or_unknown') {
    if (!verifyQuote(verified.import_evidence_quote, verified.import_turn_index)) {
      verified.import_status = 'none_or_unknown';
      verified.import_years = 0;
    }
  }

  // If product is reported as portfolio match but quote is invalid, drop to irrelevant
  if (verified.product_category === 'portfolio_match') {
    if (!verifyQuote(verified.product_evidence_quote, verified.product_turn_index)) {
      verified.product_category = 'irrelevant';
      verified.product_names = [];
    }
  }

  // If volume is claimed recurring but quote is invalid, drop to retail_or_unknown
  if (verified.volume_commitment === 'recurring') {
    if (!verifyQuote(verified.volume_evidence_quote, verified.volume_turn_index)) {
      verified.volume_commitment = 'retail_or_unknown';
      verified.volume_fcl_per_month = 0;
    }
  }

  // If business network is claimed but quote is invalid, drop to none
  if (verified.business_type !== 'none_consumer') {
    if (!verifyQuote(verified.business_evidence_quote, verified.business_turn_index)) {
      verified.business_type = 'none_consumer';
    }
  }

  return verified;
}
