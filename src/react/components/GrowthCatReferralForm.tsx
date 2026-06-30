import React, { useState } from "react";
import { useReferral } from "../hooks/useReferral";
import { GrowthCatAnalyticsContext, ReferralRedemptionResult } from "../../models/referral";

export interface GrowthCatReferralFormStrings {
  title?: string;
  description?: string;
  placeholder?: string;
  buttonText?: string;
  buttonLoadingText?: string;
  successMessage?: string;
}

const DEFAULT_STRINGS: Required<GrowthCatReferralFormStrings> = {
  title: "Have a Promo Code?",
  description: "Enter your code to unlock your special offer.",
  placeholder: "Enter code here",
  buttonText: "Apply Discount",
  buttonLoadingText: "Verifying…",
  successMessage: "Code applied!",
};

export interface GrowthCatReferralFormTheme {
  accentColor?: string;
  textColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderRadius?: number;
}

const DEFAULT_THEME: Required<GrowthCatReferralFormTheme> = {
  accentColor: "#3B82F6",
  textColor: "#111827",
  backgroundColor: "#FFFFFF",
  borderColor: "#E5E7EB",
  borderRadius: 12,
};

export interface GrowthCatReferralFormProps {
  strings?: GrowthCatReferralFormStrings;
  theme?: GrowthCatReferralFormTheme;
  context?: GrowthCatAnalyticsContext;
  /** Called when the code is successfully validated. */
  onSuccess?: (result: ReferralRedemptionResult) => void;
  /** Called when validation fails. */
  onError?: (error: Error) => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * A ready-to-use referral code redemption form.
 *
 * For a custom form, use the `useReferral()` hook instead and build your own UI.
 *
 * @example
 * <GrowthCatReferralForm
 *   onSuccess={(result) => console.log("Applied:", result.normalizedCode)}
 *   theme={{ accentColor: "#FF6B00" }}
 * />
 */
export function GrowthCatReferralForm({
  strings: customStrings,
  theme: customTheme,
  context,
  onSuccess,
  onError,
  className,
  style,
}: GrowthCatReferralFormProps) {
  const s = { ...DEFAULT_STRINGS, ...customStrings };
  const t = { ...DEFAULT_THEME, ...customTheme };

  const [code, setCode] = useState("");
  const { isLoading, result, error, validateCode } = useReferral({
    context,
    onSuccess,
    onError,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim()) void validateCode(code);
  };

  return (
    <div
      className={className}
      style={{
        backgroundColor: t.backgroundColor,
        border: `1px solid ${t.borderColor}`,
        borderRadius: t.borderRadius,
        padding: "24px",
        maxWidth: 480,
        boxSizing: "border-box",
        ...style,
      }}
    >
      {s.title && (
        <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: t.textColor }}>
          {s.title}
        </h3>
      )}
      {s.description && (
        <p style={{ margin: "0 0 18px", fontSize: 14, color: "#6B7280" }}>{s.description}</p>
      )}

      {result ? (
        <p
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            color: "#10B981",
            textAlign: "center",
          }}
        >
          {s.successMessage} ({result.normalizedCode})
        </p>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={s.placeholder}
            disabled={isLoading}
            style={{
              flex: 1,
              padding: "10px 14px",
              fontSize: 15,
              border: `1px solid ${error ? "#EF4444" : t.borderColor}`,
              borderRadius: 8,
              outline: "none",
              color: t.textColor,
              boxSizing: "border-box",
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !code.trim()}
            style={{
              padding: "10px 20px",
              fontSize: 15,
              fontWeight: 600,
              color: "#FFFFFF",
              backgroundColor: t.accentColor,
              border: "none",
              borderRadius: 8,
              cursor: isLoading || !code.trim() ? "not-allowed" : "pointer",
              opacity: isLoading || !code.trim() ? 0.6 : 1,
              flexShrink: 0,
            }}
          >
            {isLoading ? s.buttonLoadingText : s.buttonText}
          </button>
        </form>
      )}

      {error && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "#EF4444" }}>{error.message}</p>
      )}
    </div>
  );
}
