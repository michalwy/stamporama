"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
import { closingUrgency, isTerminalLotStatus, type ClosingUrgency } from "@/lib/auction-rules";
import type { AuctionLotView } from "./use-auctions-query";
import { BidFreshnessChip, BidStandingChip, LotStatusChip, OverCeilingChip } from "./auction-badges";
import { useLotOutcomeActions } from "./use-lot-outcome-actions";
import { formatAmountInput, formatInstant, formatRelative } from "./auction-format";

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
 */
function auctionBidColor(standing: "leading" | "outbid" | null): string | undefined {
  return standing === "outbid" ? "var(--color-error)" : undefined;
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
 * What the catalogue cell says about itself — the state of the composition, in one line (#353).
 *
 * The gaps are named rather than hidden: a total silently missing half the lot's lines looks like a
 * finished answer, and the collector would bid against it.
 */
function catalogHint(lot: AuctionLotView): string {
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
  return gaps.length > 0 ? `${base} ${gaps.join(", ")}.` : base;
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
  if (lot.title) return lot.title;
  if (lot.derivedTitle) return lot.derivedTitle;
  if (lot.lotNo) return `Lot ${lot.lotNo}`;
  return "Untitled lot";
}

interface AuctionLotRowProps {
  lot: AuctionLotView;
  collectionSlug: string;
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
  isPending: boolean;
  onEdit: (lot: AuctionLotView) => void;
  onDelete: (lot: AuctionLotView) => void;
  onSetBid: (lot: AuctionLotView, value: string) => void;
  onSetMyBid: (lot: AuctionLotView, value: string) => void;
  onSetMaxBid: (lot: AuctionLotView, value: string) => void;
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
}

/**
 * One lot on the flat list: what it is and when it closes, then the three figures a bid is decided
 * from — the current bid, what it actually costs all-in, and the ceiling.
 *
 * The bid and the ceiling are edited **in place** (#351). Refreshing a bid is the daily job and
 * manual by decision (ADR-0021 §8), so it has to cost one click from the list rather than a dialog;
 * committing one stamps `checkedAt`, which is what clears the staleness chip.
 */
export function AuctionLotRow({
  lot,
  collectionSlug,
  now,
  isLast,
  showSale = true,
  showParties = true,
  isPending,
  onEdit,
  onDelete,
  onSetBid,
  onSetMyBid,
  onSetMaxBid,
  onMarkChecked,
  onEditComposition,
  onOutcomeRecorded,
  expanded,
  onToggleExpanded,
}: AuctionLotRowProps) {
  const router = useRouter();
  const outcome = useLotOutcomeActions(lot, onOutcomeRecorded);
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
  const terminal = isTerminalLotStatus(lot.status);
  const urgency = closingUrgency({ status: lot.status, endsAt: new Date(lot.endsAt) }, now);
  // Past tense whenever the moment has passed — a lot still being watched an hour after its close
  // has not "closed" as an outcome, but it certainly does not still *close* in the future.
  const hasClosed = terminal || urgency === "past";
  const saleHref = `/c/${collectionSlug}/auctions/sales/${lot.saleId}`;
  // A settled lot is read-only here: its figures now live on the purchase (#28).
  const editable = !lot.settled;

  const actions: RowAction[] = [
    ...(lot.url
      ? [
          {
            key: "listing",
            label: "Open listing",
            icon: "🔗",
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
            icon: "↗",
            onSelect: () => router.push(saleHref),
          } as RowAction,
        ]
      : []),
    {
      key: "checked",
      label: "Bid unchanged",
      icon: "↻",
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
    {
      key: "bid-ceiling",
      label: "Bid my ceiling",
      icon: "⤒",
      // The ceiling is an all-in figure and a bid box is not, so this places the *hammer* price
      // whose all-in still fits: bidding the ceiling itself would overshoot by the fees.
      disabled: !editable || terminal || lot.bidRoom === null,
      hint:
        lot.maxBid === null
          ? "Set a ceiling first — this bids the most that fits inside it"
          : lot.bidRoom === null
            ? "The seller's fees alone exceed your ceiling"
            : terminal
              ? "This lot has closed"
              : `Records a bid of ${lot.bidRoom} ${lot.currency} — all-in, that is your ceiling`,
      onSelect: () => onSetMyBid(lot, lot.bidRoom ?? ""),
    },
    {
      key: "contents",
      // Readable whether or not anything has been entered — the same entry either way, because
      // "what is in this lot?" is the question in both cases.
      label: lot.lineCount === 0 ? "Describe contents" : `Contents (${lot.lineCount})`,
      icon: "☰",
      onSelect: () => onEditComposition(lot),
    },
    // What became of it (#354), set apart from the bidding entries above: those are what you do
    // *while* a lot runs, these are what you do once it has stopped.
    ...outcome.actions.map((action, idx) =>
      idx === 0 ? { ...action, separatorBefore: true } : action
    ),
    {
      key: "edit",
      label: "Edit",
      icon: "✎",
      separatorBefore: true,
      disabled: !editable,
      hint: lot.settled ? "Settled into a purchase — edit the purchase instead" : undefined,
      onSelect: () => onEdit(lot),
    },
    {
      key: "delete",
      label: "Delete",
      icon: "✕",
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
        style={{
          padding: "0.75rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
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
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Line 1: what the lot is and where to see it */}
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
              {onToggleExpanded && (
                <button
                  type="button"
                  onClick={onToggleExpanded}
                  aria-label={expanded ? "Collapse contents" : "Expand contents"}
                  aria-expanded={expanded}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--color-text-muted)",
                    fontSize: "0.75rem",
                    lineHeight: 1,
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  {expanded ? "▼" : "▶"}
                </button>
              )}
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
                    🔗 Listing
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
                    href={saleHref}
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
              <LotStatusChip status={lot.status} />
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

            </div>
            </div>

          {/* The three figures, as a small grid: each exists **twice**, as the hammer price and as
              what it costs all-in, and reading them in columns is what makes them comparable. The
              stored figure of each pair is the editable one — the auction's bid and yours are
              hammer prices, a ceiling is an all-in valuation — and the other is derived, shown
              muted. The ceiling's derived half is exactly what *Bid my ceiling* would place. */}
          <div
            style={{
              marginLeft: "auto",
              display: "grid",
              // Fixed tracks, not `auto`: every row must line its columns up with the rows above
              // and below it, and content-sized ones make each row its own private table.
              gridTemplateColumns: "3rem 5.5rem 5.5rem 5.5rem 6rem",
              columnGap: "0.5rem",
              rowGap: "0.125rem",
              justifyItems: "end",
              alignItems: "center",
            }}
          >
            <span style={GRID_LABEL}>{lot.currency}</span>
            <span style={GRID_HEAD}>Auction</span>
            <span style={GRID_HEAD}>Mine</span>
            <span style={GRID_HEAD}>Ceiling</span>
            {/* The fourth column is what the lot is *worth*, against the three columns of what it
                costs — the whole reason composition is structured (#353). It sits on the same two
                lines: the catalogue value beside the bids, and the headroom beside the all-ins,
                because headroom is exactly catalogue value less the all-in cost. */}
            <span style={GRID_HEAD}>Catalogue</span>

            <span style={GRID_LABEL}>bid</span>
            {/* What the lot stands at — the one field the daily loop writes. Once a result has been
                recorded (#354) that figure takes the cell instead: it is what the lot actually went
                for, and it is already what the all-in below is computed from, so showing the last
                bid anyone happened to see would put two different prices on one row. */}
            <Tooltip
              content={
                lot.finalPrice !== null
                  ? lot.status === "won"
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
                  inputType="number"
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
                      <span style={{ ...AMOUNT, color: auctionBidColor(lot.standing) }}>
                        {currentBid}
                      </span>
                    )
                  }
                />
              </span>
            </Tooltip>
            {/* What you have placed at the platform. */}
            <Tooltip
              content={
                lot.myBidOverCeiling
                  ? "All-in, the bid you placed costs more than your ceiling"
                  : lot.standing === "leading"
                    ? "Your bid still covers the current price"
                    : lot.standing === "outbid"
                      ? "The price has passed the bid you placed"
                      : "What you have placed at the platform"
              }
            >
              <span>
                <InlineText
                  value={myBid ?? ""}
                  placeholder="0.00"
                  inputType="number"
                  selectOnEdit
                  editable={editable && !terminal}
                  isPending={isPending}
                  onSave={(next) => {
                    setPendingMine({ value: formatAmountInput(next) || null, was: lot.myBid });
                    onSetMyBid(lot, next);
                  }}
                  display={
                    myBid === null ? (
                      <span style={MUTED_AMOUNT}>—</span>
                    ) : (
                      <span style={{ ...AMOUNT, color: myBidColor(lot.standing, lot.myBidOverCeiling) }}>
                        {myBid}
                      </span>
                    )
                  }
                />
              </span>
            </Tooltip>
            {/* Derived: the most that can be bid without the all-in passing the ceiling. */}
            <Tooltip content="The most you can bid with the all-in still inside your ceiling">
              <span style={MUTED_AMOUNT}>{lot.bidRoom ?? "—"}</span>
            </Tooltip>
            {/* Catalogue value of what the lot is described as holding. The cell is the way in to
                the composition editor, so describing a lot is one click from the row that made you
                want to — and an empty one says so rather than showing a bare dash. */}
            <Tooltip content={catalogHint(lot)}>
              <button
                type="button"
                onClick={() => onEditComposition(lot)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "right",
                }}
              >
                {lot.catalogValue === null ? (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--color-accent)",
                      textDecoration: "underline",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {lot.lineCount === 0 ? "+ contents" : "+ catalog value"}
                  </span>
                ) : (
                  <span
                    style={
                      // The one vocabulary for *inferred, not recorded* (#238): a `~` and italics.
                      lot.catalogUncertain
                        ? { ...AMOUNT, color: "var(--color-text-muted)", fontStyle: "italic" }
                        : AMOUNT
                    }
                  >
                    {lot.catalogUncertain ? "~" : ""}
                    {lot.catalogValue}
                  </span>
                )}
              </button>
            </Tooltip>

            <span style={GRID_LABEL}>all-in</span>
            <Tooltip content="The current bid plus the seller's premium. Shipping is added once, on the sale.">
              <span style={{ ...MUTED_AMOUNT, color: lot.overCeiling ? "var(--color-error)" : "var(--color-text-muted)" }}>
                {lot.allIn ?? "—"}
              </span>
            </Tooltip>
            <Tooltip content="What the bid you placed would cost you">
              <span
                style={{
                  ...MUTED_AMOUNT,
                  color: lot.myBidOverCeiling ? "var(--color-warning)" : "var(--color-text-muted)",
                }}
              >
                {lot.myAllIn ?? "—"}
              </span>
            </Tooltip>
            {/* The ceiling itself: an all-in valuation, which is why it is stored on this row. */}
            <Tooltip content="The most this lot is worth to you, all-in">
              <span>
                <InlineText
                  value={maxBid ?? ""}
                  placeholder="0.00"
                  inputType="number"
                  selectOnEdit
                  editable={editable}
                  isPending={isPending}
                  onSave={(next) => {
                    setPendingMax({ value: formatAmountInput(next) || null, was: lot.maxBid });
                    onSetMaxBid(lot, next);
                  }}
                  display={
                    maxBid === null ? (
                      <span style={MUTED_AMOUNT}>—</span>
                    ) : (
                      <span style={AMOUNT}>{maxBid}</span>
                    )
                  }
                />
              </span>
            </Tooltip>
            {/* Headroom: catalogue value less what the lot costs all-in. Green while there is room
                left, red once the price has passed what the contents are worth. */}
            <Tooltip content="Catalogue value less what this lot costs at the current bid, the seller's premium included. Shipping is added once, on the sale.">
              <span
                style={{
                  ...AMOUNT,
                  fontWeight: 500,
                  color:
                    lot.headroom === null
                      ? "var(--color-text-muted)"
                      : Number(lot.headroom) < 0
                        ? "var(--color-error)"
                        : "var(--color-success)",
                }}
              >
                {lot.headroom ?? "—"}
              </span>
            </Tooltip>
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
    </div>
  );
}
