# Friend referrals and unified code entry

Friend referral programs are configured in the GrowthCat dashboard. Milestones,
qualification events and delivery choices are server configuration; SDK code
must not assume five referrals, one month or any other fixed rule.

Initialize with the app SDK key and a signed identity provider. The provider
calls your authenticated server, which issues short-lived GrowthCat identity
tokens bound to the app and user. Account/MCP API keys stay on your server.

```ts
GrowthCat.initialize({
  apiKey: publicSdkKey,
  workspace: "live",
  identityTokenProvider: async request => {
    const response = await fetch("/api/growthcat/identity", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request), credentials: "same-origin",
    });
    if (!response.ok) throw new Error("Identity unavailable");
    return (await response.json()).token;
  },
});
GrowthCat.setAppUserId(authenticatedUser.id);
```

The server must authenticate the caller and derive the authorized user itself;
never sign an arbitrary user ID supplied by the browser. The SDK retries one
401 with `forceRefresh: true`. Clear identity on sign-out.

## Headless APIs

```ts
const programs = await GrowthCat.shared.referralPrograms();
const state = await GrowthCat.shared.referralState();
const progress = state.progress.find(item => item.programId === programId);
const program = state.programs.find(item => item.id === programId);
if (program?.acceptingNewReferrals) {
  const invite = await GrowthCat.shared.referralInvite(programId);
  if (invite.acceptingNewReferrals) renderInvite(invite.code, invite.url);
}
const result = await GrowthCat.shared.applyReferralCode(input, "both");
// Explicit modes: "influencers", "friends", "both" (default).
```

`applyReferralCode` classifies the code before accepting it. A disallowed kind
raises `referral_code_type_not_allowed` without enrolling a friend or validating
an influencer code. Friend enrollment returns `{ kind: "friend", friend:
{ enrollment, state }, normalizedCode }`; influencer validation returns
`{ kind: "influencer", influencer, normalizedCode }`.

For a previously classified invite, use
`enrollReferral({ programId, token })`. Existing enrollment retries stay
idempotent even when fresh enrollments are unavailable. Identity switches
invalidate pending results; retry with the current account.

## React

```tsx
import { GrowthCatReferralCodeForm, GrowthCatFriendReferralPanel }
  from "@growthcat/web/react";

<GrowthCatReferralCodeForm mode="both" onSuccess={handleAcceptedCode} />
<GrowthCatFriendReferralPanel programId={programId} />
```

The unified form works in onboarding or settings and lets you replace strings
and colors. `useReferralCode({ mode })` provides `applyCode`, result, error,
loading and reset for your own form. `useFriendReferrals(programId?)` provides
state, invite, refresh and createInvite. No React provider is needed.

The existing `useReferral`, `GrowthCatReferralForm` and
`validateReferralCode` remain influencer-only compatibility APIs. Use the new
unified surfaces for friend or combined entry.

Render milestones from `progress.milestones` and `program.inviterMilestones`.
Progress includes enrolled/qualified counts, remaining counts, earned states and
stable reward IDs. Paused or quota-exhausted programs can keep previously
accepted participants and earned rewards visible. Hide fresh sharing when
`acceptingNewReferrals` is false; `availabilityReason` explains the effective
state without changing program status. Refresh before sharing and handle a
server rejection if availability changes while the UI is open.

## Rewards and limits

Code acceptance never grants subscription access locally. The backend issues
App Store offer codes, configured RevenueCat benefits or owner-reviewed custom
rewards. Use the subscription provider as the entitlement source of truth.
Display pending review, inventory shortage and failed delivery honestly.

Only fulfilled rewards expose delivered codes. `offerCodeRedemptionUrl` is
accepted only as HTTPS. `referralRewardRedemptionUrl(reward)` additionally
checks the Apple redemption host, fulfillment, expiry and redemption state;
open its returned URL through a deliberate user action. A website
cannot invoke StoreKit's native offer-code sheet. Sandbox/simulated rewards are
not production benefits. `isReferralRewardUsable(reward)` rejects pending,
simulated, expired and malformed-expiry benefits. Refund flags are owner-review
evidence and do not locally revoke a fulfilled reward; confirmed redemption
hides further redemption actions while preserving history. A RevenueCat offering ID selects a configured offer;
it does not itself prove access or trial eligibility.

Commercial capacities come from the backend owner's plan across dashboard,
REST and MCP. Monthly new friend enrollment limits do not revoke prior
participants or earned rewards. `plan_limit_reached` carries optional
`planLimit` details (meter, used, limit, resetAt); show app users a simple
availability explanation. There are no automatic overage charges.

## Settings progress and sharing component

`GrowthCatFriendReferralPanel` displays the server's next threshold and remaining
friend count for single and repeated goals, and every configured cumulative tier.
It displays the configured benefit instead of assuming a month of free access.
Refreshing follows changed rules. It offers Copy invite link, a native share sheet
when available, and a selectable link if clipboard access is unavailable. It does
not navigate away from the settings page to share an invitation.

Use `strings`, `style`, `className`, and `title` to match your app. Every label and
status can be replaced; dynamic counts, benefit descriptions and delivery statuses
use callbacks. Exported type: `GrowthCatFriendReferralPanelStrings`.

```tsx
<GrowthCatFriendReferralPanel
  programId={programId}
  strings={{
    title: "Invita amigos",
    counts: (qualified, enrolled) => `${qualified} amigos calificados · ${enrolled} invitados`,
    remaining: count => `Faltan ${count} amigos para tu siguiente recompensa`,
    milestone: count => `Invita ${count} amigos`,
    // Replace the remaining labels/statuses for your supported locales too.
  }}
/>
```

`useFriendReferrals` also exposes `isCreatingInvite` so custom UIs can disable
sharing while a request is pending. Concurrent invitations and account changes
cannot replace the current user's invite with an older response. Delivery status
is shown in plain language; pending rewards never display an undelivered code.

For delivered, non-simulated, unexpired benefits, the panel also shows a benefit
summary and expiry. Use `renderReward(reward)` to render your own custom feature
or provider entitlement details. `onSelectOffering(offeringId, reward)` adds a
View offer button for those usable benefits. Present the configured RevenueCat
paywall from the host callback; an offering ID does not create trial eligibility
or grant access. The callback and custom renderer never run for pending,
simulated, expired or malformed-expiry rewards. Use provider entitlement state
as the authority for actual access.

```tsx
<GrowthCatFriendReferralPanel
  onSelectOffering={(offeringId) => presentPaywall(offeringId)}
  renderReward={(reward) => reward.featureKey === "vip_coaching"
    ? <a href="/account/coaching">View your coaching benefit</a> : null}
/>
```

The offering action re-fetches the authorized reward and checks current account,
expiry and unchanged offering before invoking the host. Failed checks remain
recoverable with Refresh progress. Custom `renderReward` is presentation only;
custom feature actions must still enforce authorization in your app/server.

Signed referral program reads, progress, invite generation, classification and
explicit enrollment are account-benefit operations. They continue when optional
analytics consent changes to essential or disabled, without measurement keepalive
or analytics event emission. Referral click/funnel tracking remains optional and
is cleared/cancelled on revocation. Identity changes and SDK shutdown still
invalidate account requests normally.
