// ─── Hooks ────────────────────────────────────────────────────────────────────
export { useAcquisitionCampaign } from "./hooks/useAcquisitionCampaign";
export type {
  UseAcquisitionCampaignOptions,
  UseAcquisitionCampaignResult,
} from "./hooks/useAcquisitionCampaign";

export { useAd } from "./hooks/useAd";
export type { UseAdOptions, UseAdResult, AdLoadState } from "./hooks/useAd";

export { useReferral } from "./hooks/useReferral";
export type { UseReferralOptions, UseReferralResult } from "./hooks/useReferral";

export { useSponsor } from "./hooks/useSponsor";
export type { UseSponsorOptions, UseSponsorResult, SponsorLoadState } from "./hooks/useSponsor";

export { useFeedbackBoard, useFeedbackSubmit } from "./hooks/useFeedback";
export type {
  UseFeedbackBoardOptions,
  UseFeedbackBoardResult,
  UseFeedbackSubmitResult,
} from "./hooks/useFeedback";

// ─── Components ───────────────────────────────────────────────────────────────
export { GrowthCatAdBanner } from "./components/GrowthCatAdBanner";
export type { GrowthCatAdBannerProps } from "./components/GrowthCatAdBanner";

export { GrowthCatAdInterstitial } from "./components/GrowthCatAdInterstitial";
export type { GrowthCatAdInterstitialProps } from "./components/GrowthCatAdInterstitial";

export { GrowthCatSponsorBanner } from "./components/GrowthCatSponsorBanner";
export type { GrowthCatSponsorBannerProps } from "./components/GrowthCatSponsorBanner";

export { GrowthCatReferralForm } from "./components/GrowthCatReferralForm";
export type {
  GrowthCatReferralFormProps,
  GrowthCatReferralFormStrings,
  GrowthCatReferralFormTheme,
} from "./components/GrowthCatReferralForm";

export { GrowthCatFeedbackBoard } from "./components/GrowthCatFeedbackBoard";
export type { GrowthCatFeedbackBoardProps } from "./components/GrowthCatFeedbackBoard";
