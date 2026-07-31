"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  AUCTION_LOT_OUTCOME_LABEL,
  AUCTION_SALE_STATUS_LABEL,
  bidFreshness,
  type AuctionLotOutcome,
  type AuctionLotStatus,
  type AuctionSaleStatus,
  type BidFreshness,
} from "@/lib/auction-rules";

// Shared chip presentation for auction tracking (#351), mirroring `offer-badges.tsx` so a status
// reads identically on the flat lot list, on a sale's detail and in the sale list.

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

function tinted(token: string | null, label: string, title?: string) {
  if (!token) {
    return (
      <Tooltip content={title}>
        <span style={CHIP}>{label}</span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={title}>
      <span
        style={{
          ...CHIP,
          color: `var(--color-${token})`,
          borderColor: `var(--color-${token}-border, var(--color-border))`,
          background: `var(--color-${token}-soft, var(--color-bg-page))`,
        }}
      >
        {label}
      </span>
    </Tooltip>
  );
}

/** The chip names the **derived** outcome (ADR-0021 §4), not the recorded lifecycle: `open |
 * closed | cancelled` is bookkeeping, and what the collector wants off a row is how it went. */
const LOT_OUTCOME: Record<AuctionLotOutcome, { token: string | null; title: string }> = {
  // Neutral on purpose. `pending` is what every live lot is — it says nothing the row does not
  // already say — while **Leading** beside it is a real, hard-won piece of news. Two tinted chips
  // side by side made the ordinary one compete with the one worth reading.
  pending: { token: null, title: "Still open — the bid is worth keeping current" },
  won: { token: "success", title: "It went for less than your maximum; payable in this sale's parcel" },
  lost: { token: null, title: "It went past your maximum — nothing to pay" },
  // Tinted like nothing else here because it is the one outcome that is not about the bidding at
  // all: no bid was ever placed, and the lot exists to record what it fetched.
  observed: { token: "accent", title: "You never bid on this one — it is here for the price it fetched" },
  cancelled: { token: null, title: "Withdrawn by the seller, or ended without a sale" },
};

export function LotOutcomeChip({ outcome }: { outcome: AuctionLotOutcome }) {
  const meta = LOT_OUTCOME[outcome];
  return tinted(meta.token, AUCTION_LOT_OUTCOME_LABEL[outcome], meta.title);
}

const SALE_STATUS: Record<AuctionSaleStatus, { token: string | null; title: string }> = {
  open: { token: "accent", title: "Lots are still being added to this parcel" },
  settled: { token: "success", title: "Transcribed into a purchase" },
  closed: { token: null, title: "Nothing was won — there is nothing to settle" },
};

export function SaleStatusChip({ status }: { status: AuctionSaleStatus }) {
  const meta = SALE_STATUS[status];
  return tinted(meta.token, AUCTION_SALE_STATUS_LABEL[status], meta.title);
}

const FRESHNESS: Record<
  Exclude<BidFreshness, "fresh">,
  { token: string | null; label: string; title: string }
> = {
  // Neutral, like the muted row it sits on: the bidding is over, so there is nothing to react to
  // in the moment. It is a state to come back to — the *Ended* filter is how — not an alarm.
  closed: {
    token: null,
    label: "Ended",
    title: "The closing time has passed while this lot is still being watched — record what happened to it",
  },
  unchecked: {
    token: "warning",
    label: "No bid yet",
    title: "No bid has ever been recorded for this lot",
  },
  stale: {
    token: "warning",
    label: "Stale",
    title: "The bid has not been checked recently for how soon this lot closes",
  },
};

/**
 * The staleness signal (ADR-0021 §5). Refreshing a bid is manual work, so the list has to say which
 * lots are worth the click; a lot that is current shows **nothing**, the same unmarked-default rule
 * the subtype chip and the single format follow.
 */
export function BidFreshnessChip({
  status,
  endsAt,
  checkedAt,
  now,
}: {
  status: AuctionLotStatus;
  endsAt: string;
  checkedAt: string | null;
  /** The clock, passed in by the list so every row on screen ages against the same instant. */
  now: Date;
}) {
  const freshness = bidFreshness(
    { status, endsAt: new Date(endsAt), checkedAt: checkedAt ? new Date(checkedAt) : null },
    now
  );
  if (freshness === "fresh") return null;
  const meta = FRESHNESS[freshness];
  return tinted(meta.token, meta.label, meta.title);
}

/**
 * Where the collector stands, derived from what they placed against what the lot stands at
 * (ADR-0021 §5) — never a flag anyone sets, because it would be wrong the moment the price moved.
 * Nothing renders until they have actually bid: a lot merely being watched is neither.
 *
 * Once the moment has passed the same comparison stops being a position and becomes a **result**,
 * so it reads *Won?* / *Lost?* — with the question mark, because it is computed against the last bid
 * anyone bothered to record rather than against what the lot actually fetched. Closing the lot
 * replaces it: the outcome chip is then the same arithmetic over the confirmed figure, and prints
 * without the doubt.
 */
export function BidStandingChip({
  standing,
  closed = false,
  settled = false,
}: {
  standing: "leading" | "outbid" | null;
  /** The closing time has passed. */
  closed?: boolean;
  /** The lot has been closed, so the outcome chip states it against a confirmed price. */
  settled?: boolean;
}) {
  if (!standing || settled) return null;
  if (closed) {
    return standing === "leading"
      ? tinted(
          "success",
          "Won?",
          "Your bid was ahead of the last price recorded — close the lot to confirm what it went for"
        )
      : tinted(
          null,
          "Lost?",
          "The last price recorded was above your bid — close the lot to confirm what it went for"
        );
  }
  return standing === "leading"
    ? tinted("success", "Leading", "Your bid still covers the current price")
    : tinted("error", "Outbid", "The price has passed the bid you placed — raise it or let it go");
}

/**
 * Nothing described yet (#442) — the composition is empty, so catalogue value, headroom and every
 * figure derived from them are blank on this row and will stay blank until someone says what the
 * lot holds. `warning`, like the other two chips that name work outstanding rather than a state of
 * the bidding, and shown for every status but `cancelled` — the rule is `lotNeedsComposition` in
 * `auction-lot.ts`, shared with the filter chip so the two can never disagree.
 */
export function NotDescribedChip() {
  return tinted(
    "warning",
    "Not described",
    "Nothing is recorded as being in this lot, so it has no catalogue value to bid against"
  );
}

/** Over the collector's ceiling — measured against the **all-in** cost, not the hammer price
 * (ADR-0021 §6), which is the whole reason the column exists. */
export function OverCeilingChip() {
  return tinted(
    "error",
    "Over ceiling",
    "The all-in cost of the current bid has passed the ceiling you set"
  );
}
