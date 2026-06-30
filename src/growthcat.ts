import { GrowthCatInitOptions, buildConfiguration } from "./core/config";
import { GrowthCatDebugLogger } from "./core/logger";
import { makeSessionId } from "./core/install-id";
import { GrowthCatClient } from "./client";

let _client: GrowthCatClient | null = null;

/**
 * The GrowthCat Web SDK namespace. Call `GrowthCat.initialize()` once at
 * app startup before any other SDK calls.
 */
export const GrowthCat = {
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
    if (_client) _client.shutdown();

    const config = buildConfiguration(options);
    _client = new GrowthCatClient(config);

    const logger = new GrowthCatDebugLogger(config.logsEnabled);
    logger.logInitialization(config.apiKey, config.baseUrl);

    // Fetch bootstrap in the background with exponential backoff.
    void bootstrapWithRetry(_client);
  },

  /** Whether `initialize` has been called. */
  get isConfigured(): boolean {
    return _client !== null;
  },

  /** The active SDK client. Throws if `initialize` has not been called. */
  get shared(): GrowthCatClient {
    if (!_client) {
      throw new Error(
        "[GrowthCat] Not initialized. Call GrowthCat.initialize() before accessing GrowthCat.shared."
      );
    }
    return _client;
  },

  /**
   * Generates a new session ID for correlating events within a single user
   * session. Pass it in `context.sessionId` and ad tracking calls.
   */
  makeSessionId(): string {
    return makeSessionId();
  },

  /** Convenience shortcut — delegates to `GrowthCat.shared.setAppUserId()`. */
  setAppUserId(userId: string): void {
    GrowthCat.shared.setAppUserId(userId);
  },

  /**
   * Handles a GrowthCat attribution link from the current page URL.
   * Call this once on page load to claim any pending attribution token.
   */
  handleCurrentUrl(): void {
    if (typeof window === "undefined") return;
    void GrowthCat.shared.handleLink(window.location.href);
  },
};

async function bootstrapWithRetry(
  client: GrowthCatClient,
  maxAttempts = 4
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await client.refreshSDKBootstrap();
      return;
    } catch {
      if (attempt === maxAttempts) return;
      const delayMs = Math.pow(2, attempt) * 1000;
      await sleep(delayMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
