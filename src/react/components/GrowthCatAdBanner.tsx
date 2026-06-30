import React, { useRef, useEffect, useCallback } from "react";
import { useAd, UseAdOptions } from "../hooks/useAd";
import { AdObject } from "../../models/ads";

export interface GrowthCatAdBannerProps
  extends Pick<UseAdOptions, "placementKey" | "format" | "appUserId" | "sessionId"> {
  /** Minimum height in pixels. Default 60. */
  minHeight?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Called after the ad CTA is tapped (the SDK opens the destination automatically). */
  onTap?: () => void;
  /** Render nothing when there is no fill. Default: true (renders nothing). */
  hideOnNoFill?: boolean;
}

/**
 * A ready-to-use banner ad component. Renders a horizontal strip with the ad
 * headline, body, optional image, and a CTA button.
 *
 * For a fully custom renderer, use `useAd()` instead — it gives you the raw
 * `AdObject` so you can design the banner yourself.
 */
export function GrowthCatAdBanner({
  placementKey,
  format = "banner",
  appUserId,
  sessionId,
  minHeight = 60,
  className,
  style,
  onTap,
  hideOnNoFill = true,
}: GrowthCatAdBannerProps) {
  const { ad, state, trackEvent } = useAd({
    placementKey,
    format,
    appUserId,
    sessionId,
    trackImpression: true,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const impressionSent = useRef(false);

  // Intersection Observer for 50% visibility impression.
  useEffect(() => {
    if (!ad || impressionSent.current || !containerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.intersectionRatio >= 0.5 && !impressionSent.current) {
          impressionSent.current = true;
          trackEvent("impression");
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [ad, trackEvent]);

  const handleTap = useCallback(() => {
    if (!ad) return;
    trackEvent("click");
    if (ad.creative.destinationUrl) {
      window.open(ad.creative.destinationUrl, "_blank", "noopener,noreferrer");
    }
    onTap?.();
  }, [ad, trackEvent, onTap]);

  if (state === "loading") {
    return (
      <div
        style={{ minHeight, backgroundColor: "transparent", ...style }}
        className={className}
      />
    );
  }

  if (!ad) {
    if (hideOnNoFill) return null;
    return <div style={{ minHeight, ...style }} className={className} />;
  }

  return (
    <BannerLayout
      ad={ad}
      minHeight={minHeight}
      className={className}
      style={style}
      containerRef={containerRef}
      onTap={handleTap}
    />
  );
}

// ─── Default banner layout ────────────────────────────────────────────────────

interface BannerLayoutProps {
  ad: AdObject;
  minHeight: number;
  className?: string;
  style?: React.CSSProperties;
  containerRef: React.RefObject<HTMLDivElement>;
  onTap: () => void;
}

function BannerLayout({ ad, minHeight, className, style, containerRef, onTap }: BannerLayoutProps) {
  const { creative } = ad;
  const layout = creative.layout?.banner;

  const bgColor = layout?.backgroundColor ?? "#F5F5F5";
  const borderRadius = layout?.borderRadius ?? 12;
  const paddingH = layout?.padding?.horizontal ?? 14;
  const paddingV = layout?.padding?.vertical ?? 10;
  const gap = layout?.gap ?? 10;

  const badgeText = layout?.adBadge?.text ?? "Ad";
  const badgeBg = layout?.adBadge?.backgroundColor ?? "#E5E7EB";
  const badgeTextColor = layout?.adBadge?.textColor ?? "#6B7280";

  const ctaBg = layout?.ctaButton?.bgColor ?? "#3B82F6";
  const ctaTextColor = layout?.ctaButton?.textColor ?? "#FFFFFF";
  const ctaBorderRadius = layout?.ctaButton?.borderRadius ?? 8;

  const titleColor = layout?.title?.color ?? "#111827";
  const titleWeight = layout?.title?.fontWeight ?? "600";

  return (
    <div
      ref={containerRef}
      className={className}
      onClick={onTap}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onTap()}
      style={{
        display: "flex",
        alignItems: "center",
        gap,
        minHeight,
        backgroundColor: bgColor,
        borderRadius,
        paddingLeft: paddingH,
        paddingRight: paddingH,
        paddingTop: paddingV,
        paddingBottom: paddingV,
        cursor: "pointer",
        userSelect: "none",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {/* Sponsored badge */}
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: badgeTextColor,
          backgroundColor: badgeBg,
          borderRadius: layout?.adBadge?.borderRadius ?? 4,
          padding: "2px 5px",
          flexShrink: 0,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {badgeText}
      </span>

      {/* Asset thumbnail */}
      {creative.publicAssetUrl && creative.creativeType === "image" && (
        <img
          src={creative.publicAssetUrl}
          alt=""
          style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
        />
      )}

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {creative.headline && (
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: titleWeight as React.CSSProperties["fontWeight"],
              color: titleColor,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {creative.headline}
          </p>
        )}
        {creative.body && (
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12,
              color: "#6B7280",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {creative.body}
          </p>
        )}
      </div>

      {/* CTA */}
      {creative.ctaText && (
        <button
          style={{
            flexShrink: 0,
            fontSize: 12,
            fontWeight: 600,
            color: ctaTextColor,
            backgroundColor: ctaBg,
            border: "none",
            borderRadius: ctaBorderRadius,
            padding: "6px 12px",
            cursor: "pointer",
            pointerEvents: "none", // parent handles click
          }}
        >
          {creative.ctaText}
        </button>
      )}
    </div>
  );
}
