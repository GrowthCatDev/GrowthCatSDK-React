import { ApiClient } from "../core/api";
import { GrowthCatLogger } from "../core/logger";
import { makeAdEventId, makeCreativeInstanceId } from "../core/install-id";
import { MeasurementState } from "../core/privacy";
import { EventQueue, isQueuedEvent } from "../core/event-queue";
import { GROWTHCAT_WEB_SDK_VERSION } from "../core/version";
import { GrowthCatError } from "../models/errors";
import { AdObject, AdEventName, AdEventPayload, AdEventTrackingOptions, AdEventMetadata } from "../models/ads";

export function qualifiedImpression(fraction?: number, duration?: number): boolean {
  return Number.isFinite(fraction) && Number.isFinite(duration) && fraction! >= 0.5 && fraction! <= 1 && duration! >= 1000 && duration! <= 86400000;
}
export class AdEventTracker {
  private readonly queue: EventQueue<AdEventPayload>;
  private readonly unsubscribe: () => void;
  private readonly billed = new Set<string>();
  constructor(private readonly api: ApiClient, _logger: GrowthCatLogger, private readonly measurement: MeasurementState, maxOffline = 500) {
    this.queue = new EventQueue<AdEventPayload>({
      key: api.storageKey("ad_events"), maxEvents: maxOffline,
      allowed: event => measurement.allowsEssentialMeasurement() && (event.measurement_mode !== "analytics" || measurement.allowsOptionalAnalytics()),
      valid: (event): event is AdEventPayload => isQueuedEvent(event) && typeof (event as AdEventPayload).tracking_token === "string" && typeof (event as AdEventPayload).campaign_id === "string",
      send: event => api.sendAdEvents({ schema_version: 2, events: [event] }),
      notify: status => api.notifyDelivery(status),
    });
    this.unsubscribe = measurement.subscribe(() => this.queue.filter());
  }
  track(name: AdEventName, ad: AdObject, options: AdEventTrackingOptions): void {
    if (!this.measurement.allowsEssentialMeasurement()) return;
    const format = options.format ?? ad.placement?.format;
    if (!format) throw GrowthCatError.unknown("Ad tracking requires a format.");
    if (name === "impression" && !qualifiedImpression(options.metadata?.visible_fraction, options.metadata?.visible_duration_ms)) return;
    const instance = options.creativeInstanceId ?? makeCreativeInstanceId();
    const key = instance + ":" + name;
    if (name === "impression" || name === "click") {
      if (this.billed.has(key)) return;
      this.billed.add(key);
      if (this.billed.size > 2000) this.billed.delete(this.billed.values().next().value!);
    }
    const metadata: AdEventMetadata = { measurement_version: 2 };
    if (name === "impression") {
      metadata.visible_fraction = options.metadata!.visible_fraction;
      metadata.visible_duration_ms = Math.round(options.metadata!.visible_duration_ms!);
    }
    if (name === "video_progress" || name === "video_complete" || name === "video_start") {
      const position = options.metadata?.player_position_ms;
      if (Number.isFinite(position)) metadata.player_position_ms = Math.max(0, Math.min(86400000, Math.round(position!)));
      if ([25, 50, 75, 100].includes(options.metadata?.quartile ?? -1)) metadata.quartile = options.metadata?.quartile;
    }
    const analytics = this.measurement.allowsOptionalAnalytics();
    this.queue.enqueue({
      sdk_event_id: makeAdEventId(name, format), creative_instance_id: instance, format,
      campaign_id: ad.campaign.id, creative_id: ad.creative.id, event_name: name,
      locale: typeof navigator !== "undefined" ? navigator.language : undefined,
      app_user_id: analytics ? options.appUserId : undefined,
      session_id: analytics ? options.sessionId ?? this.measurement.sessionId : undefined,
      sdk_install_id: this.api.installId, tracking_token: ad.tracking.token,
      occurred_at: new Date().toISOString(), measurement_mode: this.measurement.measurementMode,
      sdk_version: GROWTHCAT_WEB_SDK_VERSION, metadata,
    });
  }
  flush(): Promise<void> { return this.queue.flush(); }
  clearOptionalEvents(): void { this.queue.removeWhere((event) => event.measurement_mode === "analytics"); }
  setMaxOfflineEvents(max: number): void { this.queue.setMaxEvents(max); }
  shutdown(): void { this.unsubscribe(); this.queue.shutdown(); }
}
