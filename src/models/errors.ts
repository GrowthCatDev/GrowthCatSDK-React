export type GrowthCatErrorCode =
  | "not_initialized"
  | "missing_app_user_id"
  | "invalid_code"
  | "referral_code_type_not_allowed"
  | "friend_referrals_disabled"
  | "referral_account_age_unverified"
  | "referral_account_age_exceeded"
  | "referral_existing_account_ineligible"
  | "plan_limit_reached"
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
  readonly planLimit?: { meter?: string; limit?: number; used?: number; resetAt?: string };

  constructor(
    code: GrowthCatErrorCode,
    message: string,
    options?: {
      statusCode?: number;
      retryAfter?: number;
      requirements?: AppSetupRequirements;
      planLimit?: GrowthCatError["planLimit"];
    }
  ) {
    super(message);
    this.name = "GrowthCatError";
    this.code = code;
    this.statusCode = options?.statusCode;
    this.retryAfter = options?.retryAfter;
    this.requirements = options?.requirements;
    this.planLimit = options?.planLimit;
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
