import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  GROWTHCAT_WEB_SDK_VERSION,
  GrowthCat,
  GrowthCatClient,
  GrowthCatError,
} from "../dist/index.mjs";

function bootstrapResponse(overrides = {}) {
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
      measurement_schema_version: 2,
      ...overrides,
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installMemoryStorage() {
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
      key: (index) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    },
  });
  return values;
}

function shutdown() {
  GrowthCat.shutdown();
}

test("runtime and package versions stay aligned", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  assert.equal(GrowthCat.version, packageJson.version);
  assert.equal(GROWTHCAT_WEB_SDK_VERSION, packageJson.version);
});

test("uninitialized access uses the documented typed error", () => {
  GrowthCat.shutdown();
  assert.throws(
    () => GrowthCat.shared,
    (error) => error instanceof GrowthCatError && error.code === "not_initialized"
  );
});

test("configuration validates inputs and HTTP requests time out", async () => {
  installMemoryStorage();
  assert.throws(
    () => GrowthCat.initialize({ apiKey: "", baseUrl: "https://example.test" }),
    /apiKey/
  );
  const client = new GrowthCatClient({
    apiKey: "gc_test_timeout",
    baseUrl: "https://example.test",
    environmentMode: "automatic",
    workspace: "sandbox",
    logsEnabled: false,
    measurementMode: "essential",
    requestTimeoutMs: 5,
  });
  globalThis.fetch = async (_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

  await assert.rejects(
    () => client.refreshSDKBootstrap(),
    (error) => error instanceof GrowthCatError &&
      error.code === "network" &&
      error.message.includes("timed out")
  );
  client.shutdown();
});

test("initial bootstrap is shared by ready and early SDK calls", async () => {
  installMemoryStorage();
  let bootstrapCalls = 0;
  globalThis.fetch = async () => {
    bootstrapCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return jsonResponse(bootstrapResponse());
  };

  GrowthCat.initialize({ apiKey: "gc_test_ready", baseUrl: "https://example.test" });
  const [client, bootstrap] = await Promise.all([
    GrowthCat.ready(),
    GrowthCat.shared.refreshSDKBootstrap(),
  ]);

  assert.equal(client, GrowthCat.shared);
  assert.equal(bootstrap.adsConfig.adsEnabled, true);
  assert.equal(bootstrapCalls, 1);
  shutdown();
});

test("automatic workspace infers live keys and explicit workspace wins", async () => {
  installMemoryStorage();
  const workspaces = [];
  globalThis.fetch = async (_url, init = {}) => {
    workspaces.push(init.headers["X-GrowthCat-Workspace"]);
    return jsonResponse(bootstrapResponse());
  };

  GrowthCat.initialize({ apiKey: "gc_live_example", baseUrl: "https://example.test" });
  await GrowthCat.ready();
  shutdown();

  GrowthCat.initialize({
    apiKey: "gc_live_example",
    baseUrl: "https://example.test",
    workspace: "sandbox",
  });
  await GrowthCat.ready();

  assert.deepEqual(workspaces, ["live", "sandbox"]);
  shutdown();
});

test("ad requests are deduplicated and stale ads survive network failures", async () => {
  installMemoryStorage();
  let catalogCalls = 0;
  const rawAd = {
    placement: {
      id: "placement-1",
      format: "banner",
      reward_enabled: false,
      is_skippable: true,
    },
    campaign: {
      id: "campaign-1",
      mode: "house",
      objective: "clicks",
      priority_weight: 1,
    },
    creative: {
      id: "creative-1",
      creative_type: "image",
      destination_type: "url",
      destination_url: "example.com",
    },
    tracking: { token: "signed-token" },
  };

  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/sdk/config") {
      return jsonResponse(bootstrapResponse({ ad_cache_ttl_seconds: 0 }));
    }
    if (pathname === "/v1/ads/catalog") {
      catalogCalls += 1;
      if (catalogCalls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return jsonResponse({ ads: [rawAd], cache_ttl_seconds: 0 });
      }
      throw new TypeError("Failed to fetch");
    }
    throw new Error(`Unexpected request: ${pathname}`);
  };

  GrowthCat.initialize({ apiKey: "gc_test_ads", baseUrl: "https://example.test" });
  await GrowthCat.ready();
  const [first, duplicate] = await Promise.all([
    GrowthCat.shared.loadAd({ placementKey: "home" }),
    GrowthCat.shared.loadAd({ placementKey: "home" }),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 2));
  const stale = await GrowthCat.shared.loadAd({ placementKey: "home" });

  assert.equal(catalogCalls, 2);
  assert.equal(first?.creative.id, "creative-1");
  assert.equal(duplicate?.creative.id, "creative-1");
  assert.equal(stale?.creative.id, "creative-1");
  shutdown();
});

test("bootstrap queue limits are applied to ad tracking", async () => {
  const storage = installMemoryStorage();
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/sdk/config") {
      return jsonResponse(bootstrapResponse({ max_offline_ad_events: 1 }));
    }
    throw new Error(`Unexpected request: ${pathname}`);
  };

  GrowthCat.initialize({ apiKey: "gc_test_queue_limit", baseUrl: "https://example.test" });
  await GrowthCat.ready();
  const ad = {
    campaign: { id: "campaign", mode: "house", objective: "views", priorityWeight: 1 },
    creative: { id: "creative", creativeType: "video", destinationType: "none" },
    tracking: { token: "token" },
  };
  GrowthCat.shared.trackAdEvent("video_progress", ad, {
    format: "interstitial",
    creativeInstanceId: "render-1",
    metadata: { quartile: 25 },
  });
  GrowthCat.shared.trackAdEvent("video_progress", ad, {
    format: "interstitial",
    creativeInstanceId: "render-1",
    metadata: { quartile: 50 },
  });

  const queueEntry = [...storage.entries()]
    .find(([key]) => key.startsWith("growthcat_ad_events:"));
  assert.equal(JSON.parse(queueEntry[1]).events.length, 1);
  shutdown();
});

test("attribution identity is scoped by project and can be cleared", async () => {
  installMemoryStorage();
  globalThis.fetch = async () => jsonResponse(bootstrapResponse());

  GrowthCat.initialize({ apiKey: "gc_test_project_a", baseUrl: "https://example.test" });
  await GrowthCat.ready();
  GrowthCat.setAppUserId("user-a");
  assert.equal(GrowthCat.shared.attributionService.getAppUserId(), "user-a");
  shutdown();

  GrowthCat.initialize({ apiKey: "gc_test_project_b", baseUrl: "https://example.test" });
  await GrowthCat.ready();
  assert.equal(GrowthCat.shared.attributionService.getAppUserId(), null);
  GrowthCat.setAppUserId("user-b");
  GrowthCat.clearAppUserId();
  assert.equal(GrowthCat.shared.attributionService.getAppUserId(), null);
  shutdown();

  GrowthCat.initialize({ apiKey: "gc_test_project_a", baseUrl: "https://example.test" });
  await GrowthCat.ready();
  assert.equal(GrowthCat.shared.attributionService.getAppUserId(), "user-a");
  shutdown();
});

test("object-based attribution confirmation and permanent rejection handling", async () => {
  installMemoryStorage();
  const claims = [];
  let eventCalls = 0;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/sdk/config") return jsonResponse(bootstrapResponse());
    if (pathname === "/v1/attribution/claim") {
      const body = JSON.parse(String(init.body));
      claims.push(body);
      return jsonResponse({ assignment: { token: body.token, match_type: body.match_type } });
    }
    if (pathname === "/v1/events") {
      eventCalls += 1;
      return jsonResponse({ message: "invalid event" }, 400);
    }
    throw new Error(`Unexpected request: ${pathname}`);
  };

  GrowthCat.initialize({ apiKey: "gc_test_attribution", baseUrl: "https://example.test" });
  await GrowthCat.ready();
  GrowthCat.setAppUserId("user-1");
  await GrowthCat.shared.confirmAttribution({
    touchpointId: "touchpoint-1",
    sessionId: "session-1",
  });
  await assert.rejects(() => GrowthCat.shared.track("bad-event"));
  await assert.rejects(() => GrowthCat.shared.track("bad-event-again"));

  assert.equal(claims[0].touchpoint_id, "touchpoint-1");
  assert.equal(claims[0].match_type, "confirmed_referral");
  assert.equal(eventCalls, 2);
  shutdown();
});

test("feedback board configuration recovers after a transient failure", async () => {
  installMemoryStorage();
  let configCalls = 0;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/sdk/config") return jsonResponse(bootstrapResponse());
    if (pathname === "/v1/sdk/feedback/config") {
      configCalls += 1;
      if (configCalls === 1) return jsonResponse({ message: "temporary" }, 503);
      return jsonResponse({ board: { slug: "public-board" } });
    }
    if (pathname === "/v1/public/feedback/public-board/items") {
      return jsonResponse({ items: [] });
    }
    throw new Error(`Unexpected request: ${pathname}`);
  };

  GrowthCat.initialize({ apiKey: "gc_test_feedback", baseUrl: "https://example.test" });
  await GrowthCat.ready();
  await assert.rejects(
    () => GrowthCat.shared.fetchFeedbackBoard(),
    (error) => error instanceof GrowthCatError && error.statusCode === 503
  );
  assert.deepEqual(await GrowthCat.shared.fetchFeedbackBoard(), []);
  assert.equal(configCalls, 2);
  shutdown();
});
