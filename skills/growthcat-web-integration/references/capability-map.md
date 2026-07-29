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
