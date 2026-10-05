import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { GrowthCat } from "../dist/index.mjs";
import { useReferralCode, GrowthCatFriendReferralPanel, useWebAttribution } from "../dist/react/index.mjs";
const response = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
function initialize() {
  globalThis.fetch = async () => response({ sdk_config: {}, readiness: { checks: {} }, ads: {} });
  GrowthCat.initialize({ apiKey: "gc_test_hooks", identityTokenProvider: async () => "signed" });
  GrowthCat.setAppUserId("first");
}

test("referral hook clears stale results on code mode and account changes", async () => {
  initialize(); await GrowthCat.ready(); let value, finish;
  GrowthCat.shared.applyReferralCode = async () => new Promise(resolve => { finish = resolve; });
  function Probe({ mode }) { value = useReferralCode({ mode }); return null; }
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { mode: "both" })); });
  let pending;
  await act(async () => { pending = value.applyCode("VALID"); });
  await act(async () => { renderer.update(React.createElement(Probe, { mode: "friends" })); });
  await act(async () => { finish({ kind: "influencer", normalizedCode: "VALID" }); await pending; });
  assert.equal(value.result, null); assert.equal(value.isLoading, false);
  await act(async () => { GrowthCat.setAppUserId("second"); });
  assert.equal(value.result, null); renderer.unmount(); GrowthCat.shutdown();
});

test("referral progress panel retains earned rewards and hides sharing when admission unavailable", async () => {
  initialize(); await GrowthCat.ready();
  GrowthCat.shared.referralState = async () => ({ appUserId: "first", programs: [{ id: "p", name: "Friends", acceptingNewReferrals: false, inviterMilestones: [] }],
    progress: [{ programId: "p", enrolledCount: 8, qualifiedCount: 5, milestones: [{ id: "month", requiredCount: 5, label: "One month free" }] }],
    rewards: [{ id: "r", programId: "p", status: "fulfilled", offerCode: "APPLE123", offerCodeRedemptionUrl: "https://apps.apple.com/redeem" }] });
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(GrowthCatFriendReferralPanel)); });
  const text = JSON.stringify(renderer.toJSON());
  assert.ok(text.includes("APPLE123")); assert.ok(text.includes("One month free"));
  assert.ok(text.includes("temporarily unavailable")); assert.ok(!text.includes("Get my invite code"));
  renderer.unmount(); GrowthCat.shutdown();
});


test("disabled website attribution hook clears its previously rendered assignment", async () => {
  initialize(); await GrowthCat.ready(); let value;
  Object.defineProperty(GrowthCat.shared, "webArrival", { get: () => ({ kind: "web_arrival", status: "attributed", assignment: { campaignKey: "paid-campaign" }, error: null }) });
  GrowthCat.shared.captureWebArrival = async () => ({ campaignKey: "paid-campaign" });
  function Probe({ enabled }) { value = useWebAttribution({ enabled }); return null; }
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { enabled: true })); });
  assert.equal(value.assignment.campaignKey, "paid-campaign");
  await act(async () => { renderer.update(React.createElement(Probe, { enabled: false })); });
  assert.equal(value.assignment, null); assert.equal(value.status, "idle"); assert.equal(value.error, null);
  renderer.unmount(); GrowthCat.shutdown();
});

test("expired and consumed rewards retain history without a redemption action", async () => {
  initialize(); await GrowthCat.ready();
  GrowthCat.shared.referralState = async () => ({ appUserId: "first", programs: [{ id: "p", name: "Friends", acceptingNewReferrals: false, inviterMilestones: [] }],
    progress: [], rewards: [
      { id: "expired", programId: "p", status: "fulfilled", rewardType: "asc_offer_code", offerCode: "EXPIRED", expiresAt: "2000-01-01T00:00:00Z", offerCodeRedemptionUrl: "https://apps.apple.com/redeem" },
      { id: "used", programId: "p", status: "fulfilled", rewardType: "asc_offer_code", offerCode: "CONSUMED", redemptionStatus: "confirmed", offerCodeRedemptionUrl: "https://apps.apple.com/redeem" }
    ] });
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(GrowthCatFriendReferralPanel)); });
  const text = JSON.stringify(renderer.toJSON());
  assert.ok(text.includes("EXPIRED")); assert.ok(text.includes("CONSUMED"));
  assert.equal(renderer.root.findAllByType("a").length, 0);
  renderer.unmount(); GrowthCat.shutdown();
});


function simpleState(threshold = 5, nextThreshold = threshold) {
  const reward = { enabled: true, type: "revenuecat_entitlement", duration: { value: 1, unit: "months" } };
  return { appUserId: "first", programs: [{ id: "p", name: "Friends", acceptingNewReferrals: true, requiredCount: threshold, inviterReward: reward, inviterMilestones: [] }],
    progress: [{ programId: "p", enrolledCount: 8, qualifiedCount: 7, requiredCount: threshold, nextThreshold, remainingCount: nextThreshold == null ? 0 : nextThreshold - 7, milestones: [] }], rewards: [] };
}
test("single and repeating goals show server thresholds, remaining friends and completion", async () => {
  initialize(); await GrowthCat.ready(); let state = simpleState(5, 10);
  GrowthCat.shared.referralState = async () => state;
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(GrowthCatFriendReferralPanel)); });
  assert.equal(renderer.root.findByType("progress").props.max, 10);
  assert.equal(renderer.root.findByType("progress").props.value, 7);
  assert.ok(JSON.stringify(renderer.toJSON()).includes("3 more qualifying friends"));
  state = simpleState(12, 12);
  await act(async () => { await renderer.root.findAllByType("button").find(b => b.children[0] === "Refresh progress").props.onClick(); });
  assert.equal(renderer.root.findByType("progress").props.max, 12);
  assert.ok(JSON.stringify(renderer.toJSON()).includes("5 more qualifying friends"));
  state = simpleState(5, null);
  await act(async () => { await renderer.root.findAllByType("button").find(b => b.children[0] === "Refresh progress").props.onClick(); });
  assert.ok(JSON.stringify(renderer.toJSON()).includes("Referral goal reached."));
  renderer.unmount(); GrowthCat.shutdown();
});

test("invite copying uses clipboard and failed sharing leaves a selectable link", async () => {
  initialize(); await GrowthCat.ready();
  GrowthCat.shared.referralState = async () => simpleState();
  GrowthCat.shared.referralInvite = async () => ({ programId: "p", acceptingNewReferrals: true, code: "MYCODE", url: "https://example.test/invite/MYCODE" });
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let copied;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async url => { copied = url; } }, share: async () => { throw new Error("Share unavailable"); } } });
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(GrowthCatFriendReferralPanel, { strings: { title: "Invita amigos" } })); });
    await act(async () => { await renderer.root.findAllByType("button").find(b => b.children[0] === "Get my invite code").props.onClick(); });
    await act(async () => { await renderer.root.findAllByType("button").find(b => b.children[0] === "Copy invite link").props.onClick(); });
    assert.equal(copied, "https://example.test/invite/MYCODE");
    assert.ok(JSON.stringify(renderer.toJSON()).includes("Invite link copied."));
    await act(async () => { await renderer.root.findAllByType("button").find(b => b.children[0] === "Share invite").props.onClick(); });
    assert.equal(renderer.root.findByType("input").props.readOnly, true);
    assert.ok(JSON.stringify(renderer.toJSON()).includes("Select and copy your invite link"));
    assert.ok(JSON.stringify(renderer.toJSON()).includes("Invita amigos"));
  } finally { renderer?.unmount(); GrowthCat.shutdown(); if (original) Object.defineProperty(globalThis, "navigator", original); else delete globalThis.navigator; }
});

test("pending rewards never expose a code and localized reward statuses are supported", async () => {
  initialize(); await GrowthCat.ready();
  GrowthCat.shared.referralState = async () => ({ ...simpleState(), rewards: [{ id: "r", programId: "p", status: "pending_review", offerCode: "UNDELIVERED" }] });
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(GrowthCatFriendReferralPanel, { strings: { rewardStatus: () => "Pendiente de aprobación" } })); });
  assert.ok(JSON.stringify(renderer.toJSON()).includes("Pendiente de aprobación"));
  assert.ok(!JSON.stringify(renderer.toJSON()).includes("UNDELIVERED"));
  renderer.unmount(); GrowthCat.shutdown();
});


test("only usable delivered benefits can select offerings or render host benefit details", async () => {
  initialize(); await GrowthCat.ready();
  const base = { programId: "p", rewardType: "custom", featureKey: "private-feature-id", offeringId: "friend-offer" };
  const rewards = [
    { ...base, id: "usable", status: "fulfilled", expiresAt: "2099-01-01T00:00:00Z", customPayload: { label: "VIP coaching" } },
    { ...base, id: "pending", status: "pending_review" },
    { ...base, id: "simulated", status: "fulfilled", simulated: true },
    { ...base, id: "expired", status: "fulfilled", expiresAt: "2000-01-01T00:00:00Z" },
    { ...base, id: "delivering", status: "fulfilling" },
  ];
  GrowthCat.shared.referralState = async () => ({ ...simpleState(), rewards });
  let renderer, selected, rendered = [];
  await act(async () => { renderer = TestRenderer.create(React.createElement(GrowthCatFriendReferralPanel, {
    onSelectOffering: (id, reward) => { selected = [id, reward.id]; },
    renderReward: reward => { rendered.push(reward.id); return React.createElement("span", null, reward.customPayload.label); },
  })); });
  assert.deepEqual([...new Set(rendered)], ["usable"]);
  const buttons = renderer.root.findAllByType("button").filter(b => b.children[0] === "View offer");
  assert.equal(buttons.length, 1);
  await act(async () => { buttons[0].props.onClick(); });
  assert.deepEqual(selected, ["friend-offer", "usable"]);
  const text = JSON.stringify(renderer.toJSON());
  assert.ok(text.includes("VIP coaching")); assert.ok(text.includes("Custom benefit delivered"));
  assert.ok(text.includes("Expires")); assert.ok(text.includes("Delivering your reward"));
  assert.ok(!text.includes("private-feature-id"));
  renderer.unmount(); GrowthCat.shutdown();
});


test("offering action rechecks reward availability and cannot publish after an account change", async () => {
  initialize(); await GrowthCat.ready();
  const usable = { id: "r", programId: "p", status: "fulfilled", rewardType: "custom", offeringId: "friend-offer" };
  let state = { ...simpleState(), rewards: [usable] }, selected = 0, resolve;
  GrowthCat.shared.referralState = async () => state;
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(GrowthCatFriendReferralPanel, { onSelectOffering: () => { selected++; } })); });
  state = { ...state, rewards: [{ ...usable, expiresAt: "2000-01-01T00:00:00Z" }] };
  await act(async () => { renderer.root.findAllByType("button").find(b => b.children[0] === "View offer").props.onClick(); });
  assert.equal(selected, 0);
  assert.ok(JSON.stringify(renderer.toJSON()).includes("This reward is unavailable"));
  GrowthCat.shared.referralState = async () => new Promise(done => { resolve = done; });
  await act(async () => { renderer.root.findAllByType("button").find(b => b.children[0] === "View offer").props.onClick(); });
  const finishOld = resolve;
  await act(async () => { GrowthCat.setAppUserId("second"); });
  await act(async () => { finishOld({ ...simpleState(), rewards: [usable] }); });
  assert.equal(selected, 0);
  renderer.unmount(); GrowthCat.shutdown();
});
