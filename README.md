# GrowthCat Web SDK

GrowthCat is a TypeScript/React SDK for referral-code redemption, in-app ads, attribution, and user feedback on the web.

**Core capabilities:**
- **Referral Redemption** — validate promo/referral codes with full funnel analytics.
- **Ads** — fetch, cache, and track ads across banner and interstitial formats.
- **Custom Ad Rendering** — get the raw `AdObject` via `useAd()` and build your own design with full freedom.
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
5. [Attribution](#attribution)
6. [Feedback](#feedback)
7. [Error Handling](#error-handling)
8. [SDK Config Flags](#sdk-config-flags)
9. [Full API Reference](#full-api-reference)

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

---

## Initialization

Call `GrowthCat.initialize()` **once**, as early as possible — ideally in your root `App` component or `main.tsx`.

```ts
import { GrowthCat } from "@growthcat/web";

GrowthCat.initialize({
  apiKey: "gc_live_your_key_here",
  logsEnabled: process.env.NODE_ENV !== "production",
});
```

### What happens on initialize

1. The SDK stores your API key and resolves the workspace (`sandbox` or `live`).
2. A background task calls `GET /v1/sdk/config` to fetch the bootstrap:
   - Feature flags (`showCodeRedeemUI`, `allowCodeRedeemExecution`)
   - Ads configuration (`ads_enabled`, cache TTL)
3. The **AdService** is configured with the returned ads settings.
4. All subsequent calls to `GrowthCat.shared` are ready.

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | required | Your GrowthCat SDK key from the dashboard. |
| `environmentMode` | `"automatic" \| "production"` | `"automatic"` | Controls the workspace header (`sandbox` vs `live`). |
| `logsEnabled` | `boolean` | `false` | Emits debug logs to the console. |
| `baseUrl` | `string?` | `https://api.growthcat.dev` | Override backend URL for QA environments. |

### Handle attribution on page load

If your site receives GrowthCat attribution links, call this right after `initialize`:

```ts
GrowthCat.initialize({ apiKey: "..." });
GrowthCat.handleCurrentUrl(); // reads window.location.href and claims any gc_token
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
/>
```

---

## Custom ad rendering with `useAd()`

`useAd()` is the **core add-on for custom UI**. It gives you the raw `AdObject` — `creative.headline`, `creative.body`, `creative.ctaText`, `creative.publicAssetUrl`, and `creative.layout` — so you can build the banner or interstitial exactly how you want.

The SDK still handles impression/click tracking via the returned `trackEvent` function.

```tsx
import { useAd } from "@growthcat/web/react";

function MyCustomBanner({ placementKey }: { placementKey: string }) {
  const { ad, state, trackEvent } = useAd({
    placementKey,
    trackImpression: true,  // auto-fires impression when state becomes "ready"
  });

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
| `appUserId` | `string?` | Your user identifier — required for rewarded ads. |
| `sessionId` | `string?` | From `GrowthCat.makeSessionId()`. Correlates events. |
| `trackImpression` | `boolean` | Auto-fire impression when state becomes `"ready"`. Default `true`. |
| `onLoad` | `(ad) => void` | Called when an ad loads. |
| `onNoFill` | `() => void` | Called when no ad is available. |
| `onError` | `(error) => void` | Called on load failure. |

### `useAd()` return value

| Field | Type | Description |
|---|---|---|
| `ad` | `AdObject \| null` | The raw ad object — `null` until loaded or when no fill. |
| `state` | `"idle" \| "loading" \| "ready" \| "no_fill" \| "error"` | Load state. |
| `error` | `GrowthCatError \| null` | Error if state is `"error"`. |
| `trackEvent` | `(name, metadata?) => void` | Fire a tracking event for this ad. |
| `reload` | `() => void` | Reload the ad (e.g. after dismissal). |

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
GrowthCat.shared.trackAdEvent("impression", ad, {
  format: "banner",
  placementKey: "home_banner",
  appUserId: "user_123",
  sessionId,
});

GrowthCat.shared.trackAdEvent("click", ad, {
  format: "banner",
  placementKey: "home_banner",
  appUserId: "user_123",
});

// Video progress (pass progress_pct in metadata).
GrowthCat.shared.trackAdEvent("video_progress", ad, {
  format: "interstitial",
  placementKey: "video_placement",
  metadata: { progress_pct: "50" },
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
GrowthCat.shared.prefetchAdCatalogs(["home_banner", "level_interstitial"]);

// Flush events before the page unloads.
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void GrowthCat.shared.flushAdEvents();
  }
});
```

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
  await GrowthCat.shared.confirmAttribution(token);
}

// Track a custom event.
await GrowthCat.shared.track("upgrade_clicked", { plan: "annual" });

// Check what rewards the user has earned.
const { rewards } = await GrowthCat.shared.rewards();
const hasPremium = rewards.containsFeature("premium_access");
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

### `GrowthCat` namespace

```ts
GrowthCat.initialize(options: GrowthCatInitOptions): void
GrowthCat.isConfigured: boolean
GrowthCat.shared: GrowthCatClient
GrowthCat.makeSessionId(): string
GrowthCat.setAppUserId(userId: string): void
GrowthCat.handleCurrentUrl(): void
```

### `GrowthCatClient`

```ts
// Bootstrap
client.sdkConfig: GrowthCatSDKConfig | null
client.sdkBootstrap: GrowthCatSDKBootstrap | null
client.adsConfig: GrowthCatSDKAdsConfig | null
client.refreshSDKConfig(): Promise<GrowthCatSDKConfig>
client.refreshSDKBootstrap(): Promise<GrowthCatSDKBootstrap>

// Referral
client.validateReferralCode(code, context?): Promise<ReferralRedemptionResult>
client.recordReferralClick(code, context?): Promise<void>
client.recordAnalyticsEvent(name, options?): Promise<void>

// Ads
client.loadAd({ placementKey } | { format }): Promise<AdObject | null>
client.trackAdEvent(name, ad, options): void
client.validateAdReward(ad, appUserId, options?): Promise<AdRewardValidationResponse>
client.prefetchAdCatalogs(placementKeys): void
client.flushAdEvents(): Promise<void>

// Attribution
client.setAppUserId(userId): void
client.generateShareLink(options): Promise<AttributionLink>
client.handleLink(url): Promise<AttributionAssignment | null>
client.resolveAttribution(sessionId?): Promise<AttributionResolveResult | null>
client.confirmAttribution(token, sessionId?): Promise<AttributionAssignment | null>
client.track(eventName, properties?): Promise<void>
client.rewards(): Promise<GrowthCatRewards>

// Feedback
client.configureFeedback(options): void
client.identifyFeedbackUser(user): void
client.clearFeedbackUser(): void
client.setFeedbackMetadata(metadata): void
client.submitFeedback(submission): Promise<FeedbackSubmitResult>
client.fetchFeedbackBoard(type?): Promise<FeedbackBoardItem[]>
client.voteFeedbackItem(itemId): Promise<FeedbackVoteResult>
client.unvoteFeedbackItem(itemId): Promise<FeedbackVoteResult>
client.feedbackAnonymousId: string
```

### React exports (`@growthcat/web/react`)

```ts
// Hooks
useAd(options): UseAdResult
useReferral(options?): UseReferralResult
useFeedbackBoard(options?): UseFeedbackBoardResult
useFeedbackSubmit(): UseFeedbackSubmitResult

// Components
<GrowthCatAdBanner placementKey|format appUserId? sessionId? minHeight? onTap? />
<GrowthCatAdInterstitial placementKey|format appUserId? isOpen onDismiss onReward? />
<GrowthCatReferralForm strings? theme? context? onSuccess? onError? />
<GrowthCatFeedbackBoard defaultType? />
```

---

## iOS SDK

This package is the web equivalent of the [GrowthCat iOS SDK](https://github.com/your-org/GrowthCatSDK-iOS) (Swift Package).
