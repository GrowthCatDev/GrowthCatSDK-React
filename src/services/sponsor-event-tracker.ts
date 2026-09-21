import { ApiClient } from "../core/api";
import { makeAdEventId, makeCreativeInstanceId } from "../core/install-id";
import { GrowthCatLogger } from "../core/logger";
import { MeasurementState } from "../core/privacy";
import { EventQueue, isQueuedEvent } from "../core/event-queue";
import { GROWTHCAT_WEB_SDK_VERSION } from "../core/version";
import { SponsorCreative, SponsorEventName, SponsorEventPayload, SponsorSlotContent } from "../models/sponsor";
import { qualifiedImpression } from "./ad-event-tracker";

export interface SponsorEventOptions {
  creativeInstanceId?: string;
  sessionId?: string;
  visibleFraction?: number;
  visibleDurationMs?: number;
  creative?: SponsorCreative;
}
export class SponsorEventTracker {
  private readonly queue: EventQueue<SponsorEventPayload>;
  private readonly unsubscribe: () => void;
  private readonly billed = new Set<string>();
  constructor(private readonly api: ApiClient, _logger: GrowthCatLogger, private readonly measurement: MeasurementState) {
    this.queue = new EventQueue<SponsorEventPayload>({
      key: api.storageKey("sponsor_events"), maxEvents: 100,
      allowed: event => measurement.allowsEssentialMeasurement() && (event.measurement_mode !== "analytics" || measurement.allowsOptionalAnalytics()),
      valid: (event): event is SponsorEventPayload => isQueuedEvent(event) && typeof (event as SponsorEventPayload).booking_id === "string" && typeof (event as SponsorEventPayload).tracking_token === "string",
      send: event => api.sendSponsorEvents({ schema_version: 2, events: [event] }),
      notify: status => api.notifyDelivery(status),
    });
    this.unsubscribe = measurement.subscribe(() => this.queue.filter());
  }
  track(slotKey: string, name: SponsorEventName, sponsor: SponsorSlotContent, options: SponsorEventOptions = {}): boolean {
    if (!this.measurement.allowsEssentialMeasurement()) return false;
    const creative = options.creative ?? sponsor.creative;
    if (!creative?.bookingId || !creative.trackingToken) return false;
    if (name === "impression" && !qualifiedImpression(options.visibleFraction, options.visibleDurationMs)) return false;
    const instance = options.creativeInstanceId ?? makeCreativeInstanceId();
    const key = instance + ":" + name;
    if (this.billed.has(key)) return false;
    this.billed.add(key);
    if (this.billed.size > 2000) this.billed.delete(this.billed.values().next().value!);
    this.queue.enqueue({
      schema_version: 2, sdk_event_id: makeAdEventId(name, "sponsor"), creative_instance_id: instance,
      slot_key: slotKey, booking_id: creative.bookingId, tracking_token: creative.trackingToken,
      event_name: name, occurred_at: new Date().toISOString(), measurement_mode: this.measurement.measurementMode,
      sdk_install_id: this.api.installId,
      session_id: this.measurement.allowsOptionalAnalytics() ? options.sessionId ?? this.measurement.sessionId : undefined,
      locale: typeof navigator !== "undefined" ? navigator.language : undefined,
      sdk_version: GROWTHCAT_WEB_SDK_VERSION,
      metadata: { measurement_version: 2, visible_fraction: options.visibleFraction, visible_duration_ms: options.visibleDurationMs },
    });
    return true;
  }
  flush(): Promise<void> { return this.queue.flush(); }
  clear(): void { this.queue.clear(); }
  shutdown(): void { this.unsubscribe(); this.queue.shutdown(); }
}
