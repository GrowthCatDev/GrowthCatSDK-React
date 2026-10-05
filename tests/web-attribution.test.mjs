import test from "node:test";
import assert from "node:assert/strict";
import { GrowthCatClient, parseAcquisitionCampaign } from "../dist/index.mjs";
const response = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values }; }
function client(mode = "analytics") {
  return new GrowthCatClient({ apiKey: "gc_test_arrival", baseUrl: "https://api.test", workspace: "sandbox", environmentMode: "automatic",
    logsEnabled: false, measurementMode: mode, requestTimeoutMs: 1000, identityTokenProvider: async () => "signed" });
}

test("web arrival captures campaign on appearance, waits for identity and deduplicates requests", async () => {
  const session = storage(); globalThis.sessionStorage = session; globalThis.localStorage = storage();
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push(JSON.parse(options.body)); return response({ assignment: { campaign_key: "meta-autumn", source_type: "meta" } }); };
  const sdk = client();
  assert.equal(await sdk.captureWebArrival("https://website.test/?gc_token=ABCD123&utmsource=madeup"), null);
  assert.equal(sdk.webArrival.status, "awaiting_identity"); assert.equal(calls.length, 0);
  sdk.setAppUserId("verified-user");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sdk.webArrival.status, "attributed");
  assert.equal(sdk.webArrival.assignment.campaignKey, "meta-autumn");
  assert.equal(calls[0].platform, "web"); assert.equal(calls[0].metadata.growthcat_platform, "web");
  await sdk.captureWebArrival("https://website.test/?gc_token=ABCD123");
  assert.equal(calls.length, 1); assert.equal(session.values.size, 0);
  sdk.clearAppUserId(); assert.equal(sdk.webArrival.assignment, null); sdk.shutdown();
});

test("consent denial stores and claims nothing; pending campaign survives sign-in navigation", async () => {
  globalThis.sessionStorage = storage(); globalThis.localStorage = storage(); let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ assignment: { campaign_key: "campaign", source_type: "tiktok" } }); };
  let sdk = client("essential");
  await sdk.captureWebArrival("https://website.test/?gc_token=ABCD123");
  assert.equal(sdk.webArrival.status, "awaiting_consent"); assert.equal(sessionStorage.values.size, 0); assert.equal(calls, 0); sdk.shutdown();
  sdk = client(); await sdk.captureWebArrival("https://website.test/?gc_token=ABCD123"); sdk.shutdown();
  sdk = client(); sdk.setAppUserId("signed-in-user"); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sdk.webArrival.assignment.campaignKey, "campaign"); assert.equal(calls, 1); sdk.shutdown();
});

test("UTM labels never create attribution and revocation clears pending tokens", async () => {
  globalThis.sessionStorage = storage(); globalThis.localStorage = storage();
  const sdk = client(); await sdk.captureWebArrival("https://website.test/?utm_source=meta&utm_campaign=fake");
  assert.equal(sdk.webArrival.status, "idle");
  await sdk.captureWebArrival("https://website.test/?gc_token=ABCD123");
  sdk.setMeasurementMode("disabled"); assert.equal(sessionStorage.values.size, 0); assert.equal(sdk.webArrival.status, "idle"); sdk.shutdown();
});

test("web acquisition exposes website destination and never requires an Apple URL", async () => {
  const config = parseAcquisitionCampaign({ campaign_key: "meta-web", slug: "web", destination_type: "web", target_url: "https://website.test/?gc_token=ABCD123", apple_url: null });
  assert.equal(config.destinationType, "web"); assert.equal(config.appleUrl, undefined);
  assert.throws(() => parseAcquisitionCampaign({ campaign_key: "bad", slug: "bad", destination_type: "web", target_url: "javascript:alert(1)" }));
});


test("late web claim cannot publish into a switched account", async () => {
  globalThis.sessionStorage = storage(); globalThis.localStorage = storage(); let finish;
  globalThis.fetch = async () => new Promise(resolve => { finish = resolve; });
  const sdk = client(); sdk.setAppUserId("first-user");
  const pending = sdk.captureWebArrival("https://website.test/?gc_token=ABCD123");
  await new Promise(resolve => setTimeout(resolve, 0));
  sdk.setAppUserId("second-user");
  finish(response({ assignment: { campaign_key: "old-user-campaign", platform: "web" } }));
  assert.equal(await pending, null); assert.equal(sdk.webArrival.assignment, null); sdk.shutdown();
});


test("cached campaign revisit restores its own result after a different arrival", async () => {
  globalThis.sessionStorage = storage(); globalThis.localStorage = storage();
  const tokens = [];
  globalThis.fetch = async (_url, options) => {
    const { token } = JSON.parse(options.body); tokens.push(token);
    return response({ assignment: { campaign_key: `campaign-${token}`, platform: "web" } });
  };
  const sdk = client(); sdk.setAppUserId("user");
  const first = await sdk.captureWebArrival("https://website.test/?gc_token=CAMPAIGN1");
  await sdk.captureWebArrival("https://website.test/?gc_token=CAMPAIGN2");
  const revisit = await sdk.captureWebArrival("https://website.test/?gc_token=CAMPAIGN1");
  assert.deepEqual(revisit, first);
  assert.equal(sdk.webArrival.assignment.campaignKey, "campaign-CAMPAIGN1");
  assert.equal(sdk.webArrival.status, "attributed");
  assert.deepEqual(tokens, ["CAMPAIGN1", "CAMPAIGN2"]);
  sdk.shutdown();
});

test("a claimed signed visitor requires explicit token recapture after sign-in", async () => {
  globalThis.sessionStorage = storage(); globalThis.localStorage = storage();
  const claims = [];
  globalThis.fetch = async (_url, options) => {
    const claim = JSON.parse(options.body); claims.push(claim);
    return response({ assignment: { campaign_key: "original-campaign", platform: "web" } });
  };
  let sdk = client(); sdk.setAppUserId("signed-visitor");
  await sdk.captureWebArrival("https://website.test/?gc_token=CAMPAIGN1");
  assert.equal(sessionStorage.values.size, 0);
  sdk.shutdown();
  sdk = client(); sdk.setAppUserId("signed-in-user");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sdk.webArrival.assignment, null); assert.equal(claims.length, 1);
  await sdk.captureWebArrival("https://website.test/?gc_token=CAMPAIGN1");
  assert.equal(claims[1].app_user_id, "signed-in-user");
  assert.equal(claims[0].sdk_install_id, claims[1].sdk_install_id);
  assert.equal(sdk.webArrival.assignment.campaignKey, "original-campaign");
  sdk.shutdown();
});
