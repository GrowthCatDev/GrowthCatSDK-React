import { ApiClient } from "../core/api";
import { GrowthCatLogger } from "../core/logger";
import { makeAdEventId } from "../core/install-id";
import { MeasurementState } from "../core/privacy";
import { AdEventTracker } from "./ad-event-tracker";
import {
  AdObject,
  AdEventName,
  AdRewardValidationResponse,
  AdEventTrackingOptions,
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
  return undefined;
}

export class AdService {
  private readonly api: ApiClient;
  private readonly logger: GrowthCatLogger;
  readonly eventTracker: AdEventTracker;

  private cache = new Map<string, CacheEntry>();
  private staleCache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<AdObject | null>>();
  private cacheTtlSeconds = 300;
  private readonly rewardIds = new WeakMap<AdObject, Map<string, string>>();

  constructor(
    api: ApiClient,
    logger: GrowthCatLogger,
    measurement: MeasurementState,
    maxOfflineEvents = 500
  ) {
    this.api = api;
    this.logger = logger;
    this.eventTracker = new AdEventTracker(api, logger, measurement, maxOfflineEvents);
  }

  configure(adsConfig: GrowthCatSDKAdsConfig) {
    if (Number.isFinite(adsConfig.adCacheTtlSeconds) && adsConfig.adCacheTtlSeconds >= 0) {
      this.cacheTtlSeconds = adsConfig.adCacheTtlSeconds;
    }
    this.eventTracker.setMaxOfflineEvents(adsConfig.maxOfflineAdEvents);
    this.logger.logAdDiagnostic(
      `configured adsEnabled=${adsConfig.adsEnabled}, cacheTTL=${adsConfig.adCacheTtlSeconds}`
    );
  }

  async loadAdByPlacementKey(placementKey: string): Promise<AdObject | null> {
    const normalizedKey = placementKey.trim();
    if (!normalizedKey) throw GrowthCatError.unknown("placementKey must not be empty.");
    const cached = this.getFromCache(normalizedKey);
    if (cached !== undefined) {
      if (cached) this.logger.logAdDiagnostic(`cache hit placementKey=${normalizedKey}`);
      else this.logger.logAdNoFill(normalizedKey);
      return cached;
    }
    const pending = this.inFlight.get(normalizedKey);
    if (pending) {
      const ad = await pending;
      return ad?.tracking.token.split(":").length === 6 ? this.loadAdByPlacementKey(normalizedKey) : ad;
    }

    const request = (async () => {
      try {
      const response = await this.api.fetchAdCatalog(
        normalizedKey,
        currentLocale(),
        currentCountryCode()
      );
      const ttl = response.cache_ttl_seconds ?? this.cacheTtlSeconds;
      const ad = (response.ads[0] as AdObject | undefined) ?? null;
      this.setCache(normalizedKey, ad, ttl);
      if (!ad) this.logger.logAdNoFill(normalizedKey);
      return ad;
      } catch (err) {
      if (err instanceof GrowthCatError && err.code === "network") {
        const stale = this.getStale(normalizedKey);
        if (stale !== undefined) {
          this.logger.logAdDiagnostic(`offline — serving stale ad for placementKey=${normalizedKey}`);
          return stale;
        }
      }
      throw err;
      }
    })().finally(() => this.inFlight.delete(normalizedKey));
    this.inFlight.set(normalizedKey, request);
    return request;
  }

  async loadAdByFormat(format: "banner" | "interstitial"): Promise<AdObject | null> {
    const cacheKey = `serve:${format}`;
    const cached = this.getFromCache(cacheKey);
    if (cached !== undefined) {
      if (cached) this.logger.logAdDiagnostic(`cache hit format=${format}`);
      else this.logger.logAdNoFill(cacheKey);
      return cached;
    }
    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      const ad = await pending;
      return ad?.tracking.token.split(":").length === 6 ? this.loadAdByFormat(format) : ad;
    }

    const request = (async () => {
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
      if (err instanceof GrowthCatError && err.code === "network") {
        const stale = this.getStale(cacheKey);
        if (stale !== undefined) {
          this.logger.logAdDiagnostic(`offline — serving stale ad for format=${format}`);
          return stale;
        }
      }
      throw err;
      }
    })().finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, request);
    return request;
  }

  async prefetch(placementKeys: string[]): Promise<void> {
    await Promise.all(
      placementKeys.map((key) => this.loadAdByPlacementKey(key).catch(() => null))
    );
  }

  trackEvent(
    eventName: AdEventName,
    ad: AdObject,
    options: AdEventTrackingOptions
  ) {
    this.eventTracker.track(eventName, ad, options);
  }

  async validateReward(
    ad: AdObject,
    appUserId: string,
    sessionId: string | undefined,
    viewedSeconds: number,
    completed: boolean,
    creativeInstanceId?: string
  ): Promise<AdRewardValidationResponse> {
    if (!ad.placement) {
      throw GrowthCatError.unknown(
        "Reward validation requires a placement (placement key only)."
      );
    }
    if (!appUserId.trim()) throw GrowthCatError.missingAppUserId();
    if (!creativeInstanceId) throw GrowthCatError.unknown("Reward validation requires the rendered creativeInstanceId.");
    if (!Number.isFinite(viewedSeconds) || viewedSeconds < 0 || viewedSeconds > 3600) throw GrowthCatError.unknown("Invalid viewedSeconds.");
    let ids = this.rewardIds.get(ad);
    if (!ids) { ids = new Map(); this.rewardIds.set(ad, ids); }
    const key = `${appUserId}:${creativeInstanceId}`;
    if (!ids.has(key)) ids.set(key, makeAdEventId("reward", ad.placement.format));
    await this.flush();
    return this.api.validateAdReward({
      sdk_event_id: ids.get(key),
      creative_instance_id: creativeInstanceId,
      tracking_token: ad.tracking.token,
      format: ad.placement.format,
      campaign_id: ad.campaign.id,
      creative_id: ad.creative.id,
      app_user_id: appUserId,
      session_id: sessionId,
      sdk_install_id: this.api.installId,
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
    // A signed delivery token authorizes one presentation, not every render within the cache TTL.
    if (entry.ad?.tracking.token.split(":").length === 6) {
      this.cache.delete(key);
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.staleCache.set(key, entry);
      this.cache.delete(key);
      return undefined;
    }
    return entry.ad;
  }

  private getStale(key: string): AdObject | null | undefined {
    const entry = this.staleCache.get(key);
    if (!entry || Date.now() > entry.expiresAt + 5 * 60 * 1000 || entry.ad?.placement?.rewardEnabled) {
      this.staleCache.delete(key);
      return undefined;
    }
    return entry.ad;
  }

  private setCache(key: string, ad: AdObject | null, ttlSeconds: number) {
    const safeTtlSeconds = Number.isFinite(ttlSeconds) && ttlSeconds >= 0
      ? ttlSeconds
      : this.cacheTtlSeconds;
    const entry: CacheEntry = {
      ad,
      expiresAt: Date.now() + safeTtlSeconds * 1000,
    };
    this.cache.set(key, entry);
    this.staleCache.delete(key);
  }
}
