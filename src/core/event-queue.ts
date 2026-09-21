import { GrowthCatError } from "../models/errors";
import { GrowthCatDeliveryStatus } from "./config";

export interface QueuedEvent {
  sdk_event_id: string;
  measurement_mode: string;
  occurred_at?: string;
  event_at?: string;
}

/** Each event owns a storage key so independent tabs never overwrite a whole queue. */
export class EventQueue<T extends QueuedEvent> {
  private readonly events = new Map<string, T>();
  private pending: Promise<void> | null = null;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAt = 0;
  private attempts = 0;
  private maxEvents: number;
  private generation = 0;
  private readonly onWake = () => { void this.flush(); };

  constructor(private readonly options: {
    key: string;
    maxEvents: number;
    allowed: (event: T) => boolean;
    valid: (event: unknown) => event is T;
    send: (event: T) => Promise<unknown>;
    notify?: (status: GrowthCatDeliveryStatus) => void;
  }) {
    this.maxEvents = options.maxEvents;
    this.restore();
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onWake);
      window.addEventListener("pagehide", this.onWake);
      window.addEventListener("storage", this.onWake);
    }
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onWake);
  }

  enqueue(event: T): void {
    if (this.stopped || !this.options.valid(event) || !this.options.allowed(event)) return;
    this.events.set(event.sdk_event_id, event);
    try { localStorage.setItem(this.key(event.sdk_event_id), JSON.stringify(event)); } catch { /* memory remains available */ }
    this.prune();
    this.notify(event, "queued");
    void this.flush();
  }

  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.pending) return this.pending;
    if (Date.now() < this.retryAt) return Promise.resolve();
    const drain = async () => {
      if (this.stopped) return;
      this.restore();
      while (!this.stopped && this.events.size) {
        this.prune();
        const event = this.events.values().next().value as T | undefined;
        if (!event) break;
        const generation = this.generation;
        try {
          await this.options.send(event);
          this.remove(event.sdk_event_id);
          this.attempts = 0;
          this.notify(event, "delivered");
        } catch (error) {
          if (this.stopped) return;
          if (generation !== this.generation || !this.options.allowed(event)) continue;
          const retryable = !(error instanceof GrowthCatError) || error.code === "network" ||
            error.code === "rate_limited" || (error.code === "server" && (error.statusCode ?? 500) >= 500);
          if (!retryable) {
            this.remove(event.sdk_event_id);
            this.notify(event, "rejected", error instanceof GrowthCatError ? error.statusCode : undefined);
            continue;
          }
          const backoff = Math.min(60_000, 1000 * 2 ** Math.min(++this.attempts, 6));
          const retryAfter = error instanceof GrowthCatError ? error.retryAfter : undefined;
          const delay = Number.isFinite(retryAfter) ? Math.max(1000, Math.min(86400000, retryAfter! * 1000)) : backoff + Math.random() * 500;
          this.retryAt = Date.now() + delay;
          this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flush(); }, delay);
          return;
        }
      }
    };
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    this.pending = Promise.resolve(locks ? locks.request(this.options.key, drain) : drain()).then(() => {}).finally(() => { this.pending = null; });
    return this.pending;
  }

  filter(): void {
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = 0;
    this.restore();
    this.prune();
  }

  clear(): void {
    this.filter();
    for (const id of this.events.keys()) this.remove(id);
  }

  removeWhere(predicate: (event: T) => boolean): void {
    this.filter();
    for (const [id, event] of this.events) if (predicate(event)) this.remove(id);
  }

  setMaxEvents(max: number): void {
    if (!Number.isFinite(max) || max < 1) return;
    this.maxEvents = Math.floor(max);
    this.prune();
  }

  shutdown(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onWake);
      window.removeEventListener("pagehide", this.onWake);
      window.removeEventListener("storage", this.onWake);
    }
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onWake);
  }

  private key(id: string): string { return `${this.options.key}:${id}`; }
  private remove(id: string): void {
    this.events.delete(id);
    try { localStorage.removeItem(this.key(id)); } catch { /* storage unavailable */ }
  }
  private notify(event: T, state: GrowthCatDeliveryStatus["state"], statusCode?: number): void {
    try { this.options.notify?.({ eventId: event.sdk_event_id, state, statusCode }); } catch { /* host callbacks cannot break delivery */ }
  }
  private restore(): void {
    try {
      const prefix = `${this.options.key}:`;
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        try {
          const event: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
          if (this.options.valid(event) && key === this.key(event.sdk_event_id)) this.events.set(event.sdk_event_id, event);
          else localStorage.removeItem(key);
        } catch { localStorage.removeItem(key); }
      }
    } catch { /* storage unavailable */ }
    this.prune();
  }
  private prune(): void {
    const cutoff = Date.now() - 72 * 60 * 60 * 1000;
    for (const [id, event] of this.events) {
      const time = Date.parse(event.occurred_at ?? event.event_at ?? "");
      if (!this.options.allowed(event) || !Number.isFinite(time) || time < cutoff || time > Date.now() + 300000) this.remove(id);
    }
    while (this.events.size > this.maxEvents) this.remove(this.events.keys().next().value!);
  }
}

export function isQueuedEvent(value: unknown): value is QueuedEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as QueuedEvent;
  return typeof event.sdk_event_id === "string" && /^[a-f0-9-]{36}$/i.test(event.sdk_event_id) &&
    ["essential", "analytics"].includes(event.measurement_mode) &&
    new TextEncoder().encode(JSON.stringify(value)).length < 48 * 1024;
}
