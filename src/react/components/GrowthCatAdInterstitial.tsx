import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAd, UseAdOptions } from "../hooks/useAd";
import {
  AdEventMetadata,
  AdEventName,
  AdObject,
  AdRewardValidationResponse,
} from "../../models/ads";
import { GrowthCat } from "../../growthcat";
import { createPortal } from "react-dom";
import { GrowthCatError } from "../../models/errors";

export interface GrowthCatAdInterstitialProps
  extends Pick<
    UseAdOptions,
    "placementKey" | "format" | "appUserId" | "sessionId" | "onLoad" | "onNoFill" | "onError"
  > {
  /** Controls whether the interstitial is visible. */
  isOpen: boolean;
  /** Called when the user closes the ad. Set `isOpen` to false here. */
  onDismiss: () => void;
  /** Called when a rewarded ad's reward is validated server-side. */
  onReward?: (response: AdRewardValidationResponse) => void;
  /** Called when server-side reward validation fails. */
  onRewardError?: (error: GrowthCatError) => void;
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
  onRewardError,
  onLoad,
  onNoFill,
  onError,
}: GrowthCatAdInterstitialProps) {
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (isOpen && !hasOpened) setHasOpened(true);
  }, [isOpen, hasOpened]);

  const { ad, state, error, trackEvent, reload } = useAd({
    placementKey,
    format,
    appUserId,
    sessionId,
    enabled: hasOpened,
    trackImpression: false, // We fire impression manually when the modal mounts.
    onLoad,
    onNoFill,
    onError,
  });
  const impressionSent = useRef(false);
  const openCountRef = useRef(0);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!isOpen || !hasOpened) return;
    if (openCountRef.current > 0) void reloadRef.current();
    openCountRef.current += 1;
  }, [hasOpened, isOpen]);

  useEffect(() => {
    if (!isOpen || !ad || impressionSent.current) return;
    const durationMs = ad.creative.creativeType === "video" ? 2000 : 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      if (timer != null || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        timer = null;
        if (document.visibilityState !== "visible" || impressionSent.current) return;
        impressionSent.current = true;
        trackEvent("impression", { visible_fraction: 1, visible_duration_ms: durationMs });
      }, durationMs);
    };
    const stop = () => {
      if (timer != null) clearTimeout(timer);
      timer = null;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isOpen, ad, trackEvent]);

  useEffect(() => {
    if (!isOpen) impressionSent.current = false;
  }, [isOpen]);

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

  if (!isOpen || !hasOpened) return null;
  if (!ad) {
    return (
      <InterstitialStatus
        state={state}
        message={error?.message}
        onDismiss={onDismiss}
      />
    );
  }

  return (
    <InterstitialModal
      ad={ad}
      appUserId={appUserId}
      sessionId={sessionId}
      onDismiss={handleDismiss}
      onCtaTap={handleCTATap}
      onReward={onReward}
      onRewardError={onRewardError}
      trackEvent={trackEvent}
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
  onRewardError?: (error: GrowthCatError) => void;
  trackEvent: (
    eventName: AdEventName,
    metadata?: Partial<AdEventMetadata>
  ) => void;
}

function InterstitialModal({
  ad,
  appUserId,
  sessionId,
  onDismiss,
  onCtaTap,
  onReward,
  onRewardError,
  trackEvent,
}: InterstitialModalProps) {
  const { creative, closePolicy, placement } = ad;
  const overlay = creative.layout?.overlay;

  const isSkippable = closePolicy?.isSkippable ?? placement?.isSkippable ?? true;
  const skippableAfter = closePolicy?.skippableAfterSeconds ?? placement?.skippableAfterSeconds ?? 3;
  const rewardAfter = closePolicy?.rewardGrantAfterSeconds ?? placement?.minimumViewSeconds ?? 0;
  const isRewarded = placement?.rewardEnabled ?? false;
  const isVideo = creative.creativeType === "video";
  const requiredViewSeconds = Math.max(
    0,
    isSkippable ? skippableAfter : Math.max(rewardAfter, skippableAfter)
  );

  const [secondsViewed, setSecondsViewed] = useState(0);
  const [canClose, setCanClose] = useState(
    requiredViewSeconds === 0 && (isSkippable || !isVideo)
  );
  const [mediaCompleted, setMediaCompleted] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const videoStartedRef = useRef(false);
  const videoQuartilesRef = useRef(new Set<number>());
  const rewardValidationStartedRef = useRef(false);

  useEffect(() => {
    const startTimer = () => {
      if (intervalRef.current != null || document.visibilityState !== "visible") return;
      intervalRef.current = setInterval(() => {
      setSecondsViewed((s) => {
        const next = s + 1;
        if (
          (isSkippable && next >= skippableAfter) ||
          (!isSkippable && !isVideo && next >= requiredViewSeconds)
        ) {
          setCanClose(true);
        }
        return next;
      });
      }, 1000);
    };
    const stopTimer = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") startTimer();
      else stopTimer();
    };
    startTimer();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isSkippable, isVideo, requiredViewSeconds, skippableAfter]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], video[controls], [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (isRewarded && appUserId && !rewardValidationStartedRef.current) {
      rewardValidationStartedRef.current = true;
      void GrowthCat.shared.validateAdReward(ad, appUserId, {
          sessionId,
          viewedSeconds: secondsViewed,
          completed: isVideo ? mediaCompleted : secondsViewed >= rewardAfter,
        })
        .then((response) => {
        if (response.rewardValidated) {
          onReward?.(response);
        }
        })
        .catch((cause) => {
          onRewardError?.(
            cause instanceof GrowthCatError
              ? cause
              : GrowthCatError.unknown(cause instanceof Error ? cause.message : undefined)
          );
        });
    }

    onDismiss();
  }, [
    ad,
    appUserId,
    isRewarded,
    isVideo,
    mediaCompleted,
    onDismiss,
    onReward,
    onRewardError,
    rewardAfter,
    secondsViewed,
    sessionId,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canClose) void handleDismiss();
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = [...modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], video[controls], [tabindex]:not([tabindex="-1"])'
      )];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canClose, handleDismiss]);

  const handleVideoPlay = useCallback(() => {
    if (videoStartedRef.current) return;
    videoStartedRef.current = true;
    trackEvent("video_start", { player_position_ms: 0 });
  }, [trackEvent]);

  const handleVideoTimeUpdate = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const progress = (video.currentTime / video.duration) * 100;
    for (const quartile of [25, 50, 75] as const) {
      if (progress >= quartile && !videoQuartilesRef.current.has(quartile)) {
        videoQuartilesRef.current.add(quartile);
        trackEvent("video_progress", {
          quartile,
          player_position_ms: Math.round(video.currentTime * 1000),
        });
      }
    }
  }, [trackEvent]);

  const handleVideoEnded = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    setMediaCompleted(true);
    if (!isSkippable) setCanClose(true);
    trackEvent("video_complete", {
      quartile: 100,
      player_position_ms: Math.round(event.currentTarget.currentTime * 1000),
    });
  }, [isSkippable, trackEvent]);

  const handleVideoError = useCallback(() => {
    setMediaCompleted(false);
    setCanClose(true);
  }, []);

  const bgColor = overlay?.panelBgColor ?? "rgba(0,0,0,0.95)";
  const textColor = overlay?.textColor ?? "#FFFFFF";
  const ctaBg = creative.layout?.ctaButton?.bgColor ?? "#3B82F6";
  const ctaTextColor = creative.layout?.ctaButton?.textColor ?? "#FFFFFF";
  const ctaBorderRadius = creative.layout?.ctaButton?.borderRadius ?? 12;

  const modal = (
    <div
      ref={modalRef}
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
      aria-label={creative.headline ?? "Sponsored content"}
    >
      {/* Close button */}
      <button
        ref={closeButtonRef}
        onClick={handleDismiss}
        disabled={!canClose}
        aria-label={canClose ? "Close advertisement" : "Advertisement cannot be closed yet"}
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
        {canClose ? "×" : Math.max(0, requiredViewSeconds - secondsViewed) || "…"}
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
          onPlay={handleVideoPlay}
          onTimeUpdate={handleVideoTimeUpdate}
          onEnded={handleVideoEnded}
          onError={handleVideoError}
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
  return createPortal(modal, document.body);
}

function InterstitialStatus({
  state,
  message,
  onDismiss,
}: {
  state: "idle" | "loading" | "ready" | "no_fill" | "error";
  message?: string;
  onDismiss: () => void;
}) {
  const failed = state === "error" || state === "no_fill";
  const content = (
    <div
      role={state === "error" ? "alert" : "status"}
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "rgba(0,0,0,0.92)",
        color: "#FFFFFF",
        textAlign: "center",
      }}
    >
      <div>
        <p style={{ margin: 0 }}>
          {state === "error"
            ? (message ?? "Unable to load advertisement.")
            : state === "no_fill"
              ? "No advertisement is available."
              : "Loading advertisement…"}
        </p>
        {failed ? (
          <button
            type="button"
            onClick={onDismiss}
            style={{
              marginTop: 16,
              padding: "10px 18px",
              border: 0,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
  return createPortal(content, document.body);
}
