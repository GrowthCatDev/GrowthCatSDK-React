// ─── SDK entry point ─────────────────────────────────────────────────────────
export { GrowthCat } from "./growthcat";
export { GrowthCatClient } from "./client";
export { sanitizeAnalyticsProperties } from "./services/analytics-event-tracker";
export { GROWTHCAT_WEB_SDK_VERSION } from "./core/version";

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
  AdEventMetadata,
  AdEventTrackingOptions,
} from "./models/ads";

export type {
  AttributionMatchType,
  AttributionLink,
  AttributionAssignment,
  AttributionConfirmationOptions,
  AttributionResolveResult,
  GrowthCatReward,
  GrowthCatRewardProgress,
  GrowthCatRewards,
} from "./models/attribution";

export type {
  SponsorSlotContent,
  GrowthCatSponsorData,
  SponsorSlotStatus,
  SponsorCreative,
  SponsorPeriod,
  SponsorEventName,
} from "./models/sponsor";
export type { SponsorEventOptions } from "./services/sponsor-event-tracker";

export type {
  FeedbackType,
  FeedbackPage,
  FeedbackPageOptions,
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
export type {
  GrowthCatInitOptions,
  GrowthCatEnvironmentMode,
  GrowthCatWorkspace,
  GrowthCatIdentityRequest,
  GrowthCatDeliveryStatus,
} from "./core/config";
export type { GrowthCatMeasurementMode } from "./core/privacy";

// ─── Utils ────────────────────────────────────────────────────────────────────
export { makeSessionId, makeCreativeInstanceId, installId } from "./core/install-id";
