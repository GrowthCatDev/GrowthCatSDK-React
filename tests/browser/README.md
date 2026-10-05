# Browser SDK contracts

Use Node 24:

```sh
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run check
BROWSER=chromium npm run test:browser
BROWSER=firefox npm run test:browser
BROWSER=webkit npm run test:browser
```

The runner builds the published CJS/ESM and type outputs, bundles a fixture against `dist` and the package's own React dependency, and owns a loopback server on 3300. No sibling checkout or private temp file is required. The 16 scenarios cover both code types, signed friend enrollment, reward progress, account switching, web-arrival consent and cross-tab revocation, feedback, sponsors, billable ad impressions/clicks, no-fill, and server-approved reward delivery. API responses are deterministic in-browser doubles. Real external providers and actual backend signatures are separate integration responsibilities.

Results are `results-<engine>.json` (ignored generated evidence). Browser page errors fail the run. The workflow installs each engine and runs the same contracts on Chromium, Firefox and WebKit. Add new app UI SDK scenarios to `run.cjs` and response fixtures to `fixture.tsx`.
