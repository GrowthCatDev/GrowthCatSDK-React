import { useCallback, useEffect, useRef, useState } from "react";
import { GrowthCat } from "../../growthcat";
import { GrowthCatError } from "../../models/errors";
import type { GrowthCatReferralCodeMode, GrowthCatReferralCodeResult, ReferralState } from "../../models/friend-referrals";

export interface UseReferralCodeOptions {
  mode?: GrowthCatReferralCodeMode;
  onSuccess?: (result: GrowthCatReferralCodeResult) => void;
  onError?: (error: GrowthCatError) => void;
}
export function useReferralCode(options: UseReferralCodeOptions = {}) {
  const { mode, onSuccess, onError } = options;
  const [friendReferralsEnabled, setFriendReferralsEnabled] = useState(false);
  const [state, setState] = useState<ReferralState | null>(null);
  const [result, setResult] = useState<GrowthCatReferralCodeResult | null>(null);
  const [error, setError] = useState<GrowthCatError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const request = useRef(0);
  const reset = useCallback(() => { request.current++; setResult(null); setError(null); setIsLoading(false); }, []);
  useEffect(() => {
    reset();
    let unsubscribeIdentity: (() => void) | undefined, unsubscribeConfig: (() => void) | undefined, active = true;
    let eligibilityRequest = 0;
    setState(null); setFriendReferralsEnabled(false);
    try {
      const client = GrowthCat.shared;
      const loadEligibility = () => {
        const id = ++eligibilityRequest;
        setState(null);
        if (mode === "influencers" || !client.sdkConfig?.friendReferralsEnabled) return;
        void client.referralState().then(next => { if (active && id === eligibilityRequest) setState(next); }).catch(() => {});
      };
      setFriendReferralsEnabled(client.sdkConfig?.friendReferralsEnabled === true);
      unsubscribeIdentity = client.subscribeIdentity(() => { reset(); loadEligibility(); });
      unsubscribeConfig = client.subscribeSDKConfig(config => { setFriendReferralsEnabled(config.friendReferralsEnabled); loadEligibility(); });
      loadEligibility();
    } catch { /* Unavailable config or identity keeps friend entry hidden. */ }
    return () => { active = false; reset(); unsubscribeIdentity?.(); unsubscribeConfig?.(); };
  }, [mode, reset]);
  const canEnterFriendCode = friendReferralsEnabled && state?.friendReferralsEnabled === true && state.programs.some(program => program.canEnroll);
  const applyCode = useCallback(async (code: string) => {
    const id = ++request.current; setIsLoading(true); setError(null); setResult(null);
    try {
      if (mode === "friends" && !canEnterFriendCode) throw new GrowthCatError("friend_referrals_disabled", "New friend referrals are temporarily unavailable.");
      const effectiveMode = !canEnterFriendCode && (!mode || mode === "both") ? "influencers" : mode ?? "both";
      const next = await GrowthCat.shared.applyReferralCode(code, effectiveMode);
      if (id !== request.current) return null;
      setResult(next); onSuccess?.(next); return next;
    } catch (value) {
      if (id !== request.current) return null;
      const next = value instanceof GrowthCatError ? value : GrowthCatError.unknown();
      setError(next); onError?.(next); return null;
    } finally { if (id === request.current) setIsLoading(false); }
  }, [mode, onSuccess, onError, canEnterFriendCode]);
  return { result, error, isLoading, applyCode, reset, friendReferralsEnabled,
    canEnterFriendCode };
}
