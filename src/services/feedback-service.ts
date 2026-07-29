import { ApiClient } from "../core/api";
import { GrowthCatLogger } from "../core/logger";
import {
  FeedbackUser,
  FeedbackSubmission,
  FeedbackSubmitResult,
  FeedbackVoteResult,
  FeedbackBoardItem,
  FeedbackType,
  GrowthCatFeedbackTheme,
  GrowthCatFeedbackStrings,
  DEFAULT_FEEDBACK_THEME,
  DEFAULT_FEEDBACK_STRINGS,
} from "../models/feedback";
import { GrowthCatError } from "../models/errors";
import { makeSessionId, scopedStorageKey } from "../core/install-id";

function generateAnonId(): string {
  return `anon_${makeSessionId()}`;
}

export class FeedbackService {
  private readonly api: ApiClient;
  private readonly logger: GrowthCatLogger;
  private boardSlug: string | null = null;
  private slugPromise: Promise<string> | null = null;
  private readonly anonymousIdKey = scopedStorageKey("growthcat_feedback_anon_id", 2);

  user: FeedbackUser | null = null;
  theme: GrowthCatFeedbackTheme = DEFAULT_FEEDBACK_THEME;
  strings: GrowthCatFeedbackStrings = DEFAULT_FEEDBACK_STRINGS;
  globalMetadata: Record<string, string> = {};
  disabledMetadataKeys = new Set<string>();
  readonly anonymousId: string;

  constructor(api: ApiClient, logger: GrowthCatLogger) {
    this.api = api;
    this.logger = logger;
    this.anonymousId = this.loadOrCreateAnonId();
  }

  identify(user: FeedbackUser) {
    this.user = user;
  }

  clearUser() {
    this.user = null;
  }

  setMetadata(metadata: Record<string, string>) {
    this.globalMetadata = { ...this.globalMetadata, ...metadata };
  }

  async submit(submission: FeedbackSubmission): Promise<FeedbackSubmitResult> {
    const title = submission.title.trim();
    if (!title) throw GrowthCatError.unknown("Feedback title must not be empty.");
    const metadata = this.buildMetadata(submission.metadata);

    return this.api.submitFeedback({
      type: submission.type,
      title,
      body: submission.body || undefined,
      external_user_id: this.user?.id,
      anonymous_id: this.user ? undefined : this.anonymousId,
      external_user_email: this.user?.email,
      external_user_name: this.user?.name,
      metadata,
      platform: "web",
    });
  }

  async fetchBoard(type?: FeedbackType): Promise<FeedbackBoardItem[]> {
    const slug = await this.resolveSlug();
    return this.api.fetchFeedbackBoard(slug, type, this.user?.id, this.user ? undefined : this.anonymousId);
  }

  async vote(itemId: string): Promise<FeedbackVoteResult> {
    if (!itemId.trim()) throw GrowthCatError.unknown("Feedback itemId must not be empty.");
    const slug = await this.resolveSlug();
    return this.api.voteFeedbackItem(slug, itemId.trim(), this.user?.id, this.user ? undefined : this.anonymousId);
  }

  async unvote(itemId: string): Promise<FeedbackVoteResult> {
    if (!itemId.trim()) throw GrowthCatError.unknown("Feedback itemId must not be empty.");
    const slug = await this.resolveSlug();
    return this.api.unvoteFeedbackItem(slug, itemId.trim(), this.user?.id, this.user ? undefined : this.anonymousId);
  }

  private async resolveSlug(): Promise<string> {
    if (this.boardSlug) return this.boardSlug;
    if (this.slugPromise) return this.slugPromise;

    this.slugPromise = this.api.fetchFeedbackConfig()
      .then(({ slug }) => {
        if (!slug) throw GrowthCatError.unknown("Feedback board not configured.");
        this.boardSlug = slug;
        return slug;
      })
      .finally(() => {
        this.slugPromise = null;
      });
    return this.slugPromise;
  }

  private buildMetadata(overrides?: Record<string, string>): Record<string, string> {
    const automatic: Record<string, string> = {};

    if (!this.disabledMetadataKeys.has("platform")) automatic["platform"] = "web";
    if (!this.disabledMetadataKeys.has("locale") && typeof navigator !== "undefined") {
      automatic["locale"] = navigator.language;
    }

    return { ...automatic, ...this.globalMetadata, ...(overrides ?? {}) };
  }

  private loadOrCreateAnonId(): string {
    try {
      const stored = localStorage.getItem(this.anonymousIdKey);
      if (stored) return stored;
      const id = generateAnonId();
      localStorage.setItem(this.anonymousIdKey, id);
      return id;
    } catch {
      return generateAnonId();
    }
  }
}
