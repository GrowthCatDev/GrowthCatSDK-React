import type { GrowthCatMeasurementMode } from "./privacy";

export type GrowthCatEnvironmentMode = "automatic" | "production";

export type GrowthCatWorkspace = "sandbox" | "live";

export interface GrowthCatIdentityRequest {
  appUserId: string;
  scope: "user" | "event";
  eventName?: string;
  eventId?: string;
  forceRefresh: boolean;
}

export interface GrowthCatDeliveryStatus {
  eventId: string;
  state: "queued" | "delivered" | "rejected";
  statusCode?: number;
}

export interface GrowthCatConfiguration {
  apiKey: string;
  baseUrl: string;
  environmentMode: GrowthCatEnvironmentMode;
  workspace: GrowthCatWorkspace;
  logsEnabled: boolean;
  measurementMode: GrowthCatMeasurementMode;
  requestTimeoutMs: number;
  identityTokenProvider?: (request: GrowthCatIdentityRequest) => Promise<string>;
  onDeliveryStatus?: (status: GrowthCatDeliveryStatus) => void;
}

export interface GrowthCatInitOptions {
  apiKey: string;
  environmentMode?: GrowthCatEnvironmentMode;
  /** Explicitly selects the backend workspace. Prefer this over `environmentMode`. */
  workspace?: GrowthCatWorkspace;
  logsEnabled?: boolean;
  /** Override backend URL — useful for QA against non-production environments. */
  baseUrl?: string;
  /**
   * Controls collection of pseudonymous measurement data. Defaults to
   * `essential`; select `analytics` only after the host has a valid legal basis.
   */
  measurementMode?: GrowthCatMeasurementMode;
  /** Maximum duration for one HTTP request. Defaults to 15 seconds. */
  requestTimeoutMs?: number;
  /** Fetch a short-lived signed token from your authenticated application server. */
  identityTokenProvider?: GrowthCatConfiguration["identityTokenProvider"];
  /** Receives delivery state without event properties or personal data. */
  onDeliveryStatus?: GrowthCatConfiguration["onDeliveryStatus"];
}

const PRODUCTION_BASE_URL = "https://api.growthcat.dev";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function resolveWorkspace(
  mode: GrowthCatEnvironmentMode,
  apiKey: string,
  explicit?: GrowthCatWorkspace
): GrowthCatWorkspace {
  if (explicit) return explicit;
  if (mode === "production") return "live";
  if (/^gc_live(?:_|$)/i.test(apiKey)) return "live";
  return "sandbox";
}

export function buildConfiguration(options: GrowthCatInitOptions): GrowthCatConfiguration {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) throw new TypeError("[GrowthCat] apiKey must be a non-empty string.");

  const rawBaseUrl = (options.baseUrl ?? PRODUCTION_BASE_URL).trim().replace(/\/+$/, "");
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(rawBaseUrl);
  } catch {
    throw new TypeError("[GrowthCat] baseUrl must be a valid absolute URL.");
  }
  if (parsedBaseUrl.protocol !== "https:" && parsedBaseUrl.protocol !== "http:") {
    throw new TypeError("[GrowthCat] baseUrl must use http or https.");
  }
  if (parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new TypeError("[GrowthCat] baseUrl cannot contain credentials, a query, or a fragment.");
  }
  if (parsedBaseUrl.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsedBaseUrl.hostname)) {
    throw new TypeError("[GrowthCat] remote baseUrl must use HTTPS.");
  }
  if (options.measurementMode && !["essential", "analytics", "disabled"].includes(options.measurementMode)) {
    throw new TypeError("[GrowthCat] invalid measurementMode.");
  }

  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new TypeError("[GrowthCat] requestTimeoutMs must be a positive number.");
  }

  const mode = options.environmentMode ?? "automatic";
  return {
    apiKey,
    baseUrl: rawBaseUrl,
    environmentMode: mode,
    workspace: resolveWorkspace(mode, apiKey, options.workspace),
    logsEnabled: options.logsEnabled ?? false,
    measurementMode: options.measurementMode ?? "essential",
    requestTimeoutMs,
    identityTokenProvider: options.identityTokenProvider,
    onDeliveryStatus: options.onDeliveryStatus,
  };
}
