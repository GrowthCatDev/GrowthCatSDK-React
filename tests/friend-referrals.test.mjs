import test from "node:test";
import assert from "node:assert/strict";
import { GrowthCat, GrowthCatError, isReferralRewardUsable, referralRewardRedemptionUrl } from "../dist/index.mjs";

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function bootstrap() { return { sdk_config: { allow_code_redeem_execution: true }, readiness: { checks: {} }, ads: {} }; }
function state(user = "friend") { return { app_user_id: user, programs: [], progress: [], rewards: [{ id: "reward", program_id: "program",
  side: "friend", milestone: 1, reward_type: "asc_offer_code", status: "fulfilled", offer_code: "APPLE123", offer_code_redemption_url: "javascript:bad()" }] }; }
function init(fetcher, identityTokenProvider = async () => "signed-user") {
  globalThis.fetch = fetcher;
  GrowthCat.initialize({ apiKey: "gc_test_friend", identityTokenProvider });
  GrowthCat.setAppUserId("friend");
}

test("combined form classifies first; mode rejection never validates or enrolls", async () => {
  for (const [kind, mode] of [["influencer", "friends"], ["friend", "influencers"]]) {
    const calls = [];
    init(async (url, options) => {
      const path = new URL(url).pathname; calls.push(path);
      if (path === "/v1/sdk/config") return response(bootstrap());
      assert.equal(options.headers["X-GrowthCat-Identity"], "signed-user");
      return response({ kind, normalized_code: "VALID", program_id: "program", token: "VALID", accepting_new_referrals: true });
    });
    await assert.rejects(() => GrowthCat.shared.applyReferralCode("valid", mode), error => error.code === "referral_code_type_not_allowed");
    assert.equal(calls.filter(path => path !== "/v1/sdk/config").length, 1);
    GrowthCat.shutdown();
  }
});

test("friend enrollments use signed identity, return benefits and reject unsafe redemption URLs", async () => {
  const calls = [];
  init(async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/v1/sdk/config") return response(bootstrap());
    calls.push({ path, body: options.body && JSON.parse(options.body) });
    assert.equal(options.headers["X-GrowthCat-Identity"], "signed-user");
    if (path.endsWith("resolve-code")) return response({ kind: "friend", normalized_code: "VALID", program_id: "program", token: "VALID", accepting_new_referrals: false });
    if (path.endsWith("enroll")) return response({ enrollment: { id: "enrollment", program_id: "program", eligibility_verified: true }, state: state() });
    if (path.endsWith("state")) return response(state());
    return response({ programs: [] });
  });
  // An existing enrollment retry remains permitted when fresh admission is unavailable.
  const result = await GrowthCat.shared.applyReferralCode("VALID");
  assert.equal(result.kind, "friend");
  assert.equal(result.friend.state.rewards[0].offerCode, "APPLE123");
  assert.equal(result.friend.state.rewards[0].offerCodeRedemptionUrl, undefined);
  await GrowthCat.shared.referralPrograms(); await GrowthCat.shared.referralState();
  assert.deepEqual(calls[1].body, { app_user_id: "friend", program_id: "program", token: "VALID" });
  GrowthCat.shutdown();
});

test("identity changes during classification prevent enrollment, including switch away and back", async () => {
  let resolve, enrollments = 0;
  init(async url => {
    const path = new URL(url).pathname;
    if (path === "/v1/sdk/config") return response(bootstrap());
    if (path.endsWith("resolve-code")) return new Promise(done => { resolve = done; });
    enrollments++; return response({});
  });
  const pending = GrowthCat.shared.applyReferralCode("VALID");
  await new Promise(done => setTimeout(done, 0));
  GrowthCat.setAppUserId("other"); GrowthCat.setAppUserId("friend");
  resolve(response({ kind: "friend", normalized_code: "VALID", program_id: "program", token: "VALID" }));
  await assert.rejects(() => pending, error => error instanceof GrowthCatError && error.code === "network");
  assert.equal(enrollments, 0); GrowthCat.shutdown();
});

test("friend reads refresh a rejected identity once and expose typed capacity errors", async () => {
  const requests = []; let calls = 0;
  init(async url => {
    if (new URL(url).pathname === "/v1/sdk/config") return response(bootstrap());
    calls++; if (calls === 1) return response({ error: "expired_identity" }, 401);
    return response({ error: "plan_limit_reached", meter: "friend_enrollments", limit: 100, used: 100, reset_at: "2026-11-01" }, 403);
  }, async request => { requests.push(request); return "signed"; });
  await assert.rejects(() => GrowthCat.shared.referralState(), error => error.code === "plan_limit_reached" && error.planLimit.limit === 100);
  assert.deepEqual(requests.map(request => request.forceRefresh), [false, true]); GrowthCat.shutdown();
});


test("reward usability fails closed on expiry and keeps refund review separate from fulfillment", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const base = { status: "fulfilled", simulated: false, rewardType: "asc_offer_code", refundFlagged: false,
    offerCodeRedemptionUrl: "https://apps.apple.com/redeem?code=CODE" };
  for (const [override, usable, action] of [
    [{}, true, true],
    [{ status: "pending_review" }, false, false],
    [{ simulated: true }, false, false],
    [{ expiresAt: "2026-10-01T00:00:00Z" }, false, false],
    [{ expiresAt: "2000-01-01T00:00:00Z" }, false, false],
    [{ expiresAt: "2999-01-01T00:00:00.125+02:00" }, true, true],
    [{ expiresAt: "2999-02-30T00:00:00Z" }, false, false],
    [{ expiresAt: "2999-01-01T00:00:00Z\n" }, false, false],
    [{ expiresAt: "not-a-date" }, false, false],
    [{ expiresAt: "" }, false, false],
    [{ redemptionStatus: "confirmed" }, true, false],
    [{ refundFlagged: true }, true, true],
    [{ offerCodeRedemptionUrl: "https://apps.apple.com.evil.test/redeem" }, true, false],
    [{ offerCodeRedemptionUrl: "https://user:password@apps.apple.com/redeem" }, true, false],
    [{ offerCodeRedemptionUrl: "https://apps.apple.com/other" }, true, false]
  ]) {
    const reward = { ...base, ...override };
    assert.equal(isReferralRewardUsable(reward, now), usable, JSON.stringify(override));
    assert.equal(!!referralRewardRedemptionUrl(reward, now), action, JSON.stringify(override));
  }
});


test("consent revocation preserves signed referral benefits and does not emit optional analytics", async () => {
  for (const nextMode of ["essential", "disabled"]) {
    const calls = [], pending = [];
    let released = false;
    const payload = path => path.endsWith("/programs") ? { programs: [] }
      : path.endsWith("/state") ? state()
      : path.endsWith("/invite") ? { invite: { code: "VALID", token: "VALID", program_id: "program", url: "https://example.test/invite/VALID", accepting_new_referrals: true } }
      : path.endsWith("/resolve-code") ? { kind: "friend", normalized_code: "VALID", program_id: "program", token: "VALID", accepting_new_referrals: true }
      : { enrollment: { id: "enrollment", program_id: "program", eligibility_verified: true }, state: state() };
    globalThis.fetch = async (url, options) => {
      const path = new URL(url).pathname;
      calls.push({ path, options });
      if (path === "/v1/sdk/config") return response(bootstrap());
      if (!path.startsWith("/v1/referrals/") || path.endsWith("/click")) return response({ accepted: 1 });
      assert.equal(options.headers["X-GrowthCat-Identity"], "signed-user");
      if (released) return response(payload(path));
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        pending.push({ path, options, resolve });
      });
    };
    GrowthCat.initialize({ apiKey: "gc_test_friend", measurementMode: "analytics", identityTokenProvider: async () => "signed-user" });
    GrowthCat.setAppUserId("friend");
    await GrowthCat.ready(); await GrowthCat.shared.flushEvents();
    const optionalBefore = calls.filter(call => !call.path.startsWith("/v1/referrals/") && call.path !== "/v1/sdk/config").length;
    const completion = Promise.allSettled([
      GrowthCat.shared.referralPrograms(), GrowthCat.shared.referralState(),
      GrowthCat.shared.referralInvite("program"), GrowthCat.shared.enrollReferral({ programId: "program", token: "VALID" }),
      GrowthCat.shared.applyReferralCode("VALID", "friends"),
    ]);
    for (let attempt = 0; pending.length < 5 && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(pending.length, 5);
    GrowthCat.setMeasurementMode(nextMode);
    for (const request of pending) {
      assert.equal(request.options.signal.aborted, false, request.path);
      assert.equal(request.options.keepalive, false, request.path);
    }
    released = true;
    for (const request of pending) request.resolve(response(payload(request.path)));
    const results = await completion;
    assert.ok(results.every(result => result.status === "fulfilled"), JSON.stringify(results));
    assert.equal(results[4].value.kind, "friend");
    await GrowthCat.shared.recordReferralClick("VALID");
    await GrowthCat.shared.recordAnalyticsEvent("paywall_viewed");
    await GrowthCat.shared.flushEvents();
    assert.equal(calls.filter(call => call.path.endsWith("/referrals/click")).length, 0);
    assert.equal(calls.filter(call => !call.path.startsWith("/v1/referrals/") && call.path !== "/v1/sdk/config").length, optionalBefore);
    GrowthCat.shutdown();
  }
});
