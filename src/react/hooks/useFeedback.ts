import { useState, useCallback, useEffect } from "react";
import { GrowthCat } from "../../growthcat";
import {
  FeedbackBoardItem,
  FeedbackSubmission,
  FeedbackSubmitResult,
  FeedbackVoteResult,
  FeedbackType,
} from "../../models/feedback";
import { GrowthCatError } from "../../models/errors";

// ─── Board hook ────────────────────────────────────────────────────────────────

export interface UseFeedbackBoardOptions {
  type?: FeedbackType;
  autoLoad?: boolean;
}

export interface UseFeedbackBoardResult {
  items: FeedbackBoardItem[];
  isLoading: boolean;
  error: GrowthCatError | null;
  reload: () => void;
  vote: (itemId: string) => Promise<FeedbackVoteResult | null>;
  unvote: (itemId: string) => Promise<FeedbackVoteResult | null>;
}

/**
 * Loads the public feedback board and provides vote/unvote actions.
 * Items are updated optimistically on vote.
 */
export function useFeedbackBoard(options: UseFeedbackBoardOptions = {}): UseFeedbackBoardResult {
  const [items, setItems] = useState<FeedbackBoardItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<GrowthCatError | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const results = await GrowthCat.shared.fetchFeedbackBoard(options.type);
      setItems(results);
    } catch (err) {
      setError(
        err instanceof GrowthCatError
          ? err
          : GrowthCatError.unknown(err instanceof Error ? err.message : undefined)
      );
    } finally {
      setIsLoading(false);
    }
  }, [options.type]);

  useEffect(() => {
    if (options.autoLoad !== false) void load();
  }, [load, options.autoLoad]);

  const vote = useCallback(async (itemId: string): Promise<FeedbackVoteResult | null> => {
    setItems((prev) =>
      prev.map((i) =>
        i.itemId === itemId ? { ...i, hasVoted: true, voteCount: i.voteCount + 1 } : i
      )
    );
    try {
      const result = await GrowthCat.shared.voteFeedbackItem(itemId);
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId ? { ...i, hasVoted: result.hasVoted, voteCount: result.voteCount } : i
        )
      );
      return result;
    } catch {
      // Revert optimistic update
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId ? { ...i, hasVoted: false, voteCount: i.voteCount - 1 } : i
        )
      );
      return null;
    }
  }, []);

  const unvote = useCallback(async (itemId: string): Promise<FeedbackVoteResult | null> => {
    setItems((prev) =>
      prev.map((i) =>
        i.itemId === itemId ? { ...i, hasVoted: false, voteCount: Math.max(0, i.voteCount - 1) } : i
      )
    );
    try {
      const result = await GrowthCat.shared.unvoteFeedbackItem(itemId);
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId ? { ...i, hasVoted: result.hasVoted, voteCount: result.voteCount } : i
        )
      );
      return result;
    } catch {
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId ? { ...i, hasVoted: true, voteCount: i.voteCount + 1 } : i
        )
      );
      return null;
    }
  }, []);

  return { items, isLoading, error, reload: load, vote, unvote };
}

// ─── Submit hook ───────────────────────────────────────────────────────────────

export interface UseFeedbackSubmitResult {
  isSubmitting: boolean;
  result: FeedbackSubmitResult | null;
  error: GrowthCatError | null;
  submit: (submission: FeedbackSubmission) => Promise<FeedbackSubmitResult | null>;
  reset: () => void;
}

/** Provides a submit action for the feedback compose form. */
export function useFeedbackSubmit(): UseFeedbackSubmitResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<FeedbackSubmitResult | null>(null);
  const [error, setError] = useState<GrowthCatError | null>(null);

  const submit = useCallback(
    async (submission: FeedbackSubmission): Promise<FeedbackSubmitResult | null> => {
      setIsSubmitting(true);
      setError(null);
      setResult(null);
      try {
        const r = await GrowthCat.shared.submitFeedback(submission);
        setResult(r);
        return r;
      } catch (err) {
        setError(
          err instanceof GrowthCatError
            ? err
            : GrowthCatError.unknown(err instanceof Error ? err.message : undefined)
        );
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setIsSubmitting(false);
    setResult(null);
    setError(null);
  }, []);

  return { isSubmitting, result, error, submit, reset };
}
