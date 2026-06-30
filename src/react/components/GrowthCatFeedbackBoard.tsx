import React, { useState } from "react";
import { useFeedbackBoard, useFeedbackSubmit } from "../hooks/useFeedback";
import { FeedbackBoardItem, FeedbackType, GrowthCatFeedbackStrings } from "../../models/feedback";
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

  const { items, isLoading, error, reload, vote, unvote } = useFeedbackBoard({
    type: activeType,
    autoLoad: true,
  });

  const accent = theme?.accentColor ?? "#3B82F6";
  const bg = theme?.backgroundColor ?? "#F9FAFB";
  const card = theme?.cardColor ?? "#FFFFFF";
  const primaryText = theme?.primaryTextColor ?? "#111827";
  const secondaryText = theme?.secondaryTextColor ?? "#6B7280";
  const border = theme?.borderColor ?? "#E5E7EB";

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
        />
        {TYPES.map((t) => (
          <FilterChip
            key={t}
            label={strings?.typeLabels?.[t] ?? t}
            active={activeType === t}
            onClick={() => setActiveType(activeType === t ? undefined : t)}
            accentColor={accent}
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
          border={border}
          primaryText={primaryText}
          secondaryText={secondaryText}
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
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  accentColor: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        border: `1px solid ${active ? accentColor : "#D1D5DB"}`,
        borderRadius: 20,
        backgroundColor: active ? accentColor : "transparent",
        color: active ? "#fff" : "#374151",
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
  onVote,
}: {
  item: FeedbackBoardItem;
  cardColor: string;
  primaryText: string;
  secondaryText: string;
  border: string;
  accentColor: string;
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
          backgroundColor: item.hasVoted ? `${accentColor}18` : "transparent",
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
  border,
  primaryText,
  secondaryText,
  strings,
  onClose,
  onSubmitted,
}: {
  defaultType?: FeedbackType;
  accentColor: string;
  border: string;
  primaryText: string;
  secondaryText: string;
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
        backgroundColor: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#fff",
          borderRadius: "20px 20px 0 0",
          width: "100%",
          maxWidth: 640,
          padding: 24,
          boxSizing: "border-box",
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
                    backgroundColor: type === t ? `${accentColor}18` : "transparent",
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
                color: "#fff",
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
