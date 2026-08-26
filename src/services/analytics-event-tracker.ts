import { ApiClient } from "../core/api";
import { installId } from "../core/install-id";
import { MeasurementState } from "../core/privacy";
import { GrowthCatLogger } from "../core/logger";
import { GrowthCatError } from "../models/errors";
import { AnalyticsEventRequest, GrowthCatAnalyticsEventName, GrowthCatAnalyticsValue } from "../models/referral";

const STORAGE_VERSION = 2;
const MAX_EVENTS = 100;
const MAX_AGE_MS = 72 * 60 * 60 * 1000;

const PROPERTY_ALLOWLIST: Record<GrowthCatAnalyticsEventName, ReadonlySet<string>> = {
  session_started: new Set(["session_reason"]),
  paywall_viewed: new Set(["paywall_variant", "offering_id", "placement"]),
  checkout_started: new Set(["product_id", "package_id", "offering_id"]),
  checkout_cancelled: new Set(["product_id", "package_id", "reason"]),
  purchase_sdk_completed: new Set(["product_id", "package_id", "store"]),
};

export function sanitizeAnalyticsProperties(
  eventName: GrowthCatAnalyticsEventName,
  properties?: Record<string, GrowthCatAnalyticsValue>
): Record<string, GrowthCatAnalyticsValue> | undefined {
  if (!properties) return undefined;
  const allowed = PROPERTY_ALLOWLIST[eventName];
  const output: Record<string, GrowthCatAnalyticsValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!allowed.has(key)) continue;
    if (typeof value === "string") output[key] = value.slice(0, 255);
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "boolean") output[key] = value;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

export class AnalyticsEventTracker {
  private queue: AnalyticsEventRequest[] = [];
  private flushing = false;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly storageKey: string;
  private readonly unsubscribeMeasurement: () => void;

  constructor(
    private readonly api: ApiClient,
    private readonly logger: GrowthCatLogger,
    measurement: MeasurementState
  ) {
    this.storageKey = `growthcat_analytics_events:v2:${installId()}`;
    this.load();
    this.unsubscribeMeasurement = measurement.subscribe((mode, previous) => {
      if (previous === "analytics" && mode !== "analytics") this.clear();
    });
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
  }

  enqueue(event: AnalyticsEventRequest): void {
    this.queue.push(event);
    this.queue = this.queue.slice(-MAX_EVENTS);
    this.persist();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.dropExpired();
    const event = this.queue[0];
    if (!event) return;
    this.flushing = true;
    try {
      await this.api.recordAnalyticsEvent(event);
      this.queue.shift();
      this.retryAttempt = 0;
      this.persist();
      queueMicrotask(() => void this.flush());
    } catch (error) {
      if (!this.shouldRetry(error)) {
        this.queue.shift();
        this.persist();
        this.logger.warn(`[Analytics] dropped rejected ${event.event_name} event`);
        queueMicrotask(() => void this.flush());
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

  private shouldRetry(error: unknown): boolean {
    if (!(error instanceof GrowthCatError)) return true;
    return error.code === "network" || error.code === "rate_limited" ||
      (error.code === "server" && (error.statusCode ?? 500) >= 500);
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

  private dropExpired(): void {
    const cutoff = Date.now() - MAX_AGE_MS;
    this.queue = this.queue.filter((event) => {
      const timestamp = Date.parse(event.event_at ?? "");
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    });
    this.persist();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { version?: number; events?: unknown };
      if (parsed.version === STORAGE_VERSION && Array.isArray(parsed.events)) {
        this.queue = parsed.events as AnalyticsEventRequest[];
        this.dropExpired();
      }
    } catch {
      this.queue = [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({ version: STORAGE_VERSION, events: this.queue }));
    } catch {
      // Storage unavailable; retain in memory.
    }
  }
}
