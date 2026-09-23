import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { GrowthCat } from "../dist/index.mjs";
import { useAcquisitionCampaign } from "../dist/react/index.mjs";

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function campaign(slug, { trackLandingView = async () => {} } = {}) {
  return {
    campaignKey: `campaign-${slug}`,
    slug,
    screenshots: [],
    appleUrl: `https://apps.apple.com/app/${slug}`,
    sessionId: "session-1",
    trackLandingView,
    track: async () => {},
    openAppStore: async () => {},
  };
}

function Probe({ slug, options, onValue }) {
  const value = useAcquisitionCampaign(slug, options);
  onValue(value);
  return null;
}

async function initialize() {
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/v1/sdk/config") {
      return jsonResponse(bootstrapResponse());
    }
    throw new Error(`Unexpected request: ${parsed.pathname}`);
  };
  GrowthCat.initialize({
    apiKey: "gc_test_acquisition_hook",
    baseUrl: "https://example.test",
  });
  await GrowthCat.ready();
}

function mockAcquisition(implementation) {
  const client = GrowthCat.shared;
  const original = client.acquisition;
  client.acquisition = implementation;
  return () => { client.acquisition = original; };
}

test("useAcquisitionCampaign keeps the latest slug result", async () => {
  await initialize();
  const requests = new Map();
  const restoreAcquisition = mockAcquisition(({ slug }) => {
    const request = deferred();
    requests.set(slug, request);
    return request.promise;
  });

  let latest;
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(Probe, {
          slug: "first",
          options: { trackLandingView: false },
          onValue: (value) => { latest = value; },
        })
      );
    });

    await act(async () => {
      renderer.update(
        React.createElement(Probe, {
          slug: "second",
          options: { trackLandingView: false },
          onValue: (value) => { latest = value; },
        })
      );
    });

    await act(async () => {
      requests.get("second").resolve(campaign("second"));
      await requests.get("second").promise;
    });
    assert.equal(latest.campaign?.slug, "second");

    await act(async () => {
      requests.get("first").resolve(campaign("first"));
      await requests.get("first").promise;
    });
    assert.equal(latest.campaign?.slug, "second");
    assert.equal(latest.error, null);
    assert.equal(latest.isLoading, false);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    restoreAcquisition();
    GrowthCat.shutdown();
  }
});

test("useAcquisitionCampaign keeps the latest overlapping reload result", async () => {
  await initialize();
  const requests = [];
  const restoreAcquisition = mockAcquisition(() => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  });

  let latest;
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(Probe, {
          slug: "offer",
          options: { trackLandingView: false },
          onValue: (value) => { latest = value; },
        })
      );
    });
    await act(async () => {
      requests[0].resolve(campaign("initial"));
      await requests[0].promise;
    });

    let firstReload;
    let secondReload;
    await act(async () => {
      firstReload = latest.reload();
      secondReload = latest.reload();
      await Promise.resolve();
    });

    await act(async () => {
      requests[2].resolve(campaign("newest"));
      await secondReload;
    });
    assert.equal(latest.campaign?.slug, "newest");

    await act(async () => {
      requests[1].resolve(campaign("older"));
      await firstReload;
    });
    assert.equal(latest.campaign?.slug, "newest");
    assert.equal(latest.isLoading, false);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    restoreAcquisition();
    GrowthCat.shutdown();
  }
});

test("useAcquisitionCampaign does not track a request completed after disable", async () => {
  await initialize();
  const request = deferred();
  let trackingCalls = 0;
  const restoreAcquisition = mockAcquisition(() => request.promise);

  let latest;
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(Probe, {
          slug: "offer",
          options: { enabled: true },
          onValue: (value) => { latest = value; },
        })
      );
    });
    await act(async () => {
      renderer.update(
        React.createElement(Probe, {
          slug: "offer",
          options: { enabled: false },
          onValue: (value) => { latest = value; },
        })
      );
    });

    await act(async () => {
      request.resolve(campaign("offer", {
        trackLandingView: async () => { trackingCalls += 1; },
      }));
      await request.promise;
    });

    assert.equal(trackingCalls, 0);
    assert.equal(latest.campaign, null);
    assert.equal(latest.error, null);
    assert.equal(latest.isLoading, false);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    restoreAcquisition();
    GrowthCat.shutdown();
  }
});

test("useAcquisitionCampaign does not track a request completed after unmount", async () => {
  await initialize();
  const request = deferred();
  let trackingCalls = 0;
  const restoreAcquisition = mockAcquisition(() => request.promise);

  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(Probe, {
          slug: "offer",
          onValue: () => {},
        })
      );
    });
    await act(async () => renderer.unmount());
    renderer = null;

    await act(async () => {
      request.resolve(campaign("offer", {
        trackLandingView: async () => { trackingCalls += 1; },
      }));
      await request.promise;
    });

    assert.equal(trackingCalls, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    restoreAcquisition();
    GrowthCat.shutdown();
  }
});

test("useAcquisitionCampaign does not wait for or surface tracking failures", async () => {
  await initialize();
  const tracking = deferred();
  const restoreAcquisition = mockAcquisition(async () => campaign("offer", {
    trackLandingView: () => tracking.promise,
  }));

  let latest;
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(Probe, {
          slug: "offer",
          onValue: (value) => { latest = value; },
        })
      );
    });

    assert.equal(latest.campaign?.slug, "offer");
    assert.equal(latest.isLoading, false);
    assert.equal(latest.error, null);

    await act(async () => {
      tracking.reject(new Error("tracking unavailable"));
      await Promise.resolve();
    });
    assert.equal(latest.campaign?.slug, "offer");
    assert.equal(latest.isLoading, false);
    assert.equal(latest.error, null);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    restoreAcquisition();
    GrowthCat.shutdown();
  }
});

test("useAcquisitionCampaign clears the previous campaign when reload fails", async () => {
  await initialize();
  const failure = deferred();
  let calls = 0;
  const restoreAcquisition = mockAcquisition(async () => {
    calls += 1;
    if (calls === 1) return campaign("old");
    return failure.promise;
  });

  let latest;
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(Probe, {
          slug: "offer",
          options: { trackLandingView: false },
          onValue: (value) => { latest = value; },
        })
      );
    });
    assert.equal(latest.campaign?.slug, "old");

    let reload;
    await act(async () => {
      reload = latest.reload();
      await Promise.resolve();
    });
    assert.equal(latest.campaign, null);
    assert.equal(latest.isLoading, true);

    await act(async () => {
      failure.reject(new Error("campaign unavailable"));
      await reload;
    });
    assert.equal(latest.campaign, null);
    assert.match(latest.error?.message ?? "", /campaign unavailable/);
    assert.equal(latest.isLoading, false);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    restoreAcquisition();
    GrowthCat.shutdown();
  }
});
