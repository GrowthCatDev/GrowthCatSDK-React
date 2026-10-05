import React from "react";
import { createRoot } from "react-dom/client";
import { GrowthCat } from "../../dist/index.mjs";
import {
  GrowthCatFriendReferralPanel,
  GrowthCatReferralCodeForm,
  GrowthCatFeedbackBoard,
  GrowthCatSponsorBanner,
  GrowthCatAdBanner,
  GrowthCatAdInterstitial,
  useWebAttribution,
} from "../../dist/react/index.mjs";
const calls: any[] = [];
const w = window as any;
w.calls = calls;
w.GrowthCat = GrowthCat;
w.capacity = false;
const rewardSpec = {
  enabled: true,
  type: "asc_offer_code",
  delivery_mode: "manual",
};
const tiers = [
  {
    id: "month",
    required_count: 5,
    label: "5 friends: 1 month",
    reward: rewardSpec,
  },
  {
    id: "year",
    required_count: 10,
    label: "10 friends: 1 year",
    reward: rewardSpec,
  },
];
const simpleGoal = new URLSearchParams(location.search).get("goal") === "single";
w.goalThreshold = 5;
const state = (user: string) => ({
  app_user_id: user,
  programs: [
    {
      id: "program",
      version: 1,
      name: "Invite friends",
      campaign_key: "friends",
      status: "active",
      accepting_new_referrals: !w.capacity,
      qualifying_event: "subscription",
      friend_trigger_event: "enrollment",
      required_count: 5,
      frequency: "once",
      existing_users_allowed: true,
      inviter_reward: rewardSpec,
      friend_reward: rewardSpec,
      inviter_milestones: simpleGoal ? [] : tiers,
    },
  ],
  progress: [
    {
      program_id: "program",
      campaign_key: "friends",
      enrolled_count: 4,
      qualified_count: 3,
      required_count: w.goalThreshold,
      earned_rewards: 1,
      next_threshold: w.goalThreshold,
      remaining_count: w.goalThreshold - 3,
      frequency: "once",
      milestones: (simpleGoal ? [] : tiers).map((t) => ({
        ...t,
        earned: false,
        remaining_count: t.required_count - 3,
      })),
    },
  ],
  rewards: [
    {
      id: "reward",
      program_id: "program",
      side: "inviter",
      milestone: 1,
      reward_type: "asc_offer_code",
      status: "fulfilled",
      offer_code: "EARNED123",
      offer_code_redemption_url: "https://apps.apple.com/redeem?code=EARNED123",
    },
    {
      id: "expired",
      program_id: "program",
      side: "inviter",
      milestone: 2,
      reward_type: "asc_offer_code",
      status: "fulfilled",
      offer_code: "EXPIRED123",
      offer_code_redemption_url:
        "https://apps.apple.com/redeem?code=EXPIRED123",
      expires_at: "2000-01-01T00:00:00Z",
    },
  ],
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = init.body ? JSON.parse(String(init.body)) : null;
  calls.push({
    path: url.pathname,
    body,
    identity: new Headers(init.headers).get("X-GrowthCat-Identity"),
  });
  if (url.pathname === "/v1/sdk/config")
    return json({
      sdk_config: {
        show_code_redeem_ui: true,
        allow_code_redeem_execution: true,
      },
      ads: { ads_enabled: true, measurement_schema_version: 2 },
    });
  if (url.pathname.endsWith("resolve-code"))
    return json(
      body.code === "INFLUENCER"
        ? {
            kind: "influencer",
            normalized_code: "INFLUENCER",
            accepting_new_referrals: true,
          }
        : {
            kind: "friend",
            normalized_code: "FRIEND123",
            program_id: "program",
            token: "FRIEND123",
            accepting_new_referrals: !w.capacity,
          },
    );
  if (url.pathname === "/v1/validate")
    return json({
      is_valid: true,
      normalized_code: "INFLUENCER",
      campaign: { id: "influencer", name: "Creator" },
    });
  if (url.pathname.endsWith("/enroll"))
    return w.capacity
      ? json(
          {
            error: "plan_limit_reached",
            meter: "friend_enrollments",
            limit: 100,
            used: 100,
          },
          403,
        )
      : json({
          enrollment: {
            id: "enrollment",
            program_id: "program",
            eligibility_verified: true,
          },
          state: state(body.app_user_id),
        });
  if (url.pathname.endsWith("/state"))
    return json(state(url.searchParams.get("app_user_id")!));
  if (url.pathname.endsWith("/invite"))
    return json({
      invite: {
        code: "MYCODE123",
        token: "MYCODE123",
        program_id: "program",
        url: "https://example.test/invite/MYCODE123",
        accepting_new_referrals: !w.capacity,
      },
    });
  if (url.pathname === "/v1/attribution/claim")
    return json({
      assignment: {
        platform: "web",
        token: body.token,
        source_type: "external_ad",
        campaign_key: body.token,
      },
    });
  if (url.pathname === "/v1/sponsors/home")
    return json({
      status: "live",
      creatives: Array.from({ length: 80 }, (_, i) => ({
        booking_id: `booking-${i}`,
        tracking_token: `token-${i}`,
        sponsor_name: `Sponsor ${i}`,
        click_url: "javascript:alert(1)",
      })),
      delivery_mode: "all",
    });
  if (
    url.pathname === "/v1/ads/serve" &&
    new URLSearchParams(location.search).get("mode") === "nofill"
  )
    return json({ ads: [] });
  if (url.pathname === "/v1/ads/serve")
    return json({
      ads: [
        {
          placement: {
            id: "placement",
            format: url.searchParams.get("format"),
            reward_enabled: true,
            reward_name: "coins",
            reward_amount: 1,
            is_skippable: true,
            skippable_after_seconds: 0,
            minimum_view_seconds: 0,
          },
          campaign: { id: "ad" },
          creative: {
            id: "creative",
            creative_type: "image",
            public_asset_url: `${location.origin}/${new URLSearchParams(location.search).get("mode") === "broken" ? "broken.png" : "asset.svg"}`,
            headline: "Broken asset",
            destination_url: "javascript:alert(1)",
          },
          tracking: { token: "signed" },
        },
      ],
    });
  if (url.pathname === "/v1/sdk/feedback/config")
    return json({ board: { slug: "board" } });
  if (url.pathname === "/v1/public/feedback/board/items") {
    const second = url.searchParams.has("cursor");
    return json({
      data: {
        items: [
          {
            id: second ? "item-2" : "item-1",
            title: second ? "Second page" : "First page",
            body: "<img src=x onerror=alert(1)>",
            type: "idea",
            status: "new",
            vote_count: 0,
          },
        ],
      },
      pagination: { next_cursor: second ? null : "next" },
    });
  }
  if (url.pathname.endsWith("/vote"))
    return json({
      data: {
        item_id: "item-1",
        viewer_has_voted: init.method !== "DELETE",
        vote_count: init.method !== "DELETE" ? 1 : 0,
      },
    });
  if (url.pathname === "/v1/sdk/feedback/items")
    return json({
      data: {
        item: {
          id: "submitted",
          title: body.title,
          type: body.type,
          status: "new",
          vote_count: 0,
        },
      },
    });
  return json({
    accepted: 1,
    reward_validated: w.rewardApproved === true,
    already_granted: w.alreadyGranted === true,
    grant_id: "grant",
    reward: { name: "coins", amount: 1 },
  });
};
const mode = new URLSearchParams(location.search).get("mode") ?? "friends";
GrowthCat.initialize({
  apiKey: "gc_test_browser",
  baseUrl: location.origin,
  measurementMode: "essential",
  identityTokenProvider: async (input) => `signed:${input.appUserId}`,
});
GrowthCat.setAppUserId("first-user");
await GrowthCat.ready();
w.rewards = [];
function Interstitial() {
  const [open, setOpen] = React.useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open ad</button>
      <GrowthCatAdInterstitial
        isOpen={open}
        onDismiss={() => setOpen(false)}
        appUserId="first-user"
        onReward={(reward) => w.rewards.push(reward)}
      />
    </>
  );
}
function Web() {
  const attribution = useWebAttribution();
  return (
    <div role="status">
      {attribution.status}:{attribution.assignment?.campaignKey}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  mode === "friends" ? (
    <>
      <GrowthCatReferralCodeForm
        mode={
          (new URLSearchParams(location.search).get("types") as any) ?? "both"
        }
      />
      <GrowthCatFriendReferralPanel />
    </>
  ) : mode === "interstitial" ? (
    <Interstitial />
  ) : mode === "web" ? (
    <Web />
  ) : mode === "feedback" ? (
    <GrowthCatFeedbackBoard />
  ) : mode === "sponsors" ? (
    <GrowthCatSponsorBanner slotKey="home" />
  ) : (
    <GrowthCatAdBanner format="banner" />
  ),
);
w.ready = true;
