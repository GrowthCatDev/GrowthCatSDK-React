import { useCallback, useEffect, useRef, useState } from "react";
import { GrowthCat } from "../../growthcat";
import { GrowthCatError } from "../../models/errors";
import type { GrowthCatReferralCodeMode, GrowthCatReferralCodeResult } from "../../models/friend-referrals";

export interface UseReferralCodeOptions {
  mode?: GrowthCatReferralCodeMode;
  onSuccess?: (result: GrowthCatReferralCodeResult) => void;
  onError?: (error: GrowthCatError) => void;
}
export function useReferralCode(options: UseReferralCodeOptions = {}) {
  const { mode, onSuccess, onError } = options;
  const [result, setResult] = useState<GrowthCatReferralCodeResult | null>(null);
  const [error, setError] = useState<GrowthCatError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const request = useRef(0);
  const reset = useCallback(() => { request.current++; setResult(null); setError(null); setIsLoading(false); }, []);
  useEffect(() => {
    reset();
    let unsubscribe: (() => void) | undefined, active = true;
    void GrowthCat.ready().then(client => { if (active) unsubscribe = client.subscribeIdentity(reset); }).catch(() => {});
    return () => { active = false; reset(); unsubscribe?.(); };
  }, [mode, reset]);
  const applyCode = useCallback(async (code: string) => {
    const id = ++request.current; setIsLoading(true); setError(null); setResult(null);
    try {
      const next = await GrowthCat.shared.applyReferralCode(code, mode ?? "both");
      if (id !== request.current) return null;
      setResult(next); onSuccess?.(next); return next;
    } catch (value) {
      if (id !== request.current) return null;
      const next = value instanceof GrowthCatError ? value : GrowthCatError.unknown();
      setError(next); onError?.(next); return null;
    } finally { if (id === request.current) setIsLoading(false); }
  }, [mode, onSuccess, onError]);
  return { result, error, isLoading, applyCode, reset };
}
