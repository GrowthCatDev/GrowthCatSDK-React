import { GrowthCatConfiguration } from "./core/config";
import { ApiClient } from "./core/api";
import { GrowthCatDebugLogger } from "./core/logger";
import { AdService } from "./services/ad-service";
import { AttributionService } from "./services/attribution-service";
import { FeedbackService } from "./services/feedback-service";
import {
  GrowthCatSDKBootstrap,
  GrowthCatSDKConfig,
  GrowthCatSDKAdsConfig,
} from "./models/bootstrap";
import {
  ReferralRedemptionResult,
  GrowthCatAnalyticsContext,
  GrowthCatAnalyticsEventName,
  GrowthCatAnalyticsValue,
} from "./models/referral";
import {
  AdObject,
  AdFormat,
  AdEventName,
  AdRewardValidationResponse,
} from "./models/ads";
import {
  AttributionLink,
  AttributionAssignment,
  AttributionResolveResult,
  GrowthCatRewards,
} from "./models/attribution";
import {
  FeedbackUser,
  FeedbackSubmission,
  FeedbackSubmitResult,
  FeedbackVoteResult,
  FeedbackBoardItem,
  FeedbackType,
  GrowthCatFeedbackTheme,
  GrowthCatFeedbackStrings,
} from "./models/feedback";
import { GrowthCatError } from "./models/errors";

export class GrowthCatClient {
  private readonly config: GrowthCatConfiguration;
  private readonly api: ApiClient;
  private readonly logger: GrowthCatDebugLogger;
  readonly adService: AdService;
  readonly attributionService: AttributionService;
  readonly feedbackService: FeedbackService;

  private bootstrapCache: GrowthCatSDKBootstrap | null = null;
  private shutdownFlag = false;

  constructor(config: GrowthCatConfiguration) {
    this.config = config;
    this.logger = new GrowthCatDebugLogger(config.logsEnabled);
    this.api = new ApiClient(config);
    this.adService = new AdService(this.api, this.logger);
    this.attributionService = new AttributionService(this.api, this.logger);
    this.feedbackService = new FeedbackService(this.api, this.logger);
  }

  get isConfigured(): boolean {
    return true;
  }

  get sdkConfig(): GrowthCatSDKConfig | null {
    return this.bootstrapCache?.sdkConfig ?? null;
  }

  get sdkBootstrap(): GrowthCatSDKBootstrap | null {
    return this.bootstrapCache;
  }

  get adsConfig(): GrowthCatSDKAdsConfig | null {
    return this.bootstrapCache?.adsConfig ?? null;
  }

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  async refreshSDKBootstrap(): Promise<GrowthCatSDKBootstrap> {
    const bootstrap = await this.api.fetchSDKBootstrap();
    this.bootstrapCache = bootstrap;
    this.adService.configure(bootstrap.adsConfig);
    this.logger.logBootstrapSuccess();
    return bootstrap;
  }

  async refreshSDKConfig(): Promise<GrowthCatSDKConfig> {
    const bootstrap = await this.refreshSDKBootstrap();
    return bootstrap.sdkConfig;
  }

  // ─── Referral ──────────────────────────────────────────────────────────────

  async validateReferralCode(
    code: string,
    context?: GrowthCatAnalyticsContext
  ): Promise<ReferralRedemptionResult> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) throw GrowthCatError.invalidCode("Please enter a referral code.");
    if (normalized.length > 128) throw GrowthCatError.invalidCode("Referral code must be 128 characters or fewer.");

    const bootstrap = await this.resolvedBootstrap();
    if (!bootstrap.sdkConfig.allowCodeRedeemExecution) {
      throw GrowthCatError.server(409, "Code redemption is currently disabled.");
    }

    const response = await this.api.validateCode({
      code: normalized,
      app_user_id: this.attributionService.getAppUserId() ?? undefined,
      session_id: context?.sessionId,
      source: context?.source,
      locale: typeof navigator !== "undefined" ? navigator.language : undefined,
      platform: "web",
    });

    return {
      normalizedCode: response.normalized_code,
      campaign: {
        id: response.campaign.id,
        name: response.campaign.name,
        discountDescription: response.campaign.discount_description,
      },
    };
  }

  async recordReferralClick(code: string, context?: GrowthCatAnalyticsContext): Promise<void> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) throw GrowthCatError.invalidCode("Please enter a referral code.");
    await this.api.recordReferralClick({
      code: normalized,
      app_user_id: this.attributionService.getAppUserId() ?? undefined,
      session_id: context?.sessionId,
      source: context?.source,
      platform: "web",
    });
  }

  async recordAnalyticsEvent(
    eventName: GrowthCatAnalyticsEventName,
    options?: {
      code?: string;
      eventAt?: Date;
      context?: GrowthCatAnalyticsContext;
      properties?: Record<string, GrowthCatAnalyticsValue>;
    }
  ): Promise<void> {
    await this.api.recordAnalyticsEvent({
      event_name: eventName,
      app_user_id: this.attributionService.getAppUserId() ?? undefined,
      code: options?.code?.trim().toUpperCase(),
      event_at: options?.eventAt?.toISOString(),
      session_id: options?.context?.sessionId,
      source: options?.context?.source,
      properties: options?.properties,
      platform: "web",
      locale: typeof navigator !== "undefined" ? navigator.language : undefined,
    });
  }

  // ─── Ads ───────────────────────────────────────────────────────────────────

  async loadAd(options: { placementKey: string } | { format: AdFormat }): Promise<AdObject | null> {
    const bootstrap = await this.resolvedBootstrap();
    if (!bootstrap.adsConfig.adsEnabled) return null;

    if ("placementKey" in options) {
      return this.adService.loadAdByPlacementKey(options.placementKey);
    }
    return this.adService.loadAdByFormat(options.format);
  }

  trackAdEvent(
    eventName: AdEventName,
    ad: AdObject,
    options: {
      format: AdFormat;
      placementKey?: string;
      appUserId?: string;
      sessionId?: string;
      metadata?: Record<string, string>;
    }
  ) {
    this.adService.trackEvent(eventName, ad, options);
  }

  async validateAdReward(
    ad: AdObject,
    appUserId: string,
    options?: { sessionId?: string; viewedSeconds?: number; completed?: boolean }
  ): Promise<AdRewardValidationResponse> {
    return this.adService.validateReward(
      ad,
      appUserId,
      options?.sessionId,
      options?.viewedSeconds ?? 0,
      options?.completed ?? false
    );
  }

  prefetchAdCatalogs(placementKeys: string[]) {
    if (this.bootstrapCache?.adsConfig.adsEnabled) {
      this.adService.prefetch(placementKeys);
    }
  }

  async flushAdEvents() {
    await this.adService.flush();
  }

  // ─── Attribution ───────────────────────────────────────────────────────────

  setAppUserId(userId: string) {
    this.attributionService.setAppUserId(userId);
  }

  async generateShareLink(options: {
    campaignKey: string;
    deepLinkValue?: string;
    metadata?: Record<string, string>;
  }): Promise<AttributionLink> {
    return this.attributionService.generateShareLink(options);
  }

  async handleLink(url: string): Promise<AttributionAssignment | null> {
    return this.attributionService.handleLink(url);
  }

  async resolveAttribution(sessionId?: string): Promise<AttributionResolveResult | null> {
    return this.attributionService.resolveAttribution(sessionId);
  }

  async confirmAttribution(token: string, sessionId?: string): Promise<AttributionAssignment | null> {
    return this.attributionService.confirmAttribution(token, sessionId);
  }

  async track(eventName: string, properties?: Record<string, GrowthCatAnalyticsValue>): Promise<void> {
    await this.attributionService.track(eventName, properties);
  }

  async rewards(): Promise<GrowthCatRewards> {
    return this.attributionService.rewards();
  }

  // ─── Feedback ──────────────────────────────────────────────────────────────

  configureFeedback(options: {
    user?: FeedbackUser;
    theme?: Partial<GrowthCatFeedbackTheme>;
    strings?: Partial<GrowthCatFeedbackStrings>;
    disabledAutomaticMetadataKeys?: string[];
  }) {
    if (options.user) this.feedbackService.identify(options.user);
    if (options.theme) {
      this.feedbackService.theme = { ...this.feedbackService.theme, ...options.theme };
    }
    if (options.strings) {
      this.feedbackService.strings = { ...this.feedbackService.strings, ...options.strings };
    }
    if (options.disabledAutomaticMetadataKeys) {
      for (const key of options.disabledAutomaticMetadataKeys) {
        this.feedbackService.disabledMetadataKeys.add(key);
      }
    }
  }

  identifyFeedbackUser(user: FeedbackUser) {
    this.feedbackService.identify(user);
  }

  clearFeedbackUser() {
    this.feedbackService.clearUser();
  }

  setFeedbackMetadata(metadata: Record<string, string>) {
    this.feedbackService.setMetadata(metadata);
  }

  async submitFeedback(submission: FeedbackSubmission): Promise<FeedbackSubmitResult> {
    return this.feedbackService.submit(submission);
  }

  async fetchFeedbackBoard(type?: FeedbackType): Promise<FeedbackBoardItem[]> {
    return this.feedbackService.fetchBoard(type);
  }

  async voteFeedbackItem(itemId: string): Promise<FeedbackVoteResult> {
    return this.feedbackService.vote(itemId);
  }

  async unvoteFeedbackItem(itemId: string): Promise<FeedbackVoteResult> {
    return this.feedbackService.unvote(itemId);
  }

  get feedbackAnonymousId(): string {
    return this.feedbackService.anonymousId;
  }

  get feedbackTheme() {
    return this.feedbackService.theme;
  }

  get feedbackStrings() {
    return this.feedbackService.strings;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  shutdown() {
    this.shutdownFlag = true;
    this.adService.shutdown();
  }

  private async resolvedBootstrap(): Promise<GrowthCatSDKBootstrap> {
    if (this.bootstrapCache) return this.bootstrapCache;
    return this.refreshSDKBootstrap();
  }
}
