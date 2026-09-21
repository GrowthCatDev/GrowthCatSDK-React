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
  identityTokenProvider: async ({ appUserId, scope, eventName, eventId, forceRefresh }) => {
    void [appUserId, scope, eventName, eventId, forceRefresh];
    return "example-token-from-authenticated-host-server";
  },
});

async function useHeadlessAPI(ad: AdObject): Promise<AttributionAssignment | null> {
  await GrowthCat.ready();
  GrowthCat.setAppUserId("user-123");
  await GrowthCat.shared.prefetchAdCatalogs(["home"]);
  const creativeInstanceId = GrowthCat.makeCreativeInstanceId();
  GrowthCat.shared.trackAdEvent("impression", ad, { creativeInstanceId, metadata: { measurement_version: 2, visible_fraction: 1, visible_duration_ms: 1000 } });
  await GrowthCat.shared.flushEvents();
  await GrowthCat.shared.fetchFeedbackPage({ type: "bug", limit: 20 });
  await GrowthCat.shared.rewardsProgress();
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
