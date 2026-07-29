// ─── Analytics ───────────────────────────────────────────────────────────────

export type GrowthCatAnalyticsValue = string | number | boolean;

export type GrowthCatAnalyticsEventName =
  | "paywall_viewed"
  | "checkout_started"
  | "checkout_cancelled"
  | "purchase_sdk_completed";

export interface GrowthCatAnalyticsContext {
  sessionId?: string;
  source?: string;
}

// ─── Campaign ─────────────────────────────────────────────────────────────────

export interface CampaignResponse {
  id: string;
  name: string;
  discountDescription?: string;
}

// ─── Redemption result ────────────────────────────────────────────────────────

export interface ReferralRedemptionResult {
  normalizedCode: string;
  campaign: CampaignResponse;
}

// ─── API request/response shapes ─────────────────────────────────────────────

export interface ValidateCodeRequest {
  code: string;
  app_user_id?: string;
  session_id?: string;
  source?: string;
  locale?: string;
  country_code?: string;
  platform: "web";
  app_version?: string;
}

export interface ValidateCodeResponse {
  is_valid: boolean;
  normalized_code: string;
  campaign: {
    id: string;
    name: string;
    discount_description?: string;
  };
}

export interface ReferralClickRequest {
  code: string;
  app_user_id?: string;
  session_id?: string;
  source?: string;
  platform: "web";
}

export interface AnalyticsEventRequest {
  schema_version: 2;
  sdk_event_id: string;
  event_name: string;
  app_user_id?: string;
  code?: string;
  event_at?: string;
  session_id?: string;
  source?: string;
  properties?: Record<string, GrowthCatAnalyticsValue>;
  platform: "web";
  locale?: string;
  country_code?: string;
  measurement_mode: import("../core/privacy").GrowthCatMeasurementMode;
  sdk_version: string;
  sdk_install_id: string;
}
