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
