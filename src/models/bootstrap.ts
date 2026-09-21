import { GrowthCatError } from "./errors";
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
  measurementSchemaVersion: number;
}

export function parseBootstrap(raw: Record<string, unknown>): GrowthCatSDKBootstrap {
  const sdkConfigRaw = (raw["sdk_config"] ?? {}) as Record<string, unknown>;
  const readinessRaw = (raw["readiness"] ?? {}) as Record<string, unknown>;
  const checksRaw = (readinessRaw["checks"] ?? {}) as Record<string, unknown>;
  const adsRaw = (raw["ads"] ?? {}) as Record<string, unknown>;

  return {
    appId: String(raw["app_id"] ?? ""),
    authenticated: booleanValue(raw["authenticated"] ?? true),
    workspace: raw["workspace"] != null ? String(raw["workspace"]) : undefined,
    sdkConfig: {
      showCodeRedeemUI: booleanValue(sdkConfigRaw["show_code_redeem_ui"] ?? false),
      allowCodeRedeemExecution: booleanValue(sdkConfigRaw["allow_code_redeem_execution"] ?? false),
      sandboxEnabled: sdkConfigRaw["sandbox_enabled"] != null
        ? booleanValue(sdkConfigRaw["sandbox_enabled"])
        : undefined,
      defaultWorkspace: sdkConfigRaw["default_workspace"] != null
        ? String(sdkConfigRaw["default_workspace"])
        : undefined,
      allowedWorkspaces: Array.isArray(sdkConfigRaw["allowed_workspaces"])
        ? (sdkConfigRaw["allowed_workspaces"] as string[])
        : undefined,
    },
    readiness: {
      canValidateCodes: booleanValue(readinessRaw["can_validate_codes"] ?? false),
      checks: {
        sdkKeyValid: booleanValue(checksRaw["sdk_key_valid"] ?? true),
        appActive: booleanValue(checksRaw["app_active"] ?? true),
        sandboxEnabled: checksRaw["sandbox_enabled"] != null
          ? booleanValue(checksRaw["sandbox_enabled"])
          : undefined,
        revenueCatSecretConfigured: booleanValue(checksRaw["revenuecat_secret_configured"] ?? false),
        revenueCatWebhookConfigured: booleanValue(checksRaw["revenuecat_webhook_configured"] ?? false),
      },
    },
    adsConfig: {
      adsEnabled: booleanValue(adsRaw["ads_enabled"] ?? false),
      adCacheTtlSeconds: finiteNumber(adsRaw["ad_cache_ttl_seconds"], 300, 0),
      maxOfflineAdEvents: finiteNumber(adsRaw["max_offline_ad_events"], 500, 1),
      measurementSchemaVersion: finiteNumber(adsRaw["measurement_schema_version"], 1, 1),
    },
  };
}

function finiteNumber(raw: unknown, fallback: number, minimum: number): number {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw GrowthCatError.server(502, "Invalid bootstrap boolean.");
  return value;
}
