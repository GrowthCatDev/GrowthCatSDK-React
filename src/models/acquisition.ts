import { webUrl } from "../core/url";
import { GrowthCatError } from "./errors";

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
  appleUrl?: string;
  destinationType: "app_store" | "web";
  targetUrl: string;
}

export interface AcquisitionEventPayload {
  event_name: "landing_view" | "app_store_click" | "web_click";
  session_id?: string;
  locale?: string;
  screen_width?: number;
  screen_height?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface AcquisitionCampaign extends AcquisitionCampaignConfig {
  /** Current analytics session, or the session ID supplied by the host. */
  sessionId: string;
  /** Sends only in analytics mode; rejects if delivery fails. */
  trackLandingView(): Promise<void>;
  /** Sends only in analytics mode; rejects if delivery fails. */
  track(eventName: "landing_view" | "app_store_click" | "web_click"): Promise<void>;
  /** Navigates immediately with best-effort tracking; does not await delivery. */
  openAppStore(): Promise<void>;
  /** Opens the configured website or App Store destination. */
  openDestination(): Promise<void>;
}

export function parseAcquisitionCampaign(raw: Record<string, unknown>): AcquisitionCampaignConfig {
  const campaignKey = stringOrUndefined(raw?.["campaign_key"]);
  const slug = stringOrUndefined(raw?.["slug"]);
  const appleUrl = webUrl(raw?.["apple_url"]);
  const destinationType = raw?.destination_type === "web" ? "web" : "app_store";
  const targetUrl = webUrl(raw?.target_url) ?? appleUrl;
  if (!campaignKey?.trim() || !slug?.trim() || !targetUrl || (destinationType === "app_store" && !appleUrl)) {
    throw GrowthCatError.server(502, "GrowthCat returned an invalid acquisition campaign.");
  }
  return {
    campaignKey,
    slug,
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
      ? raw["screenshots"].map(webUrl).filter((value): value is string => value !== undefined)
      : [],
    appleUrl,
    destinationType,
    targetUrl,
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
