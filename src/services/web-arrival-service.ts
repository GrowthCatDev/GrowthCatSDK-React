import type { ApiClient } from "../core/api";
import type { MeasurementState } from "../core/privacy";
import type { AttributionAssignment } from "../models/attribution";
import { GrowthCatError } from "../models/errors";

export interface WebAttributionState {
  kind: "web_arrival";
  status: "idle" | "awaiting_consent" | "awaiting_identity" | "claiming" | "attributed" | "failed";
  assignment: AttributionAssignment | null;
  error: GrowthCatError | null;
}
interface Pending { token: string; expiresAt: number; }

/** Explicit, consented website arrival. Never infers a campaign from UTM values. */
export class WebArrivalService {
  private pending: Pending | null = null;
  private generation = 0;
  private inFlight: Promise<AttributionAssignment | null> | null = null;
  private completed = new Map<string, AttributionAssignment>();
  private stopped = false;
  private readonly listeners = new Set<(state: WebAttributionState) => void>();
  private readonly unsubscribe: () => void;
  private value: WebAttributionState = { kind: "web_arrival", status: "idle", assignment: null, error: null };
  constructor(private readonly api: ApiClient, private readonly measurement: MeasurementState,
    private readonly userId: () => string | null) {
    this.unsubscribe = measurement.subscribe(mode => {
      if (mode !== "analytics") this.clear();
      else if (this.value.status === "awaiting_consent") void this.capture().catch(() => {});
    });
    if (measurement.allowsOptionalAnalytics()) this.pending = this.loadPending();
  }
  get state(): WebAttributionState { return this.value; }
  subscribe(listener: (state: WebAttributionState) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private update(status: WebAttributionState["status"], assignment: AttributionAssignment | null = null, error: GrowthCatError | null = null) {
    this.value = { kind: "web_arrival", status, assignment, error };
    for (const listener of this.listeners) listener(this.value);
  }
  async capture(url?: string): Promise<AttributionAssignment | null> {
    if (this.stopped) throw GrowthCatError.notInitialized();
    if (!this.measurement.allowsOptionalAnalytics()) { this.update("awaiting_consent"); return null; }
    const token = extractWebToken(url ?? (typeof window !== "undefined" ? window.location.href : ""));
    const cached = token && this.userId() ? this.completed.get(`${token}:${this.userId()}`) : undefined;
    if (cached) return this.restoreCached(cached);
    if (token && token !== this.pending?.token) {
      this.generation++; this.inFlight = null;
      this.pending = { token, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 };
      this.savePending();
    }
    if (this.pending && this.pending.expiresAt <= Date.now()) { this.pending = null; this.savePending(); }
    if (!this.pending) return this.value.assignment;
    const user = this.userId();
    if (!user) { this.update("awaiting_identity"); return null; }
    const pending = this.pending, key = `${pending.token}:${user}`;
    const completed = this.completed.get(key);
    if (completed) return this.restoreCached(completed);
    if (this.inFlight) return this.inFlight;
    const generation = this.generation;
    this.update("claiming");
    const request = this.api.claimAttribution({ app_user_id: user, sdk_install_id: this.api.installId,
      platform: "web", token: pending.token, match_type: "explicit_token", metadata: { growthcat_platform: "web" } })
      .then(assignment => {
        if (this.stopped || generation !== this.generation || user !== this.userId() || !this.measurement.allowsOptionalAnalytics()) return null;
        this.completed.set(key, assignment); this.pending = null; this.savePending();
        this.update("attributed", assignment); return assignment;
      }).catch(value => {
        if (this.stopped || generation !== this.generation || user !== this.userId()) return null;
        const error = value instanceof GrowthCatError ? value : GrowthCatError.unknown();
        this.update("failed", null, error); throw error;
      }).finally(() => { if (this.inFlight === request) this.inFlight = null; });
    this.inFlight = request;
    return request;
  }
  private restoreCached(assignment: AttributionAssignment): AttributionAssignment {
    // A cached revisit replaces pending state for a different campaign and
    // invalidates any late response from that superseded request.
    this.generation++; this.inFlight = null; this.pending = null; this.savePending();
    this.update("attributed", assignment);
    return assignment;
  }
  identityChanged(previous: string | null): void {
    this.generation++; this.inFlight = null;
    if (previous) this.clear();
    else { this.update("idle"); void this.capture().catch(() => {}); }
  }
  clear(): void {
    this.generation++; this.inFlight = null; this.pending = null; this.completed.clear(); this.savePending(); this.update("idle");
  }
  shutdown(): void { this.stopped = true; this.generation++; this.unsubscribe(); this.listeners.clear(); }
  private savePending(): void {
    try { if (this.pending) sessionStorage.setItem(this.api.storageKey("web_arrival"), JSON.stringify(this.pending));
      else sessionStorage.removeItem(this.api.storageKey("web_arrival")); } catch { /* memory-only without storage */ }
  }
  private loadPending(): Pending | null {
    try {
      const value = JSON.parse(sessionStorage.getItem(this.api.storageKey("web_arrival")) ?? "null");
      if (value && typeof value.token === "string" && /^[a-z0-9]{3,64}$/i.test(value.token) && value.expiresAt > Date.now()) return value;
    } catch { /* invalid or unavailable storage */ }
    return null;
  }
}
function extractWebToken(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    const token = parsed.searchParams.get("gc_token");
    return token && /^[a-z0-9]{3,64}$/i.test(token) ? token : null;
  } catch { return null; }
}
