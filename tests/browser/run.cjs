const http = require("node:http"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const { chromium, firefox, webkit, expect } = require("@playwright/test");
let activeBrowser;
const dir = __dirname;
require("esbuild").buildSync({
  entryPoints: [dir + "/fixture.tsx"],
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  outfile: dir + "/fixture.js",
});
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/asset.svg")) {
    res.setHeader("Content-Type", "image/svg+xml");
    res.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="blue"/></svg>',
    );
    return;
  }
  const js = req.url.startsWith("/fixture.js");
  const path = dir + (js ? "/fixture.js" : "/index.html");
  if (req.url.startsWith("/broken.png")) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader("Content-Type", js ? "text/javascript" : "text/html");
  res.end(fs.readFileSync(path));
});
(async () => {
  await new Promise((r) => server.listen(3300, "127.0.0.1", r));
  const browser = (activeBrowser = await { chromium, firefox, webkit }[
    process.env.BROWSER || "chromium"
  ].launch({ headless: true }));
  let passed = 0;
  const findings = [];
  const errors = [];
  const scenario = async (
    name,
    fn,
    viewport = { width: 1280, height: 800 },
  ) => {
    const context = await browser.newContext({ viewport });
    await context.route("**/*", (route) =>
      ["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(route.request().url()).hostname,
      )
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    page.on("pageerror", (err) => errors.push({ name, message: err.message }));
    try {
      await fn(page, context);
      console.log("PASS " + name);
      passed++;
    } catch (err) {
      findings.push({ name, error: err.message });
      console.log("FAIL " + name + " " + err.message);
    } finally {
      await context.close();
    }
  };
  const open = async (page, query) => {
    await page.goto("http://127.0.0.1:3300/?" + query);
    await page.waitForFunction(() => window.ready);
  };
  await scenario(
    "combined friend code, signed enrollment, tier progress, earned and expired rewards, invite",
    async (p) => {
      await open(p, "mode=friends");
      await expect(
        p.getByText("3 qualified friends · 4 invited"),
      ).toBeVisible();
      assert.equal(await p.locator("progress").count(), 2);
      assert.equal(
        await p.locator("progress").first().getAttribute("value"),
        "3",
      );
      assert.equal(
        await p.getByRole("link", { name: "Redeem reward" }).count(),
        1,
      );
      await p.getByLabel("Referral code", { exact: true }).fill("FRIEND123");
      await p.getByRole("button", { name: "Apply code" }).click();
      await expect(p.getByRole("status")).toHaveText("Code accepted.");
      const calls = await p.evaluate(() => window.calls);
      assert.equal(
        calls.find((c) => c.path.endsWith("/enroll")).identity,
        "signed:first-user",
      );
      await p.getByRole("button", { name: "Get my invite code" }).click();
      await expect(p.getByText("MYCODE123", { exact: true })).toBeVisible();
    },
  );
  await scenario("single goal follows changed server rules and shows remaining friends", async (p) => {
    await open(p, "mode=friends&goal=single");
    await expect(p.getByRole("progressbar", { name: "Invite 5 friends" })).toHaveAttribute("max", "5");
    await expect(p.getByText("2 more qualifying friends until your next reward")).toBeVisible();
    await p.evaluate(() => { window.goalThreshold = 10; });
    await p.getByRole("button", { name: "Refresh progress" }).click();
    await expect(p.getByRole("progressbar", { name: "Invite 10 friends" })).toHaveAttribute("max", "10");
    await expect(p.getByText("7 more qualifying friends until your next reward")).toBeVisible();
  });
  await scenario("copy and share actions use the generated invite with manual fallback", async (p) => {
    await open(p, "mode=friends");
    await p.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { window.copiedInvite = value; } } });
      Object.defineProperty(navigator, "share", { configurable: true, value: async value => { window.sharedInvite = value; } });
    });
    await p.getByRole("button", { name: "Get my invite code" }).click();
    const link = "https://example.test/invite/MYCODE123";
    await expect(p.getByLabel("Your invite link")).toHaveValue(link);
    await p.getByRole("button", { name: "Copy invite link" }).click();
    await expect(p.getByRole("status")).toHaveText("Invite link copied.");
    assert.equal(await p.evaluate(() => window.copiedInvite), link);
    await p.getByRole("button", { name: "Share invite", exact: true }).click();
    assert.equal(await p.evaluate(() => window.sharedInvite.url), link);
    await p.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); });
    await p.getByRole("button", { name: "Copy invite link" }).click();
    await expect(p.getByRole("status")).toHaveText("Select and copy your invite link below.");
    await expect(p.getByLabel("Your invite link")).toHaveAttribute("readonly", "");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }, { width: 390, height: 844 });
  await scenario("influencer code accepted in combined entry", async (p) => {
    await open(p, "mode=friends");
    await p.getByLabel("Referral code", { exact: true }).fill("INFLUENCER");
    await p.getByRole("button", { name: "Apply code" }).click();
    await expect(p.getByRole("status")).toHaveText("Code accepted.");
    assert.equal(
      await p.evaluate(
        () => window.calls.filter((c) => c.path === "/v1/validate").length,
      ),
      1,
    );
  });
  for (const [types, code] of [
    ["friends", "INFLUENCER"],
    ["influencers", "FRIEND123"],
  ])
    await scenario(
      types + " mode rejects wrong kind before effects",
      async (p) => {
        await open(p, "mode=friends&types=" + types);
        await p.getByLabel("Referral code", { exact: true }).fill(code);
        await p.getByRole("button", { name: "Apply code" }).click();
        await expect(p.getByRole("alert")).toBeVisible();
        assert.equal(
          await p.evaluate(
            () =>
              window.calls.filter(
                (c) => c.path === "/v1/validate" || c.path.endsWith("/enroll"),
              ).length,
          ),
          0,
        );
      },
    );
  await scenario(
    "capacity hides fresh sharing and retains redemption/history",
    async (p) => {
      await open(p, "mode=friends");
      await p.evaluate(() => {
        window.capacity = true;
      });
      await p.getByRole("button", { name: "Refresh progress" }).click();
      await expect(
        p.getByText("New invitations are temporarily unavailable.", {
          exact: false,
        }),
      ).toBeVisible();
      assert.equal(
        await p.getByRole("button", { name: "Get my invite code" }).count(),
        0,
      );
      assert.equal(
        await p.getByRole("link", { name: "Redeem reward" }).count(),
        1,
      );
      await p.getByLabel("Referral code", { exact: true }).fill("FRIEND123");
      await p.getByRole("button", { name: "Apply code" }).click();
      await expect(p.getByRole("alert")).toContainText(
        "earned rewards remain available",
      );
    },
  );
  await scenario(
    "account switch clears successful form and cached invite",
    async (p) => {
      await open(p, "mode=friends");
      await p.getByRole("button", { name: "Get my invite code" }).click();
      await expect(p.getByText("MYCODE123", { exact: true })).toBeVisible();
      await p.getByLabel("Referral code", { exact: true }).fill("FRIEND123");
      await p.getByRole("button", { name: "Apply code" }).click();
      await expect(p.getByRole("status")).toBeVisible();
      await p.evaluate(() => window.GrowthCat.setAppUserId("second-user"));
      await expect(
        p.getByLabel("Referral code", { exact: true }),
      ).toBeVisible();
      assert.equal(await p.getByText("MYCODE123", { exact: true }).count(), 0);
      await p.waitForFunction(() =>
        window.calls.some(
          (c) =>
            c.path.endsWith("/state") && c.identity === "signed:second-user",
        ),
      );
    },
  );
  await scenario(
    "web arrival waits for consent/identity, claims once after sign-in, revocation clears",
    async (p) => {
      await open(p, "mode=web&gc_token=META123");
      await expect(p.getByRole("status")).toHaveText("awaiting_consent:");
      assert.equal(
        await p.evaluate(() => Object.keys(sessionStorage).length),
        0,
      );
      assert.equal(
        await p.evaluate(
          () =>
            window.calls.filter((c) => c.path === "/v1/attribution/claim")
              .length,
        ),
        0,
      );
      await p.evaluate(() => {
        window.GrowthCat.clearAppUserId();
        window.GrowthCat.setMeasurementMode("analytics");
        window.GrowthCat.shared.captureWebArrival();
      });
      await expect(p.getByRole("status")).toHaveText("awaiting_identity:");
      assert.equal(
        await p.evaluate(() => Object.keys(sessionStorage).length),
        1,
      );
      await p.evaluate(() => window.GrowthCat.setAppUserId("signed-user"));
      await expect(p.getByRole("status")).toHaveText("attributed:META123");
      assert.equal(
        await p.evaluate(
          () =>
            window.calls.filter((c) => c.path === "/v1/attribution/claim")
              .length,
        ),
        1,
      );
      await p.evaluate(() => window.GrowthCat.shared.captureWebArrival());
      assert.equal(
        await p.evaluate(
          () =>
            window.calls.filter((c) => c.path === "/v1/attribution/claim")
              .length,
        ),
        1,
      );
      await p.evaluate(() => window.GrowthCat.setMeasurementMode("essential"));
      await expect(p.getByRole("status")).toHaveText("idle:");
      assert.equal(
        await p.evaluate(() => Object.keys(sessionStorage).length),
        0,
      );
    },
  );
  await scenario(
    "cross-tab revocation clears web attribution",
    async (p, context) => {
      await open(p, "mode=web&gc_token=META123");
      await p.evaluate(() => window.GrowthCat.setMeasurementMode("analytics"));
      await expect(p.getByRole("status")).toHaveText("attributed:META123");
      const other = await context.newPage();
      await open(other, "mode=web&gc_token=META123");
      await other.evaluate(() => {
        window.GrowthCat.setMeasurementMode("analytics");
        window.GrowthCat.setMeasurementMode("essential");
      });
      await expect(p.getByRole("status")).toHaveText("idle:");
      assert.equal(
        await p.evaluate(() => window.GrowthCat.shared.measurementMode),
        "essential",
      );
    },
  );
  await scenario(
    "feedback pagination, vote/unvote, escaped content, composer Escape focus",
    async (p) => {
      await open(p, "mode=feedback");
      await expect(p.getByText("First page", { exact: true })).toBeVisible();
      assert.equal(await p.locator("img").count(), 0);
      await p.getByRole("button", { name: "Load more" }).click();
      await expect(p.getByText("Second page", { exact: true })).toBeVisible();
      await p
        .getByRole("button", { name: "Vote for First page", exact: true })
        .click();
      await expect(
        p.getByRole("button", {
          name: "Remove vote for First page",
          exact: true,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await p
        .getByRole("button", {
          name: "Remove vote for First page",
          exact: true,
        })
        .click();
      await expect(
        p.getByRole("button", { name: "Vote for First page", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await p
        .getByRole("button", { name: "Send Feedback", exact: true })
        .click();
      await expect(p.getByRole("dialog")).toBeVisible();
      await p.keyboard.press("Escape");
      await expect(p.getByRole("dialog")).toHaveCount(0);
    },
  );
  await scenario(
    "80 sponsors stay within narrow viewport and unsafe link filtered",
    async (p) => {
      await open(p, "mode=sponsors");
      await expect(p.getByText("Sponsor 79", { exact: true })).toBeAttached();
      assert.equal(await p.locator('a[href^="javascript:"]').count(), 0);
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
    },
    { width: 390, height: 844 },
  );
  await scenario(
    "broken banner asset never earns a billable impression",
    async (p) => {
      await open(p, "mode=broken");
      await p.waitForTimeout(1300);
      await p.evaluate(() => window.GrowthCat.shared.flushEvents());
      const events = await p.evaluate(() =>
        window.calls
          .filter((c) => c.path.endsWith("/events/batch"))
          .flatMap((c) => c.body.events),
      );
      assert.equal(
        events.filter((e) => e.event_name === "impression").length,
        0,
      );
      assert.equal(await p.locator('a[href^="javascript:"]').count(), 0);
    },
  );

  await scenario(
    "visible loaded banner earns exactly one impression and click",
    async (p) => {
      await open(p, "mode=banner");
      await expect(p.locator('a[aria-label="Broken asset"]')).toBeVisible();
      await p.waitForTimeout(1400);
      await p.evaluate(() => window.GrowthCat.shared.flushEvents());
      let events = await p.evaluate(() =>
        window.calls
          .filter((c) => c.path.endsWith("/events/batch"))
          .flatMap((c) => c.body.events),
      );
      assert.equal(
        events.filter((e) => e.event_name === "impression").length,
        1,
      );
      await p.locator('a[aria-label="Broken asset"]').click();
      await p.waitForTimeout(200);
      events = await p.evaluate(() =>
        window.calls
          .filter((c) => c.path.endsWith("/events/batch"))
          .flatMap((c) => c.body.events),
      );
      assert.equal(events.filter((e) => e.event_name === "click").length, 1);
    },
  );
  await scenario(
    "no-fill banner renders no clickable advertisement",
    async (p) => {
      await open(p, "mode=nofill");
      assert.equal(await p.locator("a").count(), 0);
      await p.waitForTimeout(200);
      assert.equal(
        await p.evaluate(
          () =>
            window.calls.filter((c) => c.path.endsWith("/events/batch")).length,
        ),
        0,
      );
    },
  );
  for (const [approved, alreadyGranted] of [
    [false, false],
    [true, false],
    [true, true],
  ])
    await scenario(
      "interstitial reward requires approval " +
        approved +
        " and avoids duplicate grant " +
        alreadyGranted,
      async (p) => {
        await open(p, "mode=interstitial");
        await expect(p.getByRole("dialog")).toBeVisible();
        await p.evaluate(
          ([approved, alreadyGranted]) => {
            window.rewardApproved = approved;
            window.alreadyGranted = alreadyGranted;
          },
          [approved, alreadyGranted],
        );
        await p.keyboard.press("Escape");
        await expect(p.getByRole("dialog")).toHaveCount(0);
        await p.waitForFunction(() =>
          window.calls.some((c) => c.path === "/v1/ads/reward/validate"),
        );
        await p.waitForTimeout(100);
        assert.equal(
          await p.evaluate(() => window.rewards.length),
          approved && !alreadyGranted ? 1 : 0,
        );
        const request = await p.evaluate(() =>
          window.calls.find((c) => c.path === "/v1/ads/reward/validate"),
        );
        assert.equal(request.identity, "signed:first-user");
      },
    );
  await browser.close();
  await new Promise((r) => server.close(r));
  fs.writeFileSync(
    dir + "/results-" + (process.env.BROWSER || "chromium") + ".json",
    JSON.stringify(
      { passed, failed: findings.length, findings, pageErrors: errors },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed,
      failed: findings.length,
      pageErrors: errors.length,
    }),
  );
  process.exitCode = findings.length || errors.length ? 1 : 0;
})().catch(async (e) => {
  console.error(e);
  await activeBrowser?.close();
  server.close();
  process.exitCode = 1;
});
