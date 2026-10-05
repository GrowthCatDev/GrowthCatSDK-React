import { useCallback, useEffect, useRef, useState } from "react";
import { GrowthCat } from "../../growthcat";
import type { ReferralState, ReferralInvite } from "../../models/friend-referrals";

export function useFriendReferrals(programId?: string) {
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
    let active = true, unsubscribe: (() => void) | undefined;
    void GrowthCat.ready().then(client => {
      if (!active) return;
      unsubscribe = client.subscribeIdentity(() => { request.current++; setState(null); setInvite(null); void refresh(); });
      void refresh();
    }).catch(value => { if (active) setError(value); });
    return () => { active = false; invalidate(); unsubscribe?.(); };
  }, [refresh, invalidate]);
  const createInvite = useCallback(async (id: string) => {
    const generation = request.current, inviteId = ++inviteRequest.current;
    setIsCreatingInvite(true); setError(null);
    let next: ReferralInvite;
    try { next = await GrowthCat.shared.referralInvite(id); }
    catch (value) { if (generation === request.current && inviteId === inviteRequest.current) setError(value instanceof Error ? value : new Error(String(value))); throw value; }
    finally { if (generation === request.current && inviteId === inviteRequest.current) setIsCreatingInvite(false); }
    if (generation !== request.current || inviteId !== inviteRequest.current) return null;
    if (!next.acceptingNewReferrals) { setInvite(null); return null; }
    setInvite(next); return next;
  }, []);
  return { state, invite, error, isLoading, isCreatingInvite, refresh, createInvite };
}
