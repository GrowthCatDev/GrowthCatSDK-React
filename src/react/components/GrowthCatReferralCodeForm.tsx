import React, { useId, useState } from "react";
import { useReferralCode } from "../hooks/useReferralCode";
import type { UseReferralCodeOptions } from "../hooks/useReferralCode";
import type { GrowthCatReferralFormStrings, GrowthCatReferralFormTheme } from "./GrowthCatReferralForm";

export interface GrowthCatReferralCodeFormProps extends UseReferralCodeOptions {
  strings?: GrowthCatReferralFormStrings; theme?: GrowthCatReferralFormTheme; className?: string; style?: React.CSSProperties;
}
/** Unified code entry; success means acceptance, never a local subscription grant. */
export function GrowthCatReferralCodeForm(props: GrowthCatReferralCodeFormProps) {
  const id = useId(), [code, setCode] = useState("");
  const { result, error, isLoading, applyCode, canEnterFriendCode } = useReferralCode(props);
  const mode = props.mode === "influencers" || !canEnterFriendCode ? "influencers" : props.mode ?? "both";
  if (props.mode === "friends" && !canEnterFriendCode) return null;
  const s = { title: "Have a referral code?", description: mode === "friends" ? "Enter a code from a friend." :
    mode === "influencers" ? "Enter an influencer code." : "Enter a code from an influencer or a friend.",
    placeholder: "Referral code", buttonText: "Apply code", buttonLoadingText: "Checking…", successMessage: "Code accepted.", ...props.strings };
  const accent = props.theme?.accentColor ?? "#2563eb";
  return <section className={props.className} style={{ padding: 20, border: `1px solid ${props.theme?.borderColor ?? "#d1d5db"}`,
    borderRadius: props.theme?.borderRadius ?? 12, color: props.theme?.textColor, background: props.theme?.backgroundColor, ...props.style }}>
    <h3>{s.title}</h3><p>{s.description}</p>
    {result ? <p role="status">{s.successMessage}</p> : <form onSubmit={event => { event.preventDefault(); if (code.trim()) void applyCode(code); }}>
      <label htmlFor={id}>{s.placeholder}</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input id={id} value={code} maxLength={2048} autoCapitalize="characters"
        autoComplete="off" aria-invalid={!!error} disabled={isLoading} onChange={event => setCode(event.target.value)} style={{ padding: 10, flex: 1, minWidth: 120 }} />
      <button type="submit" disabled={isLoading || !code.trim()} style={{ padding: 10, background: accent, color: "white", borderRadius: 8 }}>
        {isLoading ? s.buttonLoadingText : s.buttonText}</button></div>
    </form>}
    {error && <p role="alert">{error.message}</p>}
  </section>;
}
