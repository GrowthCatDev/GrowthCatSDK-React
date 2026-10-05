# GrowthCat Web capability map

Use this only as a routing and fallback reference. Confirm exact signatures
against the installed package declarations.

## Common setup

- Package: `@growthcat/web`
- Core import: `import { GrowthCat } from "@growthcat/web"`
- React import: use `@growthcat/web/react`
- Initialize once with `GrowthCat.initialize({ apiKey, workspace,
  logsEnabled, measurementMode })`.
- Await `GrowthCat.ready()` only when code immediately depends on bootstrap
  flags.
- Set identity with `GrowthCat.setAppUserId(id)` and clear it with
  `GrowthCat.clearAppUserId()`.

## Capability routing

### Feedback

- Standard React board: `GrowthCatFeedbackBoard`
- Custom React board: `useFeedbackBoard`, `useFeedbackSubmit`
- Headless: `configureFeedback`, `submitFeedback`, `fetchFeedbackBoard`,
  `voteFeedbackItem`, `unvoteFeedbackItem`
- Identify with `configureFeedback({ user })` or `identifyFeedbackUser`; clear
  on sign-out.
- Use `configureFeedback` for theme, strings, and shared metadata.

### Ads

- Standard banner: `GrowthCatAdBanner`
- Standard modal/rewarded ad: `GrowthCatAdInterstitial`
- Custom React creative: `useAd`
- Headless: `loadAd`, `trackAdEvent`, `validateAdReward`,
  `prefetchAdCatalogs`, `flushAdEvents`
- Load by dashboard `placementKey` when one exists; format-based loading is the
  fallback.
- Treat `null` or `no_fill` as an expected result.
- Custom banner impressions require at least 50% continuous visibility for one
  second. Built-in components implement qualified tracking.
- Grant rewarded value only from a successfully validated server response.

### Sponsorships

- Standard React slot: `GrowthCatSponsorBanner`
- Custom React slot: `useSponsor`
- Headless: `loadSponsorData`, `trackSponsorImpression`,
  `trackSponsorClick`
- Handle `live`, `available`, and `empty` states.
- Keep a visible `Sponsored` disclosure.
- A qualified custom impression requires at least 50% continuous visibility
  for one second.

### Referrals

- Standard React form: `GrowthCatReferralForm`
- Custom React form: `useReferral`
- Headless: `validateReferralCode`
- Optional funnel tracking: `recordReferralClick`,
  `recordAnalyticsEvent`
- Unlock access only from successful validation, not from the submitted string.

### Acquisition landings

- React: `useAcquisitionCampaign(slug)`.
- Headless: `GrowthCat.acquisition({ slug })` or `GrowthCat.shared.acquisition({ slug })`.
- Render campaign-localized content from the returned config.
- Headless integrations call `trackLandingView()` once when the campaign page is shown; the React hook does this automatically.
- Acquisition events require analytics measurement mode; loading and navigation work without analytics consent.
- Use `openAppStore()` for the App Store CTA; it tracks the click and navigates to the backend-provided Apple URL.
- Never construct `campaign_key`, Apple `ct`, provider token, or Custom Product Page URL in the host.
- The ad-platform campaign name is not the join key; the GrowthCat campaign slug/key is authoritative.

### Attribution

- On link-receiving pages, initialize, set the known app user ID, then use
  `GrowthCat.handleCurrentUrl()` or `GrowthCat.shared.handleLink(url)`.
- Generate links with `generateShareLink`.
- Deferred matching: `resolveAttribution`.
- Explicit tokens: `confirmAttribution`.
- Custom events: `track`; earned values: `rewards`.
- Validate deep-link destinations before routing.

## Errors and configuration

- Async failures use `GrowthCatError`. Preserve actionable handling for
  `not_initialized`, `missing_app_user_id`, `app_setup_incomplete`,
  `unauthorized`, `rate_limited`, `network`, and server failures.
- Bootstrap exposes referral flags and ads configuration through the client.
- A sandbox/live mismatch or missing dashboard placement is a configuration
  issue; do not hide it with hardcoded fallbacks.

## Friend programs and unified referral entry

Core: `GrowthCat.shared.referralPrograms()`, `referralState(programId?)`,
`referralInvite(programId)`, `enrollReferral({ programId, token })`,
`applyReferralCode(code, mode = "both")`.
React: `useReferralCode({ mode })`, `GrowthCatReferralCodeForm`,
`useFriendReferrals(programId?)`, `GrowthCatFriendReferralPanel`.
Modes: `influencers`, `friends`, `both`; classify before any validation or
enrollment effect. Return kinds are `influencer` and `friend` with their typed
payloads. Program/invite availability uses `acceptingNewReferrals` and
`availabilityReason`. Progress and rewards use camelCase public fields and
stable milestone IDs. Keep earned rewards visible at quotas and on paused
programs. Code acceptance does not grant entitlement locally.

Identity: initialize with `identityTokenProvider(request)` returning a signed
server token; set `GrowthCat.setAppUserId(user.id)` on authenticated identity,
clear on sign-out. Provider requests include `appUserId`, `scope` and
`forceRefresh` (one refresh after 401). Never embed a personal account/MCP key
or let the browser select an arbitrary identity for server signing.

## Paid-ad website arrival

Core: `GrowthCat.shared.captureWebArrival(url?)`, `.webArrival`,
`.subscribeWebArrival(listener)`; namespace convenience
`GrowthCat.captureWebArrival(url?)`. Optional initialize setting
`captureWebAttributionOnLoad: true`; default false.
React: `useWebAttribution({ enabled?, url? })`, no provider required.
The host establishes analytics consent before capture persists or claims a
token. Trust `gc_token` returned through a GrowthCat campaign redirect, never
fabricate claims from UTM strings. Unsigned/no-user arrivals remain pending
until identity exists; same-origin `sessionStorage` retains the token for
seven days. Clear identity on account switch. Result kind `web_arrival` is
not a mobile install.

Acquisition config: `destinationType: "app_store" | "web"`, `targetUrl`,
optional `appleUrl`; `openDestination()` picks `web_click` or
`app_store_click`. Existing `openAppStore()` needs a valid Apple URL.

### Reusable referral settings UI

`GrowthCatFriendReferralPanel` supports single, repeating and tiered goals using
server progress. Its `strings` prop accepts `Partial<GrowthCatFriendReferralPanelStrings>`
with dynamic count/benefit/status callbacks; `style`, `className`, and `title` adapt
presentation. Prefer it for standard settings UI; use `useFriendReferrals` for
custom designs, including `isCreatingInvite` request state. Sharing uses the
server-generated link with clipboard/native share and selectable fallback.
Never hardcode thresholds or describe a pending reward as delivered.

For usable delivered rewards, `onSelectOffering(offeringId, reward)` presents a
host paywall and `renderReward(reward)` renders custom-benefit details. The panel
filters simulated, pending and expired rewards before invoking either callback.
Keep provider entitlement verification in the host; an offering selects a paywall.
