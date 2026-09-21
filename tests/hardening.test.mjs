import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { GrowthCat } from '../dist/index.mjs';
const require = createRequire(import.meta.url);
const { EventQueue, isQueuedEvent } = require('../src/core/event-queue.ts');
const { ApiClient } = require('../src/core/api.ts');
const { buildConfiguration } = require('../src/core/config.ts');
const { MeasurementState } = require('../src/core/privacy.ts');
const { AnalyticsEventTracker } = require('../src/services/analytics-event-tracker.ts');
const { silentLogger } = require('../src/core/logger.ts');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function storage() {
  const data = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key), key: index => [...data.keys()][index], get length() { return data.size; },
  } });
  return data;
}
const event = () => ({ sdk_event_id: randomUUID(), event_name: 'paywall_viewed', measurement_mode: 'analytics', event_at: new Date().toISOString() });
const response = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const bootstrap = { sdk_config: { show_code_redeem_ui: true, allow_code_redeem_execution: true }, ads: { ads_enabled: true, measurement_schema_version: 2 } };

test('consent reset during a request does not acknowledge a new event', async () => {
  storage();
  let release;
  let allowed = true;
  const sent = [];
  const queue = new EventQueue({ key: 'reset', maxEvents: 100, valid: isQueuedEvent, allowed: () => allowed, send: async item => {
    sent.push(item.sdk_event_id);
    if (sent.length === 1) await new Promise(resolve => { release = resolve; });
  } });
  const a = event(), b = event();
  queue.enqueue(a);
  allowed = false; queue.filter();
  allowed = true; queue.enqueue(b);
  release(); await queue.flush();
  assert.deepEqual(sent, [a.sdk_event_id, b.sdk_event_id]);
  queue.shutdown();
});

test('shutdown during delivery does not send the next event', async () => {
  storage();
  let release;
  const sent = [];
  const queue = new EventQueue({ key: 'shutdown', maxEvents: 100, valid: isQueuedEvent, allowed: () => true, send: async item => {
    sent.push(item.sdk_event_id); await new Promise(resolve => { release = resolve; });
  } });
  queue.enqueue(event()); queue.enqueue(event());
  queue.shutdown(); release(); await tick();
  assert.equal(sent.length, 1);
});

test('removing optional events retains essential events and does not resend removed work', async () => {
  storage();
  let release;
  const sent = [];
  const queue = new EventQueue({ key: 'logout', maxEvents: 10, valid: isQueuedEvent, allowed: () => true,
    send: async item => {
      sent.push(item.sdk_event_id);
      if (sent.length === 1) await new Promise(resolve => { release = resolve; });
    },
  });
  const active = event(), optional = event(), essential = { ...event(), measurement_mode: 'essential' };
  queue.enqueue(active); queue.enqueue(optional); queue.enqueue(essential);
  queue.removeWhere(item => item.measurement_mode === 'analytics');
  release(); await queue.flush();
  assert.deepEqual(sent, [active.sdk_event_id, essential.sdk_event_id]);
  queue.shutdown();
});

test('initial disabled mode deletes restored optional events', async () => {
  const data = storage();
  const api = new ApiClient(buildConfiguration({ apiKey: 'restore' }));
  const item = event();
  data.set(`${api.storageKey('analytics_events')}:${item.sdk_event_id}`, JSON.stringify(item));
  let sent = 0;
  api.recordAnalyticsEvent = async () => { sent++; };
  const tracker = new AnalyticsEventTracker(api, silentLogger, new MeasurementState('disabled'));
  await tracker.flush();
  assert.equal(sent, 0);
  assert.equal([...data.keys()].some(key => key.includes('analytics_events')), false);
  tracker.shutdown(); api.shutdown();
});

test('identity refresh preserves event identity and rejects missing providers', async () => {
  storage();
  const identityRequests = [], requests = [];
  const api = new ApiClient(buildConfiguration({ apiKey: 'identity', identityTokenProvider: async input => {
    identityRequests.push(input); return input.forceRefresh ? 'fresh-token' : 'expired-token';
  } }));
  globalThis.fetch = async (_url, init) => {
    requests.push(init);
    return requests.length === 1 ? new Response('{}', { status: 401 }) : response({});
  };
  const item = { ...event(), app_user_id: 'user', sdk_install_id: api.installId };
  await api.trackAttributionEvent(item);
  assert.equal(identityRequests.length, 2);
  assert.equal(identityRequests[1].forceRefresh, true);
  assert.equal(identityRequests[0].eventId, item.sdk_event_id);
  assert.equal(identityRequests[1].eventId, item.sdk_event_id);
  assert.equal(new Headers(requests[1].headers).get('x-growthcat-identity'), 'fresh-token');
  const missing = new ApiClient(buildConfiguration({ apiKey: 'missing' }));
  await assert.rejects(missing.fetchRewards('user'), /identityTokenProvider/);
  assert.equal(requests.length, 2);
  missing.shutdown(); api.shutdown();
});

test('client identity is isolated across workspace and retained by old instances', () => {
  storage();
  const a = new ApiClient(buildConfiguration({ apiKey: 'same', workspace: 'sandbox' }));
  const b = new ApiClient(buildConfiguration({ apiKey: 'same', workspace: 'live' }));
  const again = new ApiClient(buildConfiguration({ apiKey: 'same', workspace: 'sandbox' }));
  assert.notEqual(a.installId, b.installId);
  assert.equal(a.installId, again.installId);
  assert.notEqual(a.storageKey('analytics_events'), b.storageKey('analytics_events'));
});

test('essential ad events omit session and locale-derived country; disabled sponsor sends nothing', async () => {
  storage();
  const events = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/sdk/config')) return response(bootstrap);
    events.push(JSON.parse(init.body)); return response({ accepted: 1 });
  };
  GrowthCat.initialize({ apiKey: 'privacy', measurementMode: 'essential' });
  await GrowthCat.ready();
  GrowthCat.shared.trackAdEvent('click', { campaign: { id: randomUUID() }, creative: { id: randomUUID() }, tracking: { token: 'signed' } }, { format: 'banner', sessionId: 'private-session', appUserId: 'private-user' });
  await GrowthCat.shared.flushEvents();
  assert.equal(events[0].schema_version, 2);
  assert.equal('session_id' in events[0].events[0], false);
  assert.equal('country_code' in events[0].events[0], false);
  assert.equal('app_user_id' in events[0].events[0], false);
  GrowthCat.setMeasurementMode('disabled');
  await GrowthCat.shared.trackSponsorEvent('uncached', 'click');
  assert.equal(events.length, 1);
  GrowthCat.shutdown();
});

test('funnel entry points share a session, validation requires identity', async () => {
  storage();
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/sdk/config')) return response(bootstrap);
    requests.push(JSON.parse(init.body));
    if (String(url).endsWith('/validate')) return response({ is_valid: true, normalized_code: 'CODE', campaign: { id: 'campaign' } });
    return response({});
  };
  GrowthCat.initialize({ apiKey: 'funnel', measurementMode: 'analytics' });
  await GrowthCat.ready();
  await assert.rejects(GrowthCat.shared.validateReferralCode('CODE'), { code: 'missing_app_user_id' });
  GrowthCat.setAppUserId('user');
  await GrowthCat.shared.recordReferralClick('CODE');
  await GrowthCat.shared.validateReferralCode('CODE');
  await GrowthCat.shared.recordAnalyticsEvent('paywall_viewed');
  await GrowthCat.shared.flushEvents();
  assert.equal(new Set(requests.map(item => item.session_id)).size, 1);
  GrowthCat.shutdown();
});

test('feedback pages retain cursor/filter and encode path identifiers', async () => {
  storage();
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return response({ data: { items: [] }, pagination: { next_cursor: 'next-page' } });
  };
  const api = new ApiClient(buildConfiguration({ apiKey: 'feedback' }));
  const page = await api.fetchFeedbackPage('board/name', { type: 'bug', cursor: 'cursor+value', limit: 10 });
  assert.equal(page.nextCursor, 'next-page');
  const url = new URL(urls[0]);
  assert.match(url.pathname, /board%2Fname/);
  assert.equal(url.searchParams.get('cursor'), 'cursor+value');
  assert.equal(url.searchParams.get('type'), 'bug');
  api.shutdown();
});

test('CommonJS hooks use the same initialized client as core', async () => {
  storage();
  const React = require('react');
  const { create, act } = require('react-test-renderer');
  const core = require('../dist/index.js');
  const { useAd } = require('../dist/react/index.js');
  globalThis.fetch = async url => response(String(url).endsWith('/sdk/config') ? bootstrap : { ads: [] });
  let result, root;
  function Consumer() { result = useAd({ format: 'banner' }); return null; }
  core.GrowthCat.initialize({ apiKey: 'cjs' }); await core.GrowthCat.ready();
  await act(async () => { root = create(React.createElement(Consumer)); });
  assert.equal(result.state, 'no_fill'); assert.equal(result.error, null);
  await act(async () => root.unmount()); core.GrowthCat.shutdown();
});

test('retries preserve event identity when browser storage is unavailable', async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  const now = Date.now;
  let attempts = 0;
  const ids = [], states = [];
  const queue = new EventQueue({ key: 'memory', maxEvents: 10, valid: isQueuedEvent, allowed: () => true,
    send: async item => { ids.push(item.sdk_event_id); if (++attempts === 1) throw new Error('offline'); },
    notify: item => states.push(item.state),
  });
  try {
    const item = event(); queue.enqueue(item); await queue.flush();
    Date.now = () => now() + 10000;
    await queue.flush();
    assert.deepEqual(ids, [item.sdk_event_id, item.sdk_event_id]);
    assert.deepEqual(states, ['queued', 'delivered']);
  } finally { Date.now = now; queue.shutdown(); storage(); }
});

test('protocol errors fail closed and debug logs redact response and query values', async () => {
  storage();
  const logs = [], previousLog = console.log;
  console.log = (...args) => logs.push(JSON.stringify(args));
  const api = new ApiClient(buildConfiguration({ apiKey: 'private-key', logsEnabled: true, identityTokenProvider: async () => 'private-token' }));
  globalThis.fetch = async () => response({ reward_validated: 'false', secret: 'private-response' });
  try {
    await assert.rejects(api.validateAdReward({ app_user_id: 'private-user', sdk_event_id: randomUUID() }), /Invalid reward_validated/);
    globalThis.fetch = async () => response({ rewards: [], secret: 'private-response' });
    await api.fetchRewards('private-user');
    assert.equal(logs.join('').includes('private-user'), false);
    assert.equal(logs.join('').includes('private-response'), false);
    assert.equal(logs.join('').includes('private-token'), false);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'app_setup_incomplete', message: 'App setup is incomplete.', requirements: { revenuecat_secret_api_key_configured: true, revenuecat_webhook_configured: false } }), { status: 409 });
    await assert.rejects(api.validateCode({ code: 'CODE', app_user_id: 'user' }), error => error.code === 'app_setup_incomplete' && error.requirements.revenueCatSecretApiKeyConfigured === true);
  } finally { api.shutdown(); console.log = previousLog; }
});
