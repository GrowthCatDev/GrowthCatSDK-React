import { ApiClient } from "../core/api";
import { MeasurementState } from "../core/privacy";
import { GrowthCatLogger } from "../core/logger";
import { EventQueue, isQueuedEvent } from "../core/event-queue";
import { AnalyticsEventRequest, GrowthCatAnalyticsEventName, GrowthCatAnalyticsValue, ReferralClickRequest } from "../models/referral";

const PROPERTY_ALLOWLIST: Record<GrowthCatAnalyticsEventName, ReadonlySet<string>> = {
  session_started: new Set(["session_reason"]),
  paywall_viewed: new Set(["paywall_variant", "offering_id", "placement", "has_intro_offer"]),
  checkout_started: new Set(["product_id", "package_id", "offering_id"]),
  checkout_cancelled: new Set(["product_id", "package_id", "reason", "purchase_result"]),
  purchase_sdk_completed: new Set(["product_id", "package_id", "store", "purchase_result"]),
};

export function sanitizeAnalyticsProperties(name: GrowthCatAnalyticsEventName, properties?: Record<string, GrowthCatAnalyticsValue>): Record<string, GrowthCatAnalyticsValue> | undefined {
  const allowed = PROPERTY_ALLOWLIST[name];
  if (!allowed) throw new TypeError("Unsupported analytics event.");
  if (!properties) return undefined;
  const output: Record<string, GrowthCatAnalyticsValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!allowed.has(key)) continue;
    if (key === "session_reason" && value !== "initial" && value !== "resumed") continue;
    if (key === "has_intro_offer" && typeof value !== "boolean") continue;
    if (typeof value === "string") output[key] = value.slice(0, 255);
    else if (key === "has_intro_offer" && typeof value === "boolean") output[key] = value;
  }
  return Object.keys(output).length ? output : undefined;
}

type FunnelEvent = AnalyticsEventRequest;
export class AnalyticsEventTracker {
  private readonly queue: EventQueue<FunnelEvent>;
  private readonly unsubscribe: () => void;
  constructor(api: ApiClient, _logger: GrowthCatLogger, measurement: MeasurementState) {
    this.queue = new EventQueue<FunnelEvent>({
      key: api.storageKey("analytics_events"), maxEvents: 100,
      allowed: () => measurement.allowsOptionalAnalytics(),
      valid: (event): event is FunnelEvent => isQueuedEvent(event) && typeof (event as FunnelEvent).event_name === "string",
      send: event => event.event_name === "referral_click" ? api.recordReferralClick(event as ReferralClickRequest) : api.recordAnalyticsEvent(event),
      notify: status => api.notifyDelivery(status),
    });
    this.unsubscribe = measurement.subscribe(() => this.queue.filter());
  }
  enqueue(event: FunnelEvent): void { this.queue.enqueue(event); }
  flush(): Promise<void> { return this.queue.flush(); }
  clear(): void { this.queue.clear(); }
  shutdown(): void { this.unsubscribe(); this.queue.shutdown(); }
}
