import { ApiClient } from "../core/api";
import { GrowthCatLogger } from "../core/logger";
import { installId, scopedStorageKey } from "../core/install-id";
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

const MAX_QUEUED_EVENTS = 100;
const MAX_EVENT_AGE_MS = 72 * 60 * 60 * 1000;

interface PendingAttributionEvent {
  request: AttributionEventRequest;
  queuedAt: string;
}

export class AttributionService {
  private readonly api: ApiClient;
  private readonly logger: GrowthCatLogger;
  private appUserId: string | null = null;
  private readonly appUserIdKey = scopedStorageKey("growthcat_app_user_id", 2);
  private readonly pendingEventsKey = scopedStorageKey("growthcat_pending_events", 2);
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private flushing = false;

  constructor(api: ApiClient, logger: GrowthCatLogger) {
    this.api = api;
    this.logger = logger;
    this.appUserId = this.loadStoredUserId();
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
  }

  setAppUserId(userId: string) {
    const normalized = userId.trim();
    if (!normalized) throw GrowthCatError.missingAppUserId();
    this.appUserId = normalized;
    try {
      localStorage.setItem(this.appUserIdKey, normalized);
    } catch {
      // storage unavailable
    }
  }

  clearAppUserId(): void {
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
      sdk_install_id: installId(),
      token,
      match_type: "explicit_token",
    });
  }

  async resolveAttribution(sessionId?: string): Promise<AttributionResolveResult | null> {
    const appUserId = this.requireAppUserId();
    const result = await this.api.resolveAttribution({
      app_user_id: appUserId,
      sdk_install_id: installId(),
      platform: "web",
      referrer_url: typeof document !== "undefined" ? document.referrer : undefined,
    });

    if (result.matched && result.requiresConfirmation === false && (result.touchpointId || result.token)) {
      // Auto-claim (no user confirmation): prefer the touchpoint id from resolve so the
      // click converts in analytics; assert "probabilistic" honestly — the server never
      // upgrades a downgraded match_type to reward-eligible.
      await this.api.claimAttribution({
        app_user_id: appUserId,
        sdk_install_id: installId(),
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
      sdk_install_id: installId(),
      session_id: options.sessionId,
      touchpoint_id: options.touchpointId,
      token: options.touchpointId ? undefined : options.token?.trim(),
      match_type: options.touchpointId ? "confirmed_referral" : "explicit_token",
    });
  }

  async track(eventName: string, properties?: Record<string, GrowthCatAnalyticsValue>) {
    const appUserId = this.requireAppUserId();
    const normalizedEventName = eventName.trim().slice(0, 128);
    if (!normalizedEventName) throw GrowthCatError.unknown("eventName must not be empty.");
    const request: AttributionEventRequest = {
      app_user_id: appUserId,
      sdk_install_id: installId(),
      event_name: normalizedEventName,
      properties: sanitizeProperties(properties),
    };
    await this.flushQueuedEvents();
    try {
      await this.api.trackAttributionEvent(request);
    } catch (error) {
      // Qualifying events drive reward grants — persist failures and retry on the
      // next track call rather than silently losing them.
      if (isRetryable(error)) this.enqueueEvent(request);
      throw error;
    }
  }

  /** Best-effort resend of previously failed events, oldest first. */
  async flushQueuedEvents(): Promise<void> {
    if (this.flushing) return;
    const pending = this.loadPendingEvents();
    if (pending.length === 0) return;
    this.flushing = true;
    try {
      while (pending.length > 0) {
        const event = pending[0]!;
        try {
          await this.api.trackAttributionEvent(event.request);
          pending.shift();
          this.retryAttempt = 0;
          this.savePendingEvents(pending);
        } catch (error) {
          if (isRetryable(error)) {
            this.savePendingEvents(pending);
            this.scheduleRetry(error);
            return;
          }
          pending.shift();
          this.savePendingEvents(pending);
          this.logger.warn(`[Attribution] dropped rejected ${event.request.event_name} event`);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  shutdown(): void {
    if (this.retryTimer != null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
  }

  private readonly onOnline = () => void this.flushQueuedEvents();

  private scheduleRetry(error: unknown): void {
    if (this.retryTimer != null) return;
    this.retryAttempt = Math.min(this.retryAttempt + 1, 8);
    const retryAfter = error instanceof GrowthCatError ? error.retryAfter : undefined;
    const exponential = Math.min(60_000, 1_000 * 2 ** this.retryAttempt);
    const delay = retryAfter != null && Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : exponential + Math.floor(Math.random() * Math.max(250, exponential * 0.25));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flushQueuedEvents();
    }, Math.max(0, delay));
  }

  private enqueueEvent(request: AttributionEventRequest): void {
    const pending = this.loadPendingEvents();
    pending.push({ request, queuedAt: new Date().toISOString() });
    this.savePendingEvents(pending.slice(-MAX_QUEUED_EVENTS));
  }

  private loadPendingEvents(): PendingAttributionEvent[] {
    try {
      const raw = localStorage.getItem(this.pendingEventsKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      const cutoff = Date.now() - MAX_EVENT_AGE_MS;
      return parsed.flatMap((entry): PendingAttributionEvent[] => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        const request = (record["request"] ?? record) as AttributionEventRequest;
        const queuedAt = typeof record["queuedAt"] === "string"
          ? record["queuedAt"]
          : new Date().toISOString();
        if (!request.event_name || Date.parse(queuedAt) < cutoff) return [];
        return [{ request, queuedAt }];
      });
    } catch {
      return [];
    }
  }

  private savePendingEvents(events: PendingAttributionEvent[]): void {
    try {
      localStorage.setItem(this.pendingEventsKey, JSON.stringify(events));
    } catch {
      // storage unavailable — degrade to in-memory-only behavior
    }
  }

  clearQueuedEvents(): void {
    this.savePendingEvents([]);
  }

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

function isRetryable(error: unknown): boolean {
  if (!(error instanceof GrowthCatError)) return true;
  return error.code === "network" ||
    error.code === "rate_limited" ||
    (error.code === "server" && (error.statusCode ?? 500) >= 500);
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
