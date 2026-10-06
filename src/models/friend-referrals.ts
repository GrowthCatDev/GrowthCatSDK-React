import { GrowthCatError } from "./errors";
import { webUrl } from "../core/url";
import type { ReferralRedemptionResult } from "./referral";

export type GrowthCatReferralCodeMode = "influencers" | "friends" | "both";
export type GrowthCatReferralCodeKind = "influencer" | "friend";
export interface ReferralAvailability { acceptingNewReferrals: boolean; availabilityReason?: string; }
export interface ReferralRewardSpec {
  enabled: boolean; type: "asc_offer_code" | "revenuecat_entitlement" | "custom";
  deliveryMode: "automatic" | "manual"; featureKey?: string; entitlementId?: string;
  offeringId?: string; duration?: { value: number; unit: "days" | "months" };
}
export interface ReferralMilestone { id: string; requiredCount: number; label?: string; reward: ReferralRewardSpec; }
export interface ReferralProgram extends ReferralAvailability {
  id: string; version: number; name: string; campaignKey: string; status: string;
  qualifyingEvent: string; friendTriggerEvent: string; requiredCount: number;
  frequency: string; existingUsersAllowed: boolean;
  /** Server eligibility for the current invitee; never inferred from local account age. */
  canEnroll: boolean; enrollmentIneligibilityReason?: string;
  /** Null uses the legacy invitation/program cutoff, rather than unlimited age. */
  newUserMaxAgeDays: number | null; friendRewardOncePerUser: boolean; inviterReward: ReferralRewardSpec;
  friendReward: ReferralRewardSpec; inviterMilestones: ReferralMilestone[];
}
export interface ReferralMilestoneProgress extends ReferralMilestone {
  earned: boolean; status?: string; rewardId?: string; remainingCount: number;
}
export interface ReferralProgress {
  programId: string; campaignKey: string; enrolledCount: number; qualifiedCount: number;
  requiredCount: number; earnedRewards: number; nextThreshold: number | null;
  remainingCount: number; frequency: string; milestones: ReferralMilestoneProgress[];
}
export interface ReferralReward {
  id: string; programId: string; side: "friend" | "inviter"; milestone: number;
  milestoneKey?: string; rewardType: string; status: string; earnedAt?: string;
  fulfilledAt?: string; reviewReason?: string; featureKey?: string; entitlementId?: string;
  offeringId?: string; offerCode?: string; offerCodeRedemptionUrl?: string;
  expiresAt?: string; redemptionStatus?: string; refundFlagged: boolean; simulated: boolean;
  customPayload?: Record<string, unknown>;
}
export interface ReferralState { hasReferralHistory: boolean; friendReferralsEnabled: boolean; appUserId: string; programs: ReferralProgram[]; progress: ReferralProgress[]; rewards: ReferralReward[]; }
export interface ReferralInvite extends ReferralAvailability { code: string; token: string; programId: string; url: string; }
export interface ReferralEnrollment { id: string; programId: string; eligibilityVerified: boolean; qualifiedAt?: string; }
export interface ReferralEnrollmentResult { enrollment: ReferralEnrollment; state: ReferralState; }
export interface ReferralCodeClassification extends ReferralAvailability {
  kind: GrowthCatReferralCodeKind; normalizedCode: string; programId?: string; token?: string;
}
export type GrowthCatReferralCodeResult =
  | { kind: "influencer"; normalizedCode: string; influencer: ReferralRedemptionResult }
  | { kind: "friend"; normalizedCode: string; friend: ReferralEnrollmentResult };

type Raw = Record<string, unknown>;
export function referralObject(value: unknown): Raw {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw GrowthCatError.server(502, "Invalid referral response.");
  return value as Raw;
}
function text(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function required(raw: Raw, key: string): string {
  const value = text(raw[key]); if (!value) throw GrowthCatError.server(502, `Invalid referral ${key}.`); return value;
}
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function rows(value: unknown): Raw[] { return Array.isArray(value) ? value.map(referralObject) : []; }
export function parseReferralAvailability(raw: Raw): ReferralAvailability {
  return { acceptingNewReferrals: raw.accepting_new_referrals === true, availabilityReason: text(raw.availability_reason) };
}
function rewardSpec(value: unknown): ReferralRewardSpec {
  const raw = referralObject(value);
  return { enabled: raw.enabled === true, type: raw.type as ReferralRewardSpec["type"],
    deliveryMode: raw.delivery_mode as ReferralRewardSpec["deliveryMode"], featureKey: text(raw.feature_key),
    entitlementId: text(raw.entitlement_id), offeringId: text(raw.offering_id),
    duration: raw.duration ? referralObject(raw.duration) as unknown as ReferralRewardSpec["duration"] : undefined };
}
function milestone(raw: Raw): ReferralMilestone {
  return { id: required(raw, "id"), requiredCount: number(raw.required_count), label: text(raw.label), reward: rewardSpec(raw.reward) };
}
export function parseReferralProgram(raw: Raw): ReferralProgram {
  return { id: required(raw, "id"), version: number(raw.version), name: required(raw, "name"),
    campaignKey: required(raw, "campaign_key"), status: required(raw, "status"), ...parseReferralAvailability(raw),
    qualifyingEvent: required(raw, "qualifying_event"), friendTriggerEvent: required(raw, "friend_trigger_event"),
    requiredCount: number(raw.required_count), frequency: required(raw, "frequency"),
    existingUsersAllowed: raw.existing_users_allowed === true, canEnroll: raw.can_enroll === true,
    enrollmentIneligibilityReason: text(raw.enrollment_ineligibility_reason),
    newUserMaxAgeDays: raw.new_user_max_age_days === null ? null :
      typeof raw.new_user_max_age_days === "number" && Number.isInteger(raw.new_user_max_age_days) && raw.new_user_max_age_days >= 1 && raw.new_user_max_age_days <= 3650 ? raw.new_user_max_age_days : 7,
    friendRewardOncePerUser: raw.friend_reward_once_per_user !== false, inviterReward: rewardSpec(raw.inviter_reward),
    friendReward: rewardSpec(raw.friend_reward), inviterMilestones: rows(raw.inviter_milestones).map(milestone) };
}
export function parseReferralState(raw: Raw): ReferralState {
  const state: ReferralState = { hasReferralHistory: raw.has_referral_history === true, friendReferralsEnabled: raw.friend_referrals_enabled === true, appUserId: required(raw, "app_user_id"), programs: rows(raw.programs).map(parseReferralProgram),
    progress: rows(raw.progress).map(p => ({ programId: required(p, "program_id"), campaignKey: required(p, "campaign_key"),
      enrolledCount: number(p.enrolled_count), qualifiedCount: number(p.qualified_count), requiredCount: number(p.required_count),
      earnedRewards: number(p.earned_rewards), nextThreshold: p.next_threshold == null ? null : number(p.next_threshold),
      remainingCount: number(p.remaining_count), frequency: required(p, "frequency"),
      milestones: rows(p.milestones).map(m => ({ ...milestone(m), earned: m.earned === true, status: text(m.status),
        rewardId: text(m.reward_id), remainingCount: number(m.remaining_count) })) })),
    rewards: rows(raw.rewards).map(r => ({ id: required(r, "id"), programId: required(r, "program_id"),
      side: r.side as ReferralReward["side"], milestone: number(r.milestone), milestoneKey: text(r.milestone_key),
      rewardType: required(r, "reward_type"), status: required(r, "status"), earnedAt: text(r.earned_at),
      fulfilledAt: text(r.fulfilled_at), reviewReason: text(r.review_reason), featureKey: text(r.feature_key),
      entitlementId: text(r.entitlement_id), offeringId: text(r.offering_id), offerCode: text(r.offer_code),
      offerCodeRedemptionUrl: httpsUrl(r.offer_code_redemption_url), expiresAt: typeof r.expires_at === "string" ? r.expires_at : undefined,
      redemptionStatus: text(r.redemption_status), refundFlagged: r.refund_flagged === true, simulated: r.simulated === true,
      customPayload: r.custom_payload ? referralObject(r.custom_payload) : undefined })) };
  state.hasReferralHistory = referralStateHasHistory(state);
  return state;
}

/** Older responses omit the accepted-invitee signal; meaningful progress/rewards remain history. */
export function referralStateHasHistory(state: Pick<ReferralState, "progress" | "rewards"> & { hasReferralHistory?: boolean }): boolean {
  return state.hasReferralHistory === true || state.rewards.length > 0 || state.progress.some(progress =>
    progress.enrolledCount > 0 || progress.qualifiedCount > 0 || progress.earnedRewards > 0 ||
    progress.milestones.some(milestone => milestone.earned));
}
function httpsUrl(value: unknown): string | undefined { const url = webUrl(value); return url?.startsWith("https://") ? url : undefined; }
export function parseReferralInvite(raw: Raw): ReferralInvite {
  const url = httpsUrl(raw.url); if (!url) throw GrowthCatError.server(502, "Invalid referral invite URL.");
  return { code: required(raw, "code"), token: required(raw, "token"), programId: required(raw, "program_id"),
    url, ...parseReferralAvailability(raw) };
}
export function parseReferralEnrollment(raw: Raw): ReferralEnrollmentResult {
  const e = referralObject(raw.enrollment);
  return { enrollment: { id: required(e, "id"), programId: required(e, "program_id"),
    eligibilityVerified: e.eligibility_verified === true, qualifiedAt: text(e.qualified_at) }, state: parseReferralState(referralObject(raw.state)) };
}
export function parseReferralClassification(raw: Raw): ReferralCodeClassification {
  if (raw.kind !== "friend" && raw.kind !== "influencer") throw GrowthCatError.server(502, "Invalid referral code kind.");
  return { kind: raw.kind, normalizedCode: required(raw, "normalized_code"),
    programId: raw.kind === "friend" ? required(raw, "program_id") : undefined,
    token: raw.kind === "friend" ? required(raw, "token") : undefined, ...parseReferralAvailability(raw) };
}


/** Fulfillment evidence controls usability; refund flags require owner review,
 * rather than locally revoking an already fulfilled benefit. */
export function isReferralRewardUsable(reward: ReferralReward, now = new Date()): boolean {
  if (reward.status !== "fulfilled" || reward.simulated) return false;
  if (reward.expiresAt === undefined) return true;
  const raw = reward.expiresAt;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(raw);
  if (!match || match[0] !== raw) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]! ||
      Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 ||
      (match[7] !== undefined && (Number(match[7]) > 23 || Number(match[8]) > 59))) return false;
  const expiry = Date.parse(raw);
  return Number.isFinite(expiry) && expiry > now.getTime();
}

/** A consumed reward remains history, but has no further redemption action. */
export function referralRewardRedemptionUrl(reward: ReferralReward, now = new Date()): string | undefined {
  if (!isReferralRewardUsable(reward, now) || reward.redemptionStatus === "confirmed" ||
      reward.rewardType !== "asc_offer_code" || !reward.offerCodeRedemptionUrl) return undefined;
  try {
    const url = new URL(reward.offerCodeRedemptionUrl);
    return url.protocol === "https:" && url.hostname === "apps.apple.com" && url.pathname === "/redeem" &&
      !url.username && !url.password && (!url.port || url.port === "443") ? url.href : undefined;
  } catch { return undefined; }
}
