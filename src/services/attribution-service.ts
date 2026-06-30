import { ApiClient } from "../core/api";
import { GrowthCatLogger } from "../core/logger";
import { installId } from "../core/install-id";
import {
  AttributionLink,
  AttributionAssignment,
  AttributionResolveResult,
  GrowthCatRewards,
} from "../models/attribution";
import { GrowthCatAnalyticsValue } from "../models/referral";
import { GrowthCatError } from "../models/errors";

const APP_USER_ID_KEY = "growthcat_app_user_id";

export class AttributionService {
  private readonly api: ApiClient;
  private readonly logger: GrowthCatLogger;
  private appUserId: string | null = null;

  constructor(api: ApiClient, logger: GrowthCatLogger) {
    this.api = api;
    this.logger = logger;
    this.appUserId = this.loadStoredUserId();
  }

  setAppUserId(userId: string) {
    this.appUserId = userId;
    try {
      localStorage.setItem(APP_USER_ID_KEY, userId);
    } catch {
      // storage unavailable
    }
  }

  getAppUserId(): string | null {
    return this.appUserId;
  }

  async generateShareLink(options: {
    campaignKey: string;
    deepLinkValue?: string;
    metadata?: Record<string, string>;
  }): Promise<AttributionLink> {
    const appUserId = this.requireAppUserId();
    return this.api.createShareLink({
      app_user_id: appUserId,
      campaign_key: options.campaignKey,
      deep_link_value: options.deepLinkValue,
      metadata: options.metadata,
      platform: "web",
    });
  }

  async handleLink(url: string): Promise<AttributionAssignment | null> {
    const token = extractTokenFromUrl(url);
    if (!token) return null;

    const appUserId = this.requireAppUserId();
    return this.api.claimAttribution({
      app_user_id: appUserId,
      sdk_install_id: installId(),
      token,
      match_type: "explicit_token",
    });
  }

  async resolveAttribution(sessionId?: string): Promise<AttributionResolveResult | null> {
    const appUserId = this.requireAppUserId();
    const result = await this.api.resolveAttribution({
      app_user_id: appUserId,
      sdk_install_id: installId(),
      platform: "web",
      referrer_url: typeof document !== "undefined" ? document.referrer : undefined,
    });

    if (result.matched && result.token && result.requiresConfirmation === false) {
      await this.api.claimAttribution({
        app_user_id: appUserId,
        sdk_install_id: installId(),
        session_id: sessionId,
        token: result.token,
        match_type: result.matchType ?? "probabilistic",
      } as never);
    }

    return result.matched ? result : null;
  }

  async confirmAttribution(token: string, sessionId?: string): Promise<AttributionAssignment | null> {
    const appUserId = this.requireAppUserId();
    return this.api.claimAttribution({
      app_user_id: appUserId,
      sdk_install_id: installId(),
      session_id: sessionId,
      token,
      match_type: "explicit_token",
    });
  }

  async track(eventName: string, properties?: Record<string, GrowthCatAnalyticsValue>) {
    const appUserId = this.requireAppUserId();
    await this.api.trackAttributionEvent({
      app_user_id: appUserId,
      sdk_install_id: installId(),
      event_name: eventName,
      properties,
    });
  }

  async rewards(): Promise<GrowthCatRewards> {
    const appUserId = this.requireAppUserId();
    return this.api.fetchRewards(appUserId);
  }

  private requireAppUserId(): string {
    if (!this.appUserId) throw GrowthCatError.missingAppUserId();
    return this.appUserId;
  }

  private loadStoredUserId(): string | null {
    try {
      return localStorage.getItem(APP_USER_ID_KEY);
    } catch {
      return null;
    }
  }
}

function extractTokenFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.get("gc_token") ??
      parsed.searchParams.get("token") ??
      null
    );
  } catch {
    return null;
  }
}
