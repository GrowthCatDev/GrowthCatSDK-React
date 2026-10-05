import { ApiClient } from "../core/api";
import { GrowthCatLogger } from "../core/logger";
import {
  FeedbackUser,
  FeedbackSubmission,
  FeedbackSubmitResult,
  FeedbackVoteResult,
  FeedbackBoardItem,
  FeedbackType,
  FeedbackPage,
  FeedbackPageOptions,
  GrowthCatFeedbackTheme,
  GrowthCatFeedbackStrings,
  DEFAULT_FEEDBACK_THEME,
  DEFAULT_FEEDBACK_STRINGS,
} from "../models/feedback";
import { GrowthCatError } from "../models/errors";
import { makeSessionId } from "../core/install-id";

function generateAnonId(): string {
  return `anon_${makeSessionId()}`;
}

export class FeedbackService {
  private readonly api: ApiClient;
  private readonly logger: GrowthCatLogger;
  private boardSlug: string | null = null;
  private slugPromise: Promise<string> | null = null;
  private readonly anonymousIdKey: string;

  private readonly identityListeners = new Set<() => void>();
  private identityGeneration = 0;
  user: FeedbackUser | null = null;
  theme: GrowthCatFeedbackTheme = DEFAULT_FEEDBACK_THEME;
  strings: GrowthCatFeedbackStrings = DEFAULT_FEEDBACK_STRINGS;
  globalMetadata: Record<string, string> = {};
  disabledMetadataKeys = new Set<string>();
  readonly anonymousId: string;

  constructor(api: ApiClient, logger: GrowthCatLogger) {
    this.api = api;
    this.logger = logger;
    this.anonymousIdKey = api.storageKey("feedback_anon_id");
    this.anonymousId = this.loadOrCreateAnonId();
  }

  subscribeIdentity(listener: () => void): () => void {
    this.identityListeners.add(listener);
    return () => { this.identityListeners.delete(listener); };
  }

  identify(user: FeedbackUser) {
    const changed = this.user?.id !== user.id;
    this.user = user;
    if (changed) this.notifyIdentity();
  }

  clearUser() {
    if (!this.user) return;
    this.user = null;
    this.notifyIdentity();
  }

  private notifyIdentity() {
    this.identityGeneration += 1;
    for (const listener of this.identityListeners) listener();
  }

  private async resolveIdentity() {
    const generation = this.identityGeneration;
    const user = this.user;
    const slug = await this.resolveSlug();
    if (generation !== this.identityGeneration) throw GrowthCatError.network("Feedback identity changed.");
    return { slug, userId: user?.id, anonymousId: user ? undefined : this.anonymousId };
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
    const { slug, userId, anonymousId } = await this.resolveIdentity();
    return this.api.fetchFeedbackBoard(slug, type, userId, anonymousId);
  }

  async fetchPage(options: FeedbackPageOptions = {}): Promise<FeedbackPage> {
    const { slug, userId, anonymousId } = await this.resolveIdentity();
    return this.api.fetchFeedbackPage(slug, options, userId, anonymousId);
  }

  async vote(itemId: string): Promise<FeedbackVoteResult> {
    if (!itemId.trim()) throw GrowthCatError.unknown("Feedback itemId must not be empty.");
    const { slug, userId, anonymousId } = await this.resolveIdentity();
    return this.api.voteFeedbackItem(slug, itemId.trim(), userId, anonymousId);
  }

  async unvote(itemId: string): Promise<FeedbackVoteResult> {
    if (!itemId.trim()) throw GrowthCatError.unknown("Feedback itemId must not be empty.");
    const { slug, userId, anonymousId } = await this.resolveIdentity();
    return this.api.unvoteFeedbackItem(slug, itemId.trim(), userId, anonymousId);
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
