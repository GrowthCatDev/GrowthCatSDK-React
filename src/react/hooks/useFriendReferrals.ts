import { useCallback, useEffect, useRef, useState } from "react";
import { GrowthCat } from "../../growthcat";
import { referralStateHasHistory } from "../../models/friend-referrals";
import type { ReferralState, ReferralInvite } from "../../models/friend-referrals";

export function useFriendReferrals(programId?: string) {
  const [friendReferralsEnabled, setFriendReferralsEnabled] = useState(false);
  const [state, setState] = useState<ReferralState | null>(null);
  const [invite, setInvite] = useState<ReferralInvite | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const request = useRef(0);
  const inviteRequest = useRef(0);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const refresh = useCallback(async () => {
    const id = ++request.current; inviteRequest.current++; setIsCreatingInvite(false); setState(null); setInvite(null); setError(null); setIsLoading(true);
    try { const next = await GrowthCat.shared.referralState(programId); if (id === request.current) setState(next); }
    catch (value) { if (id === request.current) setError(value instanceof Error ? value : new Error(String(value))); }
    finally { if (id === request.current) setIsLoading(false); }
  }, [programId]);
  const invalidate = useCallback(() => { request.current++; inviteRequest.current++; }, []);
  useEffect(() => {
    let unsubscribeIdentity: (() => void) | undefined, unsubscribeConfig: (() => void) | undefined;
    try {
      const client = GrowthCat.shared;
      setFriendReferralsEnabled(client.sdkConfig?.friendReferralsEnabled === true);
      unsubscribeConfig = client.subscribeSDKConfig(config => {
        setFriendReferralsEnabled(config.friendReferralsEnabled);
        if (!config.friendReferralsEnabled) { inviteRequest.current++; setInvite(null); setIsCreatingInvite(false); }
      });
      unsubscribeIdentity = client.subscribeIdentity(() => { request.current++; setState(null); setInvite(null); void refresh(); });
      void refresh();
    } catch (value) { setError(value instanceof Error ? value : new Error(String(value))); }
    return () => { invalidate(); unsubscribeIdentity?.(); unsubscribeConfig?.(); };
  }, [refresh, invalidate]);
  const createInvite = useCallback(async (id: string) => {
    const generation = request.current, inviteId = ++inviteRequest.current;
    setIsCreatingInvite(true); setError(null);
    let next: ReferralInvite;
    try { next = await GrowthCat.shared.referralInvite(id); }
    catch (value) { if (generation === request.current && inviteId === inviteRequest.current) setError(value instanceof Error ? value : new Error(String(value))); throw value; }
    finally { if (generation === request.current && inviteId === inviteRequest.current) setIsCreatingInvite(false); }
    if (generation !== request.current || inviteId !== inviteRequest.current) return null;
    if (!GrowthCat.shared.sdkConfig?.friendReferralsEnabled || !next.acceptingNewReferrals) { setInvite(null); return null; }
    setInvite(next); return next;
  }, []);
  const enabled = friendReferralsEnabled && state?.friendReferralsEnabled === true;
  const hasReferralHistory = state ? referralStateHasHistory(state) : false;
  return { state, invite, friendReferralsEnabled: enabled, hasReferralHistory, canViewReferrals: enabled || hasReferralHistory, error, isLoading, isCreatingInvite, refresh, createInvite };
}
