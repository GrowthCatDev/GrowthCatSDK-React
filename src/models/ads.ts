// ─── Format ───────────────────────────────────────────────────────────────────

export type AdFormat = "banner" | "interstitial";

// ─── Creative layout ──────────────────────────────────────────────────────────

export interface AdCreativeLayoutBackground {
  type: string;
  colors?: string[];
  color?: string;
  direction?: string;
}

export interface AdCreativeLayoutTitleStyle {
  color?: string;
  size?: string;
  weight?: string;
  alignment?: string;
}

export interface AdCreativeLayoutBodyTextStyle {
  color?: string;
  size?: string;
}

export interface AdCreativeLayoutCTAButtonStyle {
  bgColor?: string;
  textColor?: string;
  borderRadius?: number;
  style?: string;
}

export interface AdCreativeLayoutBannerBadge {
  text?: string;
  backgroundColor?: string;
  textColor?: string;
  borderRadius?: number;
}

export interface AdCreativeLayoutBannerIcon {
  size?: number;
  borderRadius?: number;
  backgroundColor?: string;
  borderColor?: string;
}

export interface AdCreativeLayoutBannerTitle {
  color?: string;
  fontWeight?: string;
  lineLimit?: number;
}

export interface AdCreativeLayoutBanner {
  style?: string;
  backgroundColor?: string;
  borderRadius?: number;
  padding?: { horizontal?: number; vertical?: number };
  gap?: number;
  adBadge?: AdCreativeLayoutBannerBadge;
  icon?: AdCreativeLayoutBannerIcon;
  title?: AdCreativeLayoutBannerTitle;
  ctaButton?: AdCreativeLayoutCTAButtonStyle;
}

export interface AdCreativeLayoutOverlay {
  /** "scrim" | "panel" | "floating" | "cta_only" | "asset_embedded" */
  layout?: string;
  mode?: string;
  position?: string;
  scrimOpacity?: number;
  scrimColor?: string;
  panelBgColor?: string;
  panelBorderRadius?: number;
  textColor?: string;
  textShadow?: boolean;
  /** "cover" | "contain" | "fill" */
  imageFit?: string;
  ctaBottomPadding?: number;
  ctaButton?: AdCreativeLayoutCTAButtonStyle;
  title?: AdCreativeLayoutTitleStyle;
}

/**
 * The full creative layout object returned by the API. All fields are optional —
 * the server may omit any section that is not configured.
 *
 * This is the raw data you use when building a **custom ad renderer** with `useAd()`.
 */
export interface AdCreativeLayout {
  renderVersion?: number;
  background?: AdCreativeLayoutBackground;
  title?: AdCreativeLayoutTitleStyle;
  bodyText?: AdCreativeLayoutBodyTextStyle;
  ctaButton?: AdCreativeLayoutCTAButtonStyle;
  banner?: AdCreativeLayoutBanner;
  overlay?: AdCreativeLayoutOverlay;
}

// ─── Sub-objects ──────────────────────────────────────────────────────────────

export interface AdPlacement {
  id: string;
  format: AdFormat;
  rewardEnabled: boolean;
  rewardName?: string;
  rewardAmount?: number;
  minimumViewSeconds?: number;
  isSkippable: boolean;
  skippableAfterSeconds?: number;
}

export interface AdCampaign {
  id: string;
  mode: string;
  objective: string;
  priorityWeight: number;
}

export interface AdCreativeAssetCache {
  cacheable: boolean;
  ttlSeconds: number;
}

/**
 * The creative contains all content needed to render an ad.
 * When using `useAd()` or `loadAd()` directly, this gives you full freedom
 * to build your own design around the `headline`, `body`, `ctaText`,
 * `publicAssetUrl`, and `layout` fields.
 */
export interface AdCreative {
  id: string;
  creativeType: string;
  publicAssetUrl?: string;
  layout?: AdCreativeLayout;
  assetCache?: AdCreativeAssetCache;
  headline?: string;
  body?: string;
  ctaText?: string;
  destinationType: string;
  destinationUrl?: string;
}

export interface AdTracking {
  allocationId?: string;
  token: string;
}

export interface AdClosePolicy {
  isSkippable?: boolean;
  skippableAfterSeconds?: number;
  rewardGrantAfterSeconds?: number;
}

/**
 * The full ad object returned by `loadAd()`.
 *
 * You can pass this directly to `GrowthCat.shared.trackAdEvent()` for manual
 * event tracking, or use `creative` / `creative.layout` to build a fully
 * custom ad UI — see `useAd()`.
 */
export interface AdObject {
  placement?: AdPlacement;
  campaign: AdCampaign;
  creative: AdCreative;
  tracking: AdTracking;
  closePolicy?: AdClosePolicy;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type AdEventName =
  | "impression"
  | "click"
  | "video_start"
  | "video_progress"
  | "video_complete"
  | "ad_closed"
  | "ad_reported";

export interface AdEventPayload {
  sdk_event_id: string;
  format: string;
  campaign_id: string;
  creative_id?: string;
  event_name: string;
  locale?: string;
  app_user_id?: string;
  session_id?: string;
  sdk_install_id: string;
  tracking_token: string;
  occurred_at: string;
  metadata?: Record<string, string>;
}

export interface AdEventBatchRequest {
  events: AdEventPayload[];
}

// ─── Reward validation ────────────────────────────────────────────────────────

export interface AdReward {
  name: string;
  amount: number;
}

export interface AdRewardValidationResponse {
  rewardValidated: boolean;
  accepted: number;
  reward?: AdReward;
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface AdServeResponse {
  format: AdFormat;
  country_code?: string;
  ads: AdObject[];
  cache_ttl_seconds?: number;
}

export interface AdCatalogResponse {
  placement_key: string;
  country_code?: string;
  ads: AdObject[];
  cache_ttl_seconds?: number;
}

export interface RawAdObject {
  placement?: {
    id: string;
    format: string;
    reward_enabled?: boolean;
    reward_name?: string;
    reward_amount?: number;
    minimum_view_seconds?: number;
    is_skippable?: boolean;
    skippable_after_seconds?: number;
  };
  campaign: {
    id: string;
    mode: string;
    objective: string;
    priority_weight: number;
  };
  creative: {
    id: string;
    creative_type: string;
    public_asset_url?: string;
    layout?: Record<string, unknown>;
    layout_json?: Record<string, unknown>;
    asset_cache?: { cacheable: boolean; ttl_seconds: number };
    headline?: string;
    body?: string;
    cta_text?: string;
    destination_type: string;
    destination_url?: string;
  };
  tracking: {
    allocation_id?: string;
    token: string;
  };
  close_policy?: {
    is_skippable?: boolean;
    skippable_after_seconds?: number;
    reward_grant_after_seconds?: number;
  };
}

export function parseAdObject(raw: RawAdObject): AdObject {
  const layoutRaw = (raw.creative.layout ?? raw.creative.layout_json) as
    | Record<string, unknown>
    | undefined;

  const layout = layoutRaw ? parseAdCreativeLayout(layoutRaw) : undefined;

  let destinationUrl: string | undefined;
  if (raw.creative.destination_url) {
    const url = raw.creative.destination_url;
    destinationUrl =
      url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
  }

  return {
    placement: raw.placement
      ? {
          id: raw.placement.id,
          format: raw.placement.format === "banner" ? "banner" : "interstitial",
          rewardEnabled: raw.placement.reward_enabled ?? false,
          rewardName: raw.placement.reward_name,
          rewardAmount: raw.placement.reward_amount,
          minimumViewSeconds: raw.placement.minimum_view_seconds,
          isSkippable: raw.placement.is_skippable ?? true,
          skippableAfterSeconds: raw.placement.skippable_after_seconds,
        }
      : undefined,
    campaign: {
      id: raw.campaign.id,
      mode: raw.campaign.mode,
      objective: raw.campaign.objective,
      priorityWeight: raw.campaign.priority_weight,
    },
    creative: {
      id: raw.creative.id,
      creativeType: raw.creative.creative_type,
      publicAssetUrl: raw.creative.public_asset_url,
      layout,
      assetCache: raw.creative.asset_cache
        ? { cacheable: raw.creative.asset_cache.cacheable, ttlSeconds: raw.creative.asset_cache.ttl_seconds }
        : undefined,
      headline: raw.creative.headline,
      body: raw.creative.body,
      ctaText: raw.creative.cta_text,
      destinationType: raw.creative.destination_type,
      destinationUrl,
    },
    tracking: {
      allocationId: raw.tracking.allocation_id,
      token: raw.tracking.token,
    },
    closePolicy: raw.close_policy
      ? {
          isSkippable: raw.close_policy.is_skippable,
          skippableAfterSeconds: raw.close_policy.skippable_after_seconds,
          rewardGrantAfterSeconds: raw.close_policy.reward_grant_after_seconds,
        }
      : undefined,
  };
}

function parseAdCreativeLayout(raw: Record<string, unknown>): AdCreativeLayout {
  return {
    renderVersion: raw["render_version"] != null ? Number(raw["render_version"]) : undefined,
    background: raw["background"] as AdCreativeLayoutBackground | undefined,
    title: raw["title"] as AdCreativeLayoutTitleStyle | undefined,
    bodyText: raw["body_text"] as AdCreativeLayoutBodyTextStyle | undefined,
    ctaButton: raw["cta_button"] as AdCreativeLayoutCTAButtonStyle | undefined,
    banner: raw["banner"] ? parseBannerLayout(raw["banner"] as Record<string, unknown>) : undefined,
    overlay: raw["overlay"] as AdCreativeLayoutOverlay | undefined,
  };
}

function parseBannerLayout(raw: Record<string, unknown>): AdCreativeLayoutBanner {
  return {
    style: raw["style"] as string | undefined,
    backgroundColor: raw["background_color"] as string | undefined,
    borderRadius: raw["border_radius"] != null ? Number(raw["border_radius"]) : undefined,
    padding: raw["padding"] as { horizontal?: number; vertical?: number } | undefined,
    gap: raw["gap"] != null ? Number(raw["gap"]) : undefined,
    adBadge: raw["ad_badge"] as AdCreativeLayoutBannerBadge | undefined,
    icon: raw["icon"] as AdCreativeLayoutBannerIcon | undefined,
    title: raw["title"] as AdCreativeLayoutBannerTitle | undefined,
    ctaButton: raw["cta_button"] as AdCreativeLayoutCTAButtonStyle | undefined,
  };
}
