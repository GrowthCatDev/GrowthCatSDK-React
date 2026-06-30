// ─── SDK entry point ─────────────────────────────────────────────────────────
export { GrowthCat } from "./growthcat";
export { GrowthCatClient } from "./client";

// ─── Models ───────────────────────────────────────────────────────────────────
export { GrowthCatError } from "./models/errors";
export type { GrowthCatErrorCode, AppSetupRequirements } from "./models/errors";

export type {
  GrowthCatSDKBootstrap,
  GrowthCatSDKConfig,
  GrowthCatSDKReadiness,
  GrowthCatSDKReadinessChecks,
  GrowthCatSDKAdsConfig,
} from "./models/bootstrap";

export type {
  GrowthCatAnalyticsContext,
  GrowthCatAnalyticsEventName,
  GrowthCatAnalyticsValue,
  ReferralRedemptionResult,
  CampaignResponse,
} from "./models/referral";

export type {
  AdFormat,
  AdObject,
  AdPlacement,
  AdCampaign,
  AdCreative,
  AdCreativeLayout,
  AdCreativeLayoutBackground,
  AdCreativeLayoutBanner,
  AdCreativeLayoutOverlay,
  AdCreativeLayoutCTAButtonStyle,
  AdTracking,
  AdClosePolicy,
  AdEventName,
  AdReward,
  AdRewardValidationResponse,
} from "./models/ads";

export type {
  AttributionMatchType,
  AttributionLink,
  AttributionAssignment,
  AttributionResolveResult,
  GrowthCatReward,
  GrowthCatRewards,
} from "./models/attribution";

export type {
  FeedbackType,
  FeedbackItemStatus,
  FeedbackUser,
  FeedbackSubmission,
  FeedbackSubmitResult,
  FeedbackVoteResult,
  FeedbackBoardItem,
  GrowthCatFeedbackThemeMode,
  GrowthCatFeedbackThemeColors,
  GrowthCatFeedbackTheme,
  GrowthCatFeedbackStrings,
} from "./models/feedback";

// ─── Config ───────────────────────────────────────────────────────────────────
export type { GrowthCatInitOptions, GrowthCatEnvironmentMode } from "./core/config";

// ─── Utils ────────────────────────────────────────────────────────────────────
export { makeSessionId, installId } from "./core/install-id";
