import React, { useEffect, useState } from "react";
import { useFeedbackBoard, useFeedbackSubmit } from "../hooks/useFeedback";
import {
  DEFAULT_FEEDBACK_DARK_THEME,
  DEFAULT_FEEDBACK_LIGHT_THEME,
  FeedbackBoardItem,
  FeedbackType,
  GrowthCatFeedbackStrings,
  GrowthCatFeedbackTheme,
  GrowthCatFeedbackThemeColors,
} from "../../models/feedback";
import { GrowthCat } from "../../growthcat";

export interface GrowthCatFeedbackBoardProps {
  /** Pre-apply a type filter. `undefined` shows all items. */
  defaultType?: FeedbackType;
  className?: string;
  style?: React.CSSProperties;
}

const TYPES: FeedbackType[] = ["idea", "bug", "feedback", "question"];

/**
 * The full-featured feedback board with type filters, voting, and a compose
 * form. Mirrors the iOS native feedback sheet.
 *
 * For a fully custom board, use `useFeedbackBoard()` and build your own UI.
 */
export function GrowthCatFeedbackBoard({
  defaultType,
  className,
  style,
}: GrowthCatFeedbackBoardProps) {
  const client = GrowthCat.isConfigured ? GrowthCat.shared : null;
  const strings = client?.feedbackStrings;
  const theme = client?.feedbackTheme;

  const [activeType, setActiveType] = useState<FeedbackType | undefined>(defaultType);
  const [showCompose, setShowCompose] = useState(false);
  const prefersDark = usePrefersDarkMode();
  const isCompact = useMediaQuery("(max-width: 640px)");

  const { items, isLoading, error, reload, vote, unvote } = useFeedbackBoard({
    type: activeType,
    autoLoad: true,
  });

  const resolvedTheme = resolveFeedbackTheme(theme, prefersDark);
  const accent = resolvedTheme.accentColor;
  const bg = resolvedTheme.backgroundColor;
  const card = resolvedTheme.cardColor;
  const primaryText = resolvedTheme.primaryTextColor;
  const secondaryText = resolvedTheme.secondaryTextColor;
  const border = resolvedTheme.borderColor;
  const overlay = resolvedTheme.overlayColor ?? "rgba(0,0,0,0.4)";
  const inputBackground = resolvedTheme.inputBackgroundColor ?? card;
  const buttonText = resolvedTheme.buttonTextColor ?? "#fff";
  const selectedControlBackground = resolvedTheme.selectedControlBackgroundColor ?? "rgba(10,132,255,0.1)";

  return (
    <div
      className={className}
      style={{
        backgroundColor: bg,
        minHeight: 200,
        fontFamily: "system-ui, sans-serif",
        color: primaryText,
        boxSizing: "border-box",
        ...style,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 16px 0",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
          {strings?.boardTitle ?? "Feedback"}
        </h2>
        <button
          onClick={() => setShowCompose(true)}
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "none",
            backgroundColor: accent,
            color: "#fff",
            fontSize: 22,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          +
        </button>
      </div>

      {/* Type filter chips */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 16px",
          overflowX: "auto",
          borderBottom: `1px solid ${border}`,
        }}
      >
        <FilterChip
          label={strings?.allFilterLabel ?? "All"}
          active={activeType === undefined}
          onClick={() => setActiveType(undefined)}
          accentColor={accent}
          borderColor={border}
          inactiveTextColor={secondaryText}
          activeTextColor={buttonText}
        />
        {TYPES.map((t) => (
          <FilterChip
            key={t}
            label={strings?.typeLabels?.[t] ?? t}
            active={activeType === t}
            onClick={() => setActiveType(activeType === t ? undefined : t)}
            accentColor={accent}
            borderColor={border}
            inactiveTextColor={secondaryText}
            activeTextColor={buttonText}
          />
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ padding: 32, textAlign: "center", color: secondaryText }}>
          Loading…
        </div>
      ) : error ? (
        <div style={{ padding: 32, textAlign: "center" }}>
          <p style={{ color: "#EF4444", marginBottom: 12 }}>
            {strings?.loadErrorFallback ?? "Couldn't load feedback."}
          </p>
          <button
            onClick={reload}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              border: "none",
              borderRadius: 8,
              backgroundColor: accent,
              color: "#fff",
              cursor: "pointer",
            }}
          >
            {strings?.retry ?? "Retry"}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center" }}>
          <p style={{ fontSize: 16, fontWeight: 600, color: primaryText, margin: "0 0 8px" }}>
            {strings?.emptyBoardTitle ?? "No feedback yet"}
          </p>
          <p style={{ fontSize: 14, color: secondaryText, margin: 0 }}>
            {strings?.emptyBoardMessage ?? "Be the first to share an idea."}
          </p>
        </div>
      ) : (
        <ul style={{ margin: 0, padding: "8px 16px", listStyle: "none" }}>
          {items.map((item) => (
            <BoardItemRow
              key={item.itemId}
              item={item}
              cardColor={card}
              primaryText={primaryText}
              secondaryText={secondaryText}
              border={border}
              accentColor={accent}
              selectedControlBackgroundColor={selectedControlBackground}
              onVote={() => void (item.hasVoted ? unvote(item.itemId) : vote(item.itemId))}
            />
          ))}
        </ul>
      )}

      {/* Compose sheet */}
      {showCompose && (
        <ComposeSheet
          defaultType={activeType}
          accentColor={accent}
          cardColor={card}
          overlayColor={overlay}
          inputBackgroundColor={inputBackground}
          buttonTextColor={buttonText}
          selectedControlBackgroundColor={selectedControlBackground}
          border={border}
          primaryText={primaryText}
          secondaryText={secondaryText}
          isCompact={isCompact}
          strings={strings}
          onClose={() => setShowCompose(false)}
          onSubmitted={() => { setShowCompose(false); reload(); }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FilterChip({
  label,
  active,
  onClick,
  accentColor,
  borderColor,
  inactiveTextColor,
  activeTextColor,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  accentColor: string;
  borderColor: string;
  inactiveTextColor: string;
  activeTextColor: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        border: `1px solid ${active ? accentColor : borderColor}`,
        borderRadius: 20,
        backgroundColor: active ? accentColor : "transparent",
        color: active ? activeTextColor : inactiveTextColor,
        cursor: "pointer",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

function BoardItemRow({
  item,
  cardColor,
  primaryText,
  secondaryText,
  border,
  accentColor,
  selectedControlBackgroundColor,
  onVote,
}: {
  item: FeedbackBoardItem;
  cardColor: string;
  primaryText: string;
  secondaryText: string;
  border: string;
  accentColor: string;
  selectedControlBackgroundColor: string;
  onVote: () => void;
}) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "14px 16px",
        marginBottom: 8,
        backgroundColor: cardColor,
        borderRadius: 12,
        border: `1px solid ${border}`,
        boxSizing: "border-box",
      }}
    >
      {/* Vote */}
      <button
        onClick={onVote}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          border: `1px solid ${item.hasVoted ? accentColor : border}`,
          borderRadius: 8,
          padding: "6px 10px",
          backgroundColor: item.hasVoted ? selectedControlBackgroundColor : "transparent",
          cursor: "pointer",
          flexShrink: 0,
          color: item.hasVoted ? accentColor : secondaryText,
        }}
      >
        <span style={{ fontSize: 12 }}>▲</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{item.voteCount}</span>
      </button>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <TypeBadge type={item.type} />
          {item.isPinned && <span style={{ fontSize: 11, color: secondaryText }}>📌</span>}
        </div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: primaryText }}>{item.title}</p>
        {item.body && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: secondaryText,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {item.body}
          </p>
        )}
      </div>
    </li>
  );
}

const TYPE_COLORS: Record<FeedbackType, string> = {
  idea: "#8B5CF6",
  bug: "#EF4444",
  feedback: "#3B82F6",
  question: "#F59E0B",
};

function TypeBadge({ type }: { type: FeedbackType }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: TYPE_COLORS[type],
        backgroundColor: `${TYPE_COLORS[type]}18`,
        borderRadius: 4,
        padding: "2px 6px",
        textTransform: "capitalize",
      }}
    >
      {type}
    </span>
  );
}

function ComposeSheet({
  defaultType,
  accentColor,
  cardColor,
  overlayColor,
  inputBackgroundColor,
  buttonTextColor,
  selectedControlBackgroundColor,
  border,
  primaryText,
  secondaryText,
  isCompact,
  strings,
  onClose,
  onSubmitted,
}: {
  defaultType?: FeedbackType;
  accentColor: string;
  cardColor: string;
  overlayColor: string;
  inputBackgroundColor: string;
  buttonTextColor: string;
  selectedControlBackgroundColor: string;
  border: string;
  primaryText: string;
  secondaryText: string;
  isCompact: boolean;
  strings: GrowthCatFeedbackStrings | undefined;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [type, setType] = useState<FeedbackType>(defaultType ?? "feedback");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const { isSubmitting, result, error, submit } = useFeedbackSubmit();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const r = await submit({ type, title: title.trim(), body: body.trim() || undefined });
    if (r) onSubmitted();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        backgroundColor: overlayColor,
        display: "flex",
        alignItems: isCompact ? "flex-end" : "center",
        justifyContent: "center",
        padding: isCompact ? "16px 0 0" : 24,
        boxSizing: "border-box",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: cardColor,
          borderRadius: isCompact ? "20px 20px 0 0" : 20,
          width: "100%",
          maxWidth: 640,
          maxHeight: isCompact ? "calc(100dvh - 24px)" : "min(760px, calc(100dvh - 48px))",
          overflowY: "auto",
          padding: 24,
          boxSizing: "border-box",
          boxShadow: isCompact ? "none" : "0 24px 80px rgba(0,0,0,0.22)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: primaryText }}>
            {strings?.title ?? "Send Feedback"}
          </h3>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: secondaryText }}
          >
            ×
          </button>
        </div>

        {result ? (
          <p style={{ textAlign: "center", fontSize: 15, fontWeight: 600, color: "#10B981" }}>
            {strings?.successTitle ?? "Thanks for your feedback!"}
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* Type selector */}
            <label style={{ fontSize: 13, fontWeight: 600, color: secondaryText, display: "block", marginBottom: 6 }}>
              {strings?.typeLabel ?? "Category"}
            </label>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  style={{
                    flex: 1,
                    padding: "8px 4px",
                    fontSize: 12,
                    fontWeight: type === t ? 700 : 400,
                    border: `1px solid ${type === t ? accentColor : border}`,
                    borderRadius: 8,
                    backgroundColor: type === t ? selectedControlBackgroundColor : "transparent",
                    color: type === t ? accentColor : primaryText,
                    cursor: "pointer",
                  }}
                >
                  {strings?.typeLabels?.[t] ?? t}
                </button>
              ))}
            </div>

            {/* Title */}
            <label style={{ fontSize: 13, fontWeight: 600, color: secondaryText, display: "block", marginBottom: 6 }}>
              {strings?.titleLabel ?? "Summary"}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={strings?.titlePlaceholder ?? "What should we add?"}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 14,
                border: `1px solid ${border}`,
                borderRadius: 8,
                marginBottom: 16,
                boxSizing: "border-box",
                backgroundColor: inputBackgroundColor,
                color: primaryText,
              }}
            />

            {/* Body */}
            <label style={{ fontSize: 13, fontWeight: 600, color: secondaryText, display: "block", marginBottom: 6 }}>
              {strings?.detailsLabel ?? "Details"}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={strings?.detailsPlaceholder ?? "Tell us more…"}
              rows={4}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 14,
                border: `1px solid ${border}`,
                borderRadius: 8,
                marginBottom: 16,
                boxSizing: "border-box",
                resize: "vertical",
                backgroundColor: inputBackgroundColor,
                color: primaryText,
                fontFamily: "inherit",
              }}
            />

            {error && (
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#EF4444" }}>{error.message}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              style={{
                width: "100%",
                padding: "12px",
                fontSize: 15,
                fontWeight: 700,
                color: buttonTextColor,
                backgroundColor: accentColor,
                border: "none",
                borderRadius: 10,
                cursor: isSubmitting || !title.trim() ? "not-allowed" : "pointer",
                opacity: isSubmitting || !title.trim() ? 0.6 : 1,
              }}
            >
              {isSubmitting ? (strings?.submitting ?? "Submitting…") : (strings?.submit ?? "Submit")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function usePrefersDarkMode(): boolean {
  return useMediaQuery("(prefers-color-scheme: dark)");
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener?.("change", handleChange);
    return () => mediaQuery.removeEventListener?.("change", handleChange);
  }, [query]);

  return matches;
}

function resolveFeedbackTheme(
  theme: GrowthCatFeedbackTheme | undefined,
  prefersDark: boolean,
): GrowthCatFeedbackThemeColors {
  const mode = theme?.mode ?? "system";
  const useDark = mode === "dark" || (mode === "system" && prefersDark);

  if (useDark) {
    return {
      ...DEFAULT_FEEDBACK_DARK_THEME,
      ...theme?.dark,
      accentColor: theme?.dark?.accentColor ?? theme?.accentColor ?? DEFAULT_FEEDBACK_DARK_THEME.accentColor,
    };
  }

  return {
    ...DEFAULT_FEEDBACK_LIGHT_THEME,
    ...theme,
  };
}
