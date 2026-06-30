export interface GrowthCatLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
  logAdDiagnostic(message: string): void;
  logAdNoFill(placementKey: string): void;
}

export class GrowthCatDebugLogger implements GrowthCatLogger {
  private readonly enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  log(message: string) {
    if (this.enabled) console.log(`[GrowthCat] ${message}`);
  }

  warn(message: string) {
    if (this.enabled) console.warn(`[GrowthCat] ${message}`);
  }

  error(message: string, error?: unknown) {
    if (this.enabled) console.error(`[GrowthCat] ${message}`, error ?? "");
  }

  logInitialization(apiKey: string, baseUrl: string) {
    this.log(`initialized — key=${apiKey.slice(0, 12)}… baseURL=${baseUrl}`);
  }

  logBootstrapSuccess() {
    this.log("SDK bootstrap fetched successfully");
  }

  logBootstrapFailed(error: unknown) {
    this.error("SDK bootstrap fetch failed", error);
  }

  logAdDiagnostic(message: string): void {
    this.log(`[Ads] ${message}`);
  }

  logAdNoFill(placementKey: string): void {
    this.log(`[Ads] no fill for placementKey=${placementKey}`);
  }
}

export const silentLogger: GrowthCatLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
  logAdDiagnostic: () => {},
  logAdNoFill: () => {},
};
