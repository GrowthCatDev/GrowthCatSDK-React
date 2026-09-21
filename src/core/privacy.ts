import { makeSessionId } from "./install-id";

export type GrowthCatMeasurementMode = "essential" | "analytics" | "disabled";

type MeasurementListener = (
  mode: GrowthCatMeasurementMode,
  previousMode: GrowthCatMeasurementMode
) => void;

/** Runtime privacy state shared by all SDK services for one client instance. */
export class MeasurementState {
  private mode: GrowthCatMeasurementMode;
  private analyticsSessionId = makeSessionId();
  private readonly listeners = new Set<MeasurementListener>();

  constructor(initialMode: GrowthCatMeasurementMode, private readonly storageKey?: string) {
    this.mode = initialMode;
    if (storageKey && typeof window !== "undefined") window.addEventListener("storage", this.onStorage);
  }

  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key !== this.storageKey || !event.newValue) return;
    // Revocation propagates across tabs; consent must always be granted explicitly by the host.
    if (event.newValue === "disabled" || (event.newValue === "essential" && this.mode === "analytics")) this.setMode(event.newValue);
  };

  shutdown(): void {
    if (typeof window !== "undefined") window.removeEventListener("storage", this.onStorage);
    this.listeners.clear();
  }

  get measurementMode(): GrowthCatMeasurementMode {
    return this.mode;
  }

  get sessionId(): string {
    return this.analyticsSessionId;
  }

  setMode(mode: GrowthCatMeasurementMode): void {
    if (!["essential", "analytics", "disabled"].includes(mode)) throw new TypeError("Invalid measurement mode.");
    if (mode === this.mode) return;
    const previousMode = this.mode;
    this.mode = mode;
    if (this.storageKey) {
      try { localStorage.setItem(this.storageKey, mode); } catch { /* storage unavailable */ }
    }

    // Moving away from analytics invalidates the prior optional-measurement
    // session so it cannot be correlated if analytics is enabled again later.
    if (previousMode === "analytics" && mode !== "analytics") {
      this.analyticsSessionId = makeSessionId();
    }

    for (const listener of this.listeners) listener(mode, previousMode);
  }

  rotateSession(): void {
    this.analyticsSessionId = makeSessionId();
  }

  subscribe(listener: MeasurementListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  allowsOptionalAnalytics(): boolean {
    return this.mode === "analytics";
  }

  allowsEssentialMeasurement(): boolean {
    return this.mode !== "disabled";
  }
}
