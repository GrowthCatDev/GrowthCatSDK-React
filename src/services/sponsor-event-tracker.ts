import { ApiClient } from "../core/api";
import { installId, makeAdEventId, makeCreativeInstanceId } from "../core/install-id";
import { GrowthCatLogger } from "../core/logger";
import { MeasurementState } from "../core/privacy";
import { GROWTHCAT_WEB_SDK_VERSION } from "../core/version";
import { GrowthCatError } from "../models/errors";
import { SponsorEventName, SponsorEventPayload, SponsorSlotContent } from "../models/sponsor";

export interface SponsorEventOptions {
  creativeInstanceId?: string;
  sessionId?: string;
  visibleFraction?: number;
  visibleDurationMs?: number;
}

export class SponsorEventTracker {
  private queue: SponsorEventPayload[] = [];
  private flushing = false;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly billedInstances = new Set<string>();
  private readonly billedInstanceOrder: string[] = [];
  private readonly storageKey = `growthcat_sponsor_events:v2:${installId()}`;
  private readonly unsubscribeMeasurement: () => void;

  constructor(
    private readonly api: ApiClient,
    private readonly logger: GrowthCatLogger,
    private readonly measurement: MeasurementState
  ) {
    this.load();
    this.unsubscribeMeasurement = measurement.subscribe((mode) => {
      if (mode === "disabled") this.clear();
    });
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
  }

  track(
    slotKey: string,
    eventName: SponsorEventName,
    sponsor: SponsorSlotContent,
    options: SponsorEventOptions = {}
  ): void {
    if (!this.measurement.allowsEssentialMeasurement()) return;
    const creativeInstanceId = options.creativeInstanceId ?? makeCreativeInstanceId();
    const billingKey = `${creativeInstanceId}:${eventName}`;
    if (!this.markBillableInstance(billingKey)) return;
    const bookingId = sponsor.creative?.bookingId;
    const trackingToken = sponsor.creative?.trackingToken;
    if (!bookingId || !trackingToken) {
      // The current backend is v1. Send its legacy event without inventing a
      // booking association; v2 will use the durable path below.
      void this.api.trackSponsorEvent(slotKey, eventName).catch(() => {});
      return;
    }

    const locale = currentLocale();
    this.queue.push({
      sdk_event_id: makeAdEventId(eventName, "sponsor"),
      creative_instance_id: creativeInstanceId,
      slot_key: slotKey,
      booking_id: bookingId,
      tracking_token: trackingToken,
      event_name: eventName,
      occurred_at: new Date().toISOString(),
      measurement_mode: this.measurement.measurementMode,
      sdk_install_id: installId(),
      session_id: options.sessionId ?? this.measurement.sessionId,
      locale,
      country_code: currentCountryCode(locale),
      sdk_version: GROWTHCAT_WEB_SDK_VERSION,
      metadata: {
        measurement_version: 2,
        visible_fraction: options.visibleFraction,
        visible_duration_ms: options.visibleDurationMs,
      },
    });
    this.queue = this.queue.slice(-100);
    this.persist();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    const events = this.queue.slice(0, 100);
    this.flushing = true;
    try {
      await this.api.sendSponsorEvents({ schema_version: 2, events });
      const ids = new Set(events.map((event) => event.sdk_event_id));
      this.queue = this.queue.filter((event) => !ids.has(event.sdk_event_id));
      this.persist();
      this.retryAttempt = 0;
      if (this.queue.length > 0) queueMicrotask(() => void this.flush());
    } catch (error) {
      if (!shouldRetry(error)) {
        const ids = new Set(events.map((event) => event.sdk_event_id));
        this.queue = this.queue.filter((event) => !ids.has(event.sdk_event_id));
        this.persist();
        this.logger.warn("[Sponsors] dropped rejected event batch");
      } else {
        this.scheduleRetry(error);
      }
    } finally {
      this.flushing = false;
    }
  }

  clear(): void {
    this.queue = [];
    this.persist();
  }

  shutdown(): void {
    this.unsubscribeMeasurement();
    if (this.retryTimer != null) clearTimeout(this.retryTimer);
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
    this.persist();
  }

  private readonly onOnline = () => void this.flush();

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
      void this.flush();
    }, Math.max(0, delay));
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { version?: number; events?: unknown };
      if (parsed.version === 2 && Array.isArray(parsed.events)) {
        const cutoff = Date.now() - 72 * 60 * 60 * 1000;
        this.queue = (parsed.events as SponsorEventPayload[]).filter(
          (event) => Date.parse(event.occurred_at) >= cutoff
        );
      }
    } catch {
      this.queue = [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({ version: 2, events: this.queue }));
    } catch {
      // Storage unavailable; retain in memory.
    }
  }
}

function shouldRetry(error: unknown): boolean {
  if (!(error instanceof GrowthCatError)) return true;
  return error.code === "network" || error.code === "rate_limited" ||
    (error.code === "server" && (error.statusCode ?? 500) >= 500);
}

function currentLocale(): string | undefined {
  try { return navigator.language ?? undefined; } catch { return undefined; }
}

function currentCountryCode(locale?: string): string | undefined {
  try { return locale ? new Intl.Locale(locale).region ?? undefined : undefined; } catch { return undefined; }
}
