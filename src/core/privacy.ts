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

  constructor(initialMode: GrowthCatMeasurementMode) {
    this.mode = initialMode;
  }

  get measurementMode(): GrowthCatMeasurementMode {
    return this.mode;
  }

  get sessionId(): string {
    return this.analyticsSessionId;
  }

  setMode(mode: GrowthCatMeasurementMode): void {
    if (mode === this.mode) return;
    const previousMode = this.mode;
    this.mode = mode;

    // Moving away from analytics invalidates the prior optional-measurement
    // session so it cannot be correlated if analytics is enabled again later.
    if (previousMode === "analytics" && mode !== "analytics") {
      this.analyticsSessionId = makeSessionId();
    }

    for (const listener of this.listeners) listener(mode, previousMode);
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

