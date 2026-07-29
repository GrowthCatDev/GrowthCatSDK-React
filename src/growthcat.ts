import { GrowthCatInitOptions, buildConfiguration } from "./core/config";
import { GrowthCatDebugLogger } from "./core/logger";
import { configureIdentityScope, makeCreativeInstanceId, makeSessionId } from "./core/install-id";
import type { GrowthCatMeasurementMode } from "./core/privacy";
import { GrowthCatClient } from "./client";
import { GrowthCatError } from "./models/errors";
import type { AttributionAssignment } from "./models/attribution";
import { GROWTHCAT_WEB_SDK_VERSION } from "./core/version";

let _client: GrowthCatClient | null = null;
let _readyPromise: Promise<GrowthCatClient> | null = null;

/**
 * The GrowthCat Web SDK namespace. Call `GrowthCat.initialize()` once at
 * app startup before any other SDK calls.
 */
export const GrowthCat = {
  /** Installed SDK version. */
  version: GROWTHCAT_WEB_SDK_VERSION,

  /**
   * Initializes the SDK. Safe to call multiple times — a previous instance is
   * torn down automatically.
   *
   * @example
   * GrowthCat.initialize({
   *   apiKey: "gc_live_your_key_here",
   *   logsEnabled: process.env.NODE_ENV !== "production",
   * });
  */
  initialize(options: GrowthCatInitOptions): void {
    const config = buildConfiguration(options);
    if (_client) _client.shutdown();

    configureIdentityScope(config.apiKey, config.baseUrl);
    _client = new GrowthCatClient(config);

    const logger = new GrowthCatDebugLogger(config.logsEnabled);
    logger.logInitialization(config.apiKey, config.baseUrl);

    // Fetch bootstrap in the background with exponential backoff.
    const initializedClient = _client;
    _readyPromise = bootstrapWithRetry(initializedClient, logger).then(() => initializedClient);
    // Preserve fire-and-forget initialization without an unhandled rejection
    // when the host does not need to await readiness.
    void _readyPromise.catch(() => {});
  },

  /** Whether `initialize` has been called. */
  get isConfigured(): boolean {
    return _client !== null;
  },

  /** The active SDK client. Throws if `initialize` has not been called. */
  get shared(): GrowthCatClient {
    if (!_client) {
      throw GrowthCatError.notInitialized();
    }
    return _client;
  },

  /** Resolves after the initial SDK bootstrap succeeds. */
  ready(): Promise<GrowthCatClient> {
    if (!_readyPromise) return Promise.reject(GrowthCatError.notInitialized());
    return _readyPromise;
  },

  /** Stops background work and clears the active singleton client. */
  shutdown(): void {
    _client?.shutdown();
    _client = null;
    _readyPromise = null;
  },

  /**
   * Generates a new session ID for correlating events within a single user
   * session. Pass it in `context.sessionId` and ad tracking calls.
   */
  makeSessionId(): string {
    return makeSessionId();
  },

  /** Generates an ID shared by all events for one rendered creative. */
  makeCreativeInstanceId(): string {
    return makeCreativeInstanceId();
  },

  /** Convenience shortcut — delegates to `GrowthCat.shared.setAppUserId()`. */
  setAppUserId(userId: string): void {
    GrowthCat.shared.setAppUserId(userId);
  },

  /** Clears the persisted attribution identity, typically during sign-out. */
  clearAppUserId(): void {
    GrowthCat.shared.clearAppUserId();
  },

  /** Applies a host-app consent change immediately. */
  setMeasurementMode(mode: GrowthCatMeasurementMode): void {
    GrowthCat.shared.setMeasurementMode(mode);
  },

  /**
   * Handles a GrowthCat attribution link from the current page URL.
   * Call this once on page load to claim any pending attribution token.
   */
  handleCurrentUrl(): Promise<AttributionAssignment | null> {
    if (typeof window === "undefined") return Promise.resolve(null);
    return GrowthCat.shared.handleLink(window.location.href);
  },
};

async function bootstrapWithRetry(
  client: GrowthCatClient,
  logger: GrowthCatDebugLogger,
  maxAttempts = 4
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (client.isShutdown) throw GrowthCatError.unknown("SDK client was shut down.");
    try {
      await client.refreshSDKBootstrap();
      return;
    } catch (error) {
      logger.logBootstrapFailed(error);
      if (attempt === maxAttempts || !isRetryableBootstrapError(error)) throw error;
      const delayMs = Math.pow(2, attempt) * 1000;
      await sleep(delayMs);
    }
  }
}

function isRetryableBootstrapError(error: unknown): boolean {
  if (!(error instanceof GrowthCatError)) return false;
  return error.code === "network" ||
    error.code === "rate_limited" ||
    (error.code === "server" && (error.statusCode ?? 500) >= 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
