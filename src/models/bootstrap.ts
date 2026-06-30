export interface GrowthCatSDKBootstrap {
  appId: string;
  authenticated: boolean;
  workspace?: string;
  sdkConfig: GrowthCatSDKConfig;
  readiness: GrowthCatSDKReadiness;
  adsConfig: GrowthCatSDKAdsConfig;
}

export interface GrowthCatSDKConfig {
  showCodeRedeemUI: boolean;
  allowCodeRedeemExecution: boolean;
  sandboxEnabled?: boolean;
  defaultWorkspace?: string;
  allowedWorkspaces?: string[];
}

export interface GrowthCatSDKReadiness {
  canValidateCodes: boolean;
  checks: GrowthCatSDKReadinessChecks;
}

export interface GrowthCatSDKReadinessChecks {
  sdkKeyValid: boolean;
  appActive: boolean;
  sandboxEnabled?: boolean;
  revenueCatSecretConfigured: boolean;
  revenueCatWebhookConfigured: boolean;
}

export interface GrowthCatSDKAdsConfig {
  adsEnabled: boolean;
  adCacheTtlSeconds: number;
  maxOfflineAdEvents: number;
}

export function parseBootstrap(raw: Record<string, unknown>): GrowthCatSDKBootstrap {
  const sdkConfigRaw = (raw["sdk_config"] ?? {}) as Record<string, unknown>;
  const readinessRaw = (raw["readiness"] ?? {}) as Record<string, unknown>;
  const checksRaw = (readinessRaw["checks"] ?? {}) as Record<string, unknown>;
  const adsRaw = (raw["ads"] ?? {}) as Record<string, unknown>;

  return {
    appId: String(raw["app_id"] ?? ""),
    authenticated: Boolean(raw["authenticated"] ?? true),
    workspace: raw["workspace"] != null ? String(raw["workspace"]) : undefined,
    sdkConfig: {
      showCodeRedeemUI: Boolean(sdkConfigRaw["show_code_redeem_ui"] ?? false),
      allowCodeRedeemExecution: Boolean(sdkConfigRaw["allow_code_redeem_execution"] ?? false),
      sandboxEnabled: sdkConfigRaw["sandbox_enabled"] != null
        ? Boolean(sdkConfigRaw["sandbox_enabled"])
        : undefined,
      defaultWorkspace: sdkConfigRaw["default_workspace"] != null
        ? String(sdkConfigRaw["default_workspace"])
        : undefined,
      allowedWorkspaces: Array.isArray(sdkConfigRaw["allowed_workspaces"])
        ? (sdkConfigRaw["allowed_workspaces"] as string[])
        : undefined,
    },
    readiness: {
      canValidateCodes: Boolean(readinessRaw["can_validate_codes"] ?? false),
      checks: {
        sdkKeyValid: Boolean(checksRaw["sdk_key_valid"] ?? true),
        appActive: Boolean(checksRaw["app_active"] ?? true),
        sandboxEnabled: checksRaw["sandbox_enabled"] != null
          ? Boolean(checksRaw["sandbox_enabled"])
          : undefined,
        revenueCatSecretConfigured: Boolean(checksRaw["revenuecat_secret_configured"] ?? false),
        revenueCatWebhookConfigured: Boolean(checksRaw["revenuecat_webhook_configured"] ?? false),
      },
    },
    adsConfig: {
      adsEnabled: Boolean(adsRaw["ads_enabled"] ?? false),
      adCacheTtlSeconds: Number(adsRaw["ad_cache_ttl_seconds"] ?? 300),
      maxOfflineAdEvents: Number(adsRaw["max_offline_ad_events"] ?? 500),
    },
  };
}
