---
name: growthcat-web-integration
description: Integrate, configure, debug, or extend the GrowthCat Web SDK in TypeScript, JavaScript, React, Next.js, Vite, and other browser applications. Use for GrowthCat initialization, referral redemption, banner or interstitial ads, rewarded ads, sponsorships, attribution and deep links, feedback boards and submission, identity, privacy measurement modes, custom UI built with GrowthCat hooks, or migration from headless SDK calls to React components.
---

# Integrate GrowthCat Web

Implement the requested GrowthCat capability in the host application using the
API that matches its installed SDK version. Preserve the app's architecture and
visual language; do not create a parallel integration layer without a reason.

## Inspect the host

Run the bundled inspector from the host application's root:

```bash
node <skill-directory>/scripts/inspect-project.mjs .
```

Use its JSON output to identify the package manager, framework, installed
GrowthCat version, documentation, likely entry points, and verification
commands. Inspect the relevant source files before editing. Also check repository
instructions and the current worktree state when available.

## Load the matching documentation

Use documentation in this order:

1. Read the installed package README reported by the inspector.
2. Inspect the installed `dist/*.d.ts` declarations for every API being used.
3. When working in the GrowthCat SDK source repository, read its root `README.md`
   and source types.
4. If the package is not installed yet, read
   [references/capability-map.md](references/capability-map.md), install the
   requested package version, then confirm the code against its declarations.

Treat the installed declarations as authoritative when examples and types
disagree. Do not invent props, hooks, events, or response fields.

## Choose the integration surface

Read the matching section of
[references/capability-map.md](references/capability-map.md), then select the
smallest suitable surface:

- Prefer a built-in React component when the user wants a standard UI quickly.
- Prefer a React hook when the existing UI must be preserved or customized.
- Prefer `GrowthCat.shared` methods in non-React apps, services, or headless
  flows.
- Reuse the app's existing auth, consent, routing, environment, styling,
  telemetry, toast, and error-boundary patterns.

If the user names a capability but not a presentation, infer the least invasive
placement from the existing app. State the assumption in the handoff.

## Implement

1. Install `@growthcat/web` with the detected package manager if it is absent.
   Add React peer dependencies only when the app uses the React entry point and
   does not already provide them.
2. Initialize GrowthCat once in the earliest browser-safe application bootstrap.
   Never initialize during repeated component renders.
3. Read the SDK key from the host's established public environment-variable
   convention. Add an example variable to an existing example-env file when
   present. Never commit a live key or expose a server-secret variable.
4. Set the workspace explicitly when the host distinguishes sandbox from live.
   Keep logs development-only.
5. Connect app identity only when available. Clear GrowthCat identity during the
   existing sign-out flow if identity was connected.
6. Add the requested feature at an existing route or component boundary. Match
   loading, empty, error, and offline states used by the host.
7. Keep browser-only calls out of server rendering. In Next.js or similar
   frameworks, put initialization and React SDK components behind the
   appropriate client boundary.
8. Avoid unrelated refactors.

## Apply safety rules

- Default `measurementMode` to `"essential"` unless the host has already
  established analytics consent or another valid legal basis. Apply consent
  changes through `GrowthCat.setMeasurementMode`.
- For rewarded ads, require an app user ID and grant value only after the server
  reports successful reward validation. Never reward on dismissal, elapsed
  client time, or a locally inferred completion.
- Prefer built-in ad and sponsor components for correct viewability tracking.
  For custom renderers, implement the documented visibility thresholds and reuse
  the same creative object and creative instance across its events.
- Keep a visible `Sponsored` disclosure in custom sponsor UI.
- Treat no-fill ads and empty sponsor slots as normal states, not errors.
- Route attribution deep-link values through the host router and validate them
  as internal destinations before navigation.
- Do not send sensitive or unnecessary personal data in feedback metadata,
  attribution metadata, or analytics properties.

## Verify

Run the most relevant commands reported by the inspector, prioritizing
type-checking and the host's focused tests before broader lint/build commands.
If no automated checks exist, inspect the edited imports and types and provide a
short manual test path.

Before finishing, confirm:

- initialization occurs exactly once;
- imports use `@growthcat/web` for core APIs and `@growthcat/web/react` for React;
- environment variables follow the host framework's browser-exposure rules;
- loading, no-data, error, and sign-out behavior are handled where applicable;
- rewards, viewability, privacy, and sponsored disclosure rules are preserved.

Report the files changed, capability integrated, configuration the user must
provide in GrowthCat, verification performed, and any manual dashboard step
such as creating a placement key or sponsor slot.

## Acquisition landing campaigns

When the host page is a paid-acquisition landing, prefer the SDK acquisition surface instead of hand-writing tracking fetches.

1. Initialize GrowthCat once using the app's public SDK key.
2. Load the backend-generated slug with `GrowthCat.acquisition({ slug })` or `useAcquisitionCampaign(slug)`.
3. Render copy and assets from the returned campaign where the page is campaign-driven.
4. The React hook emits `landing_view` automatically; headless integrations call `trackLandingView()` explicitly. Use `openAppStore()` for the CTA so it starts best-effort click tracking and navigates immediately to the authoritative Apple URL. Acquisition events require `measurementMode: "analytics"` after the host establishes consent or another valid legal basis.
5. Do not construct `campaign_key`, Apple `ct`, provider token, or Custom Product Page parameters in the host app.
6. Meta/ad-platform display names are not join keys. The GrowthCat campaign URL/key is authoritative.
7. Keep an organic/generic fallback when campaign configuration cannot load.

## Friend programs and website arrivals

For friend or combined code entry, read the matching SDK
`docs/friend-referrals.md` and the referral section in the capability map.
Use `applyReferralCode(code, mode)` / `GrowthCatReferralCodeForm` with the
requested `influencers`, `friends` or `both` mode. Existing `useReferral` and
`GrowthCatReferralForm` are influencer-only compatibility surfaces. Render
server milestones and effective availability; preserve earned rewards while
fresh enrollment/sharing is unavailable. Never infer subscription access from
code acceptance or a RevenueCat offering ID.

For ads targeting a website, read `docs/web-attribution.md`. Use a backend web
campaign and its generated destination token, capture on appearance through
`captureWebArrival` or `useWebAttribution`, and configure the signed identity
provider. Keep pending campaign state through sign-in and clear account state
on sign-out. Honor analytics consent before storing or claiming an arrival;
UTM labels alone are not authoritative attribution. Report web arrivals
separately from mobile installs. Use `openDestination` for website/App Store
landing CTAs and preserve `openAppStore` only where an Apple URL exists.

For a standard referral settings center, use `GrowthCatFriendReferralPanel`:
its single/repeat/tier goals follow server rules and its Copy/Share actions use
the generated invitation. Adapt `strings`, `style` and `className` to the host.
Connect `onSelectOffering` to the host paywall and `renderReward` to delivered
custom-benefit UI only when required. These callbacks receive usable delivered
benefits; an offering does not grant a trial or subscription locally.
