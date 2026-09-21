import { GrowthCatConfiguration, GrowthCatDeliveryStatus, GrowthCatIdentityRequest } from "./config";
import { installId, makeIdentityScope, scopedStorageKey } from "./install-id";
import { webUrl } from "./url";
import { GrowthCatError } from "../models/errors";
import {
  GrowthCatSDKBootstrap,
  parseBootstrap,
} from "../models/bootstrap";
import {
  ValidateCodeRequest,
  ValidateCodeResponse,
  ReferralClickRequest,
  AnalyticsEventRequest,
} from "../models/referral";
import {
  AdCatalogResponse,
  AdServeResponse,
  AdEventBatchRequest,
  AdRewardValidationResponse,
  RawAdObject,
  parseAdObject,
} from "../models/ads";
import {
  AttributionShareLinkRequest,
  AttributionClaimRequest,
  AttributionResolveRequest,
  AttributionEventRequest,
  AttributionLink,
  AttributionAssignment,
  AttributionResolveResult,
  GrowthCatRewards,
  GrowthCatReward,
} from "../models/attribution";
import { SponsorCreative, SponsorEventBatchRequest, SponsorSlotContent } from "../models/sponsor";
import {
  AcquisitionCampaignConfig,
  AcquisitionEventPayload,
  parseAcquisitionCampaign,
} from "../models/acquisition";
import {
  FeedbackSubmitRequest,
  FeedbackSubmitResult,
  FeedbackVoteResult,
  FeedbackBoardItem,
  parseFeedbackItem,
  FeedbackType,
  FeedbackPage,
  FeedbackPageOptions,
} from "../models/feedback";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

function unwrapData(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "data" in raw) {
    return (raw as Record<string, unknown>)["data"];
  }
  return raw;
}

function unwrapFeedbackItem(raw: unknown): Record<string, unknown> {
  const data = unwrapData(raw);
  if (data && typeof data === "object" && "item" in data) {
    return ((data as Record<string, unknown>)["item"] ?? {}) as Record<string, unknown>;
  }
  return (data ?? {}) as Record<string, unknown>;
}

export class ApiClient {
  private readonly config: GrowthCatConfiguration;
  private measurementSchemaVersion = 1;
  readonly installId: string;
  private readonly identityScope: string;
  private stopped = false;
  private readonly controllers = new Map<AbortController, boolean>();
  private measurementGeneration = 0;

  constructor(config: GrowthCatConfiguration) {
    this.config = config;
    this.identityScope = makeIdentityScope(config.apiKey, config.baseUrl, config.workspace);
    this.installId = installId(this.identityScope);
  }

  storageKey(name: string): string { return scopedStorageKey(`growthcat_${name}`, 3, this.identityScope); }
  notifyDelivery(status: GrowthCatDeliveryStatus): void { this.config.onDeliveryStatus?.(status); }
  cancelMeasurement(): void {
    this.measurementGeneration++;
    for (const [controller, measurement] of this.controllers) if (measurement) controller.abort();
  }
  shutdown(): void {
    this.stopped = true;
    for (const controller of this.controllers.keys()) controller.abort();
  }

  setMeasurementSchemaVersion(version: number): void {
    this.measurementSchemaVersion = version >= 2 ? 2 : 1;
  }

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  async fetchSDKBootstrap(): Promise<GrowthCatSDKBootstrap> {
    const raw = await this.request<Record<string, unknown>>(
      "GET",
      "/v1/sdk/config"
    );
    return parseBootstrap(raw);
  }

  // ─── Referral ──────────────────────────────────────────────────────────────

  async validateCode(body: ValidateCodeRequest): Promise<ValidateCodeResponse> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      "/v1/validate",
      body
    );

    const isValid = requiredBoolean(raw, "is_valid");
    if (!isValid) throw GrowthCatError.invalidCode("Invalid referral code.");

    const campaignRaw = (raw["campaign"] ?? {}) as Record<string, unknown>;
    const normalizedCode = requiredString(raw, "normalized_code", "referral response");
    const campaignId = requiredString(campaignRaw, "id", "referral campaign");
    return {
      is_valid: isValid,
      normalized_code: normalizedCode,
      campaign: {
        id: campaignId,
        name: String(campaignRaw["name"] ?? ""),
        discount_description: campaignRaw["discount_description"] != null
          ? String(campaignRaw["discount_description"])
          : undefined,
      },
    };
  }

  async recordReferralClick(body: ReferralClickRequest): Promise<void> {
    await this.request("POST", "/v1/referrals/click", body);
  }

  async recordAnalyticsEvent(body: AnalyticsEventRequest): Promise<void> {
    await this.request("POST", "/v1/analytics/events", body);
  }

  // ─── Ads ───────────────────────────────────────────────────────────────────

  async fetchAdCatalog(
    placementKey: string,
    locale?: string,
    countryCode?: string
  ): Promise<AdCatalogResponse> {
    const params = new URLSearchParams({ placement_key: placementKey });
    if (locale) params.set("locale", locale);
    if (countryCode) params.set("country_code", countryCode);

    const raw = await this.request<Record<string, unknown>>(
      "GET",
      `/v1/ads/catalog?${params}`
    );

    const rawAds = (Array.isArray(raw["ads"]) ? raw["ads"] : []) as RawAdObject[];
    return {
      placement_key: placementKey,
      country_code: raw["country_code"] as string | undefined,
      ads: rawAds.map((a) => parseAdObject(a)),
      cache_ttl_seconds: raw["cache_ttl_seconds"] as number | undefined,
    };
  }

  async fetchAdServe(
    format: string,
    locale?: string,
    countryCode?: string
  ): Promise<AdServeResponse> {
    const params = new URLSearchParams({ format });
    if (locale) params.set("locale", locale);
    if (countryCode) params.set("country_code", countryCode);

    const raw = await this.request<Record<string, unknown>>(
      "GET",
      `/v1/ads/serve?${params}`
    );

    const rawAds = (Array.isArray(raw["ads"]) ? raw["ads"] : []) as RawAdObject[];
    return {
      format: format === "banner" ? "banner" : "interstitial",
      country_code: raw["country_code"] as string | undefined,
      ads: rawAds.map((a) => parseAdObject(a)),
      cache_ttl_seconds: raw["cache_ttl_seconds"] as number | undefined,
    };
  }

  async sendAdEvents(body: AdEventBatchRequest): Promise<{ accepted: number; duplicates: number }> {
    if (this.measurementSchemaVersion >= 2) {
      return this.request("POST", "/v1/ads/events/batch", body);
    }
    // Compatibility for pre-v2 backends whose event schema is strict.
    return this.request("POST", "/v1/ads/events/batch", {
      events: body.events.map((event) => ({
        sdk_event_id: event.sdk_event_id,
        format: event.format,
        campaign_id: event.campaign_id,
        creative_id: event.creative_id,
        event_name: event.event_name,
        locale: event.locale,
        app_user_id: event.app_user_id,
        session_id: event.session_id,
        sdk_install_id: event.sdk_install_id,
        tracking_token: event.tracking_token,
        occurred_at: event.occurred_at,
        metadata: event.metadata,
      })),
    });
  }

  async validateAdReward(body: Record<string, unknown>): Promise<AdRewardValidationResponse> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      "/v1/ads/reward/validate",
      body
    );
    const rewardRaw = raw["reward"] as Record<string, unknown> | undefined;
    return {
      rewardValidated: requiredBoolean(raw, "reward_validated"),
      grantId: typeof raw["grant_id"] === "string" ? raw["grant_id"] : undefined,
      alreadyGranted: raw["already_granted"] === true,
      accepted: Number(raw["accepted"] ?? 0),
      reward:
        rewardRaw && rewardRaw["name"] != null && rewardRaw["amount"] != null
          ? { name: String(rewardRaw["name"]), amount: Number(rewardRaw["amount"]) }
          : undefined,
    };
  }

  // ─── Attribution ───────────────────────────────────────────────────────────

  async createShareLink(body: AttributionShareLinkRequest): Promise<AttributionLink> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      "/v1/attribution/share-link",
      body
    );
    const link = (raw["link"] ?? raw) as Record<string, unknown>;
    return parseAttributionLink(link);
  }

  async claimAttribution(body: AttributionClaimRequest): Promise<AttributionAssignment> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      "/v1/attribution/claim",
      body
    );
    // The claim endpoint wraps the row: { assignment: {...}, eligible_for_rewards, workspace }.
    const assignment = (raw["assignment"] ?? raw) as Record<string, unknown>;
    return parseAttributionAssignment(assignment);
  }

  async resolveAttribution(body: AttributionResolveRequest): Promise<AttributionResolveResult> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      "/v1/attribution/resolve",
      body
    );
    return {
      matched: requiredBoolean(raw, "matched"),
      requiresConfirmation: raw["requires_confirmation"] != null
        ? Boolean(raw["requires_confirmation"])
        : undefined,
      confidence: raw["confidence"] as string | undefined,
      touchpointId: raw["touchpoint_id"] as string | undefined,
      token: raw["token"] as string | undefined,
      sourceType: raw["source_type"] as string | undefined,
      campaignKey: raw["campaign_key"] as string | undefined,
      referrerAppUserId: raw["referrer_app_user_id"] as string | undefined,
      deepLinkValue: raw["deep_link_value"] as string | undefined,
    };
  }

  async trackAttributionEvent(body: AttributionEventRequest): Promise<void> {
    await this.request("POST", "/v1/events", body);
  }

  async fetchAcquisitionCampaign(slug: string): Promise<AcquisitionCampaignConfig> {
    const raw = await this.request<Record<string, unknown>>(
      "GET",
      `/v1/public/acquisition/${encodeURIComponent(slug)}`
    );
    return parseAcquisitionCampaign(raw);
  }

  async trackAcquisitionEvent(slug: string, body: AcquisitionEventPayload): Promise<void> {
    await this.request(
      "POST",
      `/v1/public/acquisition/${encodeURIComponent(slug)}/events`,
      body
    );
  }

  async fetchRewards(appUserId: string): Promise<GrowthCatRewards> {
    const params = new URLSearchParams({ app_user_id: appUserId });
    const raw = await this.request<Record<string, unknown>>(
      "GET",
      `/v1/rewards?${params}`
    );
    const rawRewards = Array.isArray(raw["rewards"]) ? (raw["rewards"] as Record<string, unknown>[]) : [];
    const rewards: GrowthCatReward[] = rawRewards.map((r) => ({
      id: typeof r.id === "string" ? r.id : undefined,
      ruleId: typeof r.rule_id === "string" ? r.rule_id : undefined,
      grantedAt: typeof r.granted_at === "string" ? r.granted_at : undefined,
      metadata: r.metadata as Record<string, unknown> | undefined,
      offerCode: typeof r.offer_code === "string" ? r.offer_code : undefined,
      offerCodeRedemptionUrl: typeof r.offer_code_redemption_url === "string" ? r.offer_code_redemption_url : undefined,
      rewardType: String(r["reward_type"] ?? ""),
      featureKey: r["feature_key"] != null ? String(r["feature_key"]) : undefined,
    }));
    return {
      rewards,
      containsFeature(featureKey: string) {
        return rewards.some(
          (r) => r.rewardType === "unlock_feature" && r.featureKey === featureKey
        );
      },
    };
  }

  // ─── Sponsors ──────────────────────────────────────────────────────────────

  async fetchRewardsProgress(appUserId: string): Promise<import("../models/attribution").GrowthCatRewardProgress[]> {
    const raw = await this.request<{ progress?: Record<string, unknown>[] }>("GET", `/v1/rewards/progress?${new URLSearchParams({ app_user_id: appUserId })}`);
    return (raw.progress ?? []).map(row => ({
      ruleId: String(row.rule_id), campaignKey: typeof row.campaign_key === "string" ? row.campaign_key : undefined,
      triggerEvent: String(row.trigger_event), requiredCount: Number(row.required_count), qualifiedCount: Number(row.qualified_count),
      rewardType: String(row.reward_type), featureKey: String(row.feature_key), granted: row.granted === true,
    }));
  }

  async getSponsor(slotKey: string): Promise<SponsorSlotContent> {
    const raw = await this.request<Record<string, unknown>>(
      "GET",
      `/v1/sponsors/${encodeURIComponent(slotKey)}`
    );
    const creativeRaw = raw["creative"] as Record<string, unknown> | undefined;
    const mapCreative = (value: Record<string, unknown>): SponsorCreative => ({
      bookingId: value["booking_id"] as string | undefined,
      sponsorName: value["sponsor_name"] as string | undefined,
      logoUrl: webUrl(value["logo_url"]),
      headline: value["headline"] as string | undefined,
      body: value["body"] as string | undefined,
      ctaText: value["cta_text"] as string | undefined,
      clickUrl: webUrl(value["click_url"]),
      customPayload: value["custom_payload"] as Record<string, unknown> | undefined,
      periodStart: value["period_start"] as string | undefined,
      periodEnd: value["period_end"] as string | undefined,
      trackingToken: value["tracking_token"] as string | undefined,
    });
    const creativeList = Array.isArray(raw["creatives"])
      ? (raw["creatives"] as Record<string, unknown>[]).map(mapCreative)
      : undefined;
    const periods = Array.isArray(raw["next_available_periods"])
      ? (raw["next_available_periods"] as Record<string, unknown>[]).map((p) => ({
          periodStart: String(p["period_start"] ?? ""),
          periodEnd: String(p["period_end"] ?? ""),
          occupied: p["occupied"] != null ? Boolean(p["occupied"]) : undefined,
          capacity: p["capacity"] != null ? Number(p["capacity"]) : undefined,
          bookedCount: p["booked_count"] != null ? Number(p["booked_count"]) : undefined,
          availableCount: p["available_count"] != null ? Number(p["available_count"]) : undefined,
        }))
      : undefined;
    return {
      status: (raw["status"] as SponsorSlotContent["status"]) ?? "empty",
      slotKey: String(raw["slot_key"] ?? slotKey),
      format: String(raw["format"] ?? "banner"),
      period: String(raw["period"] ?? "weekly"),
      deliveryMode: raw["delivery_mode"] === "all" ? "all" : "rotate",
      capacityPerPeriod: raw["capacity_per_period"] != null ? Number(raw["capacity_per_period"]) : 1,
      creative: creativeRaw
        ? {
            bookingId:
              (creativeRaw["booking_id"] as string | undefined) ??
              ((raw["booking"] as Record<string, unknown> | undefined)?.["id"] as string | undefined),
            sponsorName: creativeRaw["sponsor_name"] as string | undefined,
            logoUrl: webUrl(creativeRaw["logo_url"]),
            headline: creativeRaw["headline"] as string | undefined,
            body: creativeRaw["body"] as string | undefined,
            ctaText: creativeRaw["cta_text"] as string | undefined,
            clickUrl: webUrl(creativeRaw["click_url"]),
            customPayload: creativeRaw["custom_payload"] as Record<string, unknown> | undefined,
            periodStart: creativeRaw["period_start"] as string | undefined,
            periodEnd: creativeRaw["period_end"] as string | undefined,
            trackingToken:
              (creativeRaw["tracking_token"] as string | undefined) ??
              (raw["tracking_token"] as string | undefined) ??
              ((raw["tracking"] as Record<string, unknown> | undefined)?.["token"] as string | undefined),
          }
        : undefined,
      creatives: creativeList ?? (creativeRaw ? [mapCreative(creativeRaw)] : undefined),
      priceUsd: raw["price_usd"] != null ? Number(raw["price_usd"]) : undefined,
      bookingUrl: webUrl(raw["booking_url"]),
      nextAvailablePeriods: periods,
    };
  }

  async trackSponsorEvent(slotKey: string, eventName: "impression" | "click"): Promise<void> {
    await this.request("POST", `/v1/sponsors/${encodeURIComponent(slotKey)}/events`, {
      event_name: eventName,
    });
  }

  async sendSponsorEvents(body: SponsorEventBatchRequest): Promise<void> {
    if (this.measurementSchemaVersion >= 2) {
      await this.request("POST", "/v1/sponsors/events/batch", body);
      return;
    }
    throw GrowthCatError.server(409, "Sponsor measurement requires backend schema v2.");
  }

  // ─── Feedback ──────────────────────────────────────────────────────────────

  async submitFeedback(body: FeedbackSubmitRequest): Promise<FeedbackSubmitResult> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      "/v1/sdk/feedback/items",
      body
    );
    return parseFeedbackItem(unwrapFeedbackItem(raw)) as FeedbackSubmitResult;
  }

  async fetchFeedbackBoard(
    boardSlug: string,
    type?: FeedbackType,
    userId?: string,
    anonymousId?: string
  ): Promise<FeedbackBoardItem[]> {
    return (await this.fetchFeedbackPage(boardSlug, { type }, userId, anonymousId)).items;
  }

  async fetchFeedbackPage(boardSlug: string, options: FeedbackPageOptions, userId?: string, anonymousId?: string): Promise<FeedbackPage> {
    const params = new URLSearchParams();
    if (options.type) params.set("type", options.type);
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit != null) params.set("limit", String(options.limit));
    if (userId) params.set("viewer_external_user_id", userId);
    if (anonymousId) params.set("viewer_anonymous_id", anonymousId);
    const query = params.toString() ? `?${params}` : "";
    const raw = await this.request<unknown>("GET", `/v1/public/feedback/${encodeURIComponent(boardSlug)}/items${query}`);
    const data = unwrapData(raw);
    const items = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown> | undefined)?.["items"])
        ? ((data as Record<string, unknown>)["items"] as unknown[])
        : [];
    const pagination = (raw as { pagination?: { next_cursor?: unknown } })?.pagination;
    return { items: items.map((item) => parseFeedbackItem(item as Record<string, unknown>)), nextCursor: typeof pagination?.next_cursor === "string" ? pagination.next_cursor : null };
  }

  async voteFeedbackItem(boardSlug: string, itemId: string, userId?: string, anonymousId?: string): Promise<FeedbackVoteResult> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      `/v1/public/feedback/${encodeURIComponent(boardSlug)}/items/${encodeURIComponent(itemId)}/vote`,
      { external_user_id: userId, anonymous_id: anonymousId }
    );
    const data = unwrapData(raw) as Record<string, unknown>;
    return {
      itemId: String(data["item_id"] ?? data["id"] ?? itemId),
      hasVoted: Boolean(data["viewer_has_voted"] ?? data["has_voted"] ?? true),
      voteCount: Number(data["vote_count"] ?? 0),
    };
  }

  async unvoteFeedbackItem(boardSlug: string, itemId: string, userId?: string, anonymousId?: string): Promise<FeedbackVoteResult> {
    const raw = await this.request<Record<string, unknown>>(
      "DELETE",
      `/v1/public/feedback/${encodeURIComponent(boardSlug)}/items/${encodeURIComponent(itemId)}/vote`,
      { external_user_id: userId, anonymous_id: anonymousId }
    );
    const data = unwrapData(raw) as Record<string, unknown>;
    return {
      itemId: String(data["item_id"] ?? data["id"] ?? itemId),
      hasVoted: Boolean(data["viewer_has_voted"] ?? data["has_voted"] ?? false),
      voteCount: Number(data["vote_count"] ?? 0),
    };
  }

  async fetchFeedbackConfig(): Promise<{ slug: string }> {
    const raw = await this.request<Record<string, unknown>>("GET", "/v1/sdk/feedback/config");
    const data = unwrapData(raw) as Record<string, unknown>;
    const board = (data["board"] ?? {}) as Record<string, unknown>;
    return { slug: String(board["slug"] ?? data["slug"] ?? "") };
  }

  // ─── Core HTTP ─────────────────────────────────────────────────────────────

  private async request<T>(method: HttpMethod, path: string, body?: unknown, refreshed = false): Promise<T> {
    if (this.stopped) throw GrowthCatError.notInitialized();
    const url = `${this.config.baseUrl}${path}`;
    const measurement = /\/events(?:\/batch)?$|\/referrals\/click$/.test(path);
    const generation = this.measurementGeneration;
    const headers: Record<string, string> = {
      Accept: "application/json", "x-growthcat-key": this.config.apiKey,
      "X-GrowthCat-Workspace": this.config.workspace,
    };
    const controller = new AbortController();
    this.controllers.set(controller, measurement);
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    let response: Response;
    let json: unknown;
    try {
      const identity = this.identityRequest(path, body, refreshed);
      if (identity) {
        if (!this.config.identityTokenProvider) throw GrowthCatError.unauthorized("Configure identityTokenProvider using your authenticated application server.");
        const token = await new Promise<string>((resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(GrowthCatError.network("Identity request cancelled or timed out.")), { once: true });
          Promise.resolve().then(() => this.config.identityTokenProvider!(identity)).then(resolve, reject);
        });
        if (!token || token.length > 4096) throw GrowthCatError.unauthorized("Invalid SDK identity token.");
        headers["X-GrowthCat-Identity"] = token;
      }
      if (this.stopped || controller.signal.aborted || (measurement && generation !== this.measurementGeneration)) throw GrowthCatError.network("Request cancelled.");
      const serialized = body != null ? JSON.stringify(body) : undefined;
      if (serialized) headers["Content-Type"] = "application/json";
      this.logRequest(method, url, body);
      response = await fetch(url, {
        method, headers, body: serialized, signal: controller.signal,
        keepalive: measurement && (!serialized || new TextEncoder().encode(serialized).length < 48 * 1024),
        credentials: "omit", redirect: "error",
      });
      if (response.status === 204) json = {};
      else {
        try { json = await response.json(); }
        catch {
          if (controller.signal.aborted) throw GrowthCatError.network("Response timed out.");
          if (response.ok) throw GrowthCatError.server(502, "Invalid JSON response.");
          json = {};
        }
      }
    } catch (error) {
      if (error instanceof GrowthCatError) throw error;
      throw GrowthCatError.network(controller.signal.aborted ? "Request cancelled or timed out." : "Request failed.");
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
    if (this.stopped || (measurement && generation !== this.measurementGeneration)) throw GrowthCatError.network("Request cancelled.");
    this.logResponse(method, url, response.status, json);
    if (response.ok) return json as T;
    const payload = (json ?? {}) as Record<string, unknown>;
    const message = typeof payload.message === "string" ? payload.message :
      typeof payload.error === "string" ? payload.error : this.extractNestedErrorMessage(payload);
    if (response.status === 401 && !refreshed && this.identityRequest(path, body, true)) return this.request(method, path, body, true);
    if (response.status === 401) throw GrowthCatError.unauthorized(message);
    if (response.status === 429) {
      const raw = response.headers.get("Retry-After");
      const seconds = raw == null ? undefined : /^\\d+(\\.\\d+)?$/.test(raw) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000;
      throw GrowthCatError.rateLimited(Number.isFinite(seconds) ? Math.max(0, seconds!) : undefined);
    }
    if (message === "app_setup_incomplete" || payload.code === "app_setup_incomplete" || payload.error === "app_setup_incomplete") {
      const requirements = (payload.requirements ?? {}) as Record<string, unknown>;
      throw new GrowthCatError("app_setup_incomplete", "Complete the GrowthCat app setup.", {
        statusCode: response.status,
        requirements: {
          revenueCatSecretApiKeyConfigured: requirements.revenuecat_secret_api_key_configured === true,
          revenueCatWebhookConfigured: requirements.revenuecat_webhook_configured === true,
        },
      });
    }
    throw GrowthCatError.server(response.status, message);
  }

  private identityRequest(path: string, body: unknown, forceRefresh: boolean): GrowthCatIdentityRequest | null {
    const url = new URL(path, this.config.baseUrl);
    const feedbackUser = (body as { external_user_id?: string } | undefined)?.external_user_id;
    if (url.pathname.includes("/feedback/") && feedbackUser) return { appUserId: feedbackUser, scope: "user", forceRefresh };
    if (!url.pathname.startsWith("/v1/attribution/") && !url.pathname.startsWith("/v1/rewards") &&
        url.pathname !== "/v1/events" && url.pathname !== "/v1/ads/reward/validate") return null;
    const input = (body ?? {}) as Record<string, unknown>;
    const appUserId = String(input.app_user_id ?? url.searchParams.get("app_user_id") ?? "");
    if (!appUserId) throw GrowthCatError.missingAppUserId();
    const isEvent = url.pathname === "/v1/events" || url.pathname === "/v1/ads/reward/validate";
    return {
      appUserId, scope: isEvent ? "event" : "user", forceRefresh,
      eventName: isEvent ? String(input.event_name ?? "ad_reward") : undefined,
      eventId: isEvent ? String(input.sdk_event_id ?? "") : undefined,
    };
  }

  private logRequest(method: HttpMethod, url: string, body?: unknown) {
    if (!this.config.logsEnabled) return;
    const bodySummary =
      body && typeof body === "object"
        ? { keys: Object.keys(body as Record<string, unknown>) }
        : body == null
          ? undefined
          : { type: typeof body };
    console.log("[GrowthCat] API request", {
      method,
      url: this.publicUrl(url),
      body: bodySummary,
      workspace: this.config.workspace,
    });
  }

  private logResponse(method: HttpMethod, url: string, status: number, json: unknown) {
    if (!this.config.logsEnabled) return;
    const level = status >= 400 ? "error" : "log";
    console[level]("[GrowthCat] API response", {
      method,
      url: this.publicUrl(url),
      status,
      body: json && typeof json === "object" ? { keys: Object.keys(json) } : undefined,
    });
  }

  private logError(method: HttpMethod, url: string, phase: string, error: unknown) {
    if (!this.config.logsEnabled) return;
    console.error("[GrowthCat] API error", {
      method,
      url: this.publicUrl(url),
      phase,
      error: error instanceof Error ? error.name : "Error",
    });
  }

  private publicUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url;
    }
  }

  private extractNestedErrorMessage(payload: Record<string, unknown>): string | undefined {
    const error = payload["error"];
    if (!error || typeof error !== "object") return undefined;
    const nested = error as Record<string, unknown>;
    return (nested["message"] as string | undefined) ??
      (nested["code"] as string | undefined);
  }
}

function requiredBoolean(raw: Record<string, unknown>, key: string): boolean {
  if (typeof raw[key] !== "boolean") throw GrowthCatError.server(502, `Invalid ${key} in response.`);
  return raw[key];
}

function parseAttributionLink(raw: Record<string, unknown>): AttributionLink {
  return {
    token: requiredString(raw, "token", "attribution link"),
    publicUrl: requiredString(raw, "public_url", "attribution link"),
    sourceType: String(raw["source_type"] ?? ""),
    referrerAppUserId: String(raw["referrer_app_user_id"] ?? ""),
    campaignKey: raw["campaign_key"] as string | undefined,
    deepLinkValue: raw["deep_link_value"] as string | undefined,
  };
}

function requiredString(
  raw: Record<string, unknown>,
  key: string,
  context: string
): string {
  const value = raw[key];
  if (typeof value !== "string" || !value.trim()) {
    throw GrowthCatError.server(502, `GrowthCat returned an invalid ${context}.`);
  }
  return value;
}

function parseAttributionAssignment(raw: Record<string, unknown>): AttributionAssignment {
  return {
    token: raw["token"] as string | undefined,
    sourceType: raw["source_type"] as string | undefined,
    campaignKey: raw["campaign_key"] as string | undefined,
    referrerAppUserId: raw["referrer_app_user_id"] as string | undefined,
    deepLinkValue: raw["deep_link_value"] as string | undefined,
    matchType: raw["match_type"] as never,
    referrerCode: raw["referrer_code"] as string | undefined,
  };
}
