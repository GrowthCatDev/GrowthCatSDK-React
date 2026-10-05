# Paid-ad website arrivals

Use a GrowthCat acquisition campaign with destination type `web` and a website
URL. The dashboard's generated link is the URL to place in Meta, TikTok or
another ad. GrowthCat redirects to the website with a `gc_token` query
parameter. The backend resolves that token to the campaign; UTM labels alone
never establish attribution.

The Web SDK records a **website arrival**, not a mobile install. The backend
reports web arrivals separately from installs. Source labels do not imply a
native Meta/TikTok reporting connector or advertising conversion API.

## Capture when the website appears

Initialize GrowthCat once in a browser-safe bootstrap. Set analytics mode only
after consent or another valid legal basis, and configure the signed identity
provider described in [friend referrals](friend-referrals.md).

```ts
GrowthCat.initialize({
  apiKey: publicSdkKey,
  workspace: "live",
  measurementMode: hasAnalyticsConsent ? "analytics" : "essential",
  identityTokenProvider,
  captureWebAttributionOnLoad: true,
});
if (user) GrowthCat.setAppUserId(user.id);
```

Alternatively, capture explicitly on page appearance:

```ts
await GrowthCat.shared.captureWebArrival(window.location.href);
const state = GrowthCat.shared.webArrival;
// kind: "web_arrival"; status: awaiting_identity / claiming / attributed / failed
const unsubscribe = GrowthCat.shared.subscribeWebArrival(renderArrival);
```

React integrations can mount `useWebAttribution()` from `@growthcat/web/react`.
The hook captures the current URL on mount and subscribes to updates. Use
`{ enabled: false }` to defer capturing or `{ url }` for an explicit page URL.
It needs the initialized singleton, not a React provider. Repeated captures of
the same token and current user share one request/result within the client.

## Before login and through sign-in

A claim requires a server-signed app-user identity. If no user exists, capture
keeps the trusted token pending and reports `awaiting_identity`, without
pretending the backend has already recorded a user attribution. The SDK
resumes automatically when `setAppUserId` receives the signed-in identity.

After analytics consent, only the token and its seven-day expiry are stored in
scoped `sessionStorage`; this survives same-origin sign-in navigation. Storage
is scoped to SDK project/workspace. Without browser storage the pending token
is kept in memory. Cross-origin authentication must return to the same browser
session/origin to recover it. This automatic recovery applies to an unclaimed
arrival awaiting its first identity.

If measuring before registration is required, your server may issue a unique
signed anonymous visitor identity. A successful visitor claim consumes the
pending token. Transitioning that visitor to a signed-in account clears SDK
arrival state; it does **not** automatically transfer the claimed campaign.
The host must retain the original campaign token through its authorized sign-in
flow and explicitly capture a URL containing that token for the authenticated
identity. Retain only the token, after consent, rather than a full landing URL
or unrelated query parameters:

```ts
// originalCampaignToken was retained by the host from the original gc_token.
GrowthCat.setAppUserId(authenticatedUser.id);
const campaignUrl = new URL(window.location.origin);
campaignUrl.searchParams.set("gc_token", originalCampaignToken);
await GrowthCat.shared.captureWebArrival(campaignUrl.toString());
```

The stable SDK installation ID lets the backend deduplicate the attribution
meter while binding the resulting campaign to the account. Never use the
string `anonymous` as a shared identity for every visitor.

No token is persisted or claimed while mode is `essential` or `disabled`.
Consent revocation removes the pending token and invalidates in-flight state.
With automatic/current-page capture, granting analytics consent can retry an
arrival still present in the page URL; custom URLs should be recaptured after
consent. Do not store a full landing URL or sensitive query parameters.
Sign-out and account switches clear arrival state and referral state, preventing
one user's benefits from appearing for another user.

Failed claims remain retryable with `captureWebArrival()`. Server validation
is authoritative; invalid tokens, network failures and missing signed identity
must not create a locally fabricated campaign or reward. All claims send
`platform: "web"`, plus `growthcat_platform: "web"` metadata for compatibility.

## Campaign landing pages

```ts
const campaign = await GrowthCat.acquisition({ slug: generatedSlug });
// campaign.destinationType: "web" | "app_store"
// campaign.targetUrl: backend-configured website/App Store URL
await campaign.trackLandingView();
await campaign.openDestination();
```

`openDestination()` emits `web_click` for websites or `app_store_click` for
App Store campaigns and navigates immediately with best-effort delivery.
`openAppStore()` remains supported for App Store campaigns and rejects if a
website campaign has no Apple URL. `useAcquisitionCampaign` also exposes
`openDestination`. Optional landing/click analytics require analytics consent.
Don't build `gc_token`, campaign join keys or Apple campaign tokens locally.
