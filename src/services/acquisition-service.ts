import type { MeasurementState } from "../core/privacy";
import type { ApiClient } from "../core/api";
import type {
  AcquisitionCampaign,
  AcquisitionCampaignConfig,
  AcquisitionEventPayload,
} from "../models/acquisition";

export class AcquisitionService {
  private readonly api: ApiClient;

  constructor(api: ApiClient, private readonly measurement: MeasurementState) {
    this.api = api;
  }

  async load(options: { slug: string; sessionId?: string }): Promise<AcquisitionCampaign> {
    const slug = options.slug.trim();
    if (!slug) throw new TypeError("[GrowthCat] acquisition slug must not be empty.");

    const config = await this.api.fetchAcquisitionCampaign(slug);
    const sessionId = () => options.sessionId ?? this.measurement.sessionId;

    const track = async (eventName: "landing_view" | "app_store_click") => {
      if (!this.measurement.allowsOptionalAnalytics()) return;
      const payload: AcquisitionEventPayload = {
        event_name: eventName,
        session_id: sessionId(),
        locale: typeof navigator !== "undefined" ? navigator.language : undefined,
        screen_width: typeof window !== "undefined" ? window.screen?.width : undefined,
        screen_height: typeof window !== "undefined" ? window.screen?.height : undefined,
      };
      await this.api.trackAcquisitionEvent(slug, payload);
    };

    return {
      ...config,
      get sessionId() { return sessionId(); },
      track,
      trackLandingView: () => track("landing_view"),
      openAppStore: async () => {
        if (!config.appleUrl) throw new Error("[GrowthCat] acquisition campaign is missing appleUrl.");
        // The API uses keepalive for events so navigation need not wait for delivery.
        void track("app_store_click").catch(() => {});
        if (typeof window !== "undefined") window.location.assign(config.appleUrl);
      },
    };
  }
}

export type { AcquisitionCampaignConfig };
