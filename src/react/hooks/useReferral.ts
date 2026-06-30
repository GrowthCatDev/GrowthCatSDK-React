import { useState, useCallback } from "react";
import { GrowthCat } from "../../growthcat";
import { ReferralRedemptionResult, GrowthCatAnalyticsContext } from "../../models/referral";
import { GrowthCatError } from "../../models/errors";

export interface UseReferralOptions {
  context?: GrowthCatAnalyticsContext;
  onSuccess?: (result: ReferralRedemptionResult) => void;
  onError?: (error: GrowthCatError) => void;
}

export interface UseReferralResult {
  isLoading: boolean;
  result: ReferralRedemptionResult | null;
  error: GrowthCatError | null;
  /** Validates the given referral code. */
  validateCode: (code: string) => Promise<ReferralRedemptionResult | null>;
  /** Records that a user clicked on a referral link containing this code. */
  recordClick: (code: string) => Promise<void>;
  reset: () => void;
}

/**
 * Hook for the full referral code validation flow.
 *
 * @example
 * function ReferralForm() {
 *   const [code, setCode] = useState("");
 *   const { isLoading, error, result, validateCode } = useReferral({
 *     onSuccess: (r) => console.log("Validated:", r.normalizedCode),
 *   });
 *
 *   return (
 *     <form onSubmit={(e) => { e.preventDefault(); validateCode(code); }}>
 *       <input value={code} onChange={(e) => setCode(e.target.value)} />
 *       <button disabled={isLoading}>Apply</button>
 *       {error && <p>{error.message}</p>}
 *       {result && <p>Code {result.normalizedCode} applied!</p>}
 *     </form>
 *   );
 * }
 */
export function useReferral(options: UseReferralOptions = {}): UseReferralResult {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ReferralRedemptionResult | null>(null);
  const [error, setError] = useState<GrowthCatError | null>(null);

  const validateCode = useCallback(
    async (code: string): Promise<ReferralRedemptionResult | null> => {
      setIsLoading(true);
      setError(null);
      setResult(null);

      try {
        const r = await GrowthCat.shared.validateReferralCode(code, options.context);
        setResult(r);
        options.onSuccess?.(r);
        return r;
      } catch (err) {
        const gcError =
          err instanceof GrowthCatError
            ? err
            : GrowthCatError.unknown(err instanceof Error ? err.message : undefined);
        setError(gcError);
        options.onError?.(gcError);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [options]
  );

  const recordClick = useCallback(
    async (code: string): Promise<void> => {
      try {
        await GrowthCat.shared.recordReferralClick(code, options.context);
      } catch {
        // Non-critical — fire and forget
      }
    },
    [options]
  );

  const reset = useCallback(() => {
    setIsLoading(false);
    setResult(null);
    setError(null);
  }, []);

  return { isLoading, result, error, validateCode, recordClick, reset };
}
