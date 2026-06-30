export type GrowthCatErrorCode =
  | "not_initialized"
  | "missing_app_user_id"
  | "invalid_code"
  | "app_setup_incomplete"
  | "unauthorized"
  | "rate_limited"
  | "network"
  | "server"
  | "unknown";

export interface AppSetupRequirements {
  revenueCatSecretApiKeyConfigured: boolean;
  revenueCatWebhookConfigured: boolean;
}

export class GrowthCatError extends Error {
  readonly code: GrowthCatErrorCode;
  readonly statusCode?: number;
  readonly retryAfter?: number;
  readonly requirements?: AppSetupRequirements;

  constructor(
    code: GrowthCatErrorCode,
    message: string,
    options?: {
      statusCode?: number;
      retryAfter?: number;
      requirements?: AppSetupRequirements;
    }
  ) {
    super(message);
    this.name = "GrowthCatError";
    this.code = code;
    this.statusCode = options?.statusCode;
    this.retryAfter = options?.retryAfter;
    this.requirements = options?.requirements;
  }

  static notInitialized() {
    return new GrowthCatError(
      "not_initialized",
      "GrowthCat.initialize() must be called before any SDK operation."
    );
  }

  static missingAppUserId() {
    return new GrowthCatError(
      "missing_app_user_id",
      "No app user ID is set. Call GrowthCat.setAppUserId() first."
    );
  }

  static invalidCode(message?: string) {
    return new GrowthCatError(
      "invalid_code",
      message ?? "Referral code not found or inactive."
    );
  }

  static unauthorized(message?: string) {
    return new GrowthCatError(
      "unauthorized",
      message ?? "Invalid SDK key."
    );
  }

  static rateLimited(retryAfter?: number) {
    return new GrowthCatError("rate_limited", "Too many requests.", {
      retryAfter,
    });
  }

  static network(message?: string) {
    return new GrowthCatError(
      "network",
      message ?? "A network error occurred. Please check your connection."
    );
  }

  static server(statusCode: number, message?: string) {
    return new GrowthCatError("server", message ?? "An unexpected server error occurred.", {
      statusCode,
    });
  }

  static appSetupIncomplete(message: string, requirements: AppSetupRequirements) {
    return new GrowthCatError("app_setup_incomplete", message, { requirements });
  }

  static unknown(message?: string) {
    return new GrowthCatError("unknown", message ?? "An unknown error occurred.");
  }
}
