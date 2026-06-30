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

const ANON_ID_KEY = "growthcat_feedback_anon_id";

function generateAnonId(): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `anon_${suffix}`;
}

export class FeedbackService {
  private readonly api: ApiClient;
  private readonly logger: GrowthCatLogger;
  private boardSlug: string | null = null;
  private slugPromise: Promise<string> | null = null;

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
    const slug = await this.resolveSlug();
    const metadata = this.buildMetadata(submission.metadata);

    return this.api.submitFeedback(slug, {
      type: submission.type,
      title: submission.title,
      body: submission.body || undefined,
      user_id: this.user?.id,
      anonymous_id: this.user ? undefined : this.anonymousId,
      email: this.user?.email,
      name: this.user?.name,
      metadata,
      platform: "web",
    });
  }

  async fetchBoard(type?: FeedbackType): Promise<FeedbackBoardItem[]> {
    const slug = await this.resolveSlug();
    return this.api.fetchFeedbackBoard(slug, type);
  }

  async vote(itemId: string): Promise<FeedbackVoteResult> {
    const slug = await this.resolveSlug();
    return this.api.voteFeedbackItem(slug, itemId, this.user?.id, this.user ? undefined : this.anonymousId);
  }

  async unvote(itemId: string): Promise<FeedbackVoteResult> {
    const slug = await this.resolveSlug();
    return this.api.unvoteFeedbackItem(slug, itemId, this.user?.id, this.user ? undefined : this.anonymousId);
  }

  private async resolveSlug(): Promise<string> {
    if (this.boardSlug) return this.boardSlug;
    if (this.slugPromise) return this.slugPromise;

    this.slugPromise = this.api.fetchFeedbackConfig().then(({ slug }) => {
      if (!slug) throw GrowthCatError.unknown("Feedback board not configured.");
      this.boardSlug = slug;
      this.slugPromise = null;
      return slug;
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
      const stored = localStorage.getItem(ANON_ID_KEY);
      if (stored) return stored;
      const id = generateAnonId();
      localStorage.setItem(ANON_ID_KEY, id);
      return id;
    } catch {
      return generateAnonId();
    }
  }
}
