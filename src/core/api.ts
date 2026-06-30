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
import {
  FeedbackSubmitRequest,
  FeedbackSubmitResult,
  FeedbackVoteResult,
  FeedbackBoardItem,
  parseFeedbackItem,
  FeedbackType,
} from "../models/feedback";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export class ApiClient {
  private readonly config: GrowthCatConfiguration;

  constructor(config: GrowthCatConfiguration) {
    this.config = config;
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
    return {
      is_valid: isValid,
      normalized_code: String(raw["normalized_code"] ?? ""),
      campaign: {
        id: String(campaignRaw["id"] ?? ""),
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
    return this.request("POST", "/v1/ads/events/batch", body);
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
    return parseAttributionAssignment(raw);
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

  // ─── Feedback ──────────────────────────────────────────────────────────────

  async submitFeedback(boardSlug: string, body: FeedbackSubmitRequest): Promise<FeedbackSubmitResult> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      `/v1/feedback/${boardSlug}/items`,
      body
    );
    return parseFeedbackItem(raw) as FeedbackSubmitResult;
  }

  async fetchFeedbackBoard(boardSlug: string, type?: FeedbackType): Promise<FeedbackBoardItem[]> {
    const params = type ? `?type=${type}` : "";
    const raw = await this.request<unknown[]>("GET", `/v1/feedback/${boardSlug}/items${params}`);
    return (raw ?? []).map((item) => parseFeedbackItem(item as Record<string, unknown>));
  }

  async voteFeedbackItem(boardSlug: string, itemId: string, userId?: string, anonymousId?: string): Promise<FeedbackVoteResult> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      `/v1/feedback/${boardSlug}/items/${itemId}/vote`,
      { user_id: userId, anonymous_id: anonymousId }
    );
    return {
      itemId: String(raw["id"] ?? itemId),
      hasVoted: Boolean(raw["has_voted"] ?? true),
      voteCount: Number(raw["vote_count"] ?? 0),
    };
  }

  async unvoteFeedbackItem(boardSlug: string, itemId: string, userId?: string, anonymousId?: string): Promise<FeedbackVoteResult> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      `/v1/feedback/${boardSlug}/items/${itemId}/unvote`,
      { user_id: userId, anonymous_id: anonymousId }
    );
    return {
      itemId: String(raw["id"] ?? itemId),
      hasVoted: Boolean(raw["has_voted"] ?? false),
      voteCount: Number(raw["vote_count"] ?? 0),
    };
  }

  async fetchFeedbackConfig(): Promise<{ slug: string }> {
    const raw = await this.request<Record<string, unknown>>("GET", "/v1/sdk/feedback/config");
    return { slug: String(raw["slug"] ?? "") };
  }

  // ─── Core HTTP ─────────────────────────────────────────────────────────────

  private async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "x-growthcat-key": this.config.apiKey,
      "X-GrowthCat-Workspace": this.config.workspace,
    };

    if (body != null) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw GrowthCatError.network(
        err instanceof Error ? err.message : "Fetch failed"
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = {};
    }

    if (response.ok) return json as T;

    const payload = (json ?? {}) as Record<string, unknown>;
    const message =
      (payload["message"] as string | undefined) ??
      (payload["error"] as string | undefined);

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
}

function parseAttributionLink(raw: Record<string, unknown>): AttributionLink {
  return {
    token: String(raw["token"] ?? ""),
    publicUrl: String(raw["public_url"] ?? ""),
    sourceType: String(raw["source_type"] ?? ""),
    referrerAppUserId: String(raw["referrer_app_user_id"] ?? ""),
    campaignKey: raw["campaign_key"] as string | undefined,
    deepLinkValue: raw["deep_link_value"] as string | undefined,
  };
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
