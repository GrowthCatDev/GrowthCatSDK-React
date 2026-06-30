import { ApiClient } from "../core/api";
import { GrowthCatLogger } from "../core/logger";
import { installId, makeAdEventId } from "../core/install-id";
import { AdEventTracker } from "./ad-event-tracker";
import {
  AdObject,
  AdEventName,
  AdRewardValidationResponse,
} from "../models/ads";
import { GrowthCatSDKAdsConfig } from "../models/bootstrap";
import { GrowthCatError } from "../models/errors";

interface CacheEntry {
  ad: AdObject | null;
  expiresAt: number;
}

function currentLocale(): string | undefined {
  try {
    return navigator.language ?? undefined;
  } catch {
    return undefined;
  }
}

function currentCountryCode(): string | undefined {
  try {
    const locale = new Intl.Locale(navigator.language);
    return (locale as unknown as { region?: string }).region ?? undefined;
  } catch {
    return undefined;
  }
}

export class AdService {
  private readonly api: ApiClient;
  private readonly logger: GrowthCatLogger;
  readonly eventTracker: AdEventTracker;

  private cache = new Map<string, CacheEntry>();
  private staleCache = new Map<string, CacheEntry>();
  private cacheTtlSeconds = 300;

  constructor(api: ApiClient, logger: GrowthCatLogger, maxOfflineEvents = 500) {
    this.api = api;
    this.logger = logger;
    this.eventTracker = new AdEventTracker(api, logger, maxOfflineEvents);
  }

  configure(adsConfig: GrowthCatSDKAdsConfig) {
    this.cacheTtlSeconds = adsConfig.adCacheTtlSeconds;
    this.logger.logAdDiagnostic(
      `configured adsEnabled=${adsConfig.adsEnabled}, cacheTTL=${adsConfig.adCacheTtlSeconds}`
    );
  }

  async loadAdByPlacementKey(placementKey: string): Promise<AdObject | null> {
    const cached = this.getFromCache(placementKey);
    if (cached !== undefined) {
      if (cached) this.logger.logAdDiagnostic(`cache hit placementKey=${placementKey}`);
      else this.logger.logAdNoFill(placementKey);
      return cached;
    }

    try {
      const response = await this.api.fetchAdCatalog(
        placementKey,
        currentLocale(),
        currentCountryCode()
      );
      const ttl = response.cache_ttl_seconds ?? this.cacheTtlSeconds;
      const ad = (response.ads[0] as AdObject | undefined) ?? null;
      this.setCache(placementKey, ad, ttl);
      if (!ad) this.logger.logAdNoFill(placementKey);
      return ad;
    } catch (err) {
      if (err instanceof Error && err.message.includes("network")) {
        const stale = this.getStale(placementKey);
        if (stale !== undefined) {
          this.logger.logAdDiagnostic(`offline — serving stale ad for placementKey=${placementKey}`);
          return stale;
        }
      }
      throw err;
    }
  }

  async loadAdByFormat(format: "banner" | "interstitial"): Promise<AdObject | null> {
    const cacheKey = `serve:${format}`;
    const cached = this.getFromCache(cacheKey);
    if (cached !== undefined) {
      if (cached) this.logger.logAdDiagnostic(`cache hit format=${format}`);
      else this.logger.logAdNoFill(cacheKey);
      return cached;
    }

    try {
      const response = await this.api.fetchAdServe(
        format,
        currentLocale(),
        currentCountryCode()
      );
      const ttl = response.cache_ttl_seconds ?? this.cacheTtlSeconds;
      const ad = (response.ads[0] as AdObject | undefined) ?? null;
      this.setCache(cacheKey, ad, ttl);
      if (!ad) this.logger.logAdNoFill(format);
      return ad;
    } catch (err) {
      if (err instanceof Error && err.message.includes("network")) {
        const stale = this.getStale(cacheKey);
        if (stale !== undefined) {
          this.logger.logAdDiagnostic(`offline — serving stale ad for format=${format}`);
          return stale;
        }
      }
      throw err;
    }
  }

  prefetch(placementKeys: string[]) {
    for (const key of placementKeys) {
      void this.loadAdByPlacementKey(key).catch(() => {});
    }
  }

  trackEvent(
    eventName: AdEventName,
    ad: AdObject,
    options: {
      format: string;
      placementKey?: string;
      appUserId?: string;
      sessionId?: string;
      metadata?: Record<string, string>;
    }
  ) {
    this.eventTracker.track(eventName, ad, options);
  }

  async validateReward(
    ad: AdObject,
    appUserId: string,
    sessionId: string | undefined,
    viewedSeconds: number,
    completed: boolean
  ): Promise<AdRewardValidationResponse> {
    if (!ad.placement) {
      throw GrowthCatError.unknown(
        "Reward validation requires a placement (placement key only)."
      );
    }
    return this.api.validateAdReward({
      sdk_event_id: makeAdEventId("reward", ad.placement.format),
      format: ad.placement.format,
      campaign_id: ad.campaign.id,
      creative_id: ad.creative.id,
      app_user_id: appUserId,
      session_id: sessionId,
      sdk_install_id: installId(),
      viewed_seconds: viewedSeconds,
      completed,
    });
  }

  async flush() {
    await this.eventTracker.flush();
  }

  shutdown() {
    this.eventTracker.shutdown();
  }

  private getFromCache(key: string): AdObject | null | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.staleCache.set(key, entry);
      this.cache.delete(key);
      return undefined;
    }
    return entry.ad;
  }

  private getStale(key: string): AdObject | null | undefined {
    return this.staleCache.get(key)?.ad;
  }

  private setCache(key: string, ad: AdObject | null, ttlSeconds: number) {
    const entry: CacheEntry = {
      ad,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    this.cache.set(key, entry);
    this.staleCache.delete(key);
  }
}
