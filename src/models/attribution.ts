export type AttributionMatchType =
  | "explicit_token"
  | "pasteboard_token"
  | "explicit_code"
  | "confirmed_referral"
  | "probabilistic"
  | "none";

export interface AttributionLink {
  token: string;
  publicUrl: string;
  sourceType: string;
  referrerAppUserId: string;
  campaignKey?: string;
  deepLinkValue?: string;
}

export interface AttributionAssignment {
  token?: string;
  sourceType?: string;
  campaignKey?: string;
  referrerAppUserId?: string;
  deepLinkValue?: string;
  matchType?: AttributionMatchType;
  referrerCode?: string;
}

export interface AttributionResolveResult {
  matched: boolean;
  requiresConfirmation?: boolean;
  confidence?: string;
  /** Touchpoint suggested by /resolve; pass it back on claim for confirmed matches. */
  touchpointId?: string;
  token?: string;
  sourceType?: string;
  campaignKey?: string;
  referrerAppUserId?: string;
  deepLinkValue?: string;
  matchType?: AttributionMatchType;
}

export interface AttributionConfirmationOptions {
  token?: string;
  sessionId?: string;
  touchpointId?: string;
}

export interface GrowthCatReward {
  id?: string;
  ruleId?: string;
  grantedAt?: string;
  metadata?: Record<string, unknown>;
  offerCode?: string;
  offerCodeRedemptionUrl?: string;
  rewardType: string;
  featureKey?: string;
}

export interface GrowthCatRewards {
  rewards: GrowthCatReward[];
  containsFeature(featureKey: string): boolean;
}

export interface GrowthCatRewardProgress {
  ruleId: string;
  campaignKey?: string;
  triggerEvent: string;
  requiredCount: number;
  qualifiedCount: number;
  rewardType: string;
  featureKey: string;
  granted: boolean;
}

// ─── API request shapes ───────────────────────────────────────────────────────

export interface AttributionShareLinkRequest {
  app_user_id: string;
  campaign_key: string;
  deep_link_value?: string;
  metadata?: Record<string, string>;
  platform: "web";
}

export interface AttributionClaimRequest {
  app_user_id: string;
  sdk_install_id: string;
  session_id?: string;
  /** Provide a token (universal link / manual entry) or a touchpoint_id (from resolve). */
  token?: string;
  touchpoint_id?: string;
  match_type: AttributionMatchType;
}

export interface AttributionResolveRequest {
  app_user_id: string;
  sdk_install_id: string;
  platform: "web";
  referrer_url?: string;
}

export interface AttributionEventRequest {
  sdk_event_id: string;
  occurred_at: string;
  session_id?: string;
  measurement_mode: "essential" | "analytics";
  app_user_id: string;
  sdk_install_id: string;
  event_name: string;
  properties?: Record<string, string | number | boolean>;
}
