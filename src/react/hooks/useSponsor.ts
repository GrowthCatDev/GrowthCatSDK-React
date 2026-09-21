import { useCallback, useEffect, useRef, useState } from "react";
import { GrowthCat } from "../../growthcat";
import { GrowthCatError } from "../../models/errors";
import { GrowthCatSponsorData, SponsorCreative } from "../../models/sponsor";

export type SponsorLoadState = "idle" | "loading" | "ready" | "error";

export interface UseSponsorOptions {
  slotKey: string;
  sessionId?: string;
  onLoad?: (sponsor: GrowthCatSponsorData) => void;
  onError?: (error: GrowthCatError) => void;
}

export interface UseSponsorResult {
  sponsor: GrowthCatSponsorData | null;
  state: SponsorLoadState;
  error: GrowthCatError | null;
  trackImpression: (visibleFraction: number, visibleDurationMs: number, creative?: SponsorCreative) => Promise<boolean>;
  trackClick: (creative?: SponsorCreative) => Promise<boolean>;
  reload: () => Promise<void>;
}

/** Load raw sponsor data for a built-in or completely custom sponsor design. */
export function useSponsor(options: UseSponsorOptions): UseSponsorResult {
  const [sponsor, setSponsor] = useState<GrowthCatSponsorData | null>(null);
  const [state, setState] = useState<SponsorLoadState>("idle");
  const [error, setError] = useState<GrowthCatError | null>(null);
  const optionsRef = useRef(options);
  const requestIdRef = useRef(0);
  optionsRef.current = options;
  const slotKey = options.slotKey.trim();

  const load = useCallback(async () => {
    if (!slotKey) {
      const missingInput = GrowthCatError.unknown("useSponsor requires a non-empty slotKey.");
      setError(missingInput);
      setState("error");
      optionsRef.current.onError?.(missingInput);
      return;
    }
    const requestId = ++requestIdRef.current;
    setState("loading");
    setError(null);
    setSponsor(null);
    try {
      const loaded = await GrowthCat.shared.loadSponsorData(slotKey);
      if (requestId !== requestIdRef.current) return;
      setSponsor(loaded);
      setState("ready");
      optionsRef.current.onLoad?.(loaded);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      const nextError = cause instanceof GrowthCatError
        ? cause
        : GrowthCatError.unknown(cause instanceof Error ? cause.message : undefined);
      setError(nextError);
      setState("error");
      optionsRef.current.onError?.(nextError);
    }
  }, [slotKey]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  const trackImpression = useCallback(
    async (visibleFraction: number, visibleDurationMs: number, creative?: SponsorCreative) => {
      if (!sponsor) return false;
      if (creative) {
        return GrowthCat.shared.trackSponsorCreativeImpression(sponsor, creative, {
            visibleFraction,
            visibleDurationMs,
            sessionId: optionsRef.current.sessionId,
          });
      }
      if (sponsor.deliveryMode === "all") return false;
      return GrowthCat.shared.trackSponsorImpression(sponsor, {
        visibleFraction,
        visibleDurationMs,
        sessionId: optionsRef.current.sessionId,
      });
    },
    [sponsor]
  );

  const trackClick = useCallback(async (creative?: SponsorCreative) => {
    if (!sponsor) return false;
    if (creative) {
      return GrowthCat.shared.trackSponsorCreativeClick(sponsor, creative, {
        sessionId: optionsRef.current.sessionId,
      });
    }
    return GrowthCat.shared.trackSponsorClick(sponsor, {
      sessionId: optionsRef.current.sessionId,
    });
  }, [sponsor]);

  return { sponsor, state, error, trackImpression, trackClick, reload: load };
}
