import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GROWTHCAT_PLAYWRIGHT_MODULE || 'playwright');
const temp = await mkdtemp(path.join(tmpdir(), 'growthcat-browser-'));
const artifacts = process.env.GROWTHCAT_BROWSER_ARTIFACTS || temp;
await mkdir(artifacts, { recursive: true });
await build({ entryPoints: ['tests/browser-fixture.tsx'], bundle: true, format: 'esm', outfile: path.join(temp, 'app.js'), define: { __GROWTHCAT_VERSION__: '"browser-test"' } });
const js = await readFile(path.join(temp, 'app.js'));
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
  if (req.url?.endsWith('.png')) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui} [aria-label="Sponsors"] a{min-height:160px;box-sizing:border-box}</style><div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/?mode=sponsors`);
    await page.getByRole('link', { name: 'Sponsor 0', exact: true }).waitFor();
    await page.waitForTimeout(1300);
    const bookings = await page.evaluate(() => window.testEvents.map(event => event.booking_id));
    assert.ok(bookings.includes('booking-0'));
    assert.equal(bookings.includes('booking-79'), false);
    await page.screenshot({ path: path.join(artifacts, `sponsors-${viewport.width}.png`) });
    await page.goto(`${origin}/?mode=broken`);
    await page.getByText('Broken asset').waitFor();
    await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => window.testEvents.length), 0);
    await page.goto(`${origin}/?mode=feedback`);
    await page.getByText('First page', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Load more' }).click();
    await page.getByText('Second page', { exact: true }).waitFor();
    const compose = page.getByRole('button', { name: 'Send Feedback', exact: true });
    await compose.click();
    await page.getByRole('textbox', { name: 'Summary' }).fill('Test feedback');
    await page.keyboard.press('Escape');
    assert.equal(await compose.evaluate(el => el === document.activeElement), true);
    await page.goto(`${origin}/?mode=referral`);
    await page.getByRole('textbox', { name: 'Enter code here' }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Browser checks passed at mobile and desktop sizes: per-tile visibility, unloaded media, pagination, labels, focus restoration.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
