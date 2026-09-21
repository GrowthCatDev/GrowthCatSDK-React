// Run after npm run build: node --import tsx scripts/audit-sdk-contracts.mts
// Requires the adjacent GrowthCatBackend checkout; all HTTP remains mocked.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GrowthCat } from '../dist/index.mjs';
import { AnalyticsEventIngestSchema } from '../../GrowthCatBackend/backend/src/modules/analytics/analytics.schema.ts';
import { AdEventBatchSchema, RewardValidateSchema } from '../../GrowthCatBackend/backend/src/modules/ads/ads.schema.ts';
import { SponsorEventBatchSchema } from '../../GrowthCatBackend/backend/src/modules/sponsors/sponsors.schema.ts';
import { ValidateRequestSchema, ReferralClickSchema } from '../../GrowthCatBackend/backend/src/modules/validate/validate.schema.ts';
import { PublicItemsQuerySchema } from '../../GrowthCatBackend/backend/src/modules/feedback/feedback.schema.ts';

const data = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value),
  removeItem: (key: string) => data.delete(key), key: (index: number) => [...data.keys()][index], get length() { return data.size; },
} });
const campaignId = randomUUID(), creativeId = randomUUID(), bookingId = randomUUID();
const received = new Map<string, any[]>();
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const schemas: Record<string, any> = {
  '/v1/analytics/events': AnalyticsEventIngestSchema, '/v1/ads/events/batch': AdEventBatchSchema,
  '/v1/sponsors/events/batch': SponsorEventBatchSchema, '/v1/validate': ValidateRequestSchema,
  '/v1/referrals/click': ReferralClickSchema, '/v1/ads/reward/validate': RewardValidateSchema,
};
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.pathname === '/v1/sdk/config') return json({
    sdk_config: { show_code_redeem_ui: true, allow_code_redeem_execution: true },
    ads: { ads_enabled: true, measurement_schema_version: 2 },
  });
  if (url.pathname === '/v1/sponsors/home') return json({
    status: 'live', creative: { booking_id: bookingId, tracking_token: 'signed-sponsor', sponsor_name: 'Test' },
  });
  if (url.pathname === '/v1/sdk/feedback/config') return json({ board: { slug: 'board' } });
  if (url.pathname === '/v1/public/feedback/board/items') {
    const query = PublicItemsQuerySchema.parse(Object.fromEntries(url.searchParams));
    assert.equal(query.type, 'bug');
    assert.equal(query.cursor, 'next');
    return json({ data: { items: [] }, pagination: { next_cursor: null } });
  }
  const body = init.body ? JSON.parse(String(init.body)) : {};
  if (schemas[url.pathname]) schemas[url.pathname].parse(body);
  const list = received.get(url.pathname) ?? []; list.push(body); received.set(url.pathname, list);
  if (url.pathname === '/v1/validate') return json({ is_valid: true, normalized_code: 'CODE', campaign: { id: campaignId } });
  if (url.pathname === '/v1/ads/reward/validate') {
    assert.equal(new Headers(init.headers).get('x-growthcat-identity'), 'test-identity');
    return json({ reward_validated: true, accepted: 1, grant_id: 'grant', already_granted: false, reward: { name: 'coins', amount: 10 } });
  }
  return json({ accepted: 1, duplicates: 0 });
};
GrowthCat.initialize({ apiKey: 'contract-test', measurementMode: 'analytics', identityTokenProvider: async () => 'test-identity' });
try {
  await GrowthCat.ready();
  GrowthCat.setAppUserId('user');
  for (const [name, properties] of [
    ['paywall_viewed', { offering_id: 'annual', placement: 'onboarding', has_intro_offer: true }],
    ['checkout_started', { product_id: 'annual', package_id: 'annual' }],
    ['checkout_cancelled', { reason: 'dismissed' }],
    ['purchase_sdk_completed', { store: 'stripe', purchase_result: 'success' }],
  ] as const) await GrowthCat.shared.recordAnalyticsEvent(name, { properties });
  await GrowthCat.shared.recordReferralClick('CODE');
  await GrowthCat.shared.validateReferralCode('CODE');
  await GrowthCat.shared.flushEvents();
  assert.equal(received.get('/v1/analytics/events')?.length, 4);
  const ad = { campaign: { id: campaignId, mode: 'house', objective: 'impressions', priorityWeight: 1 },
    creative: { id: creativeId, creativeType: 'image', destinationType: 'none' }, tracking: { token: 'signed-ad' },
    placement: { id: randomUUID(), format: 'interstitial' as const, rewardEnabled: true, isSkippable: true } };
  GrowthCat.setMeasurementMode('essential');
  const instance = randomUUID();
  GrowthCat.shared.trackAdEvent('impression', ad, { creativeInstanceId: instance, metadata: { visible_fraction: 1, visible_duration_ms: 1000 } });
  const sponsor = await GrowthCat.shared.loadSponsorData('home');
  assert.equal(await GrowthCat.shared.trackSponsorImpression(sponsor, { visibleFraction: 1, visibleDurationMs: 1000 }), true);
  await GrowthCat.shared.flushEvents();
  assert.equal(received.get('/v1/ads/events/batch')?.length, 1);
  assert.equal(received.get('/v1/sponsors/events/batch')?.length, 1);
  await GrowthCat.shared.validateAdReward(ad, 'user', { creativeInstanceId: instance, viewedSeconds: 10 });
  await GrowthCat.shared.validateAdReward(ad, 'user', { creativeInstanceId: instance, viewedSeconds: 10 });
  const rewards = received.get('/v1/ads/reward/validate')!;
  assert.equal(rewards[0].sdk_event_id, rewards[1].sdk_event_id);
  assert.equal(rewards[0].tracking_token, 'signed-ad');
  await GrowthCat.shared.fetchFeedbackPage({ type: 'bug', cursor: 'next' });
  console.log('SDK serialized requests pass real backend schemas: funnel, referral, essential ads, sponsors, rewards, feedback.');
} finally { GrowthCat.shutdown(); }
