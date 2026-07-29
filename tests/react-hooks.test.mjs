import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { GrowthCat } from "../dist/index.mjs";
import { useAd } from "../dist/react/index.mjs";

const require = createRequire(import.meta.url);

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function bootstrapResponse() {
  return {
    app_id: "app-1",
    authenticated: true,
    sdk_config: { allow_code_redeem_execution: true },
    readiness: { can_validate_codes: true, checks: {} },
    ads: {
      ads_enabled: true,
      ad_cache_ttl_seconds: 300,
      max_offline_ad_events: 100,
      measurement_schema_version: 2,
    },
  };
}

function rawAd(placementKey) {
  return {
    placement: {
      id: placementKey,
      format: "banner",
      reward_enabled: false,
      is_skippable: true,
    },
    campaign: {
      id: `campaign-${placementKey}`,
      mode: "house",
      objective: "clicks",
      priority_weight: 1,
    },
    creative: {
      id: `creative-${placementKey}`,
      creative_type: "image",
      destination_type: "none",
    },
    tracking: { token: `token-${placementKey}` },
  };
}

function Probe({ placementKey, onValue }) {
  const value = useAd({ placementKey });
  onValue(value);
  return null;
}

test("useAd reloads when placementKey changes", async () => {
  const requestedPlacements = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/v1/sdk/config") return jsonResponse(bootstrapResponse());
    if (parsed.pathname === "/v1/ads/catalog") {
      const placementKey = parsed.searchParams.get("placement_key");
      requestedPlacements.push(placementKey);
      return jsonResponse({ ads: [rawAd(placementKey)] });
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };

  GrowthCat.initialize({ apiKey: "gc_test_react", baseUrl: "https://example.test" });
  await GrowthCat.ready();
  let latest;
  let renderer;

  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(Probe, {
        placementKey: "home",
        onValue: (value) => { latest = value; },
      })
    );
  });
  assert.equal(latest.ad?.creative.id, "creative-home");

  await act(async () => {
    renderer.update(
      React.createElement(Probe, {
        placementKey: "settings",
        onValue: (value) => { latest = value; },
      })
    );
  });

  assert.equal(latest.ad?.creative.id, "creative-settings");
  assert.deepEqual(requestedPlacements, ["home", "settings"]);
  await act(async () => renderer.unmount());
  GrowthCat.shutdown();
});

test("useAd stays idle while disabled", async () => {
  let catalogCalls = 0;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/v1/sdk/config") return jsonResponse(bootstrapResponse());
    if (parsed.pathname === "/v1/ads/catalog") {
      catalogCalls += 1;
      return jsonResponse({ ads: [rawAd("home")] });
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };

  GrowthCat.initialize({ apiKey: "gc_test_react_lazy", baseUrl: "https://example.test" });
  await GrowthCat.ready();
  let latest;

  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(function DisabledProbe() {
        latest = useAd({ placementKey: "home", enabled: false });
        return null;
      })
    );
  });

  assert.equal(latest.state, "idle");
  assert.equal(catalogCalls, 0);
  await act(async () => renderer.unmount());
  GrowthCat.shutdown();
});

test("core and React CommonJS entry points can be consumed", () => {
  const core = require("../dist/index.js");
  const reactEntry = require("../dist/react/index.js");
  assert.equal(typeof core.GrowthCat.initialize, "function");
  assert.equal(typeof reactEntry.useAd, "function");
});
