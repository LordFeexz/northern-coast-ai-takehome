export type TurnRole = 'lead' | 'agent';

export interface ConversationTurn {
  role: TurnRole;
  text: string;
}

export interface ScoreRequest {
  lead_id: string;
  channel?: string;
  conversation: ConversationTurn[];
}

export type ScoreTier = 'Hot' | 'Warm' | 'Cold';
export type ScoreRouting = 'kam_handoff' | 'nurture_pool' | 'auto_archive';

export interface ScoreResponse {
  lead_id: string;
  score: number;
  tier: ScoreTier;
  routing: ScoreRouting;
  reasoning: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
}

export interface ExtractedEvidence {
  // Signal 1: Import Readiness
  import_status: 'active' | 'pending' | 'none_or_unknown' | 'denied';
  import_years: number;
  import_evidence_quote?: string;
  import_turn_index?: number;

  // Signal 2: Product Fit
  product_category: 'portfolio_match' | 'general_beverage' | 'irrelevant';
  product_names: string[];
  product_evidence_quote?: string;
  product_turn_index?: number;

  // Signal 3: Volume & Demand
  volume_fcl_per_month: number;
  volume_commitment: 'recurring' | 'spot_one_off' | 'retail_or_unknown';
  volume_evidence_quote?: string;
  volume_turn_index?: number;

  // Signal 4: Business Footprint
  business_type: 'substantial_network' | 'established_distributor' | 'single_signal' | 'none_consumer';
  business_evidence_quote?: string;
  business_turn_index?: number;

  // Disqualification flags
  is_retail_consumer: boolean;
}
