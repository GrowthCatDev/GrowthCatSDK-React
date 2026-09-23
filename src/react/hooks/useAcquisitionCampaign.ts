import { useCallback, useEffect, useRef, useState } from "react";
import { GrowthCat } from "../../growthcat";
import type { AcquisitionCampaign } from "../../models/acquisition";

export interface UseAcquisitionCampaignOptions {
  enabled?: boolean;
  trackLandingView?: boolean;
  sessionId?: string;
}

export interface UseAcquisitionCampaignResult {
  campaign: AcquisitionCampaign | null;
  isLoading: boolean;
  error: Error | null;
  reload(): Promise<void>;
  openAppStore(): Promise<void>;
}

export function useAcquisitionCampaign(
  slug: string,
  options: UseAcquisitionCampaignOptions = {}
): UseAcquisitionCampaignResult {
  const [campaign, setCampaign] = useState<AcquisitionCampaign | null>(null);
  const [isLoading, setIsLoading] = useState(options.enabled !== false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setCampaign(null);
    setError(null);
    if (options.enabled === false) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const next = await GrowthCat.shared.acquisition({
        slug,
        sessionId: options.sessionId,
      });
      if (requestId !== requestIdRef.current) return;
      setCampaign(next);
      if (options.trackLandingView !== false) {
        // Optional measurement must not delay or invalidate usable campaign content.
        void next.trackLandingView().catch(() => {});
      }
    } catch (value) {
      if (requestId !== requestIdRef.current) return;
      setError(value instanceof Error ? value : new Error(String(value)));
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [slug, options.enabled, options.sessionId, options.trackLandingView]);

  useEffect(() => {
    void reload();
    return () => { requestIdRef.current += 1; };
  }, [reload]);

  return {
    campaign,
    isLoading,
    error,
    reload,
    openAppStore: async () => {
      if (!campaign) throw new Error("[GrowthCat] acquisition campaign is not loaded.");
      await campaign.openAppStore();
    },
  };
}
