import { GrowthCatConfiguration } from "./config";
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
import { SponsorEventBatchRequest, SponsorSlotContent } from "../models/sponsor";
import {
  FeedbackSubmitRequest,
  FeedbackSubmitResult,
  FeedbackVoteResult,
  FeedbackBoardItem,
  parseFeedbackItem,
  FeedbackType,
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

  constructor(config: GrowthCatConfiguration) {
    this.config = config;
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

    const isValid = Boolean(raw["is_valid"]);
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
      rewardValidated: Boolean(raw["reward_validated"] ?? false),
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
      matched: Boolean(raw["matched"] ?? false),
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

  async fetchRewards(appUserId: string): Promise<GrowthCatRewards> {
    const params = new URLSearchParams({ app_user_id: appUserId });
    const raw = await this.request<Record<string, unknown>>(
      "GET",
      `/v1/rewards?${params}`
    );
    const rawRewards = Array.isArray(raw["rewards"]) ? (raw["rewards"] as Record<string, unknown>[]) : [];
    const rewards: GrowthCatReward[] = rawRewards.map((r) => ({
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

  async getSponsor(slotKey: string): Promise<SponsorSlotContent> {
    const raw = await this.request<Record<string, unknown>>(
      "GET",
      `/v1/sponsors/${encodeURIComponent(slotKey)}`
    );
    const creativeRaw = raw["creative"] as Record<string, unknown> | undefined;
    const periods = Array.isArray(raw["next_available_periods"])
      ? (raw["next_available_periods"] as Record<string, unknown>[]).map((p) => ({
          periodStart: String(p["period_start"] ?? ""),
          periodEnd: String(p["period_end"] ?? ""),
          occupied: p["occupied"] != null ? Boolean(p["occupied"]) : undefined,
        }))
      : undefined;
    return {
      status: (raw["status"] as SponsorSlotContent["status"]) ?? "empty",
      slotKey: String(raw["slot_key"] ?? slotKey),
      format: String(raw["format"] ?? "banner"),
      period: String(raw["period"] ?? "weekly"),
      creative: creativeRaw
        ? {
            bookingId:
              (creativeRaw["booking_id"] as string | undefined) ??
              ((raw["booking"] as Record<string, unknown> | undefined)?.["id"] as string | undefined),
            sponsorName: creativeRaw["sponsor_name"] as string | undefined,
            logoUrl: creativeRaw["logo_url"] as string | undefined,
            headline: creativeRaw["headline"] as string | undefined,
            body: creativeRaw["body"] as string | undefined,
            ctaText: creativeRaw["cta_text"] as string | undefined,
            clickUrl: creativeRaw["click_url"] as string | undefined,
            customPayload: creativeRaw["custom_payload"] as Record<string, unknown> | undefined,
            periodStart: creativeRaw["period_start"] as string | undefined,
            periodEnd: creativeRaw["period_end"] as string | undefined,
            trackingToken:
              (creativeRaw["tracking_token"] as string | undefined) ??
              (raw["tracking_token"] as string | undefined) ??
              ((raw["tracking"] as Record<string, unknown> | undefined)?.["token"] as string | undefined),
          }
        : undefined,
      priceUsd: raw["price_usd"] != null ? Number(raw["price_usd"]) : undefined,
      bookingUrl: raw["booking_url"] as string | undefined,
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
    await Promise.all(
      body.events.map((event) => this.trackSponsorEvent(event.slot_key, event.event_name))
    );
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
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (userId) params.set("viewer_external_user_id", userId);
    if (anonymousId) params.set("viewer_anonymous_id", anonymousId);
    const query = params.toString() ? `?${params}` : "";
    const raw = await this.request<unknown>("GET", `/v1/public/feedback/${boardSlug}/items${query}`);
    const data = unwrapData(raw);
    const items = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown> | undefined)?.["items"])
        ? ((data as Record<string, unknown>)["items"] as unknown[])
        : [];
    return items.map((item) => parseFeedbackItem(item as Record<string, unknown>));
  }

  async voteFeedbackItem(boardSlug: string, itemId: string, userId?: string, anonymousId?: string): Promise<FeedbackVoteResult> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      `/v1/public/feedback/${boardSlug}/items/${itemId}/vote`,
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
      `/v1/public/feedback/${boardSlug}/items/${itemId}/vote`,
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

  private async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    this.logRequest(method, url, body);

    const headers: Record<string, string> = {
      Accept: "application/json",
      "x-growthcat-key": this.config.apiKey,
      "X-GrowthCat-Workspace": this.config.workspace,
    };

    if (body != null) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      this.logError(method, url, "network", err);
      throw GrowthCatError.network(
        controller.signal.aborted
          ? `Request timed out after ${this.config.requestTimeoutMs}ms.`
          : err instanceof Error ? err.message : "Fetch failed"
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        clearTimeout(timeout);
        this.logError(method, url, "timeout", error);
        throw GrowthCatError.network(
          `Request timed out after ${this.config.requestTimeoutMs}ms.`
        );
      }
      json = {};
    } finally {
      clearTimeout(timeout);
    }

    this.logResponse(method, url, response.status, json);

    if (response.ok) return json as T;

    const payload = (json ?? {}) as Record<string, unknown>;
    const message =
      (payload["message"] as string | undefined) ??
      (typeof payload["error"] === "string" ? payload["error"] as string : undefined) ??
      (typeof payload["code"] === "string" ? payload["code"] as string : undefined) ??
      this.extractNestedErrorMessage(payload);

    switch (response.status) {
      case 401:
        throw GrowthCatError.unauthorized(message);
      case 404:
        throw GrowthCatError.server(404, message ?? "Not found.");
      case 409:
        throw GrowthCatError.server(409, message ?? "Conflict.");
      case 429: {
        const retryAfter = response.headers.get("Retry-After");
        throw GrowthCatError.rateLimited(
          retryAfter != null ? Number(retryAfter) : undefined
        );
      }
      default:
        throw GrowthCatError.server(response.status, message);
    }
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
      body: json,
    });
  }

  private logError(method: HttpMethod, url: string, phase: string, error: unknown) {
    if (!this.config.logsEnabled) return;
    console.error("[GrowthCat] API error", {
      method,
      url: this.publicUrl(url),
      phase,
      error,
    });
  }

  private publicUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}${parsed.search}`;
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
