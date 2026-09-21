import { useCallback, useEffect, useState } from "react";
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

  const reload = useCallback(async () => {
    if (options.enabled === false) return;
    setIsLoading(true);
    setError(null);
    try {
      const next = await GrowthCat.shared.acquisition({
        slug,
        sessionId: options.sessionId,
      });
      setCampaign(next);
      if (options.trackLandingView !== false) {
        await next.trackLandingView();
      }
    } catch (value) {
      setError(value instanceof Error ? value : new Error(String(value)));
    } finally {
      setIsLoading(false);
    }
  }, [slug, options.enabled, options.sessionId, options.trackLandingView]);

  useEffect(() => {
    void reload();
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
