export type FeedbackType = "idea" | "bug" | "feedback" | "question";

export type FeedbackItemStatus =
  | "new"
  | "triage"
  | "todo"
  | "in_progress"
  | "done"
  | "closed";

// ─── User ─────────────────────────────────────────────────────────────────────

export interface FeedbackUser {
  id: string;
  email?: string;
  name?: string;
}

// ─── Theme ────────────────────────────────────────────────────────────────────

export interface GrowthCatFeedbackTheme {
  accentColor: string;
  backgroundColor: string;
  cardColor: string;
  primaryTextColor: string;
  secondaryTextColor: string;
  borderColor: string;
}

export const DEFAULT_FEEDBACK_THEME: GrowthCatFeedbackTheme = {
  accentColor: "#0A84FF",
  backgroundColor: "#F2F2F7",
  cardColor: "#FFFFFF",
  primaryTextColor: "#111111",
  secondaryTextColor: "#6B6B70",
  borderColor: "#DDDDDD",
};

// ─── Strings ──────────────────────────────────────────────────────────────────

export interface GrowthCatFeedbackStrings {
  title: string;
  cancel: string;
  submit: string;
  submitting: string;
  successTitle: string;
  typeLabel: string;
  titleLabel: string;
  titlePlaceholder: string;
  detailsLabel: string;
  detailsPlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  errorFallback: string;
  typeLabels: Record<FeedbackType, string>;
  boardTitle: string;
  allFilterLabel: string;
  emptyBoardTitle: string;
  emptyBoardMessage: string;
  loadErrorFallback: string;
  retry: string;
}

export const DEFAULT_FEEDBACK_STRINGS: GrowthCatFeedbackStrings = {
  title: "Send Feedback",
  cancel: "Close",
  submit: "Submit",
  submitting: "Submitting…",
  successTitle: "Thanks for your feedback!",
  typeLabel: "Category",
  titleLabel: "Summary",
  titlePlaceholder: "What should we add?",
  detailsLabel: "Details",
  detailsPlaceholder: "Tell us what you would like to see",
  emailLabel: "Email (optional)",
  emailPlaceholder: "you@example.com",
  errorFallback: "Something went wrong. Please try again.",
  typeLabels: {
    idea: "Idea",
    bug: "Bug",
    feedback: "Feedback",
    question: "Question",
  },
  boardTitle: "Feedback",
  allFilterLabel: "All",
  emptyBoardTitle: "No feedback yet",
  emptyBoardMessage: "Be the first to share an idea, report a bug, or ask a question.",
  loadErrorFallback: "Couldn't load feedback. Please try again.",
  retry: "Retry",
};

// ─── Submission ───────────────────────────────────────────────────────────────

export interface FeedbackSubmission {
  type: FeedbackType;
  title: string;
  body?: string;
  metadata?: Record<string, string>;
}

// ─── Results ──────────────────────────────────────────────────────────────────

export interface FeedbackSubmitResult {
  itemId: string;
  type: FeedbackType;
  title: string;
  body?: string;
  status: FeedbackItemStatus;
  voteCount: number;
  commentCount: number;
  isPinned: boolean;
  hasVoted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeedbackVoteResult {
  itemId: string;
  hasVoted: boolean;
  voteCount: number;
}

export interface FeedbackBoardItem {
  itemId: string;
  type: FeedbackType;
  title: string;
  body?: string;
  status: FeedbackItemStatus;
  voteCount: number;
  commentCount: number;
  isPinned: boolean;
  hasVoted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── API shapes ───────────────────────────────────────────────────────────────

export interface FeedbackSubmitRequest {
  type: FeedbackType;
  title: string;
  body?: string;
  user_id?: string;
  anonymous_id?: string;
  email?: string;
  name?: string;
  metadata?: Record<string, string>;
  platform: "web";
}

export function parseFeedbackItem(raw: Record<string, unknown>): FeedbackBoardItem {
  return {
    itemId: String(raw["id"] ?? raw["item_id"] ?? ""),
    type: (raw["type"] ?? "feedback") as FeedbackType,
    title: String(raw["title"] ?? ""),
    body: raw["body"] != null ? String(raw["body"]) : undefined,
    status: (raw["status"] ?? "new") as FeedbackItemStatus,
    voteCount: Number(raw["vote_count"] ?? 0),
    commentCount: Number(raw["comment_count"] ?? 0),
    isPinned: Boolean(raw["is_pinned"] ?? false),
    hasVoted: Boolean(raw["has_voted"] ?? false),
    createdAt: new Date(String(raw["created_at"] ?? new Date().toISOString())),
    updatedAt: new Date(String(raw["updated_at"] ?? new Date().toISOString())),
  };
}
