import { ApiClient } from "../core/api";
import { GrowthCatLogger } from "../core/logger";
import { makeSessionId } from "../core/install-id";
import { EventQueue, isQueuedEvent } from "../core/event-queue";
import { MeasurementState } from "../core/privacy";
import {
  AttributionLink,
  AttributionAssignment,
  AttributionConfirmationOptions,
  AttributionResolveResult,
  AttributionEventRequest,
  GrowthCatRewards,
} from "../models/attribution";
import { GrowthCatAnalyticsValue } from "../models/referral";
import { GrowthCatError } from "../models/errors";

export class AttributionService {
  private readonly api: ApiClient;
  private readonly logger: GrowthCatLogger;
  private appUserId: string | null = null;
  private readonly appUserIdKey: string;
  private readonly queue: EventQueue<AttributionEventRequest>;
  private readonly unsubscribe: () => void;

  constructor(api: ApiClient, logger: GrowthCatLogger, private readonly measurement = new MeasurementState("essential")) {
    this.api = api;
    this.logger = logger;
    this.appUserIdKey = api.storageKey("app_user_id");
    this.appUserId = this.loadStoredUserId();
    this.queue = new EventQueue<AttributionEventRequest>({
      key: api.storageKey("attribution_events"), maxEvents: 100,
      allowed: event => measurement.allowsEssentialMeasurement() && event.app_user_id === this.appUserId,
      valid: (event): event is AttributionEventRequest => isQueuedEvent(event) && typeof (event as AttributionEventRequest).event_name === "string" && typeof (event as AttributionEventRequest).app_user_id === "string",
      send: event => api.trackAttributionEvent(event),
      notify: status => api.notifyDelivery(status),
    });
    this.unsubscribe = measurement.subscribe(() => this.queue.filter());
  }

  setAppUserId(userId: string) {
    const normalized = userId.trim();
    if (!normalized || normalized.length > 255) throw GrowthCatError.missingAppUserId();
    if (this.appUserId !== normalized) { this.api.cancelMeasurement(); this.queue.clear(); }
    this.appUserId = normalized;
    try {
      localStorage.setItem(this.appUserIdKey, normalized);
    } catch {
      // storage unavailable
    }
  }

  clearAppUserId(): void {
    this.api.cancelMeasurement();
    this.appUserId = null;
    this.clearQueuedEvents();
    try {
      localStorage.removeItem(this.appUserIdKey);
    } catch {
      // storage unavailable
    }
  }

  getAppUserId(): string | null {
    return this.appUserId;
  }

  async generateShareLink(options: {
    campaignKey: string;
    deepLinkValue?: string;
    metadata?: Record<string, string>;
  }): Promise<AttributionLink> {
    const appUserId = this.requireAppUserId();
    return this.api.createShareLink({
      app_user_id: appUserId,
      campaign_key: options.campaignKey,
      deep_link_value: options.deepLinkValue,
      metadata: options.metadata,
      platform: "web",
    });
  }

  async handleLink(url: string): Promise<AttributionAssignment | null> {
    const token = extractTokenFromUrl(url);
    if (!token) return null;

    const appUserId = this.requireAppUserId();
    return this.api.claimAttribution({
      app_user_id: appUserId,
      sdk_install_id: this.api.installId,
      token,
      match_type: "explicit_token",
    });
  }

  async resolveAttribution(sessionId?: string): Promise<AttributionResolveResult | null> {
    const appUserId = this.requireAppUserId();
    const result = await this.api.resolveAttribution({
      app_user_id: appUserId,
      sdk_install_id: this.api.installId,
      platform: "web",

    });

    if (result.matched && result.requiresConfirmation === false && (result.touchpointId || result.token)) {
      // Auto-claim (no user confirmation): prefer the touchpoint id from resolve so the
      // click converts in analytics; assert "probabilistic" honestly — the server never
      // upgrades a downgraded match_type to reward-eligible.
      await this.api.claimAttribution({
        app_user_id: appUserId,
        sdk_install_id: this.api.installId,
        session_id: sessionId,
        touchpoint_id: result.touchpointId,
        token: result.touchpointId ? undefined : result.token,
        match_type: "probabilistic",
      });
    }

    return result.matched ? result : null;
  }

  async confirmAttribution(
    tokenOrOptions: string | AttributionConfirmationOptions,
    sessionId?: string,
    touchpointId?: string
  ): Promise<AttributionAssignment | null> {
    const options = typeof tokenOrOptions === "string"
      ? { token: tokenOrOptions, sessionId, touchpointId }
      : tokenOrOptions;
    if (!options.token?.trim() && !options.touchpointId?.trim()) {
      throw GrowthCatError.unknown("Attribution confirmation requires a token or touchpointId.");
    }
    const appUserId = this.requireAppUserId();
    // A touchpoint id from resolve makes this a confirmed referral; a bare token is an
    // explicit token claim. Both are reward-eligible server-side.
    return this.api.claimAttribution({
      app_user_id: appUserId,
      sdk_install_id: this.api.installId,
      session_id: options.sessionId,
      touchpoint_id: options.touchpointId,
      token: options.touchpointId ? undefined : options.token?.trim(),
      match_type: options.touchpointId ? "confirmed_referral" : "explicit_token",
    });
  }

  async track(eventName: string, properties?: Record<string, GrowthCatAnalyticsValue>) {
    if (!this.measurement.allowsEssentialMeasurement()) return;
    const name = eventName.trim();
    if (!name || name.length > 120) throw GrowthCatError.unknown("eventName must contain 1 to 120 characters.");
    this.queue.enqueue({
      sdk_event_id: makeSessionId(), app_user_id: this.requireAppUserId(),
      sdk_install_id: this.api.installId, event_name: name,
      occurred_at: new Date().toISOString(), measurement_mode: "essential",
      session_id: this.measurement.allowsOptionalAnalytics() ? this.measurement.sessionId : undefined,
      properties: sanitizeProperties(properties),
    });
    await this.queue.flush();
  }

  flushQueuedEvents(): Promise<void> { return this.queue.flush(); }
  clearQueuedEvents(): void { this.queue.clear(); }
  shutdown(): void { this.unsubscribe(); this.queue.shutdown(); }

  async rewards(): Promise<GrowthCatRewards> {
    const appUserId = this.requireAppUserId();
    return this.api.fetchRewards(appUserId);
  }

  private requireAppUserId(): string {
    if (!this.appUserId) throw GrowthCatError.missingAppUserId();
    return this.appUserId;
  }

  private loadStoredUserId(): string | null {
    try {
      return localStorage.getItem(this.appUserIdKey);
    } catch {
      return null;
    }
  }
}

function sanitizeProperties(
  properties?: Record<string, GrowthCatAnalyticsValue>
): Record<string, GrowthCatAnalyticsValue> | undefined {
  if (!properties) return undefined;
  const sanitized: Record<string, GrowthCatAnalyticsValue> = {};
  for (const [rawKey, value] of Object.entries(properties).slice(0, 25)) {
    const key = rawKey.trim().slice(0, 64);
    if (!key) continue;
    if (typeof value === "string") sanitized[key] = value.slice(0, 255);
    else if (typeof value === "boolean") sanitized[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) sanitized[key] = value;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function extractTokenFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.get("gc_token") ??
      parsed.searchParams.get("token") ??
      null
    );
  } catch {
    return null;
  }
}
