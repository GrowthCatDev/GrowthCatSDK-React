export type SponsorSlotStatus = "live" | "available" | "empty";
export type SponsorDeliveryMode = "rotate" | "all";

export interface SponsorCreative {
  bookingId?: string;
  sponsorName?: string;
  logoUrl?: string;
  headline?: string;
  body?: string;
  ctaText?: string;
  clickUrl?: string;
  customPayload?: Record<string, unknown>;
  periodStart?: string;
  periodEnd?: string;
  trackingToken?: string;
}

export interface SponsorPeriod {
  periodStart: string;
  periodEnd: string;
  occupied?: boolean;
  capacity?: number;
  bookedCount?: number;
  availableCount?: number;
}

/**
 * Content of a sponsor slot:
 * - `live` → render `creative`.
 * - `available` → the period is open; render a "Sponsor this app" placeholder using
 *   `priceUsd` / `bookingUrl` / `nextAvailablePeriods`.
 * - `empty` → open period, placeholder disabled by the owner; render nothing.
 */
export interface SponsorSlotContent {
  status: SponsorSlotStatus;
  slotKey: string;
  format: string;
  period: string;
  creative?: SponsorCreative;
  /** Every live creative when deliveryMode is `all`; one selected creative for rotation. */
  creatives?: SponsorCreative[];
  deliveryMode?: SponsorDeliveryMode;
  capacityPerPeriod?: number;
  priceUsd?: number;
  bookingUrl?: string;
  nextAvailablePeriods?: SponsorPeriod[];
}

/**
 * One fetched sponsor creative and the stable identity for that render.
 * Keep this object for as long as the sponsor is on screen so impressions and
 * clicks are correlated and duplicate billable events can be suppressed.
 */
export interface GrowthCatSponsorData extends SponsorSlotContent {
  creativeInstanceId: string;
  /** Stable render identity for each creative in simultaneous-delivery slots. */
  creativeInstanceIds: Record<string, string>;
}

export type SponsorEventName = "impression" | "click";

export interface SponsorEventPayload {
  sdk_event_id: string;
  creative_instance_id: string;
  slot_key: string;
  booking_id: string;
  tracking_token: string;
  event_name: SponsorEventName;
  occurred_at: string;
  measurement_mode: import("../core/privacy").GrowthCatMeasurementMode;
  sdk_install_id: string;
  session_id: string;
  locale?: string;
  country_code?: string;
  sdk_version: string;
  metadata: import("./ads").AdEventMetadata;
}

export interface SponsorEventBatchRequest {
  schema_version: 2;
  events: SponsorEventPayload[];
}
