import { isReferralRewardUsable, referralRewardRedemptionUrl } from "../../models/friend-referrals";
import type { ReferralReward, ReferralRewardSpec } from "../../models/friend-referrals";
import { GrowthCat } from "../../growthcat";
import React, { useEffect, useState } from "react";
import { useFriendReferrals } from "../hooks/useFriendReferrals";

export interface GrowthCatFriendReferralPanelStrings {
  title: string;
  loading: string;
  empty: string;
  unavailable: string;
  getCode: string;
  gettingCode: string;
  code: string;
  link: string;
  copy: string;
  share: string;
  copied: string;
  copyFailed: string;
  refresh: string;
  completed: string;
  redeem: string;
  simulated: string;
  viewOffer: string;
  openingOffer: string;
  rewardUnavailable: string;
  deliveredBenefit: (reward: ReferralReward) => string;
  expires: (isoDate: string) => string;
  counts: (qualified: number, enrolled: number) => string;
  remaining: (count: number) => string;
  milestone: (count: number) => string;
  benefit: (reward: ReferralRewardSpec) => string;
  rewardStatus: (status: string) => string;
}
const buttonStyle: React.CSSProperties = { minHeight: 44, padding: "10px 14px", borderRadius: 8, cursor: "pointer" };
const defaults: GrowthCatFriendReferralPanelStrings = {
  title: "Invite friends", loading: "Loading your referral progress…", empty: "No referral programs are available yet.",
  unavailable: "New invitations are temporarily unavailable. Your progress and earned rewards remain available.",
  getCode: "Get my invite code", gettingCode: "Getting your code…", code: "Your code", link: "Your invite link",
  copy: "Copy invite link", share: "Share invite", copied: "Invite link copied.",
  copyFailed: "Select and copy your invite link below.", refresh: "Refresh progress", completed: "Referral goal reached.",
  redeem: "Redeem reward", simulated: "Test reward", viewOffer: "View offer", openingOffer: "Checking offer…",
  rewardUnavailable: "This reward is unavailable. Refresh your progress and try again.",
  deliveredBenefit: reward => (reward.rewardType === "custom" || reward.rewardType === "unlock_feature") ? "Custom benefit delivered"
    : reward.rewardType === "revenuecat_entitlement" ? "Promotional access delivered"
    : reward.rewardType === "asc_offer_code" ? "Apple subscription offer delivered" : "Referral benefit delivered",
  expires: isoDate => `Expires ${new Date(isoDate).toLocaleString()}`,
  counts: (qualified, enrolled) => `${qualified} qualified friends · ${enrolled} invited`,
  remaining: count => `${count} more qualifying ${count === 1 ? "friend" : "friends"} until your next reward`,
  milestone: count => `Invite ${count} friends`,
  benefit: reward => reward.type === "revenuecat_entitlement" && reward.duration
    ? `${reward.duration.value} ${reward.duration.value === 1 ? reward.duration.unit.slice(0, -1) : reward.duration.unit} of free access`
    : reward.type === "asc_offer_code" ? "Apple subscription offer" : "Referral benefit",
  rewardStatus: status => ({ pending_review: "Awaiting approval", ready: "Ready for delivery", fulfilling: "Delivering your reward", fulfilled: "Delivered",
    failed: "Delivery needs attention", awaiting_inventory: "Waiting for a reward code", rejected: "Not approved" })[status] ?? "Reward update",
};
export interface GrowthCatFriendReferralPanelProps {
  programId?: string;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
  strings?: Partial<GrowthCatFriendReferralPanelStrings>;
  /** Present a configured host paywall; offering selection does not grant access. */
  onSelectOffering?: (offeringId: string, reward: ReferralReward) => void;
  /** Host UI for usable delivered custom benefits or provider entitlement details. */
  renderReward?: (reward: ReferralReward) => React.ReactNode;
}
/** Rules come from the server, including single, repeated and tiered goals. */
export function GrowthCatFriendReferralPanel({ programId, className, title, style, strings, onSelectOffering, renderReward }: GrowthCatFriendReferralPanelProps) {
  const { state, invite, friendReferralsEnabled, canViewReferrals, error, isLoading, isCreatingInvite, refresh, createInvite } = useFriendReferrals(programId);
  const [shareMessage, setShareMessage] = useState("");
  const [selectingReward, setSelectingReward] = useState<string | null>(null);
  const [rewardError, setRewardError] = useState("");
  const s = { ...defaults, ...strings };
  useEffect(() => { setShareMessage(""); setRewardError(""); setSelectingReward(null); }, [state?.appUserId, invite?.url]);
  async function selectOffering(reward: ReferralReward, owner: string) {
    if (!onSelectOffering || !isReferralRewardUsable(reward)) return;
    setSelectingReward(reward.id); setRewardError("");
    const client = GrowthCat.shared;
    try {
      const fresh = await client.referralState(reward.programId);
      if (GrowthCat.shared !== client || client.appUserId !== owner || fresh.appUserId !== owner) return;
      const current = fresh.rewards.find(item => item.id === reward.id && item.programId === reward.programId);
      if (!current || !isReferralRewardUsable(current) || !current.offeringId || current.offeringId !== reward.offeringId) {
        setRewardError(s.rewardUnavailable); return;
      }
      onSelectOffering(current.offeringId, current);
    } catch {
      if (GrowthCat.isConfigured && GrowthCat.shared === client && client.appUserId === owner) setRewardError(s.rewardUnavailable);
    } finally {
      if (GrowthCat.isConfigured && GrowthCat.shared === client && client.appUserId === owner) setSelectingReward(null);
    }
  }
  async function share(url: string, name: string, useSheet: boolean) {
    setShareMessage("");
    try {
      const client = GrowthCat.shared, owner = state?.appUserId;
      const config = await client.refreshSDKConfig();
      const fresh = await client.referralState(invite?.programId);
      if (GrowthCat.shared !== client || client.appUserId !== owner || fresh.appUserId !== owner ||
          !config.friendReferralsEnabled || !client.sdkConfig?.friendReferralsEnabled || !fresh.friendReferralsEnabled ||
          !fresh.programs.find(program => program.id === invite?.programId)?.acceptingNewReferrals) {
        setShareMessage(s.unavailable); return;
      }
      if (useSheet && typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: name, url });
      } else if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url); setShareMessage(s.copied);
      } else setShareMessage(s.copyFailed);
    } catch (value) {
      if (!(value instanceof Error && value.name === "AbortError")) setShareMessage(s.copyFailed);
    }
  }
  if (state && !canViewReferrals && !error) return null;
  return <section className={className} aria-busy={isLoading} style={{ padding: 20, border: "1px solid #d1d5db", borderRadius: 12, ...style }}>
    <h3>{title ?? s.title}</h3>{error && <p role="alert">{error.message}</p>}
    {isLoading && !state && <p role="status">{s.loading}</p>}
    {state && !state.programs.length && <p>{s.empty}</p>}
    {state?.programs.map(program => {
      const progress = state.progress.find(item => item.programId === program.id);
      const qualified = progress?.qualifiedCount ?? 0;
      const tiers = progress?.milestones.length ? progress.milestones : program.inviterMilestones;
      const threshold = progress?.nextThreshold ?? progress?.requiredCount ?? program.requiredCount;
      return <article key={program.id} style={{ borderTop: "1px solid #d1d5db", paddingBlock: 16 }}><h4>{program.name}</h4>
        <p>{s.counts(qualified, progress?.enrolledCount ?? 0)}</p>
        {tiers.map(tier => <div key={tier.id} style={{ marginBlock: 12 }}>
          <p>{tier.label ?? s.milestone(tier.requiredCount)}{tier.reward?.enabled && <> · {s.benefit(tier.reward)}</>}</p>
          <progress aria-label={tier.label ?? s.milestone(tier.requiredCount)} max={tier.requiredCount} value={Math.min(qualified, tier.requiredCount)} style={{ width: "100%" }} />
        </div>)}
        {!tiers.length && program.inviterReward?.enabled && threshold > 0 && <div style={{ marginBlock: 12 }}>
          <p>{s.milestone(threshold)} · {s.benefit(program.inviterReward)}</p>
          <progress aria-label={s.milestone(threshold)} max={threshold} value={Math.min(qualified, threshold)} style={{ width: "100%" }} />
        </div>}
        {progress && <p>{progress.nextThreshold === null ? s.completed : s.remaining(progress.remainingCount)}</p>}
        {friendReferralsEnabled && program.acceptingNewReferrals ? <button type="button" style={buttonStyle} disabled={isCreatingInvite || isLoading} onClick={() => { void createInvite(program.id).catch(() => {}); }}>
          {isCreatingInvite ? s.gettingCode : s.getCode}</button> : <p>{s.unavailable}</p>}
        {invite?.programId === program.id && friendReferralsEnabled && program.acceptingNewReferrals && <div style={{ marginTop: 12 }}>
          <p>{s.code}: <strong>{invite.code}</strong></p>
          <label style={{ display: "block" }}>{s.link}<input aria-label={s.link} readOnly value={invite.url} style={{ display: "block", width: "100%", boxSizing: "border-box", padding: 8 }} onFocus={event => event.target.select()} /></label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            <button type="button" style={buttonStyle} onClick={() => { void share(invite.url, program.name, false); }}>{s.copy}</button>
            <button type="button" style={buttonStyle} onClick={() => { void share(invite.url, program.name, true); }}>{s.share}</button>
          </div>
        </div>}
        {state.rewards.filter(reward => reward.programId === program.id).map(reward => {
          const redeemUrl = referralRewardRedemptionUrl(reward);
          const usable = isReferralRewardUsable(reward);
          return <div key={reward.id}><p>{s.rewardStatus(reward.status)}{reward.simulated && <> · {s.simulated}</>}
            {reward.status === "fulfilled" && reward.offerCode && <> · {s.code}: <strong>{reward.offerCode}</strong></>}
            {redeemUrl && <a href={redeemUrl} target="_blank" rel="noopener noreferrer"> {s.redeem}</a>}
          </p>
          {usable && <>
            <p>{s.deliveredBenefit(reward)}{reward.expiresAt && <> · {s.expires(reward.expiresAt)}</>}</p>
            {reward.offeringId && onSelectOffering && <button type="button" style={buttonStyle} disabled={selectingReward !== null} onClick={() => { void selectOffering(reward, state.appUserId); }}>{selectingReward === reward.id ? s.openingOffer : s.viewOffer}</button>}
            {renderReward?.(reward)}
          </>}
          </div>;
        })}
      </article>;
    })}
    {shareMessage && <p role="status">{shareMessage}</p>}
    {rewardError && <p role="alert">{rewardError}</p>}
    <button type="button" style={buttonStyle} disabled={isLoading} onClick={() => { void refresh(); }}>{s.refresh}</button>
  </section>;
}
