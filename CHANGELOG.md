# Changelog

## 0.0.7 — 2026-10-05

### Added

- Acquisition campaign APIs and React hook for campaign landing pages, website and App Store destinations, and consent-aware landing/click tracking.
- Friend referral programs, progress, stable invite codes, signed enrollment, and unified friend/influencer code entry.
- `GrowthCatFriendReferralPanel`, `GrowthCatReferralCodeForm`, `useFriendReferrals`, and `useReferralCode`, including configurable milestones, reward presentation, and invite copy/share actions.
- Website arrival attribution through `captureWebArrival`, `useWebAttribution`, and optional capture on initialization, with pending token recovery through same-origin sign-in.
- Feedback board pagination, referral reward progress, delivery diagnostics, and expanded reward fulfillment details.

### Improved

- Signed user identity for account operations and reward validation, with one credential refresh on unauthorized responses.
- Consent handling, cross-tab revocation, project-scoped installation identity, durable event queues, and request cancellation on account changes or shutdown.
- Qualified ad/sponsor impressions, creative identity tracking, safe destination URLs, and server-approved reward delivery.
- Feedback personalization and account-switch handling, React request lifecycle safety, and runtime/package version alignment.
- Browser contract coverage in Chromium, Firefox, and WebKit, and SDK integration documentation.

### Upgrade notes

- Identified feedback reads and mutations require an authenticated server-issued `identityTokenProvider`. Deploy with the backend signed-feedback identity update; older unsigned personalized reads receive HTTP 401. Anonymous browsing remains available.
- Friend referral account operations require signed identity. Existing influencer-only referral APIs remain supported.
- Website attribution and optional analytics require analytics consent. Pending website arrivals resume after sign-in; previously claimed visitor attribution requires the host's explicit authenticated claim flow.
- Reward delivery and subscription access remain authoritative on the backend and subscription provider. See [friend referrals](docs/friend-referrals.md) and [website attribution](docs/web-attribution.md).
