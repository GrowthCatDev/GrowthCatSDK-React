import React from "react";
import {
  GrowthCat,
  GrowthCatError,
  type AdObject,
  type AttributionAssignment,
} from "../src";
import {
  GrowthCatAdBanner,
  GrowthCatAdInterstitial,
  GrowthCatFeedbackBoard,
  GrowthCatReferralForm,
  GrowthCatSponsorBanner,
  useAd,
} from "../src/react";

GrowthCat.initialize({
  apiKey: "gc_live_example",
  workspace: "live",
  measurementMode: "essential",
  requestTimeoutMs: 10_000,
});

async function useHeadlessAPI(ad: AdObject): Promise<AttributionAssignment | null> {
  await GrowthCat.ready();
  GrowthCat.setAppUserId("user-123");
  await GrowthCat.shared.prefetchAdCatalogs(["home"]);
  GrowthCat.shared.trackAdEvent("impression", ad);
  await GrowthCat.shared.confirmAttribution({ token: "token-123" });
  const assignment = await GrowthCat.handleCurrentUrl();
  GrowthCat.clearAppUserId();
  return assignment;
}

function CustomAd() {
  const { ad, state } = useAd({ placementKey: "home", enabled: true });
  if (state !== "ready" || !ad) return null;
  return <strong>{ad.creative.headline}</strong>;
}

export function SDKExamples() {
  return (
    <>
      <GrowthCatAdBanner placementKey="home" />
      <GrowthCatAdInterstitial
        placementKey="interstitial"
        isOpen={false}
        onDismiss={() => {}}
      />
      <GrowthCatSponsorBanner slotKey="home-sponsor" />
      <GrowthCatReferralForm
        onError={(error) => {
          if (error instanceof GrowthCatError) console.error(error.code);
        }}
      />
      <GrowthCatFeedbackBoard />
      <CustomAd />
    </>
  );
}

void useHeadlessAPI;
