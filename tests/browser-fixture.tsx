import React from "react";
import { createRoot } from "react-dom/client";
import { GrowthCat } from "../src/growthcat";
import { GrowthCatSponsorBanner, GrowthCatFeedbackBoard, GrowthCatReferralForm, GrowthCatAdBanner } from "../src/react";

const events: unknown[] = [];
Object.assign(window, { testEvents: events });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
window.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/sdk/config")) return json({ sdk_config: { show_code_redeem_ui: true, allow_code_redeem_execution: true }, ads: { ads_enabled: true, measurement_schema_version: 2 } });
  if (url.pathname === "/v1/sponsors/home") return json({ status: "live", delivery_mode: "all", creatives: Array.from({ length: 80 }, (_, i) => ({ booking_id: `booking-${i}`, tracking_token: `token-${i}`, sponsor_name: `Sponsor ${i}`, click_url: "https://example.test" })) });
  if (url.pathname === "/v1/sponsors/events/batch" || url.pathname === "/v1/ads/events/batch") {
    events.push(...JSON.parse(String(init.body)).events);
    return json({ accepted: 1 });
  }
  if (url.pathname === "/v1/ads/serve") return json({ ads: [{ campaign: { id: "campaign" }, creative: { id: "creative", creative_type: "image", public_asset_url: `${location.origin}/broken.png`, headline: "Broken asset" }, tracking: { token: "token" } }] });
  if (url.pathname === "/v1/sdk/feedback/config") return json({ board: { slug: "board" } });
  if (url.pathname === "/v1/public/feedback/board/items") {
    const second = url.searchParams.has("cursor");
    return json({ data: { items: [{ id: second ? "item-2" : "item-1", title: second ? "Second page" : "First page", type: "idea", status: "new", vote_count: 0 }] }, pagination: { next_cursor: second ? null : "next" } });
  }
  return json({});
};
GrowthCat.initialize({ apiKey: "browser-test", measurementMode: "essential" });
GrowthCat.setAppUserId("test-user");
await GrowthCat.ready();
const mode = new URLSearchParams(location.search).get("mode");
createRoot(document.getElementById("root")!).render(mode === "sponsors" ?
  <GrowthCatSponsorBanner slotKey="home" /> : mode === "broken" ?
  <GrowthCatAdBanner format="banner" /> : mode === "referral" ?
  <GrowthCatReferralForm /> : <GrowthCatFeedbackBoard />);
