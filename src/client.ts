import { GrowthCatConfiguration } from "./core/config";
import { ApiClient } from "./core/api";
import { GrowthCatDebugLogger } from "./core/logger";
import { AdService } from "./services/ad-service";
import { AttributionService } from "./services/attribution-service";
import { FeedbackService } from "./services/feedback-service";
import { AnalyticsEventTracker, sanitizeAnalyticsProperties } from "./services/analytics-event-tracker";
import { SponsorEventOptions, SponsorEventTracker } from "./services/sponsor-event-tracker";
import { MeasurementState, GrowthCatMeasurementMode } from "./core/privacy";
import { makeAdEventId, makeCreativeInstanceId } from "./core/install-id";
import { qualifiedImpression } from "./services/ad-event-tracker";
import { GROWTHCAT_WEB_SDK_VERSION } from "./core/version";
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
  AdEventTrackingOptions,
} from "./models/ads";
import {
  AttributionLink,
  AttributionAssignment,
  AttributionConfirmationOptions,
  AttributionResolveResult,
  GrowthCatRewards,
} from "./models/attribution";
import { GrowthCatSponsorData, SponsorCreative, SponsorSlotContent } from "./models/sponsor";
import {
  FeedbackUser,
  FeedbackSubmission,
  FeedbackSubmitResult,
  FeedbackVoteResult,
  FeedbackBoardItem,
  FeedbackType,
  FeedbackPage,
  FeedbackPageOptions,
  GrowthCatFeedbackTheme,
  GrowthCatFeedbackStrings,
} from "./models/feedback";
import { GrowthCatError } from "./models/errors";

export class GrowthCatClient {
  private static readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  private readonly config: GrowthCatConfiguration;
  private readonly api: ApiClient;
  private readonly logger: GrowthCatDebugLogger;
  readonly adService: AdService;
  readonly attributionService: AttributionService;
  readonly feedbackService: FeedbackService;
  private readonly measurement: MeasurementState;
  private readonly analyticsEventTracker: AnalyticsEventTracker;
  private readonly sponsorEventTracker: SponsorEventTracker;
  private readonly sponsorCache = new Map<string, SponsorSlotContent>();

  private bootstrapCache: GrowthCatSDKBootstrap | null = null;
  private bootstrapPromise: Promise<GrowthCatSDKBootstrap> | null = null;
  private shutdownFlag = false;
  private hiddenAt: number | null = null;
  private sessionEventRecorded = false;
  private readonly configListeners = new Set<(config: GrowthCatSDKConfig) => void>();

  constructor(config: GrowthCatConfiguration) {
    this.config = config;
    this.logger = new GrowthCatDebugLogger(config.logsEnabled);
    this.api = new ApiClient(config);
    this.measurement = new MeasurementState(config.measurementMode, this.api.storageKey("measurement_mode"));
    this.measurement.subscribe(mode => {
      this.api.cancelMeasurement();
      if (mode !== "analytics") this.sessionEventRecorded = false;
    });
    this.adService = new AdService(this.api, this.logger, this.measurement);
    this.attributionService = new AttributionService(this.api, this.logger, this.measurement);
    this.feedbackService = new FeedbackService(this.api, this.logger);
    this.analyticsEventTracker = new AnalyticsEventTracker(this.api, this.logger, this.measurement);
    this.sponsorEventTracker = new SponsorEventTracker(this.api, this.logger, this.measurement);
    this.startSessionTracking();
  }

  get isConfigured(): boolean {
    return true;
  }

  get isShutdown(): boolean {
    return this.shutdownFlag;
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

  get measurementMode(): GrowthCatMeasurementMode {
    return this.measurement.measurementMode;
  }

  setMeasurementMode(mode: GrowthCatMeasurementMode): void {
    if (mode !== this.measurementMode) this.api.cancelMeasurement();
    this.measurement.setMode(mode);
    if (mode !== "analytics") this.sessionEventRecorded = false;
    if (mode === "disabled") {
      this.attributionService.clearQueuedEvents();
    }
    if (mode === "analytics" && !this.sessionEventRecorded) {
      this.recordSessionStarted("initial");
    }
  }

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  async refreshSDKBootstrap(): Promise<GrowthCatSDKBootstrap> {
    if (this.bootstrapPromise) return this.bootstrapPromise;
    this.bootstrapPromise = this.api.fetchSDKBootstrap()
      .then((bootstrap) => {
        if (this.shutdownFlag) {
          throw GrowthCatError.unknown("SDK client was shut down.");
        }
        this.bootstrapCache = bootstrap;
        for (const listener of this.configListeners) listener(bootstrap.sdkConfig);
        this.api.setMeasurementSchemaVersion(bootstrap.adsConfig.measurementSchemaVersion);
        this.adService.configure(bootstrap.adsConfig);
        void this.flushEvents();
        this.logger.logBootstrapSuccess();
        return bootstrap;
      })
      .finally(() => {
        this.bootstrapPromise = null;
      });
    return this.bootstrapPromise;
  }

  async refreshSDKConfig(): Promise<GrowthCatSDKConfig> {
    const bootstrap = await this.refreshSDKBootstrap();
    return bootstrap.sdkConfig;
  }

  subscribeSDKConfig(listener: (config: GrowthCatSDKConfig) => void): () => void {
    this.configListeners.add(listener);
    return () => { this.configListeners.delete(listener); };
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
      app_user_id: this.requireUserId(),
      session_id: this.measurement.allowsOptionalAnalytics() ? context?.sessionId ?? this.measurement.sessionId : undefined,
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
    if (!this.measurement.allowsOptionalAnalytics()) return;
    const normalized = code.trim().toUpperCase();
    if (!normalized) throw GrowthCatError.invalidCode("Please enter a referral code.");
    if (normalized.length > 128) throw GrowthCatError.invalidCode("Referral code is too long.");
    this.analyticsEventTracker.enqueue({
      schema_version: 2, sdk_event_id: makeAdEventId("referral_click", "analytics"),
      event_name: "referral_click", code: normalized,
      app_user_id: this.attributionService.getAppUserId() ?? undefined,
      session_id: context?.sessionId ?? this.measurement.sessionId, source: context?.source,
      platform: "web", event_at: new Date().toISOString(), measurement_mode: "analytics",
      sdk_version: GROWTHCAT_WEB_SDK_VERSION, sdk_install_id: this.api.installId,
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
    if (!this.measurement.allowsOptionalAnalytics()) return;
    const eventAt = options?.eventAt ?? new Date();
    this.analyticsEventTracker.enqueue({
      schema_version: 2,
      sdk_event_id: makeAdEventId(eventName, "analytics"),
      event_name: eventName,
      app_user_id: this.attributionService.getAppUserId() ?? undefined,
      code: options?.code?.trim().toUpperCase(),
      event_at: eventAt.toISOString(),
      session_id: options?.context?.sessionId ?? this.measurement.sessionId,
      source: options?.context?.source,
      properties: sanitizeAnalyticsProperties(eventName, options?.properties),
      platform: "web",
      locale: typeof navigator !== "undefined" ? navigator.language : undefined,
      measurement_mode: this.measurement.measurementMode,
      sdk_version: GROWTHCAT_WEB_SDK_VERSION,
      sdk_install_id: this.api.installId,
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
    options: AdEventTrackingOptions = {}
  ) {
    this.adService.trackEvent(eventName, ad, options);
  }

  async validateAdReward(
    ad: AdObject,
    appUserId: string,
    options?: { sessionId?: string; viewedSeconds?: number; completed?: boolean; creativeInstanceId?: string }
  ): Promise<AdRewardValidationResponse> {
    return this.adService.validateReward(
      ad,
      appUserId,
      options?.sessionId,
      options?.viewedSeconds ?? 0,
      options?.completed ?? false,
      options?.creativeInstanceId
    );
  }

  async prefetchAdCatalogs(placementKeys: string[]): Promise<void> {
    const bootstrap = await this.resolvedBootstrap();
    if (bootstrap.adsConfig.adsEnabled) {
      await this.adService.prefetch(placementKeys);
    }
  }

  async flushAdEvents() {
    await this.adService.flush();
  }

  // ─── Attribution ───────────────────────────────────────────────────────────

  setAppUserId(userId: string) {
    const previous = this.attributionService.getAppUserId();
    this.attributionService.setAppUserId(userId);
    if (previous && previous !== this.attributionService.getAppUserId()) {
      this.analyticsEventTracker.clear();
      this.adService.eventTracker.clearOptionalEvents();
      this.measurement.rotateSession();
    }
  }

  clearAppUserId() {
    this.analyticsEventTracker.clear();
    this.adService.eventTracker.clearOptionalEvents();
    this.measurement.rotateSession();
    this.attributionService.clearAppUserId();
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
    if (!this.measurement.allowsOptionalAnalytics()) return null;
    return this.attributionService.resolveAttribution(sessionId);
  }

  async confirmAttribution(
    tokenOrOptions: string | AttributionConfirmationOptions,
    sessionId?: string,
    touchpointId?: string
  ): Promise<AttributionAssignment | null> {
    return this.attributionService.confirmAttribution(tokenOrOptions, sessionId, touchpointId);
  }

  async track(eventName: string, properties?: Record<string, GrowthCatAnalyticsValue>): Promise<void> {
    if (!this.measurement.allowsEssentialMeasurement()) return;
    await this.attributionService.track(eventName, properties);
  }

  async rewards(): Promise<GrowthCatRewards> {
    return this.attributionService.rewards();
  }

  async rewardsProgress(): Promise<import("./models/attribution").GrowthCatRewardProgress[]> {
    return this.api.fetchRewardsProgress(this.requireUserId());
  }

  // ─── Sponsors ──────────────────────────────────────────────────────────────

  /**
   * Current content for a sponsor slot: a live sponsor creative, an availability
   * payload for rendering a "Sponsor this app" placeholder, or empty.
   */
  async sponsor(slotKey: string): Promise<SponsorSlotContent> {
    await this.resolvedBootstrap();
    const normalizedSlotKey = slotKey.trim();
    if (!normalizedSlotKey) throw GrowthCatError.unknown("slotKey must not be empty.");
    const sponsor = await this.api.getSponsor(normalizedSlotKey);
    this.sponsorCache.set(normalizedSlotKey, sponsor);
    return sponsor;
  }

  /**
   * Load a sponsor and assign a stable identity to this rendered instance.
   * Keep the returned value while it is rendered and pass the same object to
   * the sponsor tracking methods below.
   */
  async loadSponsorData(slotKey: string): Promise<GrowthCatSponsorData> {
    const sponsor = await this.sponsor(slotKey);
    const creativeInstanceId = makeCreativeInstanceId();
    return {
      ...sponsor,
      creativeInstanceId,
      creativeInstanceIds: Object.fromEntries(
        (sponsor.creatives ?? (sponsor.creative ? [sponsor.creative] : []))
          .filter((creative) => creative.bookingId)
          .map((creative) => [creative.bookingId!, makeCreativeInstanceId()])
      ),
    };
  }

  private sponsorCreativeInstanceId(data: GrowthCatSponsorData, creative: SponsorCreative): string {
    return creative.bookingId
      ? (data.creativeInstanceIds[creative.bookingId] ?? data.creativeInstanceId)
      : data.creativeInstanceId;
  }

  /** Track one creative in a simultaneous sponsor placement. */
  async trackSponsorCreativeImpression(
    data: GrowthCatSponsorData,
    creative: SponsorCreative,
    options: { visibleFraction: number; visibleDurationMs: number; sessionId?: string }
  ): Promise<boolean> {
    if (
      data.status !== "live" || !creative.bookingId || !creative.trackingToken ||
      !qualifiedImpression(options.visibleFraction, options.visibleDurationMs)
    ) return false;
    return this.sponsorEventTracker.track(data.slotKey, "impression", data, {
      creative,
      creativeInstanceId: this.sponsorCreativeInstanceId(data, creative),
      sessionId: options.sessionId,
      visibleFraction: Math.max(0, Math.min(1, options.visibleFraction)),
      visibleDurationMs: Math.max(0, Math.round(options.visibleDurationMs)),
    });
  }

  /** Track a click on one creative in a simultaneous sponsor placement. */
  async trackSponsorCreativeClick(
    data: GrowthCatSponsorData,
    creative: SponsorCreative,
    options?: { sessionId?: string }
  ): Promise<boolean> {
    if (data.status !== "live" || !creative.bookingId || !creative.trackingToken) return false;
    return this.sponsorEventTracker.track(data.slotKey, "click", data, {
      creative,
      creativeInstanceId: this.sponsorCreativeInstanceId(data, creative),
      sessionId: options?.sessionId,
    });
  }

  /** Track a qualified sponsor impression. Returns false when not viewable/live. */
  async trackSponsorImpression(
    data: GrowthCatSponsorData,
    options: { visibleFraction: number; visibleDurationMs: number; sessionId?: string }
  ): Promise<boolean> {
    if (
      data.status !== "live" ||
      !data.creative ||
      !qualifiedImpression(options.visibleFraction, options.visibleDurationMs)
    ) {
      return false;
    }
    return this.sponsorEventTracker.track(data.slotKey, "impression", data, {
      creativeInstanceId: data.creativeInstanceId,
      sessionId: options.sessionId,
      visibleFraction: Math.max(0, Math.min(1, options.visibleFraction)),
      visibleDurationMs: Math.max(0, Math.round(options.visibleDurationMs)),
    });
  }

  /** Track a deliberate click on a live sponsor creative. */
  async trackSponsorClick(
    data: GrowthCatSponsorData,
    options?: { sessionId?: string }
  ): Promise<boolean> {
    if (data.status !== "live" || !data.creative) return false;
    return this.sponsorEventTracker.track(data.slotKey, "click", data, {
      creativeInstanceId: data.creativeInstanceId,
      sessionId: options?.sessionId,
    });
  }

  /** Flush queued sponsor events immediately. */
  async flushSponsorEvents(): Promise<void> {
    await this.sponsorEventTracker.flush();
  }

  /** Track an impression or click on the currently live sponsor. Best-effort. */
  async trackSponsorEvent(
    slotKey: string,
    eventName: "impression" | "click",
    options?: SponsorEventOptions
  ): Promise<void> {
    if (!this.measurement.allowsEssentialMeasurement()) return;
    const sponsor = this.sponsorCache.get(slotKey);
    if (!sponsor) {
      return;
    }
    this.sponsorEventTracker.track(slotKey, eventName, sponsor, options);
  }

  // ─── Feedback ──────────────────────────────────────────────────────────────

  configureFeedback(options: {
    user?: FeedbackUser;
    theme?: Partial<GrowthCatFeedbackTheme>;
    strings?: Partial<Omit<GrowthCatFeedbackStrings, "typeLabels">> & {
      typeLabels?: Partial<GrowthCatFeedbackStrings["typeLabels"]>;
    };
    disabledAutomaticMetadataKeys?: string[];
  }) {
    if (options.user) this.feedbackService.identify(options.user);
    if (options.theme) {
      this.feedbackService.theme = {
        ...this.feedbackService.theme,
        ...options.theme,
        dark: {
          ...this.feedbackService.theme.dark,
          ...options.theme.dark,
        },
      };
    }
    if (options.strings) {
      this.feedbackService.strings = {
        ...this.feedbackService.strings,
        ...options.strings,
        typeLabels: {
          ...this.feedbackService.strings.typeLabels,
          ...options.strings.typeLabels,
        },
      };
    }
    if (options.disabledAutomaticMetadataKeys) {
      this.feedbackService.disabledMetadataKeys =
        new Set(options.disabledAutomaticMetadataKeys);
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

  async fetchFeedbackPage(options: FeedbackPageOptions = {}): Promise<FeedbackPage> {
    return this.feedbackService.fetchPage(options);
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
    this.api.shutdown();
    this.adService.shutdown();
    this.analyticsEventTracker.shutdown();
    this.sponsorEventTracker.shutdown();
    this.attributionService.shutdown();
    this.measurement.shutdown();
    this.configListeners.clear();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  private startSessionTracking(): void {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    if (document.visibilityState !== "hidden") this.recordSessionStarted("initial");
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.hiddenAt = Date.now();
      return;
    }
    if (
      this.hiddenAt !== null &&
      Date.now() - this.hiddenAt >= GrowthCatClient.SESSION_TIMEOUT_MS
    ) {
      this.measurement.rotateSession();
      this.recordSessionStarted("resumed");
    }
    this.hiddenAt = null;
    if (!this.sessionEventRecorded) this.recordSessionStarted("initial");
  };

  private recordSessionStarted(reason: "initial" | "resumed"): void {
    if (!this.measurement.allowsOptionalAnalytics()) return;
    this.sessionEventRecorded = true;
    void this.recordAnalyticsEvent("session_started", {
      properties: { session_reason: reason },
    });
  }

  private async resolvedBootstrap(): Promise<GrowthCatSDKBootstrap> {
    if (this.shutdownFlag) throw GrowthCatError.notInitialized();
    if (this.bootstrapCache) return this.bootstrapCache;
    return this.refreshSDKBootstrap();
  }

  async flushEvents(): Promise<void> {
    await Promise.all([this.analyticsEventTracker.flush(), this.adService.flush(), this.sponsorEventTracker.flush(), this.attributionService.flushQueuedEvents()]);
  }

  private requireUserId(): string {
    const user = this.attributionService.getAppUserId();
    if (!user) throw GrowthCatError.missingAppUserId();
    return user;
  }
}
