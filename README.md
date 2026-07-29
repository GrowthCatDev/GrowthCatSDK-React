# GrowthCat Web SDK

GrowthCat is a TypeScript/React SDK for referral-code redemption, in-app ads, sponsorships, attribution, and user feedback on the web.

**Core capabilities:**
- **Referral Redemption** — validate promo/referral codes with full funnel analytics.
- **Ads** — fetch, cache, and track ads across banner and interstitial formats.
- **Custom Ad Rendering** — get the raw `AdObject` via `useAd()` and build your own design with full freedom.
- **Sponsorships** — fetch live sponsor creative or availability data, use the built-in banner, or render a completely custom design with qualified event tracking.
- **Attribution** — generate share links, resolve deferred attribution, confirm tokens, and track events.
- **Feedback** — let users submit ideas, bugs, and feedback; vote on public items; stay anonymous or identify.

---

## Table of Contents

1. [Installation](#installation)
2. [Initialization](#initialization)
3. [Referral Redemption](#referral-redemption)
   - [Built-in form](#option-a-built-in-form)
   - [useReferral hook](#option-b-usereferral-hook-custom-ui)
   - [Headless API](#option-c-headless-api)
   - [Analytics events](#analytics-events)
4. [Ads](#ads)
   - [How ads work](#how-ads-work)
   - [Ad formats](#ad-formats)
   - [Banner ad](#banner-ad)
   - [Interstitial ad](#interstitial-ad)
   - [Custom ad rendering with useAd()](#custom-ad-rendering-with-usead)
   - [Manual ad loading and event tracking](#manual-ad-loading-and-event-tracking)
   - [Reward validation](#reward-validation)
   - [Offline behavior](#offline-behavior)
   - [Prefetching](#prefetching)
5. [Sponsorships](#sponsorships)
   - [Built-in sponsor banner](#built-in-sponsor-banner)
   - [Custom sponsor design](#custom-sponsor-design)
   - [Headless sponsor API](#headless-sponsor-api)
   - [Sponsor response states](#sponsor-response-states)
6. [Attribution](#attribution)
7. [Feedback](#feedback)
8. [Error Handling](#error-handling)
9. [SDK Config Flags](#sdk-config-flags)
10. [Full API Reference](#full-api-reference)
    - [Core package exports](#core-package-exports)
    - [GrowthCat namespace](#growthcat-namespace)
    - [GrowthCatClient](#growthcatclient)
    - [React hooks](#react-hooks)
    - [React components](#react-components)
    - [Exported TypeScript types](#exported-typescript-types)

---

## Installation

```bash
npm install @growthcat/web
# or
yarn add @growthcat/web
```

React components and hooks are in the `/react` subpath (React is a peer dependency):

```bash
npm install @growthcat/web react react-dom
```

### Install the integration skill

This repository includes an agent skill that can inspect an existing web app,
read the SDK documentation and installed type declarations, and implement
feedback, ads, sponsorships, referrals, or attribution using the app's existing
architecture.

From a local checkout:

```bash
npx skills add . --skill growthcat-web-integration
```

For a remote install, replace `.` with this repository's Git URL. You can also
copy `skills/growthcat-web-integration` into your agent's skills directory.
Then ask your agent, for example:

```text
Use $growthcat-web-integration to add a feedback board to my settings page.
```

---

## Initialization

Call `GrowthCat.initialize()` **once**, as early as possible — ideally in your root `App` component or `main.tsx`.

```ts
import { GrowthCat } from "@growthcat/web";

GrowthCat.initialize({
  apiKey: "gc_live_your_key_here",
  workspace: "live",
  logsEnabled: process.env.NODE_ENV !== "production",
  measurementMode: "essential",
});

// Optional: await this before reading bootstrap flags immediately.
await GrowthCat.ready();
```

### What happens on initialize

1. The SDK stores your API key and resolves the workspace (`sandbox` or `live`).
2. A background task calls `GET /v1/sdk/config` to fetch the bootstrap:
   - Feature flags (`showCodeRedeemUI`, `allowCodeRedeemExecution`)
   - Ads configuration (`ads_enabled`, cache TTL)
3. The **AdService** is configured with the returned ads settings.
4. Calls that require bootstrap data share the same in-flight request automatically.

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | required | Your GrowthCat SDK key from the dashboard. |
| `workspace` | `"sandbox" \| "live"` | inferred | Explicit backend workspace. Recommended for production configuration. |
| `environmentMode` | `"automatic" \| "production"` | `"automatic"` | Backward-compatible workspace option. `"production"` selects live; automatic infers `gc_live_` keys. |
| `logsEnabled` | `boolean` | `false` | Emits debug logs to the console. |
| `baseUrl` | `string?` | `https://api.growthcat.dev` | Override backend URL for QA environments. |
| `measurementMode` | `"essential" \| "analytics" \| "disabled"` | `"essential"` | Privacy mode. Use `analytics` only after the host establishes consent or another valid legal basis. |
| `requestTimeoutMs` | `number` | `15000` | Maximum duration of one SDK HTTP request. |

Apply consent changes immediately at runtime:

```ts
GrowthCat.setMeasurementMode("analytics");

// Revocation clears queued optional events and rotates the analytics session.
GrowthCat.setMeasurementMode("essential");
```

`essential` keeps aggregate ad delivery, reward validation, fraud prevention, and operational measurement, but omits the app user ID from ordinary ad events. `disabled` does not enqueue measurement events.

### Handle attribution on page load

If your site receives GrowthCat attribution links, call this right after `initialize`:

```ts
GrowthCat.initialize({ apiKey: "...", workspace: "live" });
GrowthCat.setAppUserId(currentUser.id);
const assignment = await GrowthCat.handleCurrentUrl();
// `assignment?.deepLinkValue` can now be routed safely.
```

---

## Referral Redemption

### Option A: Built-in form

Drop in `<GrowthCatReferralForm>` and attach a success callback:

```tsx
import { GrowthCatReferralForm } from "@growthcat/web/react";

function SettingsPage() {
  return (
    <GrowthCatReferralForm
      onSuccess={(result) => {
        console.log("Applied:", result.normalizedCode);
        // Unlock access here — this is the safe point.
      }}
      onError={(error) => console.error(error.message)}
      theme={{ accentColor: "#FF6B00" }}
      strings={{ title: "Got a promo code?", buttonText: "Redeem" }}
    />
  );
}
```

### Option B: `useReferral` hook (custom UI)

```tsx
import { useReferral } from "@growthcat/web/react";

function CustomReferralForm() {
  const [code, setCode] = useState("");
  const { isLoading, error, result, validateCode } = useReferral({
    onSuccess: (r) => grantAccess(r.normalizedCode),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); validateCode(code); }}>
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter code" />
      <button disabled={isLoading}>{isLoading ? "Verifying…" : "Apply"}</button>
      {error && <p style={{ color: "red" }}>{error.message}</p>}
      {result && <p>✓ {result.normalizedCode} applied!</p>}
    </form>
  );
}
```

### Option C: Headless API

```ts
const result = await GrowthCat.shared.validateReferralCode("MARCO20");
console.log(result.normalizedCode, result.campaign.name);
```

### Analytics events

Optional referral funnel events are recorded only while `measurementMode` is `"analytics"`.

Track funnel events tied to a code, using the same session across all calls:

```ts
const sessionId = GrowthCat.makeSessionId();
const context = { sessionId, source: "creator_profile" };

// 1. User saw the code link
await GrowthCat.shared.recordReferralClick("MARCO20", context);

// 2. User validated the code
const result = await GrowthCat.shared.validateReferralCode("MARCO20", context);

// 3. User reached the paywall
await GrowthCat.shared.recordAnalyticsEvent("paywall_viewed", {
  code: result.normalizedCode,
  context,
  properties: { paywall_variant: "annual_default" },
});
```

Available event names: `"paywall_viewed"`, `"checkout_started"`, `"checkout_cancelled"`, `"purchase_sdk_completed"`.

---

## Ads

### How ads work

```
initialize()
    └─▶ GET /v1/sdk/config          ← bootstrap: ads_enabled, TTL
           │
           ▼
loadAd({ placementKey })            ← named placement slot
    └─▶ GET /v1/ads/catalog?placement_key=…

— or —

loadAd({ format: "banner" })        ← automatic format selection
    └─▶ GET /v1/ads/serve?format=banner|interstitial
           │
           ├─▶ cache response (TTL from response)
           │
           ▼
render ad with <GrowthCatAdBanner> or your own component (useAd)
    └─▶ POST /v1/ads/events/batch   ← impression, click, video events
           │
           ▼  (rewarded only)
POST /v1/ads/reward/validate        ← server confirms reward
```

### Ad formats

| `AdFormat` | Description | Renders as |
|---|---|---|
| `"banner"` | Fixed-height strip, full width | Inline component |
| `"interstitial"` | Full-screen modal (image, video, rewarded) | Overlay modal |

### Banner ad

```tsx
import { GrowthCatAdBanner } from "@growthcat/web/react";

function HomePage() {
  return (
    <div>
      {/* Your page content */}
      <GrowthCatAdBanner
        placementKey="home_banner"
        appUserId="user_123"
        sessionId={GrowthCat.makeSessionId()}
        minHeight={60}
        onTap={() => console.log("Banner tapped")}
      />
    </div>
  );
}
```

`<GrowthCatAdBanner>` fires an `impression` event automatically once 50%+ of the banner is in the viewport.

You can also use the **format-based** initializer:

```tsx
<GrowthCatAdBanner format="banner" appUserId="user_123" />
```

### Interstitial ad

```tsx
import { GrowthCatAdInterstitial } from "@growthcat/web/react";

function LevelCompleteScreen() {
  const [showAd, setShowAd] = useState(false);

  return (
    <>
      <button onClick={() => setShowAd(true)}>Continue</button>
      <GrowthCatAdInterstitial
        placementKey="level_complete_interstitial"
        appUserId="user_123"
        isOpen={showAd}
        onDismiss={() => setShowAd(false)}
      />
    </>
  );
}
```

For **rewarded** interstitials:

```tsx
<GrowthCatAdInterstitial
  placementKey="rewarded_coins"
  appUserId="user_123"  // REQUIRED for reward attribution
  isOpen={showRewardedAd}
  onDismiss={() => setShowRewardedAd(false)}
  onReward={(response) => {
    // Only called when reward_validated === true from the server.
    addCoins(response.reward?.amount ?? 0);
    setShowRewardedAd(false);
  }}
  onRewardError={(error) => {
    // The modal closes immediately; no reward is granted when validation fails.
    console.error(error.message);
  }}
/>
```

Built-in video interstitials emit start, quartile-progress, and completion events.
Closing the modal never waits for reward validation; `onReward` runs asynchronously
only after the backend confirms the reward.

---

### Custom ad rendering with `useAd()`

`useAd()` is the **core add-on for custom UI**. It gives you the raw `AdObject` — `creative.headline`, `creative.body`, `creative.ctaText`, `creative.publicAssetUrl`, and `creative.layout` — so you can build the banner or interstitial exactly how you want.

The SDK still handles impression/click tracking via the returned `trackEvent` function.

```tsx
import { useAd } from "@growthcat/web/react";

function MyCustomBanner({ placementKey }: { placementKey: string }) {
  const { ad, state, trackEvent } = useAd({ placementKey });

  if (state === "loading") return <div style={{ height: 60 }} />;
  if (!ad) return null;  // no fill

  const { creative } = ad;
  const layout = creative.layout?.banner;  // server-configured layout data

  return (
    <div
      style={{
        background: layout?.backgroundColor ?? "#F0F4FF",
        borderRadius: layout?.borderRadius ?? 12,
        padding: `${layout?.padding?.vertical ?? 12}px ${layout?.padding?.horizontal ?? 16}px`,
        display: "flex",
        alignItems: "center",
        gap: layout?.gap ?? 12,
        cursor: "pointer",
      }}
      onClick={() => {
        trackEvent("click");
        if (creative.destinationUrl) window.open(creative.destinationUrl, "_blank");
      }}
    >
      {/* Your design — full freedom */}
      {creative.publicAssetUrl && (
        <img src={creative.publicAssetUrl} style={{ width: 48, height: 48, borderRadius: 8 }} />
      )}
      <div>
        <strong style={{ color: layout?.title?.color }}>{creative.headline}</strong>
        <p>{creative.body}</p>
      </div>
      <button>{creative.ctaText}</button>
    </div>
  );
}
```

### `useAd()` options

| Option | Type | Description |
|---|---|---|
| `placementKey` | `string` | Named placement key from your dashboard. |
| `format` | `"banner" \| "interstitial"` | Format-based loading via `/v1/ads/serve`. |
| `enabled` | `boolean?` | Set false to defer loading. Defaults to true. |
| `appUserId` | `string?` | Your user identifier — required for rewarded ads. |
| `sessionId` | `string?` | From `GrowthCat.makeSessionId()`. Correlates events. |
| `trackImpression` | `boolean` | Deprecated. Load-time impressions are not viewable impressions; custom renderers must measure visibility before calling `trackEvent`. |
| `onLoad` | `(ad) => void` | Called when an ad loads. |
| `onNoFill` | `() => void` | Called when no ad is available. |
| `onError` | `(error) => void` | Called on load failure. |

### `useAd()` return value

| Field | Type | Description |
|---|---|---|
| `ad` | `AdObject \| null` | The raw ad object — `null` until loaded or when no fill. |
| `state` | `"idle" \| "loading" \| "ready" \| "no_fill" \| "error"` | Load state. |
| `creativeInstanceId` | `string` | Stable ID for this render; regenerated when the ad reloads. |
| `error` | `GrowthCatError \| null` | Error if state is `"error"`. |
| `trackEvent` | `(name, metadata?) => void` | Fire a tracking event for this ad. |
| `reload` | `() => void` | Reload the ad (e.g. after dismissal). |

Custom banner renderers must call `trackEvent("impression", { visible_fraction, visible_duration_ms })` only after the creative remains at least 50% visible for one continuous second. The built-in banner and interstitial components implement this automatically and pause timing while the page is hidden.

### The `AdObject` shape

```ts
interface AdObject {
  placement?: {
    id: string;
    format: "banner" | "interstitial";
    rewardEnabled: boolean;
    rewardName?: string;
    rewardAmount?: number;
    minimumViewSeconds?: number;
    isSkippable: boolean;
    skippableAfterSeconds?: number;
  };
  campaign: {
    id: string;
    mode: string;
    objective: string;
    priorityWeight: number;
  };
  creative: {
    id: string;
    creativeType: string;            // "image" | "video" | "app_store"
    publicAssetUrl?: string;         // Remote URL for the image or video asset
    layout?: AdCreativeLayout;       // Server-configured visual layout data
    headline?: string;               // Ad headline text
    body?: string;                   // Ad body text
    ctaText?: string;                // Call-to-action button label
    destinationType: string;
    destinationUrl?: string;         // Where to send the user on tap
  };
  tracking: {
    allocationId?: string;
    token: string;
  };
  closePolicy?: {
    isSkippable?: boolean;
    skippableAfterSeconds?: number;
    rewardGrantAfterSeconds?: number;
  };
}
```

### `AdCreativeLayout` — the design data

The `creative.layout` object contains server-configured styling so the same ad can look different per placement:

```ts
interface AdCreativeLayout {
  renderVersion?: number;
  background?: {
    type: string;          // "solid" | "gradient"
    color?: string;        // hex for solid
    colors?: string[];     // array for gradient
    direction?: string;    // e.g. "to bottom right"
  };
  banner?: {
    backgroundColor?: string;
    borderRadius?: number;
    padding?: { horizontal?: number; vertical?: number };
    gap?: number;
    adBadge?: { text?: string; backgroundColor?: string; textColor?: string; borderRadius?: number };
    icon?: { size?: number; borderRadius?: number; backgroundColor?: string; borderColor?: string };
    title?: { color?: string; fontWeight?: string; lineLimit?: number };
    ctaButton?: { bgColor?: string; textColor?: string; borderRadius?: number; style?: string };
  };
  overlay?: {             // For interstitial layouts
    layout?: "scrim" | "panel" | "floating" | "cta_only" | "asset_embedded";
    position?: string;
    scrimOpacity?: number;
    scrimColor?: string;
    panelBgColor?: string;
    panelBorderRadius?: number;
    textColor?: string;
    imageFit?: "cover" | "contain" | "fill";
    ctaBottomPadding?: number;
    ctaButton?: { bgColor?: string; textColor?: string; borderRadius?: number };
    title?: { color?: string; size?: string; weight?: string };
  };
  ctaButton?: { bgColor?: string; textColor?: string; borderRadius?: number; style?: string };
}
```

---

### Manual ad loading and event tracking

```ts
// Check if an ad is available before showing a "Watch Ad" button.
const ad = await GrowthCat.shared.loadAd({ placementKey: "rewarded_coins" });
if (ad) showWatchAdButton();

// Fire events manually for a custom renderer.
const creativeInstanceId = GrowthCat.makeCreativeInstanceId();
GrowthCat.shared.trackAdEvent("impression", ad, {
  format: "banner",
  placementKey: "home_banner",
  appUserId: "user_123",
  sessionId,
  creativeInstanceId,
  metadata: { visible_fraction: 0.75, visible_duration_ms: 1250 },
});

GrowthCat.shared.trackAdEvent("click", ad, {
  format: "banner",
  placementKey: "home_banner",
  appUserId: "user_123",
  creativeInstanceId,
});

// Video progress uses allowlisted v2 metadata.
GrowthCat.shared.trackAdEvent("video_progress", ad, {
  format: "interstitial",
  placementKey: "video_placement",
  creativeInstanceId,
  metadata: { quartile: 50, player_position_ms: 15000 },
});
```

Available event names: `"impression"`, `"click"`, `"video_start"`, `"video_progress"`, `"video_complete"`, `"ad_closed"`, `"ad_reported"`.

### Reward validation

```ts
const response = await GrowthCat.shared.validateAdReward(ad, "user_123", {
  sessionId,
  viewedSeconds: 30,
  completed: true,
});

if (response.rewardValidated) {
  grantCoins(response.reward?.amount ?? 0);
}
// Never grant the reward if rewardValidated is false or the call throws.
```

### Offline behavior

| Scenario | What happens |
|---|---|
| Ad catalog fetch fails (offline) | Returns cached entry if TTL has not expired. |
| Event tracking (offline) | Events are persisted to `localStorage` and replayed automatically on reconnect. |
| Reward validation (offline) | The SDK throws — no reward is granted. |
| App comes back online | `window.online` event triggers automatic queue flush. |

### Prefetching

```ts
// Call on route change or page visibility change to warm the cache.
await GrowthCat.shared.prefetchAdCatalogs(["home_banner", "level_interstitial"]);

// Flush events before the page unloads.
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void GrowthCat.shared.flushAdEvents();
  }
});
```

---

## Sponsorships

Configure a sponsor slot in the GrowthCat dashboard, then use its `slotKey` on the site. The SDK can render the slot for you or return the complete SDK-safe payload for your own design.

Every sponsor design must include a clear **Sponsored** disclosure. A qualified impression requires at least 50% continuous visibility for one second.

### Built-in sponsor banner

```tsx
import { GrowthCatSponsorBanner } from "@growthcat/web/react";

function HomePage() {
  return (
    <GrowthCatSponsorBanner
      slotKey="home_sponsor"
      sessionId={GrowthCat.makeSessionId()}
      onTap={() => console.log("Sponsor opened")}
    />
  );
}
```

`<GrowthCatSponsorBanner>` fetches the current slot, renders a live sponsor or an optional booking placeholder, opens its destination, and automatically tracks qualified impressions and clicks. Pass `showAvailability={false}` if open slots should render nothing.

### Custom sponsor design

`useSponsor()` keeps one stable `creativeInstanceId` for the fetched sponsor, which correlates its impression and click and suppresses duplicate billable events.

```tsx
import { useEffect, useRef } from "react";
import { useSponsor } from "@growthcat/web/react";

function CustomSponsor({ slotKey }: { slotKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { sponsor, trackImpression, trackClick } = useSponsor({ slotKey });

  useEffect(() => {
    if (sponsor?.status !== "live" || !ref.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer);
      if (entry.intersectionRatio >= 0.5 && document.visibilityState === "visible") {
        timer = setTimeout(() => {
          void trackImpression(entry.intersectionRatio, 1000);
        }, 1000);
      }
    }, { threshold: 0.5 });
    observer.observe(ref.current);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [sponsor, trackImpression]);

  if (sponsor?.status !== "live" || !sponsor.creative) return null;
  const creative = sponsor.creative;

  return (
    <div ref={ref}>
      <small>Sponsored</small>
      {creative.logoUrl && <img src={creative.logoUrl} alt="" />}
      <strong>{creative.headline ?? creative.sponsorName}</strong>
      <p>{creative.body}</p>
      <button onClick={async () => {
        await trackClick();
        if (creative.clickUrl) window.open(creative.clickUrl, "_blank", "noopener,noreferrer");
      }}>
        {creative.ctaText ?? "Learn more"}
      </button>
    </div>
  );
}
```

The raw creative also includes `customPayload`, booking dates, and signed tracking data. Keep the same `sponsor` object while it is rendered; call `reload()` only when you intentionally want a new creative instance.

### Headless sponsor API

```ts
const sponsor = await GrowthCat.shared.loadSponsorData("home_sponsor");

if (sponsor.status === "live" && sponsor.creative) {
  renderSponsor(sponsor.creative);

  // Call only after measuring at least 50% continuous visibility for 1 second.
  await GrowthCat.shared.trackSponsorImpression(sponsor, {
    visibleFraction: 0.8,
    visibleDurationMs: 1100,
  });

  // Reuse the same object when the user deliberately clicks it.
  await GrowthCat.shared.trackSponsorClick(sponsor);
}
```

`sponsor(slotKey)` remains available when you only need the raw slot response and do not need a stable render identity.

### Sponsor response states

| Status | Meaning | Recommended UI |
|---|---|---|
| `"live"` | A sponsor occupies the current period. | Render `creative` and track qualified events. |
| `"available"` | The slot can be booked. | Optionally render `priceUsd`, `bookingUrl`, and `nextAvailablePeriods`. |
| `"empty"` | No live sponsor and the placeholder is disabled. | Render nothing. |

---

## Attribution

```ts
// Set user ID for attribution.
GrowthCat.setAppUserId("user_123");

// Generate a share link for a campaign.
const link = await GrowthCat.shared.generateShareLink({
  campaignKey: "influencer_spring",
  deepLinkValue: "/welcome",
  metadata: { source: "instagram" },
});
console.log(link.publicUrl);  // Share this URL

// Handle a GrowthCat link when a user opens it.
const assignment = await GrowthCat.shared.handleLink(url);
if (assignment?.deepLinkValue) {
  router.push(assignment.deepLinkValue);
}

// Resolve deferred attribution on first load (fingerprinting).
const result = await GrowthCat.shared.resolveAttribution();
if (result?.matched) {
  console.log("Referred by campaign:", result.campaignKey);
}

// Confirm a token explicitly (e.g., from a URL param).
const token = new URLSearchParams(window.location.search).get("gc_token");
if (token) {
  await GrowthCat.shared.confirmAttribution({ token });
}

// Track a custom event.
await GrowthCat.shared.track("upgrade_clicked", { plan: "annual" });

// Check what rewards the user has earned.
const rewards = await GrowthCat.shared.rewards();
const hasPremium = rewards.containsFeature("premium_access");

// Clear persisted attribution identity during sign-out.
GrowthCat.clearAppUserId();
```

---

## Feedback

```ts
import { GrowthCat } from "@growthcat/web";

// Configure feedback (call once after initialize).
GrowthCat.shared.configureFeedback({
  user: { id: "user_123", email: "jane@example.com", name: "Jane" },
  theme: { accentColor: "#0A84FF" },
  strings: { title: "Share your thoughts" },
});

// The built-in board follows the user's system color scheme by default.
// You can also force a mode or customize separate dark colors.
GrowthCat.shared.configureFeedback({
  theme: {
    mode: "system", // "light" | "dark" | "system"
    accentColor: "#0A84FF",
    buttonTextColor: "#FFFFFF",
    overlayColor: "rgba(0,0,0,0.4)",
    inputBackgroundColor: "#FFFFFF",
    selectedControlBackgroundColor: "rgba(10,132,255,0.1)",
    dark: {
      backgroundColor: "#111113",
      cardColor: "#1C1C1E",
      primaryTextColor: "#F5F5F7",
      secondaryTextColor: "#A1A1AA",
      borderColor: "#2C2C2E",
      overlayColor: "rgba(0,0,0,0.55)",
      inputBackgroundColor: "#111113",
      selectedControlBackgroundColor: "rgba(10,132,255,0.18)",
    },
  },
});

// Submit feedback programmatically.
const result = await GrowthCat.shared.submitFeedback({
  type: "bug",
  title: "Export button crashes",
  body: "When I tap Export from the reports screen the app freezes.",
  metadata: { screen: "reports" },
});

// Fetch the public board.
const items = await GrowthCat.shared.fetchFeedbackBoard("idea");

// Vote and unvote.
await GrowthCat.shared.voteFeedbackItem(items[0].itemId);
await GrowthCat.shared.unvoteFeedbackItem(items[0].itemId);

// Sign out.
GrowthCat.shared.clearFeedbackUser();
```

### Built-in feedback board component

```tsx
import { GrowthCatFeedbackBoard } from "@growthcat/web/react";

function FeedbackPage() {
  return (
    <GrowthCatFeedbackBoard
      defaultType="idea"
      style={{ minHeight: "100vh" }}
    />
  );
}
```

### Custom board with `useFeedbackBoard`

```tsx
import { useFeedbackBoard } from "@growthcat/web/react";

function MyBoard() {
  const { items, isLoading, vote, unvote } = useFeedbackBoard({ autoLoad: true });

  return (
    <ul>
      {items.map((item) => (
        <li key={item.itemId}>
          <button onClick={() => vote(item.itemId)}>▲ {item.voteCount}</button>
          <strong>{item.title}</strong>
        </li>
      ))}
    </ul>
  );
}
```

---

## Error Handling

All async SDK methods throw `GrowthCatError`:

```ts
import { GrowthCatError } from "@growthcat/web";

try {
  await GrowthCat.shared.validateReferralCode("BAD_CODE");
} catch (err) {
  if (err instanceof GrowthCatError) {
    switch (err.code) {
      case "invalid_code":
        showError("That code doesn't exist. Try again.");
        break;
      case "unauthorized":
        console.error("Check your SDK key.");
        break;
      case "rate_limited":
        console.log("Retry after:", err.retryAfter, "seconds");
        break;
      case "network":
        showError("No internet connection.");
        break;
      default:
        showError(err.message);
    }
  }
}
```

### Error codes

| Code | Meaning |
|---|---|
| `not_initialized` | `GrowthCat.initialize()` not called. |
| `missing_app_user_id` | `setAppUserId()` needed for this operation. |
| `invalid_code` | Referral code not found or inactive. |
| `app_setup_incomplete` | Backend configuration is missing. Check `err.requirements`. |
| `unauthorized` | Invalid SDK key. |
| `rate_limited` | 429 response. Check `err.retryAfter`. |
| `network` | No connectivity or fetch failed. |
| `server` | 5xx or unexpected status. Check `err.statusCode`. |
| `unknown` | Unexpected error. |

---

## SDK Config Flags

The bootstrap from `GET /v1/sdk/config` exposes flags you can read:

```ts
const client = GrowthCat.shared;

// Referral flags
if (client.sdkConfig?.showCodeRedeemUI) showRedeemButton();
if (client.sdkConfig?.allowCodeRedeemExecution) allowUserToStart();

// Ads flag
if (client.adsConfig?.adsEnabled) prefetchAds();

// Manually refresh (e.g., after sign-in or page focus).
const config = await GrowthCat.shared.refreshSDKConfig();
```

---

## Full API Reference

The declarations bundled with the installed package remain the source of truth
for its exact version. Import browser/core APIs from `@growthcat/web` and React
APIs from `@growthcat/web/react`.

### Core package exports

```ts
import {
  GrowthCat,
  GrowthCatClient,
  GrowthCatError,
  GROWTHCAT_WEB_SDK_VERSION,
  installId,
  makeSessionId,
  makeCreativeInstanceId,
  sanitizeAnalyticsProperties,
} from "@growthcat/web";
```

| Export | Description |
|---|---|
| `GrowthCat` | Singleton namespace used for normal SDK initialization and access. |
| `GrowthCatClient` | Active client type. Obtain it from `GrowthCat.shared` or `await GrowthCat.ready()`; do not normally construct it yourself. |
| `GrowthCatError` | Typed SDK error with `code`, `statusCode?`, `retryAfter?`, and `requirements?`. |
| `GROWTHCAT_WEB_SDK_VERSION` | Version string compiled into the installed SDK. |
| `installId()` | Returns the project-scoped browser installation ID. Call after initialization so the ID is scoped to the configured GrowthCat project. |
| `makeSessionId()` | Creates a UUID for correlating one app/user flow. |
| `makeCreativeInstanceId()` | Creates a UUID shared by events for one rendered ad or sponsor creative. |
| `sanitizeAnalyticsProperties(name, properties?)` | Removes properties not allowed for that referral-funnel event, drops invalid values, and truncates strings to 255 characters. |

`sanitizeAnalyticsProperties` accepts only the documented fields for each
analytics event:

| Event | Allowed properties |
|---|---|
| `paywall_viewed` | `paywall_variant`, `offering_id`, `placement` |
| `checkout_started` | `product_id`, `package_id`, `offering_id` |
| `checkout_cancelled` | `product_id`, `package_id`, `reason` |
| `purchase_sdk_completed` | `product_id`, `package_id`, `store` |

### GrowthCat namespace

```ts
GrowthCat.version: string
GrowthCat.initialize(options: GrowthCatInitOptions): void
GrowthCat.ready(): Promise<GrowthCatClient>
GrowthCat.shutdown(): void
GrowthCat.isConfigured: boolean
GrowthCat.shared: GrowthCatClient
GrowthCat.makeSessionId(): string
GrowthCat.makeCreativeInstanceId(): string
GrowthCat.setAppUserId(userId: string): void
GrowthCat.clearAppUserId(): void
GrowthCat.setMeasurementMode(mode: GrowthCatMeasurementMode): void
GrowthCat.handleCurrentUrl(): Promise<AttributionAssignment | null>
```

`initialize` is safe to call again: it shuts down the previous client before
creating the replacement. `ready` resolves after the initial bootstrap request
succeeds. `shutdown` stops queues and background work and clears
`GrowthCat.shared`. `handleCurrentUrl` returns `null` during server rendering.

### GrowthCatClient

Use `GrowthCat.shared` after initialization. Access before initialization throws
`GrowthCatError` with code `not_initialized`.

```ts
// Lifecycle and bootstrap
client.isConfigured: boolean
client.isShutdown: boolean
client.sdkConfig: GrowthCatSDKConfig | null
client.sdkBootstrap: GrowthCatSDKBootstrap | null
client.adsConfig: GrowthCatSDKAdsConfig | null
client.measurementMode: GrowthCatMeasurementMode
client.setMeasurementMode(mode: GrowthCatMeasurementMode): void
client.refreshSDKConfig(): Promise<GrowthCatSDKConfig>
client.refreshSDKBootstrap(): Promise<GrowthCatSDKBootstrap>
client.shutdown(): void

// Referral
client.validateReferralCode(
  code: string,
  context?: GrowthCatAnalyticsContext
): Promise<ReferralRedemptionResult>
client.recordReferralClick(
  code: string,
  context?: GrowthCatAnalyticsContext
): Promise<void>
client.recordAnalyticsEvent(
  name: GrowthCatAnalyticsEventName,
  options?: {
    code?: string;
    eventAt?: Date;
    context?: GrowthCatAnalyticsContext;
    properties?: Record<string, GrowthCatAnalyticsValue>;
  }
): Promise<void>

// Ads
client.loadAd(
  options: { placementKey: string } | { format: AdFormat }
): Promise<AdObject | null>
client.trackAdEvent(
  name: AdEventName,
  ad: AdObject,
  options?: AdEventTrackingOptions
): void
client.validateAdReward(
  ad: AdObject,
  appUserId: string,
  options?: {
    sessionId?: string;
    viewedSeconds?: number;
    completed?: boolean;
  }
): Promise<AdRewardValidationResponse>
client.prefetchAdCatalogs(placementKeys: string[]): Promise<void>
client.flushAdEvents(): Promise<void>

// Sponsorships
client.sponsor(slotKey: string): Promise<SponsorSlotContent>
client.loadSponsorData(slotKey: string): Promise<GrowthCatSponsorData>
client.trackSponsorImpression(
  data: GrowthCatSponsorData,
  options: {
    visibleFraction: number;
    visibleDurationMs: number;
    sessionId?: string;
  }
): Promise<boolean>
client.trackSponsorClick(
  data: GrowthCatSponsorData,
  options?: { sessionId?: string }
): Promise<boolean>
client.trackSponsorEvent(
  slotKey: string,
  name: "impression" | "click",
  options?: SponsorEventOptions
): Promise<void>
client.flushSponsorEvents(): Promise<void>

// Attribution
client.setAppUserId(userId: string): void
client.clearAppUserId(): void
client.generateShareLink(options: {
  campaignKey: string;
  deepLinkValue?: string;
  metadata?: Record<string, string>;
}): Promise<AttributionLink>
client.handleLink(url: string): Promise<AttributionAssignment | null>
client.resolveAttribution(
  sessionId?: string
): Promise<AttributionResolveResult | null>
client.confirmAttribution(
  options: AttributionConfirmationOptions
): Promise<AttributionAssignment | null>
// Backward-compatible overload:
client.confirmAttribution(
  token: string,
  sessionId?: string,
  touchpointId?: string
): Promise<AttributionAssignment | null>
client.track(
  eventName: string,
  properties?: Record<string, GrowthCatAnalyticsValue>
): Promise<void>
client.rewards(): Promise<GrowthCatRewards>

// Feedback
client.configureFeedback(options: {
  user?: FeedbackUser;
  theme?: Partial<GrowthCatFeedbackTheme>;
  strings?: (
    Partial<Omit<GrowthCatFeedbackStrings, "typeLabels">> & {
      typeLabels?: Partial<GrowthCatFeedbackStrings["typeLabels"]>;
    }
  );
  disabledAutomaticMetadataKeys?: string[];
}): void
client.identifyFeedbackUser(user: FeedbackUser): void
client.clearFeedbackUser(): void
client.setFeedbackMetadata(metadata: Record<string, string>): void
client.submitFeedback(
  submission: FeedbackSubmission
): Promise<FeedbackSubmitResult>
client.fetchFeedbackBoard(
  type?: FeedbackType
): Promise<FeedbackBoardItem[]>
client.voteFeedbackItem(itemId: string): Promise<FeedbackVoteResult>
client.unvoteFeedbackItem(itemId: string): Promise<FeedbackVoteResult>
client.feedbackAnonymousId: string
client.feedbackTheme: GrowthCatFeedbackTheme
client.feedbackStrings: GrowthCatFeedbackStrings
```

`loadSponsorData` plus the qualified tracking methods is the preferred headless
sponsor flow because it preserves one creative identity. `trackSponsorEvent` is
the simpler best-effort API for the currently live slot.

The client currently exposes `adService`, `attributionService`, and
`feedbackService` as readable low-level service objects. Treat those as advanced
implementation surfaces; prefer the client methods above for stable
integrations.

### React hooks

Import hooks from `@growthcat/web/react`.

```ts
useAd(options: {
  placementKey?: string;
  format?: "banner" | "interstitial";
  enabled?: boolean;
  appUserId?: string;
  sessionId?: string;
  trackImpression?: boolean; // deprecated; use measured visibility
  onLoad?: (ad: AdObject) => void;
  onNoFill?: () => void;
  onError?: (error: GrowthCatError) => void;
}): {
  ad: AdObject | null;
  state: "idle" | "loading" | "ready" | "no_fill" | "error";
  error: GrowthCatError | null;
  creativeInstanceId: string;
  trackEvent(
    name: AdEventName,
    metadata?: Partial<AdEventMetadata>
  ): void;
  reload(): Promise<void>;
}

useSponsor(options: {
  slotKey: string;
  sessionId?: string;
  onLoad?: (sponsor: GrowthCatSponsorData) => void;
  onError?: (error: GrowthCatError) => void;
}): {
  sponsor: GrowthCatSponsorData | null;
  state: "idle" | "loading" | "ready" | "error";
  error: GrowthCatError | null;
  trackImpression(
    visibleFraction: number,
    visibleDurationMs: number
  ): Promise<boolean>;
  trackClick(): Promise<boolean>;
  reload(): Promise<void>;
}

useReferral(options?: {
  context?: GrowthCatAnalyticsContext;
  onSuccess?: (result: ReferralRedemptionResult) => void;
  onError?: (error: GrowthCatError) => void;
}): {
  isLoading: boolean;
  result: ReferralRedemptionResult | null;
  error: GrowthCatError | null;
  validateCode(code: string): Promise<ReferralRedemptionResult | null>;
  recordClick(code: string): Promise<void>;
  reset(): void;
}

useFeedbackBoard(options?: {
  type?: FeedbackType;
  autoLoad?: boolean;
}): {
  items: FeedbackBoardItem[];
  isLoading: boolean;
  error: GrowthCatError | null;
  reload(): void;
  vote(itemId: string): Promise<FeedbackVoteResult | null>;
  unvote(itemId: string): Promise<FeedbackVoteResult | null>;
}

useFeedbackSubmit(): {
  isSubmitting: boolean;
  result: FeedbackSubmitResult | null;
  error: GrowthCatError | null;
  submit(
    submission: FeedbackSubmission
  ): Promise<FeedbackSubmitResult | null>;
  reset(): void;
}
```

The deprecated `useAd({ trackImpression })` option remains in the type
declarations for compatibility but does not produce a qualified viewable
impression. Custom renderers must measure visibility and call `trackEvent`.

### React components

All components accept the props shown below and are imported from
`@growthcat/web/react`.

```ts
interface GrowthCatAdBannerProps {
  placementKey?: string;
  format?: "banner" | "interstitial";
  appUserId?: string;
  sessionId?: string;
  minHeight?: number; // default 60
  className?: string;
  style?: React.CSSProperties;
  onTap?: () => void;
  hideOnNoFill?: boolean; // default true
}

interface GrowthCatAdInterstitialProps {
  placementKey?: string;
  format?: "banner" | "interstitial";
  appUserId?: string;
  sessionId?: string;
  isOpen: boolean;
  onDismiss: () => void;
  onReward?: (response: AdRewardValidationResponse) => void;
  onRewardError?: (error: GrowthCatError) => void;
  onLoad?: (ad: AdObject) => void;
  onNoFill?: () => void;
  onError?: (error: GrowthCatError) => void;
}

interface GrowthCatSponsorBannerProps {
  slotKey: string;
  sessionId?: string;
  minHeight?: number;
  className?: string;
  style?: React.CSSProperties;
  showAvailability?: boolean; // default true
  onTap?: () => void;
}

interface GrowthCatReferralFormProps {
  strings?: {
    title?: string;
    description?: string;
    placeholder?: string;
    buttonText?: string;
    buttonLoadingText?: string;
    successMessage?: string;
  };
  theme?: {
    accentColor?: string;
    textColor?: string;
    backgroundColor?: string;
    borderColor?: string;
    borderRadius?: number;
  };
  context?: GrowthCatAnalyticsContext;
  onSuccess?: (result: ReferralRedemptionResult) => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: React.CSSProperties;
}

interface GrowthCatFeedbackBoardProps {
  defaultType?: FeedbackType;
  className?: string;
  style?: React.CSSProperties;
}
```

### Exported TypeScript types

The core package exports these public types for custom integrations:

- **Configuration:** `GrowthCatInitOptions`, `GrowthCatEnvironmentMode`,
  `GrowthCatWorkspace`, `GrowthCatMeasurementMode`
- **Bootstrap:** `GrowthCatSDKBootstrap`, `GrowthCatSDKConfig`,
  `GrowthCatSDKReadiness`, `GrowthCatSDKReadinessChecks`,
  `GrowthCatSDKAdsConfig`
- **Errors:** `GrowthCatErrorCode`, `AppSetupRequirements`
- **Referrals and analytics:** `GrowthCatAnalyticsContext`,
  `GrowthCatAnalyticsEventName`, `GrowthCatAnalyticsValue`,
  `ReferralRedemptionResult`, `CampaignResponse`
- **Ads:** `AdFormat`, `AdObject`, `AdPlacement`, `AdCampaign`, `AdCreative`,
  `AdCreativeLayout`, `AdCreativeLayoutBackground`, `AdCreativeLayoutBanner`,
  `AdCreativeLayoutOverlay`, `AdCreativeLayoutCTAButtonStyle`, `AdTracking`,
  `AdClosePolicy`, `AdEventName`, `AdReward`, `AdRewardValidationResponse`,
  `AdEventMetadata`, `AdEventTrackingOptions`
- **Sponsorships:** `SponsorSlotContent`, `GrowthCatSponsorData`,
  `SponsorSlotStatus`, `SponsorCreative`, `SponsorPeriod`, `SponsorEventName`,
  `SponsorEventOptions`
- **Attribution:** `AttributionMatchType`, `AttributionLink`,
  `AttributionAssignment`, `AttributionConfirmationOptions`,
  `AttributionResolveResult`, `GrowthCatReward`, `GrowthCatRewards`
- **Feedback:** `FeedbackType`, `FeedbackItemStatus`, `FeedbackUser`,
  `FeedbackSubmission`, `FeedbackSubmitResult`, `FeedbackVoteResult`,
  `FeedbackBoardItem`, `GrowthCatFeedbackThemeMode`,
  `GrowthCatFeedbackThemeColors`, `GrowthCatFeedbackTheme`,
  `GrowthCatFeedbackStrings`

The React entry point also exports these named types:

- **Hook options and results:** `UseAdOptions`, `UseAdResult`,
  `UseReferralOptions`, `UseReferralResult`, `UseSponsorOptions`,
  `UseSponsorResult`, `UseFeedbackBoardOptions`, `UseFeedbackBoardResult`,
  `UseFeedbackSubmitResult`
- **Load states:** `AdLoadState`, `SponsorLoadState`
- **Component props:** `GrowthCatAdBannerProps`,
  `GrowthCatAdInterstitialProps`, `GrowthCatSponsorBannerProps`,
  `GrowthCatReferralFormProps`, `GrowthCatFeedbackBoardProps`
- **Referral form customization:** `GrowthCatReferralFormStrings`,
  `GrowthCatReferralFormTheme`

---

## iOS SDK

This package is the web equivalent of the [GrowthCat iOS SDK](https://github.com/your-org/GrowthCatSDK-iOS) (Swift Package).
