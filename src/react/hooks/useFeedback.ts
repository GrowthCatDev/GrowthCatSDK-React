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
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => Promise<void>;
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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setIsLoading(true);
    setItems([]);
    pendingVotesRef.current = new Set();
    loadingMoreRef.current = false;
    setIsLoadingMore(false);
    setNextCursor(null);
    setError(null);
    try {
      const page = await GrowthCat.shared.fetchFeedbackPage({ type: options.type });
      if (loadId !== loadIdRef.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
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

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current || isLoading) return;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    const loadId = loadIdRef.current;
    try {
      const page = await GrowthCat.shared.fetchFeedbackPage({ type: options.type, cursor: nextCursor });
      if (loadId !== loadIdRef.current) return;
      setItems(current => [...current, ...page.items.filter(item => !current.some(existing => existing.itemId === item.itemId))]);
      setNextCursor(page.nextCursor === nextCursor ? null : page.nextCursor);
    } catch (cause) {
      if (loadId === loadIdRef.current) setError(toGrowthCatError(cause));
    } finally {
      if (loadId === loadIdRef.current) { loadingMoreRef.current = false; setIsLoadingMore(false); }
    }
  }, [nextCursor, options.type, isLoading]);

  useEffect(() => {
    const resetIdentity = () => {
      loadIdRef.current += 1;
      pendingVotesRef.current = new Set();
      loadingMoreRef.current = false;
      setItems([]);
      setNextCursor(null);
      setError(null);
      setIsLoading(false);
      setIsLoadingMore(false);
      if (options.autoLoad !== false) void load();
    };
    const unsubscribe = GrowthCat.shared.feedbackService.subscribeIdentity(resetIdentity);
    resetIdentity();
    return () => { unsubscribe(); loadIdRef.current += 1; };
  }, [load, options.autoLoad]);

  const vote = useCallback(async (itemId: string): Promise<FeedbackVoteResult | null> => {
    if (pendingVotesRef.current.has(itemId)) return null;
    const pendingVotes = pendingVotesRef.current;
    const loadId = loadIdRef.current;
    pendingVotes.add(itemId);
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
      if (loadId !== loadIdRef.current) return null;
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId ? { ...i, hasVoted: result.hasVoted, voteCount: result.voteCount } : i
        )
      );
      return result;
    } catch (cause) {
      if (loadId !== loadIdRef.current) return null;
      // Revert optimistic update
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId && previousItem ? previousItem : i
        )
      );
      setError(toGrowthCatError(cause));
      return null;
    } finally {
      pendingVotes.delete(itemId);
    }
  }, []);

  const unvote = useCallback(async (itemId: string): Promise<FeedbackVoteResult | null> => {
    if (pendingVotesRef.current.has(itemId)) return null;
    const pendingVotes = pendingVotesRef.current;
    const loadId = loadIdRef.current;
    pendingVotes.add(itemId);
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
      if (loadId !== loadIdRef.current) return null;
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId ? { ...i, hasVoted: result.hasVoted, voteCount: result.voteCount } : i
        )
      );
      return result;
    } catch (cause) {
      if (loadId !== loadIdRef.current) return null;
      setItems((prev) =>
        prev.map((i) =>
          i.itemId === itemId && previousItem ? previousItem : i
        )
      );
      setError(toGrowthCatError(cause));
      return null;
    } finally {
      pendingVotes.delete(itemId);
    }
  }, []);

  return { items, isLoading, error, reload: load, vote, unvote, hasMore: nextCursor !== null, isLoadingMore, loadMore };
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
  const generationRef = useRef(0);

  useEffect(() => {
    const unsubscribe = GrowthCat.shared.feedbackService.subscribeIdentity(() => {
      generationRef.current += 1;
      setIsSubmitting(false);
      setResult(null);
      setError(null);
    });
    return () => { unsubscribe(); generationRef.current += 1; };
  }, []);

  const submit = useCallback(
    async (submission: FeedbackSubmission): Promise<FeedbackSubmitResult | null> => {
      const generation = ++generationRef.current;
      setIsSubmitting(true);
      setError(null);
      setResult(null);
      try {
        const r = await GrowthCat.shared.submitFeedback(submission);
        if (generation !== generationRef.current) return null;
        setResult(r);
        return r;
      } catch (err) {
        if (generation !== generationRef.current) return null;
        setError(
          err instanceof GrowthCatError
            ? err
            : GrowthCatError.unknown(err instanceof Error ? err.message : undefined)
        );
        return null;
      } finally {
        if (generation === generationRef.current) setIsSubmitting(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    generationRef.current += 1;
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
