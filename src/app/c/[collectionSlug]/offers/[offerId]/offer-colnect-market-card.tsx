"use client";

import { useEffect, useRef, useState } from "react";
import {
  axisPosition,
  dotAreaScale,
  dotDiameter,
  dotLegendCounts,
  priceUnder,
  type MarketDotGroup,
  type MarketRow,
  type MarketTick,
  type OfferColnectMarket,
} from "@/lib/colnect-market-rules";
import { recordColnectMarketReadAction } from "@/app/actions/offers";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Icon } from "@/app/icons";
import { assistantHint } from "../assistant-listing";
import { MARKET_ELEMENT_ID, useAssistantMarket } from "../assistant-market-handoff";

// **Colnect market** (#2454) — what Colnect's marketplace asks for this offer's stamps, per
// condition, read by the Assistant on the collector's own Colnect session.
//
// Each condition is a **strip of dots** on a logarithmic axis shared by every row of the read: a lone
// 0.01 among prices around 1 € reads as the outlier it is, and many listings at 0.01 read as what most
// sellers ask. Drawn to be read at a glance (#2464): one dot per price, with the number of listings at
// it beside the dot; the lowest a solid tick, the median a dashed one, both named in a legend; the
// offer's own price an amber line through every row; the scale above and below, with gridlines through
// every row. Beside the strip, lowest · median · offers. The offer's own condition is the highlighted
// row, its lowest price larger and bold (#2463); the other rows' dots, ticks and figures recede to
// neutral grey, so a price is not read from the wrong row (#2469). A receded dot comes back to full
// strength while the pointer is on it. A dot's area follows its number of offers, on a scale worked out
// from the read and shared by every row, the legend showing it (#2473).
//
// A click on a price — a dot, or a figure beside the strip — sets the offer's price that price less
// the platform's step, shown at once as a typed price is (#2413). Whether a price is absurd is the
// collector's call: nothing here filters or suggests.
//
// Nothing is read on its own. **Check Colnect market** starts a read; the card keeps the last one
// until **Refresh** replaces it. Rendered on an offer on Colnect only.

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
};

const BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

const FIGURE_BTN: React.CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  font: "inherit",
  color: "var(--color-accent)",
  cursor: "pointer",
  fontVariantNumeric: "tabular-nums",
};

const MUTED: React.CSSProperties = { fontSize: "0.75rem", color: "var(--color-text-muted)" };

/** The figure the collector prices against — the lowest price in the offer's own condition — is set
 * larger and bold, so it is seen at a glance (#2463). A line height of 1 keeps it within the strip's
 * height, so the row does not grow. */
const LEAD_FIGURE: React.CSSProperties = { fontSize: "1rem", fontWeight: 700, lineHeight: 1 };

/** The offer's own condition row — the one the collector prices from — is one framed strip from its
 * name to its figures (#2495): a frame in the highlight's colour, a little heavier than the card's
 * ordinary lines, round the whole row, and the tint one continuous band inside it, gaps included. The
 * row is a subgrid on the card's three columns, so its cells stay on the same tracks as every other
 * row's and the strip's axis does not move; the frame only adds to the edge columns. Other rows stay
 * bare cells (`display: contents`). */
const OWN_ROW_FRAME: React.CSSProperties = {
  display: "grid",
  gridColumn: "1 / -1",
  gridTemplateColumns: "subgrid",
  border: "2px solid var(--color-accent)",
  borderRadius: "0.375rem",
  background: "var(--color-accent-soft)",
};

/** How high a strip is, and how big a dot, a ring of the card's background around it so neighbouring
 * dots stay apart (#2464). A dot's area follows how many offers it stands for, on the read's own scale
 * (#2473): a single offer is {@link SMALLEST_DOT}, the read's largest group {@link LARGEST_DOT} — never
 * too small to see or click, never so big that it hides its neighbours or outgrows the strip. */
const STRIP_HEIGHT = 28;
const SMALLEST_DOT = 12;
const LARGEST_DOT = 24;

const dotSize = (count: number, largestGroup: number) =>
  dotDiameter(dotAreaScale(count, largestGroup), SMALLEST_DOT, LARGEST_DOT);

/** Room either side of the axis, so a label at either end is not cut off — the strips and both scales
 * share it, so a position means the same place on all of them. */
const AXIS_INSET = "1.25rem";

const pct = (position: number) => `${(position * 100).toFixed(3)}%`;

const SCALE_LABEL: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-secondary)",
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1,
  whiteSpace: "nowrap",
};

/** The marks, one style each, so the legend draws exactly what the strips do. */
const LOWEST_MARK = "2px solid var(--color-success)";
const MEDIAN_MARK = "2px dashed var(--color-text-muted)";
const OWN_PRICE_MARK = "2px solid var(--color-warning)";
/** The same two marks on a row that is not the offer's own condition (#2469). */
const RECEDED_LOWEST_MARK = "1px solid var(--color-text-muted)";
const RECEDED_MEDIAN_MARK = "1px dashed var(--color-text-muted)";

/** Where the offer's own price sits on the axis, and how it is labelled; null with no price. */
interface OwnPriceMark {
  position: number;
  label: string;
}

function dotTip(group: MarketDotGroup, currency: string, setsTo: string | null): React.ReactNode {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
      <strong>
        {group.amount} {currency}
      </strong>
      {group.count > 1 && <span>{group.count} offers at this price</span>}
      {group.converted && (
        <span>Converted{group.originals.length > 0 ? ` from ${[...new Set(group.originals)].join(", ")}` : ""}</span>
      )}
      {group.notes.slice(0, 3).map((note, i) => (
        <span key={i}>“{note}”</span>
      ))}
      {setsTo && <span>Click to price this offer at {setsTo} {currency}</span>}
    </span>
  );
}

/** A vertical mark through a strip or a scale: a gridline, lowest, median or the offer's price. */
function Mark({ position, border, z }: { position: number; border: string; z: number }) {
  return (
    <span
      aria-hidden
      style={{ position: "absolute", left: pct(position), top: 0, bottom: 0, borderLeft: border, transform: "translateX(-50%)", zIndex: z }}
    />
  );
}

/**
 * One price on a strip, as big as the number of offers at it makes it (#2473). A receded dot (#2469)
 * is the same size, drawn grey, and is back to full strength while the pointer is on it. The pointer
 * is watched on the wrapper because a button that is disabled — a closed offer's — fires no mouse
 * events of its own. Where dots overlap, the smaller is drawn on top, so every dot stays visible and
 * clickable.
 */
function Dot({
  group,
  largestGroup,
  receded,
  currency,
  step,
  onApply,
}: {
  group: MarketDotGroup;
  largestGroup: number;
  receded: boolean;
  currency: string;
  step: string;
  onApply: ((amount: string) => void) | null;
}) {
  const [engaged, setEngaged] = useState(false);
  const muted = receded && !engaged;
  const setsTo = onApply ? priceUnder(group.amount, step) : null;
  const size = dotSize(group.count, largestGroup);
  return (
    <span
      onMouseEnter={() => setEngaged(true)}
      onMouseLeave={() => setEngaged(false)}
      onFocus={() => setEngaged(true)}
      onBlur={() => setEngaged(false)}
      style={{
        position: "absolute",
        left: pct(group.position),
        top: "50%",
        transform: "translate(-50%, -50%)",
        // Above the marks (0–3); the fewer offers, the higher, so a small dot is never hidden.
        zIndex: 4 + Math.max(0, largestGroup - group.count),
        display: "block",
      }}
    >
      <Tooltip content={dotTip(group, currency, setsTo)}>
        <button
          type="button"
          aria-label={`${group.amount} ${currency}${group.count > 1 ? `, ${group.count} offers` : ""}`}
          disabled={!onApply}
          onClick={() => setsTo && onApply?.(setsTo)}
          style={{
            display: "grid",
            placeItems: "center",
            width: size,
            height: size,
            padding: 0,
            border: "none",
            background: "none",
            cursor: onApply ? "pointer" : "default",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "block",
              width: size,
              height: size,
              boxSizing: "border-box",
              borderRadius: "50%",
              border: group.converted
                ? `1px dashed var(${muted ? "--color-text-secondary" : "--color-text-primary"})`
                : "none",
              background: muted ? "var(--color-text-muted)" : "var(--color-success)",
              boxShadow: "0 0 0 2px var(--color-bg-elevated)",
            }}
          />
        </button>
      </Tooltip>
      {/* Several offers at one price are one dot with their count beside it. */}
      {group.count > 1 && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: size + 3,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: "0.6875rem",
            fontWeight: muted ? 400 : 700,
            lineHeight: 1,
            color: muted ? "var(--color-text-muted)" : "var(--color-text-primary)",
            background: "var(--color-bg-elevated)",
            borderRadius: "0.25rem",
            padding: "0 0.125rem",
            pointerEvents: "none",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {group.count}
        </span>
      )}
    </span>
  );
}

function Strip({
  row,
  ticks,
  largestGroup,
  ownPrice,
  currency,
  step,
  onApply,
}: {
  row: MarketRow;
  ticks: readonly MarketTick[];
  largestGroup: number;
  ownPrice: OwnPriceMark | null;
  currency: string;
  step: string;
  onApply: ((amount: string) => void) | null;
}) {
  // A row with no offers keeps its line and gridlines, so the rows stay aligned (#2464).
  return (
    <div style={{ position: "relative", height: STRIP_HEIGHT }}>
      {ticks.map((t) => (
        <Mark key={t.label} position={t.position} border="1px solid var(--color-border)" z={0} />
      ))}
      <span
        aria-hidden
        style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: "1px solid var(--color-border-strong)", zIndex: 1 }}
      />
      {row.medianPosition !== null && (
        <Mark position={row.medianPosition} border={row.receded ? RECEDED_MEDIAN_MARK : MEDIAN_MARK} z={2} />
      )}
      {row.lowestPosition !== null && (
        <Mark position={row.lowestPosition} border={row.receded ? RECEDED_LOWEST_MARK : LOWEST_MARK} z={2} />
      )}
      {ownPrice && <Mark position={ownPrice.position} border={OWN_PRICE_MARK} z={3} />}
      {row.groups.map((group) => (
        <Dot
          key={group.amount}
          group={group}
          largestGroup={largestGroup}
          receded={row.receded}
          currency={currency}
          step={step}
          onApply={onApply}
        />
      ))}
    </div>
  );
}

/**
 * The scale, printed above and below the strips (#2464) at a readable size. Above, the offer's own
 * price is labelled over its line, so the line can be read against every row at once.
 */
function Scale({
  ticks,
  ownPrice,
  placement,
}: {
  ticks: readonly MarketTick[];
  ownPrice: OwnPriceMark | null;
  placement: "top" | "bottom";
}) {
  const labelOwn = placement === "top" && ownPrice;
  return (
    <div style={{ padding: `0 ${AXIS_INSET}` }}>
      {labelOwn && (
        <div style={{ position: "relative", height: "1.125rem" }}>
          <span
            style={{
              ...SCALE_LABEL,
              position: "absolute",
              left: pct(ownPrice.position),
              // The label's anchor slides with the line, so it never runs off either end.
              transform: `translateX(-${(ownPrice.position * 100).toFixed(1)}%)`,
              color: "var(--color-warning)",
              fontWeight: 700,
            }}
          >
            {ownPrice.label}
          </span>
        </div>
      )}
      <div style={{ position: "relative", height: "1rem" }}>
        {ticks.map((t) => (
          <span
            key={t.label}
            style={{
              ...SCALE_LABEL,
              position: "absolute",
              left: pct(t.position),
              top: placement === "top" ? 0 : 3,
              transform: "translateX(-50%)",
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
      <span aria-hidden style={{ display: "inline-flex", alignItems: "center", height: 14 }}>
        {swatch}
      </span>
      {label}
    </span>
  );
}

/** A legend dot of `count` offers, drawn at the size a strip draws it, its count beside it. */
function LegendDot({ count, largestGroup }: { count: number; largestGroup: number }) {
  const size = dotSize(count, largestGroup);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span
        style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: "var(--color-success)" }}
      />
      <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
        {count}
      </span>
    </span>
  );
}

/** What each mark on the strips means (#2464) — the dot sizes this read's (#2473): one offer, about
 * half the largest group and the largest group — and the offer's price only when it has one. */
function Legend({ withOwnPrice, largestGroup }: { withOwnPrice: boolean; largestGroup: number }) {
  const tick = (border: string) => <span style={{ display: "inline-block", height: 14, borderLeft: border }} />;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.375rem 1.25rem",
        fontSize: "0.75rem",
        color: "var(--color-text-secondary)",
      }}
    >
      <LegendItem
        swatch={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
            {dotLegendCounts(largestGroup).map((count) => (
              <LegendDot key={count} count={count} largestGroup={largestGroup} />
            ))}
          </span>
        }
        label="offers at one price"
      />
      <LegendItem swatch={tick(LOWEST_MARK)} label="lowest" />
      <LegendItem swatch={tick(MEDIAN_MARK)} label="median" />
      {withOwnPrice && <LegendItem swatch={tick(OWN_PRICE_MARK)} label="your price" />}
    </div>
  );
}

function Figure({
  amount,
  currency,
  step,
  onApply,
  lead = false,
  receded = false,
}: {
  amount: string;
  currency: string;
  step: string;
  onApply: ((amount: string) => void) | null;
  /** The lowest price of the offer's own condition, set larger and bold (#2463). */
  lead?: boolean;
  /** A condition other than the offer's own, muted so it is not read as the offer's (#2469). */
  receded?: boolean;
}) {
  const emphasis = lead ? LEAD_FIGURE : undefined;
  const tone = receded ? { color: "var(--color-text-muted)" } : undefined;
  if (!onApply) {
    return <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)", ...tone, ...emphasis }}>{amount}</span>;
  }
  const setsTo = priceUnder(amount, step);
  return (
    <Tooltip content={`Price this offer at ${setsTo} ${currency}`}>
      <button type="button" style={{ ...FIGURE_BTN, ...tone, ...emphasis }} onClick={() => onApply(setsTo)}>
        {amount}
      </button>
    </Tooltip>
  );
}

const DOT_SEP = <span style={{ color: "var(--color-text-muted)" }}>·</span>;

export function OfferColnectMarketCard({
  collectionId,
  offerId,
  market,
  assistantPresent,
  editable,
  ownPrice,
  onApply,
  onRecorded,
}: {
  collectionId: string;
  offerId: string;
  market: OfferColnectMarket;
  assistantPresent: string | null;
  /** Whether the offer's price may still be changed. */
  editable: boolean;
  /** The offer's own price — what the seller states — or null while it has none (#2464). */
  ownPrice: string | null;
  /** Set the offer's price — the same write a typed price makes. */
  onApply: (amount: string) => void;
  /** A read was kept: re-read the offer. */
  onRecorded: () => void;
}) {
  const { handoff, nodeRef, start, dismiss } = useAssistantMarket();
  const [error, setError] = useState<string | null>(null);
  const recorded = useRef<string | null>(null);

  // A finished read is recorded by this screen — the extension reads, the instance keeps (#407).
  useEffect(() => {
    if (!handoff || handoff.state !== "done" || recorded.current === handoff.requestId) return;
    recorded.current = handoff.requestId;
    void recordColnectMarketReadAction(offerId, handoff.result).then((result) => {
      if (result.status === "success") {
        setError(null);
        onRecorded();
        dismiss();
      } else {
        setError(result.message);
        dismiss();
      }
    });
  }, [handoff, offerId, onRecorded, dismiss]);

  const running = handoff?.state === "running" || handoff?.state === "done";
  const failure = handoff?.state === "error" ? handoff.message : error;
  const noItems = market.targets.length === 0;
  const hint = noItems
    ? "No stamp of this offer is linked to Colnect yet — link them in the items list below"
    : assistantHint({ blockerCount: 0, present: assistantPresent, busy: false, act: "read Colnect's market" });
  const apply = editable ? onApply : null;
  const { view, currency, step } = market;
  const placed = axisPosition(view.axis, ownPrice);
  const ownMark: OwnPriceMark | null = placed && {
    position: placed.position,
    label:
      placed.outside === "below"
        ? `← your price ${ownPrice} ${currency}`
        : placed.outside === "above"
          ? `your price ${ownPrice} ${currency} →`
          : `your price ${ownPrice} ${currency}`,
  };

  function check() {
    setError(null);
    start({
      offerId,
      collectionId,
      items: market.targets.map((t) => ({ colnectId: t.colnectId, label: t.label })),
    });
  }

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Colnect market
        </h3>
        {market.readAt && (
          <span style={MUTED}>
            read {new Date(market.readAt).toISOString().slice(0, 16).replace("T", " ")}
          </span>
        )}
        <Tooltip
          content={
            hint ??
            "The Assistant reads every condition's listings of this offer's stamps on Colnect, in your own Colnect session"
          }
        >
          <button
            type="button"
            onClick={check}
            disabled={hint !== null || running}
            style={{ ...BTN, opacity: hint !== null || running ? 0.55 : 1, cursor: hint || running ? "default" : "pointer" }}
          >
            <Icon name={market.readAt ? "refresh" : "assistant"} size="sm" />
            {running ? "Reading Colnect…" : market.readAt ? "Refresh" : "Check Colnect market"}
          </button>
        </Tooltip>
        {editable && market.readAt && (
          <span style={MUTED}>
            Click a price to price this offer {step} {currency} under it.
          </span>
        )}
      </div>

      {failure && <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-error)" }}>{failure}</p>}

      {market.readAt && !view.anyListings && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          No offers on Colnect for {view.items.length === 1 ? "this stamp" : "these stamps"}, in any condition.
        </p>
      )}

      {market.readAt && view.anyListings && <Legend withOwnPrice={ownMark !== null} largestGroup={view.largestGroup} />}

      {market.readAt && view.anyListings &&
        view.items.map((item) => (
          <div key={item.colnectId} style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {view.items.length > 1 && (
              <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
                {item.label}
              </div>
            )}
            {item.rows === null ? (
              <span style={MUTED}>Not in the last read — Refresh to read it.</span>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(10rem, 14rem) minmax(16rem, 1fr) minmax(14rem, auto)",
                  columnGap: "1rem",
                  rowGap: "0.125rem",
                  alignItems: "center",
                }}
              >
                {/* The scale above the strips, the offer's price labelled over it, and the figures'
                    heading. */}
                <div />
                <Scale ticks={view.ticks} ownPrice={ownMark} placement="top" />
                <div style={{ ...MUTED, alignSelf: "end" }}>lowest · median · offers</div>
                {item.rows.map((row) => (
                  <div key={row.key} style={row.highlighted ? OWN_ROW_FRAME : { display: "contents" }}>
                    <div
                      style={{
                        fontSize: "0.8125rem",
                        padding: "0.25rem 0.5rem",
                        fontWeight: row.highlighted ? 700 : 400,
                        color: "var(--color-text-primary)",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.375rem",
                        alignSelf: "stretch",
                      }}
                    >
                      <span>{row.name}</span>
                      {(row.colnectGrade || row.highlighted) && (
                        <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
                          {row.colnectGrade && <span style={{ ...MUTED, fontWeight: 400 }}>{row.colnectGrade}</span>}
                          {row.highlighted && (
                            <span style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--color-accent)" }}>
                              this offer
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        padding: `0 ${AXIS_INSET}`,
                        alignSelf: "stretch",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                      }}
                    >
                      <Strip row={row} ticks={view.ticks} largestGroup={view.largestGroup} ownPrice={ownMark} currency={currency} step={step} onApply={apply} />
                    </div>
                    <div
                      style={{
                        fontSize: "0.8125rem",
                        color: row.receded ? "var(--color-text-muted)" : "var(--color-text-secondary)",
                        display: "flex",
                        gap: "0.375rem",
                        flexWrap: "wrap",
                        alignItems: "baseline",
                        padding: "0.25rem 0.5rem",
                        alignSelf: "stretch",
                        alignContent: "center",
                      }}
                    >
                      {row.count === 0 ? (
                        <span style={{ color: "var(--color-text-muted)", ...(row.highlighted ? LEAD_FIGURE : undefined) }}>
                          no offers
                        </span>
                      ) : (
                        <>
                          <Figure
                            amount={row.lowest!}
                            currency={currency}
                            step={step}
                            onApply={apply}
                            lead={row.highlighted}
                            receded={row.receded}
                          />
                          {DOT_SEP}
                          <span>
                            med{" "}
                            <Figure amount={row.median!} currency={currency} step={step} onApply={apply} receded={row.receded} />
                          </span>
                          {DOT_SEP}
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.count}</span>
                        </>
                      )}
                      {row.ownCount > 0 && (
                        <Tooltip content="Your own Colnect offers in this condition — left out of the strip, so this offer never undercuts itself">
                          <span style={{ color: "var(--color-text-muted)", marginLeft: "0.375rem" }}>+{row.ownCount} yours</span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                ))}
                {/* The same scale again under the last row. */}
                <div />
                <Scale ticks={view.ticks} ownPrice={ownMark} placement="bottom" />
                <div style={MUTED}>{currency}</div>
              </div>
            )}
            {item.rows !== null && (item.lots > 0 || item.unreadable > 0 || item.truncated) && (
              <span style={MUTED}>
                {[
                  item.lots > 0 && `${item.lots} lot${item.lots === 1 ? "" : "s"} of several stamps left out`,
                  item.unreadable > 0 && `${item.unreadable} listing${item.unreadable === 1 ? "" : "s"} without a readable price`,
                  item.truncated && "only the first pages were read",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
        ))}

      {!market.readAt && !failure && (
        <span style={MUTED}>
          {noItems
            ? "Link this offer's stamps to Colnect to read what their market asks."
            : "Not read yet. The Assistant reads each condition's listings, cheapest first, and the strips show where they sit."}
        </span>
      )}

      {/* The handoff node (#2454), read and answered by the Assistant. */}
      {handoff && (
        <div ref={nodeRef} id={MARKET_ELEMENT_ID} hidden>
          {handoff.payload}
        </div>
      )}
    </div>
  );
}
