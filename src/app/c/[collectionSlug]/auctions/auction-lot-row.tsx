"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import {
  RowQuickActions,
  pickRowActions,
} from "@/app/c/[collectionSlug]/shared/row-quick-actions";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
import {
  auctionLotName,
  closingUrgency,
  isTerminalLotStatus,
  type ClosingUrgency,
} from "@/lib/auction-rules";
import {
  allIn,
  bidCosting,
  ceilingOf,
  headroom,
  lotNeedsComposition,
  maxBidWithin,
  type AuctionFees,
} from "@/lib/auction-lot";
import type { BidRecommendation } from "@/lib/bid-recommendation";
import type { AuctionLotView } from "./use-auctions-query";
import {
  BidFreshnessChip,
  BidStandingChip,
  LotOutcomeChip,
  NotDescribedChip,
  NotStampsChip,
  OverCeilingChip,
} from "./auction-badges";
import { useLotOutcomeActions } from "./use-lot-outcome-actions";
import { formatBase, formatInstant, formatRelative } from "./auction-format";
import { useSeparateCeiling } from "./use-separate-ceiling";
import { useNotStampsAction } from "./use-not-stamps-action";
import { useToast } from "@/app/toast-provider";
import { formatAmountInput } from "@/lib/decimal-input";
import { AmountWithBase } from "./auction-base-amount";
import {
  BidRecommendationPopover,
  RECOMMENDATION_CARET_SLOT,
} from "./bid-recommendation-popover";
import { Icon } from "@/app/icons";
import { CaretCell } from "@/app/c/[collectionSlug]/shared/cell-target";

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

const AMOUNT: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
};

const MUTED_AMOUNT: React.CSSProperties = {
  ...AMOUNT,
  fontWeight: 500,
  color: "var(--color-text-muted)",
};

/** The recommendation — the worth figure the row is decided from (#1515) — a size above the rest. */
const PROMINENT_AMOUNT: React.CSSProperties = {
  ...AMOUNT,
  fontSize: "1rem",
  fontWeight: 700,
};

/** The recommended figure's own box (#576, #1515): right-aligned in a fixed width, so the figures
 * line up down the list and *Bid this* beside them stands in one column whatever the amount. The
 * caret that marks the figure as a way in hangs in a slot of its own past the right edge, reserved
 * on the box rather than inside the trigger, so a row that draws no caret lines up all the same. */
const RECOMMENDATION_CELL: React.CSSProperties = {
  display: "inline-block",
  minWidth: "6.5rem",
  textAlign: "right",
  paddingRight: RECOMMENDATION_CARET_SLOT,
};

/** Column heading and row label in the amounts grid — small, muted, and never competing with the
 * figures they organise. */
const GRID_HEAD: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
};

const GRID_LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "var(--color-text-muted)",
  justifySelf: "start",
  // `headroom` is the longest of them and must not wrap onto a second line: the grid's rows are
  // what line one lot's figures up with the next lot's.
  whiteSpace: "nowrap",
};

/**
 * The rule between what the lot **costs** and what it is **worth** (#1515): the *Auction* and *My
 * bid* blocks on its left, the *Recommended* block on its right.
 *
 * The two sides do not share a vocabulary — on the cost side a row is one figure expressed two ways
 * (a hammer price and what it comes to all-in), while the recommendation is a valuation with its
 * own secondary line — so the rule says where one reading stops and the other starts.
 *
 * Spans every row the grid draws, explicitly, so the cells around it keep auto-placing in order.
 */
function gridRule(rows: number): React.CSSProperties {
  return {
    gridColumn: 4,
    gridRow: `1 / span ${rows}`,
    justifySelf: "center",
    alignSelf: "stretch",
    width: "1px",
    background: "var(--color-border)",
  };
}

/** The recommendation block's cells are laid out by hand, left to right — a figure, its button, and
 * the line under them — so the block reads as one answer rather than as a column of amounts. */
const RECOMMENDED_CELL: React.CSSProperties = {
  justifySelf: "start",
  display: "inline-flex",
  alignItems: "baseline",
  gap: "0.5rem",
  whiteSpace: "nowrap",
};

/** The secondary line under the recommendation: what is left of it, and the catalogue value. */
const RECOMMENDED_NOTE: React.CSSProperties = {
  fontSize: "0.75rem",
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

/**
 * *Bid this* — the one action a collector takes on nearly every lot (#1515), so it is a real button
 * that is **always visible**, not a control revealed on hover. Drawn in the row's chip shape and the
 * accent colour, like the *Listing* chip beside the title: an action on the row, not a figure in it.
 */
const BID_THIS: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-accent)",
  color: "var(--color-accent)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

/** How the closing time reads. Colour here means **"act now"**, so only a deadline you can still do
 * something about gets any: red inside two hours, amber inside a day, plain text further out.
 *
 * A lot whose moment has passed is **muted**, not red. There is nothing to react to — the bidding
 * happened without you — and an alarm on it would compete every day with the lots that can still be
 * won. Finding those lots is what the *Ended* filter is for. */
const CLOSING_STYLE: Record<ClosingUrgency, React.CSSProperties> = {
  past: { color: "var(--color-text-muted)" },
  imminent: { color: "var(--color-error)", fontWeight: 600 },
  soon: { color: "var(--color-warning)", fontWeight: 600 },
  later: { color: "var(--color-text-secondary)" },
};

/**
 * The two bid cells are tinted by the same comparison, but **not in the same colours** — each says
 * something about its own side.
 *
 * The auction's price goes **red** when it has passed what you placed: that is the price running
 * away from you, and the one thing here you might still answer.
 *
 * Yours goes **green** while it still covers the price and **grey** once it does not — a bid that
 * has been passed is simply out of play. It must not go red: on your own figure red already reads
 * as *over ceiling*, and two different problems in one colour is worse than one of them unmarked.
 * Over-ceiling takes amber and outranks both, being the one you can still take back.
 *
 * **A colour applies to a whole column, both of its lines.** The bid line and the all-in line are
 * one figure expressed twice — the same money, with the seller's premium on it — so a fact about
 * that money is a fact about both. Tinting only the stored half made a column read as two unrelated
 * numbers that happened to disagree: your bid green for still leading, and the very same bid grey
 * one line below. What keeps the two lines *distinguishable* is weight, not colour: the stored side
 * is solid and the derived side muted, and that is unchanged.
 */
function auctionBidColor(
  standing: "leading" | "outbid" | null,
  overCeiling: boolean | null
): string | undefined {
  // Both facts say the same thing about the auction's own column — the price has run past something
  // of yours — and both were already drawn in red, one on each line. Now either colours the pair.
  return standing === "outbid" || overCeiling ? "var(--color-error)" : undefined;
}

function myBidColor(
  standing: "leading" | "outbid" | null,
  overCeiling: boolean | null
): string | undefined {
  if (overCeiling) return "var(--color-warning)";
  if (standing === "leading") return "var(--color-success)";
  if (standing === "outbid") return "var(--color-text-muted)";
  return undefined;
}

/** An amount an inline edit has committed but the list has not yet returned: the value to show, and
 * the value it replaced, which is how we know the fetch has landed. */
interface Pending {
  value: string | null;
  was: string | null;
}

/** The amount to render, dropping the pending override once the row arrives with a different
 * underlying value — whether that is the new figure or, after a refusal, the old one again.
 * Adjusted during render (the codebase's pattern for state that follows fetched data). */
function resolvePending(
  pending: Pending | null,
  actual: string | null,
  clear: (next: null) => void
): string | null {
  if (!pending) return actual;
  if (actual !== pending.was) {
    clear(null);
    return actual;
  }
  return pending.value;
}

/**
 * What the catalogue line says about itself — the state of the composition, in one line (#353), and
 * the catalogue headroom, which moved here from a column of its own (#1515).
 *
 * The gaps are named rather than hidden: a total silently missing half the lot's lines looks like a
 * finished answer, and the collector would bid against it. `inBase` is the catalogue value in the
 * base currency, where the screen converts every figure (#498).
 */
function catalogHint(lot: AuctionLotView, inBase: string | null): string {
  if (lot.lineCount === 0) {
    return "Nothing described yet. Say what the lot holds and its catalogue value follows.";
  }
  const gaps: string[] = [];
  if (lot.unpricedLineCount > 0) {
    gaps.push(`${lot.unpricedLineCount} line${lot.unpricedLineCount === 1 ? "" : "s"} unpriced`);
  }
  if (lot.unconvertibleLineCount > 0) {
    gaps.push(`${lot.unconvertibleLineCount} in a currency with no rate`);
  }
  const base = lot.catalogUncertain
    ? "Catalogue value; part of it is the cheapest of an unidentified variant — inferred, not recorded."
    : "Catalogue value of what this lot is described as holding.";
  const parts = [gaps.length > 0 ? `${base} ${gaps.join(", ")}.` : base];
  if (inBase) parts.push(`${inBase}.`);
  if (lot.headroom !== null) {
    parts.push(
      Number(lot.headroom) < 0
        ? `At the current bid, all-in, the lot costs ${lot.headroom.replace(/^-/, "")} more than catalogue.`
        : `Headroom: ${lot.headroom} below catalogue at the current bid, all-in.`
    );
  }
  parts.push("Click to edit the contents.");
  return parts.join(" ");
}

/**
 * What the row calls the lot: what the collector typed, else what it is described as holding (#353),
 * else its lot number, else a plain placeholder.
 *
 * The derived name outranks the lot number deliberately — `1-12 · Definitives (1950)` says what the
 * lot *is*, while `Lot 385` only says where it sits in someone's catalogue, and the number is
 * already on the row as its own chip. A lot captured in a hurry off a marketplace has none of the
 * three, and an empty line reads as a bug.
 */
function lotLabel(lot: AuctionLotView): string {
  return auctionLotName(lot) ?? "Untitled lot";
}

/**
 * A figure the row already knows, offered as a one-click fill for the bid or the ceiling (#370,
 * #371) — from the `⋮` menu since #1515, which took the hover controls out of the row.
 *
 * `value === null` is the single definition of unavailable; the hint then says why, which is #273's
 * rule for the menu (a disabled entry never receives a hover event, so the reason has to be printed
 * under the label).
 */
interface QuickFill {
  /** The figure to write, as the target field would store it. Null when the action is unavailable. */
  value: string | null;
  /** What it will do, or — when `value` is null — why it cannot. */
  hint: string;
}

const SETTLED_HINT = "Settled into a purchase — edit the purchase instead";

/** Why a lot marked *not stamps* (#1624) has no catalogue value and no recommendation. */
const NOT_STAMPS_HINT = "Not stamps — there is no catalogue value to go by";

/** Why catalogue value cannot be a source: nothing described, or nothing described carries a price.
 * Named apart from a bare "no catalogue value", because the two are fixed in different places. */
function noCatalogValueHint(lot: AuctionLotView): string {
  if (lot.notStamps) return NOT_STAMPS_HINT;
  return lot.lineCount === 0
    ? "Describe what the lot holds first — its catalogue value follows from that"
    : "Nothing described in this lot carries a catalogue price yet";
}

/**
 * Catalogue value → a ceiling set apart (#370, #1515).
 *
 * Copies its figure across **unchanged**: a ceiling is what the lot is worth *all-in* (ADR-0021 §6)
 * and catalogue value is an all-in figure too — it is exactly what `headroom` subtracts the all-in
 * cost from. The fills that place a *bid* go through the inverse instead, because a platform's bid
 * box takes a hammer price.
 *
 * Not blocked on a closed lot, deliberately: recording what a lot was worth to you is most often
 * done after the fact (#213).
 */
function ceilingFromCatalog(lot: AuctionLotView, editable: boolean): QuickFill {
  if (!editable) return { value: null, hint: SETTLED_HINT };
  if (lot.catalogValue === null) return { value: null, hint: noCatalogValueHint(lot) };
  return {
    value: lot.catalogValue,
    hint: `Sets a separate ceiling of ${lot.catalogValue} ${lot.currency} — what this lot is worth at catalogue, all-in`,
  };
}

/** A ceiling set apart → the bid you place, at the most that fits inside it once the fees are
 * counted. Reads the ceiling **as displayed**, so an entry offered right after another edit is about
 * the figure on screen rather than the one the last fetch carried. A ceiling that follows the bid
 * has nothing to offer here: bidding it would bid what is already placed. */
function bidFromCeiling(
  lot: AuctionLotView,
  apart: string | null,
  room: string | null,
  editable: boolean,
  terminal: boolean
): QuickFill {
  if (!editable) return { value: null, hint: SETTLED_HINT };
  if (terminal) return { value: null, hint: "This lot has closed" };
  if (apart === null) {
    return { value: null, hint: "Your ceiling follows your bid — set one apart first" };
  }
  if (room === null) {
    return { value: null, hint: "The seller's fees alone exceed your ceiling" };
  }
  return {
    value: room,
    hint: `Records a bid of ${room} ${lot.currency} — all-in, that is your ceiling`,
  };
}

/** Catalogue value → the bid you place (#371), through the same inverse, for the same reason. A
 * ceiling set apart stays where it is; one that follows the bid follows this one. */
function bidFromCatalog(lot: AuctionLotView, editable: boolean, terminal: boolean): QuickFill {
  if (!editable) return { value: null, hint: SETTLED_HINT };
  if (terminal) return { value: null, hint: "This lot has closed" };
  if (lot.catalogValue === null) return { value: null, hint: noCatalogValueHint(lot) };
  if (lot.catalogBidRoom === null) {
    return { value: null, hint: "The seller's fees alone exceed the catalogue value" };
  }
  return {
    value: lot.catalogBidRoom,
    hint: `Records a bid of ${lot.catalogBidRoom} ${lot.currency} — all-in, that is catalogue value`,
  };
}

/** Which of the three figures a control is about. The keys are the recommendation's own, so a
 * control names a level by reading it rather than by mapping onto it. */
type BidLevelKey = keyof Pick<BidRecommendation, "floor" | "fair" | "walkAway">;

/** How each recommended level is named wherever one is offered — *Bid this*, the `⋮` entries, the
 * undo, and the popover's own rows. One vocabulary, so "walk-away" means the same thing in all. */
const LEVEL_LABEL: Record<BidLevelKey, string> = {
  floor: "bargain floor",
  fair: "recommended bid",
  walkAway: "walk-away",
};

/** The `⋮` entries for the three levels — verbs, where {@link LEVEL_LABEL} names the figure. */
const LEVEL_MENU_LABEL: Record<BidLevelKey, string> = {
  floor: "Bid the bargain floor",
  fair: "Bid the recommendation",
  walkAway: "Bid the walk-away figure",
};

/** A recommended level, ready to bid: the all-in figure and the hammer price that fits inside it. */
interface LevelBid {
  /** Null when the level cannot be bid; {@link hint} then says why. */
  level: { allIn: string; bid: string } | null;
  hint: string;
}

/**
 * A recommended level → my bid, with the ceiling following it (#1515; ADR-0029 §8).
 *
 * The recommendation is an **all-in** figure (ADR-0029 §5), so what is placed is the largest bid
 * whose all-in fits inside it — the same arithmetic as *Bid my ceiling* — and the ceiling becomes
 * that bid's all-in: a separate one is cleared, which is what "sets my bid and my ceiling in one
 * click" means. `fair` is the row's own *Bid this*; the other two are in the `⋮` menu and the panel.
 */
function bidFromRecommendation(
  lot: AuctionLotView,
  editable: boolean,
  terminal: boolean,
  which: BidLevelKey
): LevelBid {
  const name = LEVEL_LABEL[which];
  if (!editable) return { level: null, hint: SETTLED_HINT };
  if (terminal) return { level: null, hint: "This lot has closed" };
  if (lot.recommendation === null) {
    return {
      level: null,
      hint: lot.notStamps
        ? NOT_STAMPS_HINT
        : "Describe what the lot holds first — a recommendation follows from that",
    };
  }
  const level = lot.recommendation[which];
  if (level === null) {
    return {
      level: null,
      hint: "Nothing in this lot could be priced — neither a recorded result nor a catalogue value",
    };
  }
  if (level.bid === null) {
    return { level: null, hint: `The seller's fees alone exceed the ${name}` };
  }
  return {
    level: { allIn: level.allIn, bid: level.bid },
    hint: `Bids ${level.bid} ${lot.currency} — all-in, that is the ${name} of ${level.allIn}. Your ceiling follows the bid.`,
  };
}

interface AuctionLotRowProps {
  lot: AuctionLotView;
  collectionSlug: string;
  /** The recommendation's evidence is read per lot and only while its popover is open (#511), and
   * that read is collection-scoped like every other one in the module. */
  collectionId: string;
  /** The clock the whole list ages against, so every row on screen agrees. */
  now: Date;
  isLast: boolean;
  /** Whether the row names its own sale. False on the sale's own screen and under a group heading
   * that already says it — which also takes the redundant *Open sale* action out of the ⋮ menu. */
  showSale?: boolean;
  /**
   * Whether the row names the seller and the platform. False on the sale's own screen: a sale is
   * **one settlement with one seller** (ADR-0021 §1), so both are fixed for every lot on it and the
   * header above states them. Kept on the grouped flat list, where a sale-name heading says which
   * parcel a lot is in but not who it is with.
   */
  showParties?: boolean;
  /**
   * Whether clicking the row opens the lot's sale, with that lot scrolled to and flashed once
   * there (#374; the flash replaced a persistent ring and a dismissable strip in #850).
   *
   * On for the flat watchlist, off on the sale's own screen — there the click would land on the
   * page you are already reading, and the row is that card's header, whose caret is the only thing
   * meant to react to a click.
   */
  linkToSale?: boolean;
  isPending: boolean;
  onEdit: (lot: AuctionLotView) => void;
  onDelete: (lot: AuctionLotView) => void;
  onSetBid: (lot: AuctionLotView, value: string) => void;
  onSetMyBid: (lot: AuctionLotView, value: string) => void;
  /** The ceiling set apart from the bid (#1515); blank clears it and the ceiling follows the bid. */
  onSetMaxBid: (lot: AuctionLotView, value: string) => void;
  /** *Bid this* and its undo (#1515): the bid and the separate ceiling in one write, blank clearing. */
  onSetBidAndCeiling: (lot: AuctionLotView, myBid: string, maxBid: string) => void;
  onMarkChecked: (lot: AuctionLotView) => void;
  /** Open the composition editor (#353) — what the lot contains, and what that is worth. */
  onEditComposition: (lot: AuctionLotView) => void;
  /** Refresh after an outcome was recorded (#354). The row owns those entries and their dialog
   * itself — both screens get the same three without knowing about the flow — so all it needs back
   * is "something changed". */
  onOutcomeRecorded: () => void;
  /**
   * When set, the row is the **header of a collapsible card** over its composition (#353, the
   * sale's own screen). A caret is drawn ahead of the title and is the *only* thing that toggles:
   * the row is dense with inline-editable figures, so a click-anywhere header would fight the very
   * fields the daily bid refresh is typed into.
   */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /**
   * How much of the row is read in the base currency too (#498).
   *
   * `headline` — the flat watchlist — converts the **bid** alone: the list is scanned down a column
   * of forty rows for what to deal with next, and a second line under every figure would double the
   * height of all of them to answer a question that is asked of one lot at a time.
   *
   * `full` — the sale's own screen, where a card is opened *because* this lot is the one being
   * decided — converts every figure in the grid. Nothing is drawn at all where the sale already
   * trades in the base currency, so a collection with one currency sees neither.
   */
  baseAmounts?: "headline" | "full";
}

/**
 * One lot on the flat list: what it is and when it closes, then the figures a bid is decided from —
 * what the auction stands at, what you placed, and what the lot is worth bidding, with *Bid this*
 * beside it (#1515).
 *
 * The bids are edited **in place** (#351). Refreshing a bid is the daily job and
 * manual by decision (ADR-0021 §8), so it has to cost one click from the list rather than a dialog;
 * committing one stamps `checkedAt`, which is what clears the staleness chip.
 */
export function AuctionLotRow({
  lot,
  collectionSlug,
  collectionId,
  now,
  isLast,
  showSale = true,
  showParties = true,
  linkToSale = false,
  isPending,
  onEdit,
  onDelete,
  onSetBid,
  onSetMyBid,
  onSetMaxBid,
  onSetBidAndCeiling,
  onMarkChecked,
  onEditComposition,
  onOutcomeRecorded,
  expanded,
  onToggleExpanded,
  baseAmounts = "headline",
}: AuctionLotRowProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [hovered, setHovered] = useState(false);
  // What an inline edit just committed, shown until the list comes back carrying it. Two things
  // come out of this: the figure appears **as it will be stored** (`40` → `40.00`) rather than as
  // it was typed, and the row does not flash the previous amount while the refetch is in flight.
  // Cleared as soon as the underlying value moves at all — which covers a refusal too, since the
  // row then arrives unchanged and the override goes with it.
  const [pendingBid, setPendingBid] = useState<Pending | null>(null);
  const [pendingMax, setPendingMax] = useState<Pending | null>(null);
  const [pendingMine, setPendingMine] = useState<Pending | null>(null);
  const currentBid = resolvePending(pendingBid, lot.currentBid, setPendingBid);
  const maxBid = resolvePending(pendingMax, lot.maxBid, setPendingMax);
  const myBid = resolvePending(pendingMine, lot.myBid, setPendingMine);
  // The closing-price field opens at the last bid observed (#851), and an inline refresh made a
  // second ago is the last observation — so the dialog is given the bid **as displayed**, not the
  // one the last fetch happened to carry. Refreshing a bid and closing the lot in the same breath is
  // exactly the sequence the prefill exists for.
  const outcome = useLotOutcomeActions({ ...lot, currentBid }, onOutcomeRecorded);
  const terminal = isTerminalLotStatus(lot.status);
  const urgency = closingUrgency({ status: lot.status, endsAt: new Date(lot.endsAt) }, now);
  // Past tense whenever the moment has passed — a lot still being watched an hour after its close
  // has not "closed" as an outcome, but it certainly does not still *close* in the future.
  const hasClosed = terminal || urgency === "past";
  const saleHref = `/c/${collectionSlug}/auctions/sales/${lot.saleId}`;
  // A settled lot is read-only here: its figures now live on the purchase (#28).
  const editable = !lot.settled;

  /**
   * The seller's terms, as the sale carries them — shipping excluded, exactly as everywhere a
   * single lot is costed (ADR-0021 §6).
   *
   * *My bid* is edited **from either side**: it stores the hammer price and shows the all-in, and
   * typing into either one is a way of stating the same thing. So the derived half is computed here
   * from the figure **as displayed** rather than read off the fetched row — that way one pending
   * override covers both cells, and neither can show the old number beside the new one while the
   * refetch is in flight. The ceiling is derived the same way, since it follows the bid unless set
   * apart (#1515).
   */
  const fees: AuctionFees = {
    premiumPercent: lot.premiumPercent,
    premiumFixed: lot.premiumFixed,
  };
  /** What the bid you placed would cost. */
  const myAllIn = allIn(myBid, fees);
  /** The ceiling the lot is held to, as displayed: one set apart, else the bid's own all-in. */
  const ceiling = ceilingOf({ myBid, maxBid }, fees);
  /** The most that can be bid with the all-in still inside a ceiling set apart. */
  const bidRoom = maxBidWithin(maxBid, fees);

  /** The figure the bid cell is actually showing (#498): the result once one is recorded, else what
   * the lot stands at, else what it opens at — so the conversion is of the number on screen. */
  const shownBid = lot.finalPrice ?? currentBid ?? lot.startingPrice;

  // One colour per block, applied to both of its lines — see `auctionBidColor` / `myBidColor`.
  // Suppressed once a result is recorded, on the rule the bid cell already stated for itself:
  // leading and outbid are positions in a race that is over, and a settled figure tinted as though
  // it were live keeps asking a question nobody can answer any more.
  const auctionColor = lot.finalPrice !== null ? undefined : auctionBidColor(lot.standing, lot.overCeiling);
  const mineColor =
    lot.finalPrice !== null ? undefined : myBidColor(lot.standing, lot.myBidOverCeiling);
  /**
   * A cell and its base-currency reading, stacked (#498). `headline` marks the one figure the flat
   * list converts too; every other cell is converted in `full` mode alone.
   *
   * `onSaveBase` makes that reading a **third way of typing the same figure**, beside the two *My
   * bid* already has: what is entered is read in the base currency and converted back to what gets
   * stored. Passed only where the figure is the collector's own.
   */
  function withBase(
    amount: string | null,
    node: React.ReactNode,
    opts: {
      headline?: boolean;
      onSaveBase?: (stored: string) => void;
      editable?: boolean;
    } = {}
  ) {
    if (baseAmounts !== "full" && !opts.headline) return node;
    return (
      <AmountWithBase
        amount={amount}
        rate={lot.baseRate}
        baseCurrency={lot.baseCurrency}
        onSaveBase={opts.onSaveBase}
        editable={opts.editable}
        isPending={isPending}
      >
        {node}
      </AmountWithBase>
    );
  }

  // The fills (#370, #371, #511, #1515), resolved once: the three recommended levels — `fair` is
  // the row's own *Bid this* — and the rarer ones the ⋮ menu carries.
  const bidCeiling = bidFromCeiling(lot, maxBid, bidRoom, editable, terminal);
  const bidCatalog = bidFromCatalog(lot, editable, terminal);
  const ceilingCatalog = ceilingFromCatalog(lot, editable);
  const levelBids: Record<BidLevelKey, LevelBid> = {
    floor: bidFromRecommendation(lot, editable, terminal, "floor"),
    fair: bidFromRecommendation(lot, editable, terminal, "fair"),
    walkAway: bidFromRecommendation(lot, editable, terminal, "walkAway"),
  };
  const bidThis = levelBids.fair;
  /** *Bid this* would change nothing: the bid is already the recommended one and the ceiling
   * already follows it. The button stays, so the block does not reshape, but says so. */
  const bidThisDone =
    bidThis.level !== null && myBid === bidThis.level.bid && maxBid === null;

  /** The recommendation as the block draws it: the fair figure, and the room left before the price
   * passes it — the same subtraction, same costed figure, as the catalogue headroom. */
  const recommendedFair = lot.recommendation?.fair?.allIn ?? null;
  const recommendedHeadroom = headroom(recommendedFair, lot.finalPrice ?? lot.currentBid, fees);

  // Every write to *My bid* or to the ceiling goes through these: they carry the same pending
  // override an inline edit does, so the figure appears at once — in **both** cells, since the
  // derived half above follows the displayed one — and neither flashes its old value.
  function applyMyBid(value: string) {
    setPendingMine({ value: formatAmountInput(value) || null, was: lot.myBid });
    onSetMyBid(lot, value);
  }
  function applyMaxBid(value: string) {
    setPendingMax({ value: formatAmountInput(value) || null, was: lot.maxBid });
    onSetMaxBid(lot, value);
  }
  /**
   * *My bid* typed from its **all-in** side: what is stored is still the hammer price, so the figure
   * is run back through `bidCosting` — the inverse rounded to the *nearest* cent, so the total reads
   * back as the one that was typed. A target the fees alone already swallow has no bid behind it at
   * all, and clears the bid rather than inventing one.
   */
  function applyMyAllIn(value: string) {
    applyMyBid(bidCosting(value, fees) ?? "");
  }

  /**
   * Bid a recommended level (#1515): the bid that fits inside it, and the ceiling following that bid
   * — a separate one is cleared. One write for both, then a toast with **Undo**, because the bid it
   * replaced may have been typed by hand and one click should not cost it for good. The undo puts
   * both figures back exactly as they were on screen.
   */
  function bidLevel(which: BidLevelKey, level: { allIn: string; bid: string }) {
    const before = { myBid: myBid ?? "", maxBid: maxBid ?? "" };
    setPendingMine({ value: level.bid, was: lot.myBid });
    setPendingMax({ value: null, was: lot.maxBid });
    onSetBidAndCeiling(lot, level.bid, "");
    toast({
      message: `Bid ${level.bid} ${lot.currency} on ${lotLabel(lot)} — the ${LEVEL_LABEL[which]}, ${level.allIn} all-in`,
      action: {
        label: "Undo",
        onSelect: () => {
          // Dropped rather than re-pointed: the row shows what the refetch brings back.
          setPendingMine(null);
          setPendingMax(null);
          onSetBidAndCeiling(lot, before.myBid, before.maxBid);
        },
      },
    });
  }

  const separateCeiling = useSeparateCeiling(
    { currency: lot.currency, myBid, ceiling },
    applyMaxBid
  );
  const notStamps = useNotStampsAction(lot, onOutcomeRecorded);

  /** Where the row's own click goes (#374): the parcel this lot settles in, with the lot named so
   * the sale screen can scroll to it and flash it. */
  const highlightHref = `${saleHref}?lot=${lot.id}`;

  /**
   * The row is a click target **and** a dense set of inline-editable figures, so navigation only
   * happens on a click that nothing else on the row wanted.
   *
   * Everything interactive here is an `a`, a `button`, an `input`, or — for the click-to-edit cells,
   * which is the case that matters — a `[role="button"]`, so one `closest` covers them all and
   * keeps covering them as the row grows. A drag that selected text is a read, not a navigation;
   * a modified click means "somewhere else", so it opens a tab instead of replacing this screen.
   */
  function handleRowClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!linkToSale) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('a, button, input, select, textarea, [role="button"]')) return;
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      window.open(highlightHref, "_blank", "noopener,noreferrer");
      return;
    }
    router.push(highlightHref);
  }

  const actions: RowAction[] = [
    ...(lot.url
      ? [
          {
            key: "listing",
            label: "Open listing",
            icon: "externalLink",
            onSelect: () => window.open(lot.url!, "_blank", "noopener,noreferrer"),
          } as RowAction,
        ]
      : []),
    // Only where the row itself names the sale. On the sale's own screen — and under a group
    // heading that links it — the way there is already on screen, so the entry would just be a
    // second door into the room you are standing in.
    ...(showSale
      ? [
          {
            key: "sale",
            label: "Open sale",
            icon: "open",
            href: highlightHref,
          } as RowAction,
        ]
      : []),
    {
      key: "checked",
      label: "Bid unchanged",
      icon: "refresh",
      // Confirming an observation needs an observation to confirm; the hint says so rather than
      // hiding the entry (#273).
      disabled: !editable || terminal || lot.currentBid === null,
      hint:
        lot.currentBid === null
          ? "No bid recorded yet — type one in the row instead"
          : terminal
            ? "This lot has closed"
            : lot.settled
              ? "Settled into a purchase"
              : undefined,
      onSelect: () => onMarkChecked(lot),
    },
    // The three recommended levels (#1515): each bids the level, with the ceiling following the bid.
    // `fair` is the row's own *Bid this* too; it is here as well so the keyboard reaches it, and the
    // other two are here because a scanned row carries one answer.
    ...(["fair", "floor", "walkAway"] as const).map((which) => {
      const { level, hint } = levelBids[which];
      return {
        key: `bid-${which}`,
        label: LEVEL_MENU_LABEL[which],
        icon: "suggestion",
        disabled: level === null,
        hint,
        onSelect: () => bidLevel(which, level!),
      } as RowAction;
    }),
    // The rarer fills. The two that place a *bid* go through the inverse of `allIn`, because the
    // ceiling and the catalogue value are both all-in figures while a bid box takes a hammer price.
    {
      key: "bid-catalog",
      label: "Bid catalogue value",
      icon: "bidCatalog",
      disabled: bidCatalog.value === null,
      hint: bidCatalog.hint,
      onSelect: () => applyMyBid(bidCatalog.value!),
    },
    {
      key: "bid-ceiling",
      label: "Bid my ceiling",
      icon: "bidCeiling",
      disabled: bidCeiling.value === null,
      hint: bidCeiling.hint,
      onSelect: () => applyMyBid(bidCeiling.value!),
    },
    // A ceiling set apart from the bid (#1515): set, filled from catalogue value, or cleared so it
    // follows the bid again.
    {
      key: "ceiling-set",
      label: "Set ceiling…",
      icon: "bidCeiling",
      separatorBefore: true,
      disabled: !editable,
      hint: editable
        ? "A ceiling apart from your bid — it stays put when the bid changes"
        : SETTLED_HINT,
      onSelect: separateCeiling.open,
    },
    {
      key: "ceiling-catalog",
      label: "Ceiling = catalogue value",
      icon: "bidCatalog",
      disabled: ceilingCatalog.value === null,
      hint: ceilingCatalog.hint,
      onSelect: () => applyMaxBid(ceilingCatalog.value!),
    },
    {
      key: "ceiling-clear",
      label: "Clear ceiling",
      icon: "clear",
      disabled: !editable || maxBid === null,
      hint: !editable
        ? SETTLED_HINT
        : maxBid === null
          ? "Your ceiling already follows your bid"
          : "Let the ceiling follow your bid again",
      onSelect: () => applyMaxBid(""),
    },
    {
      key: "contents",
      separatorBefore: true,
      // Readable whether or not anything has been entered — the same entry either way, because
      // "what is in this lot?" is the question in both cases. A lot marked *not stamps* (#1624)
      // holds nothing a line could describe, so the entry stays and says why it is closed.
      label: lot.lineCount === 0 ? "Describe contents" : `Contents (${lot.lineCount})`,
      icon: "contents",
      disabled: lot.notStamps,
      hint: lot.notStamps ? "Marked as not stamps" : undefined,
      onSelect: () => onEditComposition(lot),
    },
    notStamps.action,
    // What became of it (#354), set apart from the bidding entries above: those are what you do
    // *while* a lot runs, these are what you do once it has stopped.
    ...outcome.actions.map((action, idx) =>
      idx === 0 ? { ...action, separatorBefore: true } : action
    ),
    {
      key: "edit",
      label: "Edit",
      icon: "edit",
      separatorBefore: true,
      disabled: !editable,
      hint: lot.settled ? "Settled into a purchase — edit the purchase instead" : undefined,
      onSelect: () => onEdit(lot),
    },
    {
      key: "delete",
      label: "Delete",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      disabled: !editable,
      hint: lot.settled ? "Settled into a purchase — edit the purchase instead" : undefined,
      onSelect: () => onDelete(lot),
    },
  ];

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handleRowClick}
        style={{
          padding: "0.75rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          // Only where the click goes somewhere. The pointer is the whole affordance — the row is
          // not a link element, so the keyboard route stays the ⋮ menu's *Open sale* entry.
          //
          // Deliberately **not** given `RowLink` (#557), unlike the offer, purchase, sale and
          // auction-sale rows. Those are stacked cards of text with a control or two; this one is
          // an amounts grid of inline-editable figures, quick-fill controls and popovers, so an
          // overlay would have to be lifted off nearly every part of the row and would end up
          // covering the gaps between them. `handleRowClick` already answers a modified click with
          // a new tab, and *Open sale* in the menu is the real link.
          cursor: linkToSale ? "pointer" : undefined,
          // Anything finished recedes: a settled outcome, and a lot whose moment has gone by. The
          // list is a watchlist, and what is over should not compete with what is running.
          opacity: terminal || urgency === "past" ? 0.6 : 1,
        }}
      >
        {/* One row, three parts: what the lot is (two stacked lines), the figures, then when
            it closes and its actions. The figures sit **before** the closing time rather than
            pushed to the far edge — a two-line grid held out at arm's length stretched the row
            across the screen and put the numbers furthest from everything they describe. */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* The caret leads both lines, in a cell running the row's full height and reaching its
              left edge (#1589) — a click there expands and never opens the sale. */}
          {onToggleExpanded && (
            <CaretCell
              expanded={!!expanded}
              onToggle={onToggleExpanded}
              label={expanded ? "Collapse contents" : "Expand contents"}
              bleed={{
                top: "0.75rem",
                bottom: lot.notes ? undefined : "0.75rem",
                left: "1.25rem",
                right: "0.25rem",
              }}
              // Half the row's gap from the lot's name, as it sat when it was on line 1.
              style={{ marginRight: "-0.75rem" }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Line 1: what the lot is and where to see it */}
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
              <span
                style={{
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "60%",
                }}
                // The visible string, ellipsized — the browser's own overflow affordance, which is one
                // of the two places a native `title` still belongs (#291).
                title={lotLabel(lot)}
              >
                {lotLabel(lot)}
              </span>
              {/* Two numbers, deliberately side by side and deliberately styled apart: ours (#432,
                  monospace and muted, always present) identifies the lot in this collection and is
                  what the quick-jump box takes; the boxed chip beside it is the *house's* number,
                  which only some lots have and which repeats across sales. */}
              <EntityNoChip entity="auctionLot" no={lot.auctionLotNo} prefix="lot" />
              {lot.lotNo && (lot.title || lot.derivedTitle) && (
                <Tooltip content="Lot number in the sale">
                  <span style={CHIP}>#{lot.lotNo}</span>
                </Tooltip>
              )}
              {lot.url && (
                <Tooltip content="Open the listing">
                  <a
                    href={lot.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
                  >
                    <Icon name="externalLink" size="sm" /> Listing
                  </a>
                </Tooltip>
              )}
            </div>

            {/* Line 2: parties + status */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                marginTop: "0.5rem",
                flexWrap: "wrap",
              }}
              >
              {showSale && (
                <Tooltip content="Settlement this lot belongs to">
                  <a
                    href={highlightHref}
                    style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
                  >
                    {lot.saleName}
                  </a>
                </Tooltip>
              )}
              {showParties && (
                <Tooltip content="Seller">
                  <span style={CHIP}>{lot.sellerName}</span>
                </Tooltip>
              )}
              {showParties && lot.platformName !== lot.sellerName && (
                <Tooltip content="Platform">
                  <span style={CHIP}>{lot.platformName}</span>
                </Tooltip>
              )}
              <LotOutcomeChip outcome={lot.outcome} />
              <BidFreshnessChip
                status={lot.status}
                endsAt={lot.endsAt}
                checkedAt={lot.checkedAt}
                now={now}
              />
              <BidStandingChip
              standing={lot.standing}
              closed={urgency === "past"}
              settled={terminal}
            />
              {lot.overCeiling && <OverCeilingChip />}
              {/* Last of the chips: the composition is work outstanding, not news about the
                  bidding, so it never stands between the status and what the price is doing. */}
              {lotNeedsComposition(lot) && <NotDescribedChip />}
              {lot.notStamps && <NotStampsChip description={lot.notStampsDescription} />}

            </div>
            </div>

          {/* The figures (#1515): three blocks — **Auction** and **My bid** on the cost side of a
              rule, **Recommended** on the worth side.

              On the cost side each figure exists **twice**, as the hammer price and as what it costs
              all-in, and reading them in columns is what makes them comparable. Exactly one of each
              pair is **stored** (both bids are hammer prices) and the other is computed from it and
              shown muted. *My bid* is typed from **either** half — the two cells are one fact
              stated two ways. The **Auction** block stays one-way: its bid is an *observation*.

              There is **no Ceiling column**. The ceiling follows the bid unless it is set apart, and
              only a ceiling set apart (from the ⋮ menu) earns a line of its own, under the bid.

              The **Recommended** block is the prominent worth figure, with *Bid this* beside it —
              the one action taken on nearly every lot — and a secondary line under it: what is left
              of the recommendation at the current price, and the catalogue value, which matters far
              less and is no longer a column. */}
          <div
            style={{
              marginLeft: "auto",
              display: "grid",
              // Fixed tracks, not `auto`: every row must line its columns up with the rows above
              // and below it, and content-sized ones make each row its own private table. Track 4
              // is the rule. The last track is the recommendation block, laid out left to right
              // inside itself; it is wide enough for its secondary line and *Bid this*.
              gridTemplateColumns: "3.5rem 5.5rem 5.5rem 1px 15rem",
              columnGap: "0.5rem",
              rowGap: "0.125rem",
              justifyItems: "end",
              // **Baselines, not centres** (#498). A cell carrying a base-currency line under its
              // figure is two lines tall while its neighbours are one, and centring made a row's
              // label — and every unconverted cell in it — float half a line above the amounts it
              // belongs to.
              alignItems: "baseline",
            }}
          >
            <span style={gridRule(maxBid !== null ? 4 : 3)} aria-hidden />

            <span style={GRID_LABEL}>{lot.currency}</span>
            <span style={GRID_HEAD}>Auction</span>
            <span style={GRID_HEAD}>My bid</span>
            <span style={{ ...GRID_HEAD, justifySelf: "start" }}>Recommended</span>

            <span style={GRID_LABEL}>bid</span>
            {/* What the lot stands at — the one field the daily loop writes. Once a result has been
                recorded (#354) that figure takes the cell instead: it is what the lot actually went
                for, and it is already what the all-in below is computed from, so showing the last
                bid anyone happened to see would put two different prices on one row. */}
            {withBase(
              shownBid,
              <Tooltip
                content={
                  lot.finalPrice !== null
                    ? lot.outcome === "won"
                      ? `What you paid for this lot, ${formatInstant(lot.endsAt)}`
                      : `What this lot went for, ${formatInstant(lot.endsAt)}`
                    : lot.checkedAt
                      ? `Checked ${formatInstant(lot.checkedAt)}`
                      : "What the lot stands at now"
                }
              >
                <span>
                  <InlineText
                    value={currentBid ?? ""}
                    placeholder="0.00"
                    inputType="amount"
                    selectOnEdit
                    editable={editable && !terminal}
                    isPending={isPending}
                    onSave={(next) => {
                      setPendingBid({ value: formatAmountInput(next) || null, was: lot.currentBid });
                      onSetBid(lot, next);
                    }}
                    display={
                      lot.finalPrice !== null ? (
                        // The result, uncoloured: leading and outbid are positions in a race that is
                        // over, and tinting a settled figure would keep asking a question nobody can
                        // answer any more.
                        <span style={AMOUNT}>{lot.finalPrice}</span>
                      ) : currentBid === null ? (
                        // Nothing bid yet: show what the lot opens at, muted. It is not a bid —
                        // nobody is committed to it — so it never takes the amount's own weight.
                        <span style={MUTED_AMOUNT}>
                          {lot.startingPrice === null ? "—" : `from ${lot.startingPrice}`}
                        </span>
                      ) : (
                        <span style={{ ...AMOUNT, color: auctionColor }}>{currentBid}</span>
                      )
                    }
                  />
                </span>
              </Tooltip>,
              { headline: true }
            )}
            {/* What you have placed at the platform. */}
            {withBase(
              myBid,
              <Tooltip
                content={
                  lot.myBidOverCeiling
                    ? "All-in, the bid you placed costs more than the ceiling you set apart"
                    : lot.standing === "leading"
                      ? "Your bid still covers the current price"
                      : lot.standing === "outbid"
                        ? "The price has passed the bid you placed"
                        : "What you have placed at the platform. Your ceiling follows it unless you set one apart."
                }
              >
                <span>
                  <InlineText
                    value={myBid ?? ""}
                    placeholder="0.00"
                    inputType="amount"
                    selectOnEdit
                    editable={editable && !terminal}
                    isPending={isPending}
                    onSave={applyMyBid}
                    display={
                      myBid === null ? (
                        <span style={MUTED_AMOUNT}>—</span>
                      ) : (
                        <span style={{ ...AMOUNT, color: mineColor }}>{myBid}</span>
                      )
                    }
                  />
                </span>
              </Tooltip>,
              { onSaveBase: applyMyBid, editable: editable && !terminal }
            )}
            {/* What the lot is worth **bidding** — the `fair` figure, all-in, from recorded results
                where there are any and catalogue × the learned ratio where there are not (#511).
                The figure is the way in to the evidence: the one a collector wants to interrogate
                is the one they are looking at, so it is the thing they click. A lot with nothing
                described has no figure and no panel — a bare dash that says why, and no *Bid this*.
                *Bid this* is always drawn where it can act, never only on hover (#1515). */}
            <span style={RECOMMENDED_CELL}>
              <span style={RECOMMENDATION_CELL}>
                {withBase(
                  recommendedFair,
                  lot.recommendation === null ? (
                    <Tooltip content="Nothing described yet. Say what the lot holds and a recommendation follows.">
                      <span style={MUTED_AMOUNT}>—</span>
                    </Tooltip>
                  ) : (
                    // Opens even with no figure behind it: a described lot nothing could price is
                    // precisely the one whose empty cell needs explaining, and the panel is where
                    // the unanchored lines are counted.
                    <BidRecommendationPopover
                      collectionId={collectionId}
                      lotId={lot.id}
                      currency={lot.currency}
                      onPickLevel={editable && !terminal ? bidLevel : undefined}
                    >
                      {recommendedFair === null ? (
                        <span style={MUTED_AMOUNT}>—</span>
                      ) : (
                        <span style={PROMINENT_AMOUNT}>{recommendedFair}</span>
                      )}
                    </BidRecommendationPopover>
                  )
                )}
              </span>
              {bidThis.level !== null && (
                <Tooltip
                  content={
                    bidThisDone ? "Your bid is already the recommended one" : bidThis.hint
                  }
                >
                  <button
                    type="button"
                    // `aria-disabled`, not `disabled`: a disabled button receives no hover, and the
                    // hint saying why it has nothing to do is the whole point of keeping it drawn.
                    aria-disabled={bidThisDone}
                    onClick={() => {
                      if (!bidThisDone) bidLevel("fair", bidThis.level!);
                    }}
                    style={{
                      ...BID_THIS,
                      ...(bidThisDone
                        ? {
                            cursor: "default",
                            color: "var(--color-text-muted)",
                            borderColor: "var(--color-border)",
                          }
                        : null),
                    }}
                  >
                    Bid this
                  </button>
                </Tooltip>
              )}
            </span>

            <span style={GRID_LABEL}>all-in</span>
            {withBase(
              lot.allIn,
              <Tooltip content="The current bid plus the seller's premium. Shipping is added once, on the sale.">
                <span
                  // The bid line's own colour, muted weight — one block, one verdict.
                  style={{ ...MUTED_AMOUNT, color: auctionColor ?? "var(--color-text-muted)" }}
                >
                  {lot.allIn ?? "—"}
                </span>
              </Tooltip>
            )}
            {/* *My bid*'s **all-in** side, editable for the same reason: naming what you are
                willing to have the lot cost is another way of naming the bid. What is stored is
                still the hammer price. */}
            {withBase(
              myAllIn,
              <Tooltip content="What the bid you placed would cost you. Type a total here to set the bid from it instead.">
                <span>
                  <InlineText
                    value={myAllIn ?? ""}
                    placeholder="0.00"
                    inputType="amount"
                    selectOnEdit
                    editable={editable && !terminal}
                    isPending={isPending}
                    onSave={applyMyAllIn}
                    display={
                      <span style={{ ...MUTED_AMOUNT, color: mineColor ?? "var(--color-text-muted)" }}>
                        {myAllIn ?? "—"}
                      </span>
                    }
                  />
                </span>
              </Tooltip>,
              { onSaveBase: applyMyAllIn, editable: editable && !terminal }
            )}
            {/* The secondary line (#1515): what is left of the recommendation at the current price,
                then the catalogue value — which matters far less than the recommendation and so is
                a note, not a column. The catalogue headroom is in its hover hint, and the catalogue
                is still the way in to the composition editor, one click from the row. */}
            <span style={{ ...RECOMMENDED_NOTE, justifySelf: "start" }}>
              {recommendedHeadroom !== null && (
                <>
                  <Tooltip content="The recommended figure less what this lot costs at the current bid, the seller's premium included. Shipping is added once, on the sale.">
                    <span
                      style={{
                        color:
                          Number(recommendedHeadroom) < 0
                            ? "var(--color-error)"
                            : "var(--color-success)",
                      }}
                    >
                      {Number(recommendedHeadroom) < 0
                        ? `${recommendedHeadroom.replace(/^-/, "")} over`
                        : `${recommendedHeadroom} left`}
                    </span>
                  </Tooltip>
                  {" · "}
                </>
              )}
              {/* A lot marked not stamps (#1624) has no contents to describe and no catalogue
                  value, so the way in to the composition editor gives way to saying so. */}
              {lot.notStamps ? (
                <span>no catalogue value</span>
              ) : (
                <Tooltip
                  content={catalogHint(
                    lot,
                    baseAmounts === "full"
                      ? formatBase(lot.catalogValue, lot.baseRate, lot.baseCurrency)
                      : null
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onEditComposition(lot)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      font: "inherit",
                      color: "inherit",
                    }}
                  >
                    {lot.catalogValue === null ? (
                      <span style={{ color: "var(--color-accent)", textDecoration: "underline" }}>
                        {lot.lineCount === 0 ? "+ contents" : "+ catalog value"}
                      </span>
                    ) : (
                      <>
                        catalogue{" "}
                        <span
                          // The one vocabulary for *inferred, not recorded* (#238): a `~` and italics.
                          style={lot.catalogUncertain ? { fontStyle: "italic" } : undefined}
                        >
                          {lot.catalogUncertain ? "~" : ""}
                          {lot.catalogValue}
                        </span>
                      </>
                    )}
                  </button>
                </Tooltip>
              )}
            </span>

            {/* A ceiling **set apart** from the bid (#1515), under it — the only ceiling the row
                shows, because one that follows the bid is the bid's own all-in, already on screen.
                Amber with *My bid* when the bid costs more than it; editable in place, and cleared
                — blank, or *Clear ceiling* — it follows the bid again. */}
            {maxBid !== null && (
              <>
                <span style={GRID_LABEL}>ceiling</span>
                <span />
                {withBase(
                  maxBid,
                  <Tooltip content="A ceiling set apart from your bid: the most this lot may cost you, all-in. It stays put when the bid changes; clear it and the ceiling follows the bid.">
                    <span>
                      <InlineText
                        value={maxBid}
                        placeholder="0.00"
                        inputType="amount"
                        selectOnEdit
                        editable={editable}
                        isPending={isPending}
                        onSave={applyMaxBid}
                        display={
                          <span
                            style={{
                              ...MUTED_AMOUNT,
                              color: lot.myBidOverCeiling
                                ? "var(--color-warning)"
                                : "var(--color-text-secondary)",
                            }}
                          >
                            {maxBid}
                          </span>
                        }
                      />
                    </span>
                  </Tooltip>,
                  { onSaveBase: applyMaxBid, editable }
                )}
                <span />
              </>
            )}
          </div>

          <Tooltip content={`Closes ${formatInstant(lot.endsAt)}`}>
            {/* Fixed width for the same reason: "in 3 days" and "in 368 days" must not shunt the
                actions button left and right from row to row. */}
            <span
              style={{
                display: "inline-block",
                width: "8.5rem",
                textAlign: "right",
                fontSize: "0.8125rem",
                whiteSpace: "nowrap",
                ...CLOSING_STYLE[urgency],
              }}
            >
              {hasClosed ? "closed " : "closes "}
              {formatRelative(lot.endsAt, now)}
            </span>
          </Tooltip>
          {/* The busiest menu of the set on the densest row, so the promotion is **two** icons and
              they are the watchlist pass itself: check the listing, then either type the new figure
              into the row — already inline, which is why no bid-fill entry is promoted — or say the
              bid has not moved. *Contents* is the row's other outstanding work, the one the
              **Not described** chip is about. Both entries are always present (blocked ones are
              disabled with their hint, #273), so the pair is a constant width and cannot shunt the
              closing time and the ⋮ about from row to row, which is what the fixed widths beside it
              exist to prevent. *Open listing* stays out for the offer row's reason — line 1 already
              carries it as a labelled `Listing` chip — and *Open sale* is the row's own click. */}
          <RowQuickActions
            actions={pickRowActions(actions, ["checked", "contents"])}
            visible={hovered}
          />
          <RowActionsMenu actions={actions} ariaLabel="Lot actions" />
        </div>

        {lot.notes && (
          <p
            style={{
              margin: "0.5rem 0 0",
              fontSize: "0.8125rem",
              color: "var(--color-text-muted)",
              whiteSpace: "pre-wrap",
            }}
          >
            {lot.notes}
          </p>
        )}
      </div>
      {/* Rendered from the row, not the menu — the menu closes on select and the dialog it opened
          has to outlive it — but portaled out of it: an ended row is drawn at `opacity: 0.6`, which
          would otherwise trap a fixed dialog in the row's own stacking context. */}
      {outcome.dialog}
      {separateCeiling.dialog}
      {notStamps.dialog}
    </div>
  );
}
