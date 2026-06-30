export type GrowthCatEnvironmentMode = "automatic" | "production";

type GrowthCatWorkspace = "sandbox" | "live";

export interface GrowthCatConfiguration {
  apiKey: string;
  baseUrl: string;
  environmentMode: GrowthCatEnvironmentMode;
  workspace: GrowthCatWorkspace;
  logsEnabled: boolean;
}

export interface GrowthCatInitOptions {
  apiKey: string;
  environmentMode?: GrowthCatEnvironmentMode;
  logsEnabled?: boolean;
  /** Override backend URL — useful for QA against non-production environments. */
  baseUrl?: string;
}

const PRODUCTION_BASE_URL = "https://api.growthcat.dev";

function resolveWorkspace(mode: GrowthCatEnvironmentMode): GrowthCatWorkspace {
  if (mode === "production") return "live";
  // In browser environments there is no DEBUG build flag; treat production mode
  // as live and automatic as sandbox unless explicitly overridden.
  return "sandbox";
}

export function buildConfiguration(options: GrowthCatInitOptions): GrowthCatConfiguration {
  const mode = options.environmentMode ?? "automatic";
  return {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl ?? PRODUCTION_BASE_URL,
    environmentMode: mode,
    workspace: resolveWorkspace(mode),
    logsEnabled: options.logsEnabled ?? false,
  };
}
