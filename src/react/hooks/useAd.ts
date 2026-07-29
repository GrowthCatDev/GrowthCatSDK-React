import { useState, useEffect, useCallback, useRef } from "react";
import { GrowthCat } from "../../growthcat";
import { AdObject, AdFormat, AdEventName, AdEventMetadata } from "../../models/ads";
import { GrowthCatError } from "../../models/errors";
import { makeCreativeInstanceId } from "../../core/install-id";

export type AdLoadState = "idle" | "loading" | "ready" | "no_fill" | "error";

export interface UseAdOptions {
  /** Named placement key from your GrowthCat dashboard. */
  placementKey?: string;
  /** Format-based loading — fetches via `/v1/ads/serve`. */
  format?: AdFormat;
  /** Set false to defer loading until the ad can be used. Default true. */
  enabled?: boolean;
  appUserId?: string;
  sessionId?: string;
  /**
   * @deprecated Automatic load-time impressions do not satisfy viewability.
   * Use a visibility observer and call `trackEvent("impression", metadata)`.
   */
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
    metadata?: Partial<AdEventMetadata>
  ) => void;
  /** Stable for one rendered creative and regenerated on reload. */
  creativeInstanceId: string;
  /** Reload the ad (e.g. after dismissal). */
  reload: () => Promise<void>;
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
  const creativeInstanceId = useRef(makeCreativeInstanceId());
  const optionsRef = useRef(options);
  const requestIdRef = useRef(0);
  optionsRef.current = options;
  const placementKey = options.placementKey?.trim();
  const format = options.format;
  const enabled = options.enabled !== false;

  const load = useCallback(async () => {
    if (!enabled) {
      setAd(null);
      setError(null);
      setState("idle");
      return;
    }
    if (!placementKey && !format) {
      const missingInput = GrowthCatError.unknown(
        "useAd requires either placementKey or format."
      );
      setError(missingInput);
      setState("error");
      optionsRef.current.onError?.(missingInput);
      return;
    }

    const requestId = ++requestIdRef.current;
    setState("loading");
    setError(null);
    setAd(null);
    creativeInstanceId.current = makeCreativeInstanceId();

    try {
      const client = GrowthCat.shared;
      let loaded: AdObject | null;

      if (placementKey) {
        loaded = await client.loadAd({ placementKey });
      } else {
        loaded = await client.loadAd({ format: format! });
      }
      if (requestId !== requestIdRef.current) return;

      setAd(loaded);
      setState(loaded ? "ready" : "no_fill");

      if (loaded) {
        optionsRef.current.onLoad?.(loaded);
      } else {
        optionsRef.current.onNoFill?.();
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const gcError =
        err instanceof GrowthCatError
          ? err
          : GrowthCatError.unknown(err instanceof Error ? err.message : undefined);
      setError(gcError);
      setState("error");
      optionsRef.current.onError?.(gcError);
    }
  }, [enabled, format, placementKey]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  const trackEvent = useCallback(
    (eventName: AdEventName, metadata?: Partial<AdEventMetadata>) => {
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
        creativeInstanceId: creativeInstanceId.current,
        metadata,
      });
    },
    [ad]
  );

  return { ad, state, error, trackEvent, reload: load, creativeInstanceId: creativeInstanceId.current };
}
