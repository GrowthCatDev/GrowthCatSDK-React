import test from "node:test";
import assert from "node:assert/strict";

import {
  GrowthCat,
  makeCreativeInstanceId,
  makeSessionId,
  sanitizeAnalyticsProperties,
} from "../dist/index.mjs";

function bootstrapResponse() {
  return {
    app_id: "00000000-0000-4000-8000-000000000001",
    authenticated: true,
    sdk_config: {
      show_code_redeem_ui: true,
      allow_code_redeem_execution: true,
    },
    readiness: { can_validate_codes: true, checks: {} },
    ads: {
      ads_enabled: true,
      ad_cache_ttl_seconds: 300,
      max_offline_ad_events: 100,
      measurement_schema_version: 1,
    },
  };
}

test("IDs are unique per session and creative instance", () => {
  assert.notEqual(makeSessionId(), makeSessionId());
  assert.notEqual(makeCreativeInstanceId(), makeCreativeInstanceId());
});

test("funnel properties are event-specific and size limited", () => {
  const properties = sanitizeAnalyticsProperties("paywall_viewed", {
    paywall_variant: "x".repeat(400),
    email: "person@example.com",
    product_id: "not-valid-for-this-event",
  });
  assert.equal(properties?.paywall_variant.length, 255);
  assert.equal("email" in (properties ?? {}), false);
  assert.equal("product_id" in (properties ?? {}), false);
});

test("one creative instance emits at most one billable impression", async () => {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/sdk/config") {
      return new Response(JSON.stringify(bootstrapResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  GrowthCat.initialize({
    apiKey: "gc_test_analytics",
    baseUrl: "https://example.test",
    measurementMode: "essential",
  });
  await GrowthCat.shared.refreshSDKBootstrap();

  const ad = {
    campaign: { id: "00000000-0000-4000-8000-000000000002", mode: "house", objective: "impressions", priorityWeight: 1 },
    creative: { id: "00000000-0000-4000-8000-000000000003", creativeType: "image", destinationType: "none" },
    tracking: { token: "signed-token" },
  };
  const options = { format: "banner", creativeInstanceId: "render-1", metadata: { visible_fraction: 1, visible_duration_ms: 1000 } };
  GrowthCat.shared.trackAdEvent("impression", ad, options);
  GrowthCat.shared.trackAdEvent("impression", ad, options);
  await GrowthCat.shared.flushAdEvents();

  const eventCount = requests.reduce((count, body) => count + (body.events?.length ?? 0), 0);
  assert.equal(eventCount, 1);
  GrowthCat.shared.shutdown();
});

test("measurement mode changes immediately", () => {
  GrowthCat.initialize({
    apiKey: "gc_test_consent",
    baseUrl: "https://example.test",
    measurementMode: "analytics",
  });
  assert.equal(GrowthCat.shared.measurementMode, "analytics");
  GrowthCat.setMeasurementMode("disabled");
  assert.equal(GrowthCat.shared.measurementMode, "disabled");
  GrowthCat.shared.shutdown();
});

test("analytics mode automatically records the initial SDK session", async () => {
  const eventTarget = new EventTarget();
  Object.defineProperty(eventTarget, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  const previousDocument = globalThis.document;
  const previousNavigator = globalThis.navigator;
  globalThis.document = eventTarget;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "en-US" },
  });
  const analyticsEvents = [];
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/sdk/config") {
      return new Response(JSON.stringify(bootstrapResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (pathname === "/v1/analytics/events") {
      analyticsEvents.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected request: ${pathname}`);
  };

  try {
    GrowthCat.initialize({
      apiKey: "gc_test_session",
      baseUrl: "https://example.test",
      measurementMode: "analytics",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(analyticsEvents.length, 1);
    assert.equal(analyticsEvents[0].event_name, "session_started");
    assert.equal(analyticsEvents[0].properties.session_reason, "initial");
    assert.ok(analyticsEvents[0].session_id);
    assert.ok(analyticsEvents[0].sdk_install_id);
  } finally {
    GrowthCat.shutdown();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: previousNavigator,
    });
  }
});

test("custom sponsor data keeps one render identity and qualifies impressions", async () => {
  const eventNames = [];
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/sdk/config") {
      const bootstrap = bootstrapResponse();
      bootstrap.ads.measurement_schema_version = 2;
      return new Response(JSON.stringify(bootstrap), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (pathname === "/v1/sponsors/home_sponsor") {
      return new Response(JSON.stringify({
        status: "live",
        slot_key: "home_sponsor",
        format: "banner",
        period: "weekly",
        creative: {
          booking_id: "booking-1",
          tracking_token: "sponsor-token",
          sponsor_name: "Example Sponsor",
          headline: "A useful product",
          click_url: "https://example.com",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (pathname === "/v1/sponsors/events/batch") {
      const body = JSON.parse(String(init.body));
      eventNames.push(...body.events.map((event) => event.event_name));
      return new Response(JSON.stringify({ accepted: body.events.length }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected request: ${pathname}`);
  };

  GrowthCat.initialize({
    apiKey: "gc_test_sponsors",
    baseUrl: "https://example.test",
    measurementMode: "essential",
  });
  await GrowthCat.shared.refreshSDKBootstrap();

  const sponsor = await GrowthCat.shared.loadSponsorData("home_sponsor");
  assert.equal(sponsor.status, "live");
  assert.ok(sponsor.creativeInstanceId);
  assert.equal(await GrowthCat.shared.trackSponsorImpression(sponsor, {
    visibleFraction: 0.9,
    visibleDurationMs: 999,
  }), false);
  assert.equal(await GrowthCat.shared.trackSponsorImpression(sponsor, {
    visibleFraction: 0.9,
    visibleDurationMs: 1000,
  }), true);
  await GrowthCat.shared.trackSponsorImpression(sponsor, {
    visibleFraction: 0.9,
    visibleDurationMs: 1000,
  });
  await GrowthCat.shared.trackSponsorClick(sponsor);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await GrowthCat.shared.flushSponsorEvents();

  assert.deepEqual(eventNames.sort(), ["click", "impression"]);
  GrowthCat.shared.shutdown();
});

test("simultaneous sponsor data tracks each visible creative independently", async () => {
  const events = [];
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/sdk/config") {
      const bootstrap = bootstrapResponse();
      bootstrap.ads.measurement_schema_version = 2;
      return new Response(JSON.stringify(bootstrap), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (pathname === "/v1/sponsors/silver") {
      return new Response(JSON.stringify({
        status: "live",
        slot_key: "silver",
        format: "banner",
        period: "monthly",
        capacity_per_period: 5,
        delivery_mode: "all",
        creative: { booking_id: "booking-1", tracking_token: "token-1", sponsor_name: "One" },
        creatives: [
          { booking_id: "booking-1", tracking_token: "token-1", sponsor_name: "One" },
          { booking_id: "booking-2", tracking_token: "token-2", sponsor_name: "Two" },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (pathname === "/v1/sponsors/events/batch") {
      const body = JSON.parse(String(init.body));
      events.push(...body.events);
      return new Response(JSON.stringify({ accepted: body.events.length }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${pathname}`);
  };

  GrowthCat.initialize({ apiKey: "gc_test_sponsor_all", baseUrl: "https://example.test", measurementMode: "essential" });
  await GrowthCat.shared.refreshSDKBootstrap();
  const sponsor = await GrowthCat.shared.loadSponsorData("silver");
  assert.equal(sponsor.deliveryMode, "all");
  assert.equal(sponsor.creatives.length, 2);
  await Promise.all(sponsor.creatives.map((creative) =>
    GrowthCat.shared.trackSponsorCreativeImpression(sponsor, creative, { visibleFraction: 1, visibleDurationMs: 1000 })
  ));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await GrowthCat.shared.flushSponsorEvents();
  assert.deepEqual(events.map((event) => event.booking_id).sort(), ["booking-1", "booking-2"]);
  assert.equal(new Set(events.map((event) => event.creative_instance_id)).size, 2);
  GrowthCat.shared.shutdown();
});
