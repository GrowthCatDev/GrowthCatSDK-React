import { useState, useEffect, useCallback, useRef } from "react";
import { GrowthCat } from "../../growthcat";
import { AdObject, AdFormat, AdEventName } from "../../models/ads";
import { GrowthCatError } from "../../models/errors";

export type AdLoadState = "idle" | "loading" | "ready" | "no_fill" | "error";

export interface UseAdOptions {
  /** Named placement key from your GrowthCat dashboard. */
  placementKey?: string;
  /** Format-based loading — fetches via `/v1/ads/serve`. */
  format?: AdFormat;
  appUserId?: string;
  sessionId?: string;
  /** Set to false to disable automatic impression tracking. Default: true. */
  trackImpression?: boolean;
  /** Called when the ad loads successfully. */
  onLoad?: (ad: AdObject) => void;
  /** Called when no ad is available. */
  onNoFill?: () => void;
  /** Called when loading fails. */
  onError?: (error: GrowthCatError) => void;
}

export interface UseAdResult {
  /** The raw AdObject — use this to build your own custom ad UI. */
  ad: AdObject | null;
  state: AdLoadState;
  error: GrowthCatError | null;
  /** Manually fire a tracking event for this ad. */
  trackEvent: (
    eventName: AdEventName,
    metadata?: Record<string, string>
  ) => void;
  /** Reload the ad (e.g. after dismissal). */
  reload: () => void;
}

/**
 * Loads an ad and returns the raw `AdObject` so you can build a fully custom
 * ad renderer. This is the core add-on for custom UI — use the `ad` object's
 * `creative` and `creative.layout` fields to build whatever design you want.
 *
 * The SDK still handles impression/click tracking for you via `trackEvent`.
 *
 * @example
 * function MyCustomBanner({ placementKey }: { placementKey: string }) {
 *   const { ad, trackEvent } = useAd({ placementKey });
 *   if (!ad) return null;
 *
 *   return (
 *     <div style={{ background: ad.creative.layout?.banner?.backgroundColor ?? "#fff" }}
 *          onClick={() => trackEvent("click")}>
 *       <span>{ad.creative.headline}</span>
 *       <button>{ad.creative.ctaText}</button>
 *     </div>
 *   );
 * }
 */
export function useAd(options: UseAdOptions): UseAdResult {
  const [ad, setAd] = useState<AdObject | null>(null);
  const [state, setState] = useState<AdLoadState>("idle");
  const [error, setError] = useState<GrowthCatError | null>(null);
  const impressionTracked = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const load = useCallback(async () => {
    if (!optionsRef.current.placementKey && !optionsRef.current.format) return;

    setState("loading");
    setError(null);
    impressionTracked.current = false;

    try {
      const client = GrowthCat.shared;
      let loaded: AdObject | null;

      if (optionsRef.current.placementKey) {
        loaded = await client.loadAd({ placementKey: optionsRef.current.placementKey });
      } else {
        loaded = await client.loadAd({ format: optionsRef.current.format! });
      }

      setAd(loaded);
      setState(loaded ? "ready" : "no_fill");

      if (loaded) {
        optionsRef.current.onLoad?.(loaded);
      } else {
        optionsRef.current.onNoFill?.();
      }
    } catch (err) {
      const gcError =
        err instanceof GrowthCatError
          ? err
          : GrowthCatError.unknown(err instanceof Error ? err.message : undefined);
      setError(gcError);
      setState("error");
      optionsRef.current.onError?.(gcError);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-track impression when the hook indicates ready and trackImpression is enabled.
  useEffect(() => {
    if (
      state === "ready" &&
      ad &&
      !impressionTracked.current &&
      optionsRef.current.trackImpression !== false
    ) {
      impressionTracked.current = true;
      const format =
        optionsRef.current.placementKey
          ? (ad.placement?.format ?? "banner")
          : (optionsRef.current.format ?? "banner");
      GrowthCat.shared.trackAdEvent("impression", ad, {
        format,
        placementKey: optionsRef.current.placementKey,
        appUserId: optionsRef.current.appUserId,
        sessionId: optionsRef.current.sessionId,
      });
    }
  }, [state, ad]);

  const trackEvent = useCallback(
    (eventName: AdEventName, metadata?: Record<string, string>) => {
      if (!ad) return;
      const format =
        optionsRef.current.placementKey
          ? (ad.placement?.format ?? "banner")
          : (optionsRef.current.format ?? "banner");
      GrowthCat.shared.trackAdEvent(eventName, ad, {
        format,
        placementKey: optionsRef.current.placementKey,
        appUserId: optionsRef.current.appUserId,
        sessionId: optionsRef.current.sessionId,
        metadata,
      });
    },
    [ad]
  );

  return { ad, state, error, trackEvent, reload: load };
}
