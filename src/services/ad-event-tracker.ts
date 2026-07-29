import { ApiClient } from "../core/api";
import { GrowthCatLogger } from "../core/logger";
import { installId, makeAdEventId, makeCreativeInstanceId } from "../core/install-id";
import { MeasurementState } from "../core/privacy";
import { GROWTHCAT_WEB_SDK_VERSION } from "../core/version";
import { GrowthCatError } from "../models/errors";
import {
  AdObject,
  AdEventName,
  AdEventPayload,
  AdEventTrackingOptions,
  AdEventMetadata,
} from "../models/ads";

const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_THRESHOLD = 10;
const MAX_BATCH_EVENTS = 100;
const MAX_BATCH_BYTES = 256 * 1024;
const OPTIONAL_EVENT_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const IMMEDIATE_EVENTS = new Set<AdEventName>(["impression", "click"]);

function currentLocale(): string | undefined {
  try {
    return navigator.language ?? undefined;
  } catch {
    return undefined;
  }
}

function currentCountryCode(): string | undefined {
  try {
    return new Intl.Locale(navigator.language).region ?? undefined;
  } catch {
    return undefined;
  }
}

function sanitizeMetadata(
  eventName: AdEventName,
  input?: Partial<AdEventMetadata>
): AdEventMetadata {
  const output: AdEventMetadata = { measurement_version: 2 };
  if (!input) return output;

  if (eventName === "impression") {
    if (Number.isFinite(input.visible_fraction)) {
      output.visible_fraction = Math.max(0, Math.min(1, input.visible_fraction!));
    }
    if (Number.isFinite(input.visible_duration_ms)) {
      output.visible_duration_ms = Math.max(0, Math.round(input.visible_duration_ms!));
    }
  }

  if (eventName === "video_progress" || eventName === "video_complete") {
    if (Number.isFinite(input.player_position_ms)) {
      output.player_position_ms = Math.max(0, Math.round(input.player_position_ms!));
    }
    if ([0, 25, 50, 75, 100].includes(input.quartile ?? -1)) {
      output.quartile = input.quartile;
    }
  }
  return output;
}

function isOptional(event: AdEventPayload): boolean {
  return event.measurement_mode === "analytics";
}

export class AdEventTracker {
  private queue: AdEventPayload[] = [];
  private readonly api: ApiClient;
  private readonly logger: GrowthCatLogger;
  private readonly measurement: MeasurementState;
  private maxOffline: number;
  private readonly storageKey: string;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private flushing = false;
  private readonly billedInstances = new Set<string>();
  private readonly billedInstanceOrder: string[] = [];
  private readonly onOnline = () => void this.flush();
  private readonly onVisibilityChange = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      void this.flush();
    }
  };
  private readonly unsubscribeMeasurement: () => void;

  constructor(
    api: ApiClient,
    logger: GrowthCatLogger,
    measurement: MeasurementState,
    maxOffline = 500
  ) {
    this.api = api;
    this.logger = logger;
    this.measurement = measurement;
    this.maxOffline = maxOffline;
    this.storageKey = `growthcat_ad_events:v2:${installId()}`;
    this.loadOfflineQueue();
    this.startPeriodicFlush();
    this.watchLifecycle();
    this.unsubscribeMeasurement = measurement.subscribe((mode, previousMode) => {
      if (previousMode === "analytics" && mode !== "analytics") {
        this.queue = this.queue.filter((event) => !isOptional(event));
        this.persistOfflineQueue();
      }
    });
  }

  track(eventName: AdEventName, ad: AdObject, options: AdEventTrackingOptions): void {
    if (!this.measurement.allowsEssentialMeasurement()) return;
    const format = options.format ?? ad.placement?.format;
    if (!format) {
      throw GrowthCatError.unknown(
        "Ad event tracking requires `format` when the ad has no placement."
      );
    }

    const creativeInstanceId = options.creativeInstanceId ?? makeCreativeInstanceId();
    if (eventName === "impression" || eventName === "click") {
      const billingKey = `${creativeInstanceId}:${eventName}`;
      if (!this.markBillableInstance(billingKey)) return;
    }

    const analyticsAllowed = this.measurement.allowsOptionalAnalytics();
    const payload: AdEventPayload = {
      sdk_event_id: makeAdEventId(eventName, format),
      creative_instance_id: creativeInstanceId,
      format,
      campaign_id: ad.campaign.id,
      creative_id: ad.creative.id,
      event_name: eventName,
      locale: currentLocale(),
      country_code: currentCountryCode(),
      app_user_id: analyticsAllowed ? options.appUserId : undefined,
      session_id: options.sessionId ?? this.measurement.sessionId,
      sdk_install_id: installId(),
      tracking_token: ad.tracking.token,
      occurred_at: new Date().toISOString(),
      measurement_mode: this.measurement.measurementMode,
      sdk_version: GROWTHCAT_WEB_SDK_VERSION,
      metadata: sanitizeMetadata(eventName, options.metadata),
    };

    this.enqueue(payload);
    if (IMMEDIATE_EVENTS.has(eventName) || this.queue.length >= FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.dropExpiredOptionalEvents();
    const batch = this.nextBatch();
    if (batch.length === 0) return;
    this.flushing = true;

    try {
      await this.api.sendAdEvents({ schema_version: 2, events: batch });
      const sentIds = new Set(batch.map((event) => event.sdk_event_id));
      this.queue = this.queue.filter((event) => !sentIds.has(event.sdk_event_id));
      this.retryAttempt = 0;
      this.persistOfflineQueue();
      this.logger.log(`[Ads] flushed ${batch.length} event(s)`);
      if (this.queue.length > 0) queueMicrotask(() => void this.flush());
    } catch (error) {
      if (!this.shouldRetry(error)) {
        const sentIds = new Set(batch.map((event) => event.sdk_event_id));
        this.queue = this.queue.filter((event) => !sentIds.has(event.sdk_event_id));
        this.logger.warn(`[Ads] rejected ${batch.length} schema-invalid event(s)`);
      } else {
        this.scheduleRetry(error);
      }
      this.persistOfflineQueue();
    } finally {
      this.flushing = false;
    }
  }

  clearOptionalEvents(): void {
    this.queue = this.queue.filter((event) => !isOptional(event));
    this.persistOfflineQueue();
  }

  setMaxOfflineEvents(maxOffline: number): void {
    if (!Number.isFinite(maxOffline) || maxOffline < 1) return;
    this.maxOffline = Math.floor(maxOffline);
    if (this.queue.length > this.maxOffline) {
      this.queue = this.queue.slice(-this.maxOffline);
      this.persistOfflineQueue();
    }
  }

  shutdown(): void {
    if (this.flushTimer != null) clearInterval(this.flushTimer);
    if (this.retryTimer != null) clearTimeout(this.retryTimer);
    this.flushTimer = null;
    this.retryTimer = null;
    this.unsubscribeMeasurement();
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.persistOfflineQueue();
  }

  private enqueue(payload: AdEventPayload): void {
    this.queue.push(payload);
    if (this.queue.length > this.maxOffline) this.queue.shift();
    this.persistOfflineQueue();
  }

  private markBillableInstance(key: string): boolean {
    if (this.billedInstances.has(key)) return false;
    this.billedInstances.add(key);
    this.billedInstanceOrder.push(key);
    if (this.billedInstanceOrder.length > 2_000) {
      const expired = this.billedInstanceOrder.shift();
      if (expired) this.billedInstances.delete(expired);
    }
    return true;
  }

  private nextBatch(): AdEventPayload[] {
    const batch: AdEventPayload[] = [];
    const oversizedIds = new Set<string>();
    let bytes = 32;
    for (const event of this.queue) {
      const eventBytes = new TextEncoder().encode(JSON.stringify(event)).byteLength + 1;
      if (batch.length > 0 && (batch.length >= MAX_BATCH_EVENTS || bytes + eventBytes > MAX_BATCH_BYTES)) {
        break;
      }
      // An individually oversized event cannot be accepted by the contract.
      if (eventBytes > MAX_BATCH_BYTES) {
        oversizedIds.add(event.sdk_event_id);
        continue;
      }
      batch.push(event);
      bytes += eventBytes;
    }
    if (oversizedIds.size > 0) {
      this.queue = this.queue.filter((event) => !oversizedIds.has(event.sdk_event_id));
      this.persistOfflineQueue();
      this.logger.warn(`[Ads] dropped ${oversizedIds.size} oversized event(s)`);
    }
    return batch;
  }

  private shouldRetry(error: unknown): boolean {
    if (!(error instanceof GrowthCatError)) return true;
    return (
      error.code === "network" ||
      error.code === "rate_limited" ||
      (error.code === "server" && (error.statusCode ?? 500) >= 500)
    );
  }

  private scheduleRetry(error: unknown): void {
    if (this.retryTimer != null) return;
    this.retryAttempt = Math.min(this.retryAttempt + 1, 8);
    const retryAfterSeconds = error instanceof GrowthCatError ? error.retryAfter : undefined;
    const exponentialMs = Math.min(60_000, 1_000 * 2 ** this.retryAttempt);
    const jitterMs = Math.floor(Math.random() * Math.max(250, exponentialMs * 0.25));
    const delayMs = retryAfterSeconds != null && Number.isFinite(retryAfterSeconds)
      ? Math.max(0, retryAfterSeconds * 1000)
      : exponentialMs + jitterMs;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delayMs);
  }

  private dropExpiredOptionalEvents(): void {
    const cutoff = Date.now() - OPTIONAL_EVENT_MAX_AGE_MS;
    this.queue = this.queue.filter((event) => {
      if (!isOptional(event)) return true;
      const occurredAt = Date.parse(event.occurred_at);
      return Number.isFinite(occurredAt) && occurredAt >= cutoff;
    });
    this.persistOfflineQueue();
  }

  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  private watchLifecycle(): void {
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  private persistOfflineQueue(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({ version: 2, events: this.queue }));
    } catch {
      // Storage can be unavailable or full; the in-memory queue remains usable.
    }
  }

  private loadOfflineQueue(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as { version?: number; events?: unknown };
      if (parsed.version === 2 && Array.isArray(parsed.events)) {
        this.queue = parsed.events as AdEventPayload[];
        this.dropExpiredOptionalEvents();
      }
    } catch {
      this.queue = [];
    }
  }
}
