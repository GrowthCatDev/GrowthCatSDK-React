import { ApiClient } from "../core/api";
import { GrowthCatLogger } from "../core/logger";
import { installId, makeAdEventId } from "../core/install-id";
import { AdObject, AdEventName, AdEventPayload } from "../models/ads";

const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_THRESHOLD = 10;
const IMMEDIATE_EVENTS: AdEventName[] = ["impression", "click"];
const STORAGE_KEY = "growthcat_offline_ad_events";

function currentLocale(): string | undefined {
  try {
    return navigator.language ?? undefined;
  } catch {
    return undefined;
  }
}

export class AdEventTracker {
  private queue: AdEventPayload[] = [];
  private readonly api: ApiClient;
  private readonly logger: GrowthCatLogger;
  private readonly maxOffline: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isOnline = true;

  constructor(api: ApiClient, logger: GrowthCatLogger, maxOffline = 500) {
    this.api = api;
    this.logger = logger;
    this.maxOffline = maxOffline;
    this.loadOfflineQueue();
    this.startPeriodicFlush();
    this.watchConnectivity();
  }

  track(
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
    const payload: AdEventPayload = {
      sdk_event_id: makeAdEventId(eventName, options.format),
      format: options.format,
      campaign_id: ad.campaign.id,
      creative_id: ad.creative.id,
      event_name: eventName,
      locale: currentLocale(),
      app_user_id: options.appUserId,
      session_id: options.sessionId,
      sdk_install_id: installId(),
      tracking_token: ad.tracking.token,
      occurred_at: new Date().toISOString(),
      metadata: options.metadata,
    };

    if (IMMEDIATE_EVENTS.includes(eventName)) {
      this.flushSingle(payload);
    } else {
      this.enqueue(payload);
      if (this.queue.length >= FLUSH_THRESHOLD) {
        void this.flush();
      }
    }
  }

  async flush() {
    if (this.queue.length === 0) return;
    const batch = [...this.queue];
    this.queue = [];

    try {
      await this.api.sendAdEvents({ events: batch });
      this.persistOfflineQueue();
      this.logger.log(`[Ads] flushed ${batch.length} event(s)`);
    } catch {
      this.logger.warn(`[Ads] flush failed — queuing ${batch.length} event(s) offline`);
      this.enqueueMany(batch);
      this.persistOfflineQueue();
    }
  }

  shutdown() {
    if (this.flushTimer != null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async flushSingle(payload: AdEventPayload) {
    try {
      await this.api.sendAdEvents({ events: [payload] });
    } catch {
      this.enqueue(payload);
      this.persistOfflineQueue();
    }
  }

  private enqueue(payload: AdEventPayload) {
    this.queue.push(payload);
    if (this.queue.length > this.maxOffline) {
      this.queue.shift();
    }
  }

  private enqueueMany(payloads: AdEventPayload[]) {
    for (const p of payloads) this.enqueue(p);
  }

  private startPeriodicFlush() {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private watchConnectivity() {
    if (typeof window === "undefined") return;
    window.addEventListener("online", () => {
      if (!this.isOnline) {
        this.isOnline = true;
        this.logger.log("[Ads] connectivity restored — flushing offline queue");
        void this.flush();
      }
    });
    window.addEventListener("offline", () => {
      this.isOnline = false;
    });
  }

  private persistOfflineQueue() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch {
      // storage unavailable
    }
  }

  private loadOfflineQueue() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored) as AdEventPayload[];
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // storage unavailable
    }
  }
}
