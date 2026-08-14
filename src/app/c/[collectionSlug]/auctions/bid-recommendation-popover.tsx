"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { MarketConfidenceChip } from "@/app/c/[collectionSlug]/shared/market-confidence-chip";
import { Icon } from "@/app/icons";
import { formatDay } from "./auction-format";
import {
  useAuctionLotBidEvidence,
  type AuctionLotBidEvidenceView,
} from "./use-auctions-query";

// **Why a lot is worth what the recommendation says** (#511; ADR-0029 §8).
//
// The row carries `fair` as a column of its own, in the *worth* half of the grid beside catalogue
// value — two answers to "what is this worth", side by side — and that cell is this panel's
// trigger. Everything that makes the figure *arguable* lives here, one click away:
//
//   - the three levels, each as the all-in valuation and as the hammer bid to type — and each one
//     **clickable**, writing itself into the ceiling. Which level to take is a judgement, so it is
//     made where the evidence for it is on screen rather than from a word in a scanned row.
//   - one row per composition line, saying what anchored it and what the evidence behind it was
//   - for a market anchor: the median with `n`, the span of results and ADR-0022's confidence badge
//   - for a catalogue anchor: **the ratio, the bucket it was learned from, and its `n`** — naming
//     the bucket is the whole point (*"55% — Polska Ludowa, MNH, 1945–1949, n = 6"* can be argued
//     with, *"55%"* cannot)
//   - how many copies of each line are **already held** — evidence, never arithmetic (ADR-0029 §7)
//   - the unanchored and unconvertible line counts, so a partial total never reads as complete
//
// Portalled and fixed-positioned like `RowActionsMenu`, for the same reason: the lists it opens
// over clip their overflow, and an ended row is drawn at `opacity: 0.6`, which would otherwise trap
// a fixed panel in the row's own stacking context.
//
// Nothing here is stored and nothing here is a control. The one figure a collector commits to is
// the ceiling they type or fill, and this is the paperwork behind it.

const PANEL_Z_INDEX = 200;

/**
 * The caret's own track, to the right of the figure (#576).
 *
 * The recommendation column is right-aligned like every other amount on the row, so a caret drawn
 * *in flow* after the figure pushes that figure left by its own width — and only on the rows that
 * have one. The digits then failed to line up with the row above, with the headroom line directly
 * below, and with the cell's own base-currency reading. So the caret is taken **out of flow** and
 * hung in a reserved slot past the right edge, which the cells of that column pad for
 * unconditionally: the track is there whether or not a given row draws anything in it.
 */
export const RECOMMENDATION_CARET_SLOT = "0.95rem";

const PANEL: React.CSSProperties = {
  position: "fixed",
  width: "30rem",
  maxWidth: "calc(100vw - 2rem)",
  padding: "0.75rem 0.875rem",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  boxShadow: "0 8px 24px rgb(0 0 0 / 0.16)",
  display: "flex",
  flexDirection: "column",
  gap: "0.625rem",
};

const HEAD: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
};

const AMOUNT: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
};

const MUTED: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
};

const RULE: React.CSSProperties = {
  height: 1,
  background: "var(--color-border)",
};

/** A percentage as it is read aloud — `55%`, not `0.55`. Rounded to a whole number: the ratio is a
 * median of a handful of results, and a second decimal would state a precision it does not have. */
function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * One of the three levels: what the lot is worth all-in, and the bid that fits inside it.
 *
 * Both, always, for the reason the ceiling cell already shows both (ADR-0029 §5): a recommendation
 * for an all-in valuation is an all-in figure, and a platform's bid box takes a hammer price. A
 * level whose fees alone eat the figure has **no** bid behind it, which is a real answer and reads
 * as one rather than as a zero.
 *
 * The whole row is **one button** that writes this level into the ceiling. Not the two figures
 * separately: they are one figure stated twice, and offering the bid side as its own target would
 * be offering to store a hammer price in an all-in field. `onPick` is absent on a settled lot,
 * where the figures are still worth reading and nothing here may be written.
 */
function LevelRow({
  label,
  hint,
  level,
  emphasis,
  onPick,
}: {
  label: string;
  /** The percentage of `fair` this level was taken at; absent on `fair` itself. */
  hint?: string;
  level: { allIn: string; bid: string | null } | null;
  emphasis?: boolean;
  onPick?: (allIn: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const pickable = level !== null && onPick !== undefined;
  const cells = (
    <>
      <span style={{ ...MUTED, justifySelf: "start", whiteSpace: "nowrap" }}>
        {label}
        {hint && <span style={{ marginLeft: "0.3rem", opacity: 0.75 }}>{hint}</span>}
      </span>
      <span style={emphasis ? AMOUNT : { ...AMOUNT, fontWeight: 500 }}>{level?.allIn ?? "—"}</span>
      <span style={{ ...AMOUNT, fontWeight: 500, color: "var(--color-text-muted)" }}>
        {level?.bid ?? "—"}
      </span>
    </>
  );

  if (!pickable) {
    // Laid out as a plain row, on the same three tracks. `display: contents` is what lets a level be
    // a button in one state and three bare cells in the other without either drawing a grid of its
    // own inside the panel's.
    return <div style={{ display: "contents" }}>{cells}</div>;
  }
  // No `Tooltip` here, deliberately: it wraps its trigger in a span of its own, which would become
  // the grid item and take the subgrid alignment with it. The invitation to click is stated once
  // under the three of them instead, which is where it belongs anyway.
  return (
    <button
      type="button"
      aria-label={`Set the ceiling to the ${label} figure, ${level.allIn}`}
      onClick={() => onPick(level.allIn)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridColumn: "1 / -1",
        gridTemplateColumns: "subgrid",
        alignItems: "baseline",
        justifyItems: "end",
        width: "100%",
        padding: "0.15rem 0.3rem",
        margin: "0 -0.3rem",
        border: "none",
        borderRadius: "0.3rem",
        background: hovered ? "var(--color-bg-row-hover)" : "transparent",
        cursor: "pointer",
        textAlign: "right",
        font: "inherit",
      }}
    >
      {cells}
    </button>
  );
}

/** What a line was anchored on, in one sentence under its name. Market and catalogue read
 * differently on purpose — one is a transaction and the other is a list price times a learned
 * fraction, and a popover whose whole job is traceability must not make them look alike. */
function LineEvidence({
  line,
  baseCurrency,
}: {
  line: AuctionLotBidEvidenceView["lines"][number];
  baseCurrency: string;
}) {
  if (line.market) {
    const span =
      line.market.earliestAt === line.market.latestAt
        ? formatDay(line.market.latestAt)
        : `${formatDay(line.market.earliestAt)} – ${formatDay(line.market.latestAt)}`;
    return (
      <span style={{ ...MUTED, display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
        <span>
          market {line.market.median} {baseCurrency} · {line.market.n} result
          {line.market.n === 1 ? "" : "s"} · {span}
        </span>
        <MarketConfidenceChip badge={line.market.confidence.badge} score={line.market.confidence.score} />
      </span>
    );
  }
  if (line.source === "catalogue" && line.ratio) {
    return (
      <span style={MUTED}>
        catalogue {line.catalogueValue ?? "—"} × {percent(line.ratio.ratio)} —{" "}
        {line.ratio.bucketLabel}
        {line.ratio.n > 0 ? `, n = ${line.ratio.n}` : ", nothing learned yet"}
      </span>
    );
  }
  return (
    <span style={MUTED}>
      nothing recorded and no catalogue price — not counted into the figures above
    </span>
  );
}

/** One composition line: what it is, what anchored it, and what that came to. */
function LineRow({
  line,
  currency,
  baseCurrency,
}: {
  line: AuctionLotBidEvidenceView["lines"][number];
  currency: string;
  baseCurrency: string;
}) {
  const name = line.catalogLabel ?? line.stampName ?? "Unnamed stamp";
  const total = line.anchor === null ? null : (line.anchor * line.quantity).toFixed(2);
  return (
    <div style={{ display: "flex", gap: "0.75rem", alignItems: "baseline" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.375rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {name}
          </span>
          <span style={MUTED}>
            {line.conditionAbbreviation}
            {line.formatAbbreviation ? ` · ${line.formatAbbreviation}` : ""}
            {line.quantity > 1 ? ` · ×${line.quantity}` : ""}
          </span>
          {/* Ownership, stated and never applied (ADR-0029 §7): duplicates are bought deliberately
              for trade, so a system-applied haircut would under-bid exactly the material a
              collector most wants. */}
          {line.owned > 0 && (
            <Tooltip content="Copies of this stamp at this condition you already hold. Shown as evidence — it does not change the figures.">
              <span style={{ ...MUTED, color: "var(--color-accent)" }}>
                you hold {line.owned}
              </span>
            </Tooltip>
          )}
        </div>
        <LineEvidence line={line} baseCurrency={baseCurrency} />
      </div>
      <span
        style={{
          ...AMOUNT,
          fontWeight: 500,
          color: line.unconvertible ? "var(--color-text-muted)" : undefined,
          fontStyle: line.unconvertible ? "italic" : undefined,
        }}
      >
        {line.unconvertible ? `no ${currency} rate` : (total ?? "—")}
      </span>
    </div>
  );
}

/** The counts that keep a partial total honest — the same rule the catalogue cell follows: a total
 * silently missing half a lot's lines looks like a finished answer, and the collector bids against
 * it. */
function gapSentence(recommendation: AuctionLotBidEvidenceView["recommendation"]): string | null {
  const gaps: string[] = [];
  if (recommendation.unanchoredLines > 0) {
    gaps.push(
      `${recommendation.unanchoredLines} line${recommendation.unanchoredLines === 1 ? "" : "s"} with nothing to price ${recommendation.unanchoredLines === 1 ? "it" : "them"} from`
    );
  }
  if (recommendation.unconvertibleLines > 0) {
    gaps.push(`${recommendation.unconvertibleLines} in a currency with no rate`);
  }
  if (gaps.length === 0) return null;
  return `Not counted: ${gaps.join(", ")}.`;
}

interface Position {
  top: number;
  right: number;
}

/**
 * The recommendation cell on the row, and the panel it opens.
 *
 * The trigger is the figure itself — `children` — so the way in is a number that is **already on
 * screen**, not a control that has to be found. It mirrors the catalogue cell beside it exactly:
 * that one is a button into the composition editor, this one a button into the evidence.
 *
 * Rendered for any lot that has been described, **including one where nothing could be anchored** —
 * that is precisely the lot whose recommendation needs explaining, and hiding the explanation
 * exactly where the figure is missing is the mistake #273 is about.
 */
export function BidRecommendationPopover({
  collectionId,
  lotId,
  currency,
  onPickCeiling,
  children,
}: {
  collectionId: string;
  lotId: string;
  /** The sale's currency, for the panel's own heading. */
  currency: string;
  /**
   * Write a level into the lot's ceiling. Omitted on a settled lot, where the figures are still
   * worth reading and nothing may be written — the panel then renders its three levels as plain
   * rows rather than as buttons that would refuse.
   */
  onPickCeiling?: (allIn: string) => void;
  /** What the cell shows: the fair figure, as the row draws its amounts. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Fetched only while open, and left in the cache afterwards: reopening the same lot's evidence
  // during one bidding session should not go back to the server for figures that move with recorded
  // results, not with the minute.
  const evidence = useAuctionLotBidEvidence(collectionId, open ? lotId : null);

  function place() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 4;
    // The panel's height is not known before its lines are, so it is anchored below the trigger and
    // flipped above only when the *bottom half* of the screen could not hold anything useful. The
    // lines section scrolls internally, which is what keeps either placement on screen.
    const below = rect.bottom + gap;
    const room = window.innerHeight - below;
    const flip = room < 240 && rect.top > room;
    setPos({
      top: flip ? gap : below,
      right: Math.max(gap, window.innerWidth - rect.right),
    });
  }

  useEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Capture-phase catches scrolling inside the list containers too.
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  const data = evidence.data ?? null;

  /** Taking a level **closes the panel**: the decision it was opened for has been made, and a panel
   * left standing over the row would hide the ceiling it just wrote. */
  const pick = onPickCeiling
    ? (allIn: string) => {
        onPickCeiling(allIn);
        setOpen(false);
      }
    : undefined;

  return (
    <>
      <Tooltip content="What this lot is worth bidding. Open for the three figures and what each line was priced from.">
        <button
          ref={triggerRef}
          type="button"
          aria-label="Bid recommendation"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          style={{
            position: "relative",
            display: "inline-block",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "right",
          }}
        >
          {children}
          {/* The caret is what says the figure is a way in rather than just a number. Always drawn,
              never revealed on hover: a disclosure the collector has to discover by sweeping the
              row is a disclosure most of them never find. Positioned in the reserved slot beside
              the figure rather than in flow after it (#576), so it costs the figure no width and
              every row's digits land in the same place. */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: "100%",
              top: "50%",
              transform: "translateY(-50%)",
              display: "inline-flex",
              justifyContent: "center",
              width: RECOMMENDATION_CARET_SLOT,
              color: "var(--color-text-muted)",
              lineHeight: 1,
            }}
          >
            <Icon name="caret" size="xs" />
          </span>
        </button>
      </Tooltip>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Bid recommendation"
            style={{ ...PANEL, zIndex: PANEL_Z_INDEX, top: pos.top, right: pos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={HEAD}>What to bid</span>
              <span style={HEAD}>{currency}</span>
            </div>

            {evidence.isLoading && <span style={MUTED}>Working it out…</span>}
            {evidence.isError && (
              <span style={MUTED}>The recommendation could not be worked out just now.</span>
            )}
            {!evidence.isLoading && !evidence.isError && data === null && (
              <span style={MUTED}>
                Nothing described yet. Say what the lot holds and a recommendation follows.
              </span>
            )}

            {data && (
              <>
                {/* The three levels, against the two readings every figure on the ceiling cell
                    already has: what it is worth all-in, and what to type into a bid box. */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    columnGap: "1rem",
                    rowGap: "0.25rem",
                    justifyItems: "end",
                    alignItems: "baseline",
                  }}
                >
                  <span />
                  <span style={HEAD}>all-in</span>
                  <span style={HEAD}>bid</span>
                  <LevelRow
                    label="floor"
                    hint={`${data.band.bidFloorPercent}%`}
                    level={data.recommendation.floor}
                    onPick={pick}
                  />
                  <LevelRow
                    label="fair"
                    level={data.recommendation.fair}
                    emphasis
                    onPick={pick}
                  />
                  <LevelRow
                    label="walk-away"
                    hint={`${data.band.bidCeilingPercent}%`}
                    level={data.recommendation.walkAway}
                    onPick={pick}
                  />
                </div>

                {/* Said once, under all three, rather than as a hint on each: which level to take is
                    one decision, and three copies of the same sentence would read as three. */}
                {pick && data.recommendation.fair !== null && (
                  <span style={MUTED}>Click a figure to make it your ceiling.</span>
                )}

                <div style={RULE} />

                {data.recommendation.fair === null && (
                  <span style={MUTED}>
                    Nothing in this lot could be priced — neither a recorded result nor a catalogue
                    value. There is no figure to recommend, which is not the same as it being worth
                    nothing.
                  </span>
                )}

                {/* One row per line. Scrolls internally: a house lot of forty stamps must not make
                    the panel taller than the screen it is read on. */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    maxHeight: "18rem",
                    overflowY: "auto",
                  }}
                >
                  {data.lines.map((line) => (
                    <LineRow
                      key={line.lineId}
                      line={line}
                      currency={data.currency}
                      baseCurrency={data.baseCurrency}
                    />
                  ))}
                </div>

                {gapSentence(data.recommendation) && (
                  <>
                    <div style={RULE} />
                    <span style={MUTED}>{gapSentence(data.recommendation)}</span>
                  </>
                )}
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
