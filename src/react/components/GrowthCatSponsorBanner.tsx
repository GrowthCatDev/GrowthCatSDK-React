import { useViewableImpression } from "../hooks/useViewableImpression";
import React, { useCallback, useRef } from "react";
import { useSponsor } from "../hooks/useSponsor";

export interface GrowthCatSponsorBannerProps {
  slotKey: string;
  sessionId?: string;
  minHeight?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Render the bookable-slot placeholder returned by GrowthCat. Default true. */
  showAvailability?: boolean;
  onTap?: () => void;
}

/** Built-in sponsor banner with qualified impression and click tracking. */
export function GrowthCatSponsorBanner({
  slotKey,
  sessionId,
  minHeight = 72,
  className,
  style,
  showAvailability = true,
  onTap,
}: GrowthCatSponsorBannerProps) {
  const { sponsor, state, trackImpression, trackClick } = useSponsor({ slotKey, sessionId });
  const containerRef = useRef<HTMLAnchorElement>(null);
  useViewableImpression(containerRef, sponsor, (fraction, duration) => {
    void trackImpression(fraction, duration);
  });

  const handleTap = useCallback((track = false, creative?: import("../../models/sponsor").SponsorCreative) => {
    if (track) void trackClick(creative);
    onTap?.();
  }, [onTap, trackClick]);

  if (state === "loading") {
    return <div className={className} style={{ minHeight, ...style }} />;
  }
  if (!sponsor || sponsor.status === "empty") return null;

  if (sponsor.status === "available") {
    if (!showAvailability || !sponsor.bookingUrl) return null;
    return (
      <a
        className={className}
        href={sponsor.bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => handleTap(false)}
        style={bannerStyle(minHeight, style)}
      >
        <span style={badgeStyle}>Sponsor this site</span>
        <div style={{ flex: 1 }}>
          <strong>Reach this audience</strong>
          {sponsor.priceUsd != null && <div style={{ color: "#6B7280", fontSize: 13 }}>From ${sponsor.priceUsd}</div>}
        </div>
        <span style={ctaStyle}>Book</span>
      </a>
    );
  }

  const creative = sponsor.creative;
  if (sponsor.deliveryMode === "all" && sponsor.creatives?.length) {
    return (
      <div className={className} style={multiStyle(minHeight, style)} aria-label="Sponsors">
        <span style={{ ...badgeStyle, gridColumn: "1 / -1" }}>Sponsored</span>
        {sponsor.creatives.map((item) => (
          <SponsorTile key={item.bookingId ?? item.sponsorName} item={item}
            onImpression={(fraction, duration) => { void trackImpression(fraction, duration, item); }}
            onClick={() => handleTap(true, item)} />
        ))}
      </div>
    );
  }
  if (!creative) return null;
  return (
    <a
      ref={containerRef}
      className={className}
      href={creative.clickUrl}
      target={creative.clickUrl ? "_blank" : undefined}
      rel={creative.clickUrl ? "noopener noreferrer" : undefined}
      onClick={() => handleTap(true)}
      aria-label={creative.headline ?? creative.sponsorName ?? "Sponsored content"}
      style={bannerStyle(minHeight, style)}
    >
      <span style={badgeStyle}>Sponsored</span>
      {creative.logoUrl && <img src={creative.logoUrl} alt="" style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 8 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{creative.headline ?? creative.sponsorName ?? "Sponsor"}</strong>
        {creative.body && <div style={{ color: "#6B7280", fontSize: 13 }}>{creative.body}</div>}
      </div>
      {creative.ctaText && <span style={ctaStyle}>{creative.ctaText}</span>}
    </a>
  );
}

function multiStyle(minHeight: number, overrides?: React.CSSProperties): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: 8,
    minHeight,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#F5F5F5",
    boxSizing: "border-box",
    ...overrides,
  };
}

const sponsorTileStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  padding: 8,
  borderRadius: 10,
  color: "#111827",
  backgroundColor: "#FFFFFF",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 600,
};

function bannerStyle(minHeight: number, overrides?: React.CSSProperties): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 12, minHeight, padding: "10px 14px",
    borderRadius: 12, backgroundColor: "#F5F5F5", color: "#111827", cursor: "pointer",
    boxSizing: "border-box", userSelect: "none", textDecoration: "none", ...overrides,
  };
}

const badgeStyle: React.CSSProperties = {
  flexShrink: 0, fontSize: 10, fontWeight: 700, color: "#6B7280", textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const ctaStyle: React.CSSProperties = {
  flexShrink: 0, padding: "7px 12px", borderRadius: 8, backgroundColor: "#111827",
  color: "#FFFFFF", fontSize: 12, fontWeight: 700,
};

function SponsorTile({ item, onImpression, onClick }: {
  item: import("../../models/sponsor").SponsorCreative;
  onImpression: (fraction: number, duration: number) => void;
  onClick: () => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useViewableImpression(ref, item, onImpression);
  return <a ref={ref} href={item.clickUrl} target="_blank" rel="noopener noreferrer" onClick={onClick}
    aria-label={item.headline ?? item.sponsorName ?? "Sponsored content"} style={sponsorTileStyle}>
    {item.logoUrl && <img src={item.logoUrl} alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />}
    <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{item.sponsorName ?? item.headline ?? "Sponsor"}</span>
  </a>;
}
