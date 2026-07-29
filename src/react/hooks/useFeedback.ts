import { useState, useCallback, useEffect, useRef } from "react";
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
  const loadIdRef = useRef(0);
  const pendingVotesRef = useRef(new Set<string>());

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const results = await GrowthCat.shared.fetchFeedbackBoard(options.type);
      if (loadId !== loadIdRef.current) return;
      setItems(results);
    } catch (err) {
      if (loadId !== loadIdRef.current) return;
      setError(
        err instanceof GrowthCatError
          ? err
          : GrowthCatError.unknown(err instanceof Error ? err.message : undefined)
      );
    } finally {
      if (loadId === loadIdRef.current) setIsLoading(false);
    }
  }, [options.type]);

  useEffect(() => {
    if (options.autoLoad !== false) void load();
    return () => {
      loadIdRef.current += 1;
    };
  }, [load, options.autoLoad]);

  const vote = useCallback(async (itemId: string): Promise<FeedbackVoteResult | null> => {
    if (pendingVotesRef.current.has(itemId)) return null;
    pendingVotesRef.current.add(itemId);
    let previousItem: FeedbackBoardItem | undefined;
    setItems((prev) => prev.map((item) => {
      if (item.itemId !== itemId) return item;
      previousItem = item;
      return {
        ...item,
        hasVoted: true,
        voteCount: item.hasVoted ? item.voteCount : item.voteCount + 1,
      };
    }));
    try {
      const result = await GrowthCat.shared.voteFeedbackItem(itemId);
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId ? { ...i, hasVoted: result.hasVoted, voteCount: result.voteCount } : i
        )
      );
      return result;
    } catch (cause) {
      // Revert optimistic update
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId && previousItem ? previousItem : i
        )
      );
      setError(toGrowthCatError(cause));
      return null;
    } finally {
      pendingVotesRef.current.delete(itemId);
    }
  }, []);

  const unvote = useCallback(async (itemId: string): Promise<FeedbackVoteResult | null> => {
    if (pendingVotesRef.current.has(itemId)) return null;
    pendingVotesRef.current.add(itemId);
    let previousItem: FeedbackBoardItem | undefined;
    setItems((prev) => prev.map((item) => {
      if (item.itemId !== itemId) return item;
      previousItem = item;
      return {
        ...item,
        hasVoted: false,
        voteCount: item.hasVoted ? Math.max(0, item.voteCount - 1) : item.voteCount,
      };
    }));
    try {
      const result = await GrowthCat.shared.unvoteFeedbackItem(itemId);
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId ? { ...i, hasVoted: result.hasVoted, voteCount: result.voteCount } : i
        )
      );
      return result;
    } catch (cause) {
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId && previousItem ? previousItem : i
        )
      );
      setError(toGrowthCatError(cause));
      return null;
    } finally {
      pendingVotesRef.current.delete(itemId);
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

function toGrowthCatError(cause: unknown): GrowthCatError {
  return cause instanceof GrowthCatError
    ? cause
    : GrowthCatError.unknown(cause instanceof Error ? cause.message : undefined);
}
