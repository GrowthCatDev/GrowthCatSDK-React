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
  token?: string;
  sourceType?: string;
  campaignKey?: string;
  referrerAppUserId?: string;
  deepLinkValue?: string;
  matchType?: AttributionMatchType;
}

export interface GrowthCatReward {
  rewardType: string;
  featureKey?: string;
}

export interface GrowthCatRewards {
  rewards: GrowthCatReward[];
  containsFeature(featureKey: string): boolean;
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
  token: string;
  match_type: AttributionMatchType;
}

export interface AttributionResolveRequest {
  app_user_id: string;
  sdk_install_id: string;
  platform: "web";
  referrer_url?: string;
}

export interface AttributionEventRequest {
  app_user_id: string;
  sdk_install_id: string;
  event_name: string;
  properties?: Record<string, string | number | boolean>;
}
