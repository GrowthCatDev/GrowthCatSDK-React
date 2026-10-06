import test from "node:test";
import assert from "node:assert/strict";
import { GrowthCat, GrowthCatError, isReferralRewardUsable, referralRewardRedemptionUrl } from "../dist/index.mjs";

import { parseBootstrap } from "../src/models/bootstrap.ts";
import { parseReferralProgram, parseReferralState } from "../src/models/friend-referrals.ts";

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function bootstrap() { return { sdk_config: { allow_code_redeem_execution: true, friend_referrals_enabled: true }, readiness: { checks: {} }, ads: {} }; }
function program(overrides = {}) { return { id: "program", version: 1, name: "Friends", campaign_key: "friends", status: "active",
  qualifying_event: "signup", friend_trigger_event: "signup", required_count: 5, frequency: "single",
  accepting_new_referrals: true, can_enroll: true, inviter_reward: { enabled: false }, friend_reward: { enabled: false }, ...overrides }; }
function state(user = "friend") { return { friend_referrals_enabled: true, app_user_id: user, programs: [program()], progress: [], rewards: [{ id: "reward", program_id: "program",
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


test("remote friend flags and eligibility fail closed; policy defaults retain legacy null semantics", () => {
  for (const value of [undefined, false, "true", 1, null]) {
    assert.equal(parseBootstrap({ sdk_config: { friend_referrals_enabled: value } }).sdkConfig.friendReferralsEnabled, false);
    assert.equal(parseReferralState({ ...state(), friend_referrals_enabled: value }).friendReferralsEnabled, false);
    assert.equal(parseReferralProgram(program({ can_enroll: value })).canEnroll, false);
  }
  assert.equal(parseBootstrap(bootstrap()).sdkConfig.friendReferralsEnabled, true);
  const defaults = parseReferralProgram(program({ can_enroll: undefined }));
  assert.equal(defaults.canEnroll, false);
  assert.equal(defaults.newUserMaxAgeDays, 7);
  assert.equal(defaults.friendRewardOncePerUser, true);
  const custom = parseReferralProgram(program({ new_user_max_age_days: null, friend_reward_once_per_user: false,
    can_enroll: false, enrollment_ineligibility_reason: "referral_account_age_exceeded" }));
  assert.equal(custom.newUserMaxAgeDays, null);
  assert.equal(custom.friendRewardOncePerUser, false);
  assert.equal(custom.enrollmentIneligibilityReason, "referral_account_age_exceeded");
  assert.equal(parseReferralProgram(program({ new_user_max_age_days: 14 })).newUserMaxAgeDays, 14);
  for (const value of [-1, 0, 2.5, 3651, "14"]) assert.equal(parseReferralProgram(program({ new_user_max_age_days: value })).newUserMaxAgeDays, 7);
});

test("new invite generation requires fresh config and state but inviter account age does not gate it", async () => {
  for (const scenario of ["missing", "disabled", "state-disabled", "state-missing", "unavailable", "old-inviter", "eligible"]) {
    let writes = 0;
    init(async url => {
      const path = new URL(url).pathname;
      if (path === "/v1/sdk/config") return response({ ...bootstrap(), sdk_config: scenario === "missing" ? {} :
        { friend_referrals_enabled: scenario !== "disabled" } });
      if (path.endsWith("/state")) return response({ ...state(), friend_referrals_enabled: scenario === "state-missing" ? undefined : scenario !== "state-disabled",
        programs: [program({ accepting_new_referrals: scenario !== "unavailable", can_enroll: scenario !== "old-inviter" })] });
      writes++;
      return response({ invite: { code: "VALID", token: "VALID", program_id: "program", url: "https://example.test/VALID", accepting_new_referrals: true } });
    });
    if (["old-inviter", "eligible"].includes(scenario)) {
      assert.equal((await GrowthCat.shared.referralInvite("program")).code, "VALID"); assert.equal(writes, 1);
    } else {
      await assert.rejects(() => GrowthCat.shared.referralInvite("program")); assert.equal(writes, 0, scenario);
    }
    GrowthCat.shutdown();
  }
});

test("failed config refresh closes new sharing while history and accepted enrollment retries survive", async () => {
  let unavailable = false, invites = 0, enrollments = 0;
  init(async url => {
    const path = new URL(url).pathname;
    if (path === "/v1/sdk/config") return unavailable ? response({ error: "unavailable" }, 503) : response(bootstrap());
    if (path.endsWith("/state")) return response({ ...state(), friend_referrals_enabled: false });
    if (path.endsWith("/resolve-code")) return response({ kind: "friend", normalized_code: "VALID", program_id: "program", token: "VALID" });
    if (path.endsWith("/enroll")) { enrollments++; return response({ enrollment: { id: "existing", program_id: "program", eligibility_verified: true }, state: state() }); }
    invites++; return response({});
  });
  await GrowthCat.ready();
  const flags = [], unsubscribe = GrowthCat.shared.subscribeSDKConfig(config => flags.push(config.friendReferralsEnabled));
  unavailable = true;
  await assert.rejects(() => GrowthCat.shared.referralInvite("program"));
  assert.equal(GrowthCat.shared.sdkConfig.friendReferralsEnabled, false);
  assert.deepEqual(flags, [false]); assert.equal(invites, 0);
  assert.equal((await GrowthCat.shared.referralState()).rewards[0].offerCode, "APPLE123");
  assert.equal((await GrowthCat.shared.enrollReferral({ programId: "program", token: "VALID" })).enrollment.id, "existing");
  assert.equal((await GrowthCat.shared.applyReferralCode("VALID", "friends")).kind, "friend");
  assert.equal(enrollments, 2);
  unsubscribe(); GrowthCat.shutdown();
});

test("server enrollment failures expose stable eligibility reasons even when message is localized", async () => {
  for (const reason of ["friend_referrals_disabled", "referral_account_age_unverified", "referral_account_age_exceeded", "referral_existing_account_ineligible"]) {
    init(async url => new URL(url).pathname === "/v1/sdk/config" ? response(bootstrap()) :
      response({ code: reason, message: "Localized reason" }, 409));
    await assert.rejects(() => GrowthCat.shared.enrollReferral({ programId: "program", token: "VALID" }), error => error.code === reason && error.statusCode === 409);
    GrowthCat.shutdown();
  }
});


test("history uses accepted enrollment evidence and meaningful legacy progress, not zero-count rows", () => {
  const empty = { ...state(), friend_referrals_enabled: false, rewards: [], progress: [{
    program_id: "program", campaign_key: "friends", frequency: "single", enrolled_count: 0, qualified_count: 0, earned_rewards: 0, milestones: []
  }] };
  assert.equal(parseReferralState(empty).hasReferralHistory, false);
  assert.equal(parseReferralState({ ...empty, has_referral_history: true }).hasReferralHistory, true);
  for (const value of [false, undefined, "true", 1]) assert.equal(parseReferralState({ ...empty, has_referral_history: value }).hasReferralHistory, false);
  assert.equal(parseReferralState({ ...empty, rewards: state().rewards }).hasReferralHistory, true);
  for (const field of ["enrolled_count", "qualified_count", "earned_rewards"]) {
    assert.equal(parseReferralState({ ...empty, progress: [{ ...empty.progress[0], [field]: 1 }] }).hasReferralHistory, true, field);
  }
});
