import test from "node:test";
import assert from "node:assert/strict";
import { GrowthCat, parseAcquisitionCampaign } from "../dist/index.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AcquisitionService } = require("../src/services/acquisition-service.ts");
const { MeasurementState } = require("../src/core/privacy.ts");
const { ApiClient } = require("../src/core/api.ts");
const { buildConfiguration } = require("../src/core/config.ts");
const rawCampaign = {
  campaign_key: "campaign", slug: "landing",
  apple_url: "https://apps.apple.com/app/id123?ct=campaign&pt=123",
};

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

test("rejects malformed campaigns and unsafe navigation URLs", () => {
  for (const raw of [null, {}, { ...rawCampaign, campaign_key: 42 },
    { ...rawCampaign, slug: " " }, { ...rawCampaign, apple_url: "javascript:alert(1)" },
    { ...rawCampaign, apple_url: "https://user:password@example.com" }]) {
    assert.throws(() => parseAcquisitionCampaign(raw), /invalid acquisition campaign/);
  }
  const parsed = parseAcquisitionCampaign({ ...rawCampaign,
    screenshots: ["https://example.com/image.png", 42, "javascript:alert(1)"] });
  assert.deepEqual(parsed.screenshots, ["https://example.com/image.png"]);
  assert.equal(parsed.appleUrl, rawCampaign.apple_url);
});

test("acquisition tracking respects consent and rotates the default session", async () => {
  const events = [];
  const measurement = new MeasurementState("essential");
  const service = new AcquisitionService({
    fetchAcquisitionCampaign: async () => parseAcquisitionCampaign(rawCampaign),
    trackAcquisitionEvent: async (slug, body) => { events.push({ slug, ...body }); },
  }, measurement);
  const campaign = await service.load({ slug: " landing " });
  await campaign.trackLandingView();
  assert.equal(events.length, 0);
  measurement.setMode("analytics");
  await campaign.trackLandingView();
  const initialSession = campaign.sessionId;
  assert.equal(events[0].slug, "landing");
  assert.equal(events[0].session_id, initialSession);
  measurement.setMode("disabled");
  await campaign.track("app_store_click");
  assert.equal(events.length, 1);
  measurement.setMode("analytics");
  await campaign.trackLandingView();
  assert.notEqual(events[1].session_id, initialSession);
  assert.equal(events[1].session_id, campaign.sessionId);
  const explicit = await service.load({ slug: "landing", sessionId: "host-session" });
  await explicit.trackLandingView();
  assert.equal(events[2].session_id, "host-session");
  await assert.rejects(service.load({ slug: " " }), /must not be empty/);
});

test("App Store navigation does not wait for tracking or reject on tracking failure", async (t) => {
  const destinations = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { assign: url => destinations.push(url) },
  } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });
  let rejectTracking;
  const service = new AcquisitionService({
    fetchAcquisitionCampaign: async () => parseAcquisitionCampaign(rawCampaign),
    trackAcquisitionEvent: () => new Promise((_, reject) => { rejectTracking = reject; }),
  }, new MeasurementState("analytics"));
  const campaign = await service.load({ slug: "landing" });
  await campaign.openAppStore();
  assert.deepEqual(destinations, [rawCampaign.apple_url]);
  rejectTracking(new Error("offline"));
  await new Promise(resolve => setImmediate(resolve));
});

test("acquisition HTTP requests encode slugs, use keepalive, and cancel on revocation", async (t) => {
  const requests = [];
  const api = new ApiClient(buildConfiguration({ apiKey: "gc_test_acquisition", baseUrl: "https://example.test" }));
  t.after(() => api.shutdown());
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init });
    if (init.method === "GET") return new Response(JSON.stringify(rawCampaign));
    return new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  });
  await api.fetchAcquisitionCampaign("landing/name");
  const event = api.trackAcquisitionEvent("landing/name", { event_name: "landing_view" });
  assert.equal(new URL(requests[0].url).pathname, "/v1/public/acquisition/landing%2Fname");
  assert.equal(new URL(requests[1].url).pathname, "/v1/public/acquisition/landing%2Fname/events");
  assert.equal(requests[1].init.keepalive, true);
  api.cancelMeasurement();
  await assert.rejects(event, /cancelled/);
});

test("public acquisition API uses the client's live measurement state", async (t) => {
  const events = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).endsWith("/acquisition/landing")) return new Response(JSON.stringify(rawCampaign));
    if (String(url).endsWith("/acquisition/landing/events")) events.push(JSON.parse(init.body));
    return new Response("{}");
  });
  GrowthCat.initialize({ apiKey: "gc_test_acquisition", measurementMode: "disabled" });
  t.after(() => GrowthCat.shutdown());
  await GrowthCat.ready();
  const campaign = await GrowthCat.acquisition({ slug: "landing" });
  await campaign.trackLandingView();
  assert.equal(events.length, 0);
  GrowthCat.setMeasurementMode("analytics");
  await campaign.trackLandingView();
  assert.equal(events.length, 1);
  GrowthCat.setMeasurementMode("essential");
  await campaign.track("app_store_click");
  assert.equal(events.length, 1);
});
