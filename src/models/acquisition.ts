export interface AcquisitionCampaignConfig {
  campaignKey: string;
  slug: string;
  countryCode?: string;
  language?: string;
  segment?: string;
  source?: string;
  adGroupKey?: string;
  creativeKey?: string;
  headline?: string;
  subtitle?: string;
  eyebrow?: string;
  ctaText?: string;
  screenshots: string[];
  appleUrl: string;
}

export interface AcquisitionEventPayload {
  event_name: "landing_view" | "app_store_click";
  session_id?: string;
  locale?: string;
  screen_width?: number;
  screen_height?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface AcquisitionCampaign extends AcquisitionCampaignConfig {
  sessionId: string;
  trackLandingView(): Promise<void>;
  track(eventName: "landing_view" | "app_store_click"): Promise<void>;
  openAppStore(): Promise<void>;
}

export function parseAcquisitionCampaign(raw: Record<string, unknown>): AcquisitionCampaignConfig {
  return {
    campaignKey: String(raw["campaign_key"] ?? ""),
    slug: String(raw["slug"] ?? ""),
    countryCode: stringOrUndefined(raw["country_code"]),
    language: stringOrUndefined(raw["language"]),
    segment: stringOrUndefined(raw["segment"]),
    source: stringOrUndefined(raw["source"]),
    adGroupKey: stringOrUndefined(raw["ad_group_key"]),
    creativeKey: stringOrUndefined(raw["creative_key"]),
    headline: stringOrUndefined(raw["headline"]),
    subtitle: stringOrUndefined(raw["subtitle"]),
    eyebrow: stringOrUndefined(raw["eyebrow"]),
    ctaText: stringOrUndefined(raw["cta_text"]),
    screenshots: Array.isArray(raw["screenshots"])
      ? raw["screenshots"].filter((value): value is string => typeof value === "string")
      : [],
    appleUrl: String(raw["apple_url"] ?? ""),
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
