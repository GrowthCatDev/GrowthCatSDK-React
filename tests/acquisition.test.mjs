import test from "node:test";
import assert from "node:assert/strict";
import { parseAcquisitionCampaign } from "../dist/index.mjs";

test("parses acquisition campaign config", () => {
  const campaign = parseAcquisitionCampaign({
    campaign_key: "gc_de_padel_meta_v01",
    slug: "de-padel-meta-v01",
    country_code: "DE",
    language: "de",
    segment: "padel",
    source: "meta",
    creative_key: "video_01",
    headline: "Padel am Handgelenk",
    screenshots: ["https://example.com/1.png"],
    apple_url: "https://apps.apple.com/app/id123?ct=gc_de_padel_meta_v01"
  });
  assert.equal(campaign.campaignKey, "gc_de_padel_meta_v01");
  assert.equal(campaign.creativeKey, "video_01");
  assert.equal(campaign.screenshots.length, 1);
});
