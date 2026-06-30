import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAd, UseAdOptions } from "../hooks/useAd";
import { AdObject, AdRewardValidationResponse } from "../../models/ads";
import { GrowthCat } from "../../growthcat";

export interface GrowthCatAdInterstitialProps
  extends Pick<UseAdOptions, "placementKey" | "format" | "appUserId" | "sessionId"> {
  /** Controls whether the interstitial is visible. */
  isOpen: boolean;
  /** Called when the user closes the ad. Set `isOpen` to false here. */
  onDismiss: () => void;
  /** Called when a rewarded ad's reward is validated server-side. */
  onReward?: (response: AdRewardValidationResponse) => void;
}

/**
 * Full-screen interstitial ad modal. Handles image/video creatives and rewarded
 * formats. The ad is loaded lazily when `isOpen` first becomes true.
 *
 * For a fully custom interstitial, load the ad via `useAd()` and build your own
 * overlay using the raw `AdObject`.
 */
export function GrowthCatAdInterstitial({
  placementKey,
  format = "interstitial",
  appUserId,
  sessionId,
  isOpen,
  onDismiss,
  onReward,
}: GrowthCatAdInterstitialProps) {
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (isOpen && !hasOpened) setHasOpened(true);
  }, [isOpen, hasOpened]);

  const { ad, trackEvent } = useAd({
    placementKey,
    format,
    appUserId,
    sessionId,
    trackImpression: false, // We fire impression manually when the modal mounts.
  });

  useEffect(() => {
    if (isOpen && ad) {
      trackEvent("impression");
    }
  }, [isOpen, ad, trackEvent]);

  const handleDismiss = useCallback(() => {
    if (ad) trackEvent("ad_closed");
    onDismiss();
  }, [ad, trackEvent, onDismiss]);

  const handleCTATap = useCallback(() => {
    if (!ad) return;
    trackEvent("click");
    if (ad.creative.destinationUrl) {
      window.open(ad.creative.destinationUrl, "_blank", "noopener,noreferrer");
    }
  }, [ad, trackEvent]);

  if (!isOpen || !hasOpened || !ad) return null;

  return (
    <InterstitialModal
      ad={ad}
      appUserId={appUserId}
      sessionId={sessionId}
      onDismiss={handleDismiss}
      onCtaTap={handleCTATap}
      onReward={onReward}
    />
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface InterstitialModalProps {
  ad: AdObject;
  appUserId?: string;
  sessionId?: string;
  onDismiss: () => void;
  onCtaTap: () => void;
  onReward?: (r: AdRewardValidationResponse) => void;
}

function InterstitialModal({ ad, appUserId, sessionId, onDismiss, onCtaTap, onReward }: InterstitialModalProps) {
  const { creative, closePolicy, placement } = ad;
  const overlay = creative.layout?.overlay;

  const isSkippable = closePolicy?.isSkippable ?? placement?.isSkippable ?? true;
  const skippableAfter = closePolicy?.skippableAfterSeconds ?? placement?.skippableAfterSeconds ?? 3;
  const rewardAfter = closePolicy?.rewardGrantAfterSeconds ?? placement?.minimumViewSeconds ?? 0;
  const isRewarded = placement?.rewardEnabled ?? false;

  const [secondsViewed, setSecondsViewed] = useState(0);
  const [canClose, setCanClose] = useState(!isSkippable ? false : skippableAfter === 0);
  const [rewardValidated, setRewardValidated] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setSecondsViewed((s) => {
        const next = s + 1;
        if (next >= skippableAfter) setCanClose(true);
        return next;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [skippableAfter]);

  const handleDismiss = useCallback(async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (isRewarded && appUserId && !rewardValidated) {
      try {
        const response = await GrowthCat.shared.validateAdReward(ad, appUserId, {
          sessionId,
          viewedSeconds: secondsViewed,
          completed: secondsViewed >= rewardAfter,
        });
        if (response.rewardValidated) {
          setRewardValidated(true);
          onReward?.(response);
        }
      } catch {
        // Network error — reward not granted
      }
    }

    onDismiss();
  }, [ad, appUserId, isRewarded, onDismiss, onReward, rewardAfter, rewardValidated, secondsViewed, sessionId]);

  const bgColor = overlay?.panelBgColor ?? "rgba(0,0,0,0.95)";
  const textColor = overlay?.textColor ?? "#FFFFFF";
  const ctaBg = creative.layout?.ctaButton?.bgColor ?? "#3B82F6";
  const ctaTextColor = creative.layout?.ctaButton?.textColor ?? "#FFFFFF";
  const ctaBorderRadius = creative.layout?.ctaButton?.borderRadius ?? 12;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bgColor,
      }}
      role="dialog"
      aria-modal="true"
    >
      {/* Close button */}
      <button
        onClick={handleDismiss}
        disabled={!canClose}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "none",
          backgroundColor: "rgba(255,255,255,0.2)",
          color: "#fff",
          fontSize: 20,
          lineHeight: 1,
          cursor: canClose ? "pointer" : "default",
          opacity: canClose ? 1 : 0.4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {canClose ? "×" : skippableAfter - secondsViewed}
      </button>

      {/* Sponsored badge */}
      <span
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          fontSize: 10,
          fontWeight: 700,
          color: "rgba(255,255,255,0.6)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        Sponsored
      </span>

      {/* Asset */}
      {creative.publicAssetUrl && creative.creativeType === "image" && (
        <img
          src={creative.publicAssetUrl}
          alt=""
          style={{
            maxWidth: "90%",
            maxHeight: "60vh",
            objectFit: overlay?.imageFit === "cover" ? "cover" : "contain",
            borderRadius: 16,
          }}
        />
      )}

      {creative.publicAssetUrl && creative.creativeType === "video" && (
        <video
          src={creative.publicAssetUrl}
          autoPlay
          muted
          playsInline
          style={{ maxWidth: "90%", maxHeight: "60vh", borderRadius: 16 }}
        />
      )}

      {/* Content */}
      <div
        style={{
          textAlign: "center",
          padding: "24px 32px 32px",
          maxWidth: 480,
          color: textColor,
        }}
      >
        {creative.headline && (
          <h2
            style={{
              margin: "0 0 8px",
              fontSize: 22,
              fontWeight: 700,
              color: overlay?.title?.color ?? textColor,
            }}
          >
            {creative.headline}
          </h2>
        )}
        {creative.body && (
          <p style={{ margin: "0 0 24px", fontSize: 15, opacity: 0.8 }}>
            {creative.body}
          </p>
        )}
        {creative.ctaText && (
          <button
            onClick={onCtaTap}
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: ctaTextColor,
              backgroundColor: ctaBg,
              border: "none",
              borderRadius: ctaBorderRadius,
              padding: "14px 32px",
              cursor: "pointer",
              width: "100%",
            }}
          >
            {creative.ctaText}
          </button>
        )}
      </div>
    </div>
  );
}
