"use client";

import { useEffect, useRef, useState } from "react";
import {
  priceUnder,
  type MarketDot,
  type MarketRow,
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
// Each condition is a **strip of dots**, one per listing, on a logarithmic axis shared by every row of
// the read: a lone 0.01 among prices around 1 € reads as the outlier it is, and many listings at 0.01
// read as what most sellers ask. The lowest price and the median are marked, and stated beside the
// strip with the number of listings. The offer's own condition is the highlighted row.
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

/** How high a strip is, and how far apart stacked dots sit — listings at one price stack upward. */
const STRIP_HEIGHT = 30;
const DOT = 7;
const STACK_STEP = 5;
const MAX_STACK = 4;

const pct = (position: number) => `${(position * 100).toFixed(3)}%`;

function dotTip(dot: MarketDot, currency: string, setsTo: string | null): React.ReactNode {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
      <strong>
        {dot.amount} {currency}
      </strong>
      {dot.converted && <span>Converted{dot.original ? ` from ${dot.original}` : ""}</span>}
      {dot.note && <span>“{dot.note}”</span>}
      {setsTo && <span>Click to price this offer at {setsTo} {currency}</span>}
    </span>
  );
}

function Strip({
  row,
  currency,
  step,
  onApply,
}: {
  row: MarketRow;
  currency: string;
  step: string;
  onApply: ((amount: string) => void) | null;
}) {
  // Listings at one price stack upward rather than hiding one another; past a few, the rest overlap
  // the top dot, and the count beside the strip says how many there are.
  const stacks = new Map<string, number>();
  return (
    <div
      style={{
        position: "relative",
        height: STRIP_HEIGHT,
        borderBottom: "1px solid var(--color-border-strong)",
      }}
    >
      {row.lowestPosition !== null && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: pct(row.lowestPosition),
            bottom: -4,
            height: STRIP_HEIGHT + 4,
            borderLeft: "2px solid var(--color-success)",
          }}
        />
      )}
      {row.medianPosition !== null && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: pct(row.medianPosition),
            bottom: -4,
            height: STRIP_HEIGHT + 4,
            borderLeft: "2px dashed var(--color-text-secondary)",
          }}
        />
      )}
      {row.dots.map((dot, i) => {
        const key = dot.position.toFixed(3);
        const level = stacks.get(key) ?? 0;
        stacks.set(key, level + 1);
        const setsTo = onApply ? priceUnder(dot.amount, step) : null;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: pct(dot.position),
              bottom: 2 + Math.min(level, MAX_STACK) * STACK_STEP,
              transform: "translateX(-50%)",
            }}
          >
            <Tooltip content={dotTip(dot, currency, setsTo)}>
              <button
                type="button"
                aria-label={`${dot.amount} ${currency}`}
                disabled={!onApply}
                onClick={() => setsTo && onApply?.(setsTo)}
                style={{
                  display: "block",
                  width: DOT,
                  height: DOT,
                  padding: 0,
                  borderRadius: "50%",
                  border: dot.converted ? "1px dashed var(--color-text-primary)" : "1px solid var(--color-bg-elevated)",
                  background: "var(--color-accent)",
                  opacity: 0.8,
                  cursor: onApply ? "pointer" : "default",
                }}
              />
            </Tooltip>
          </span>
        );
      })}
    </div>
  );
}

function Figure({
  label,
  amount,
  currency,
  step,
  onApply,
}: {
  label: string;
  amount: string;
  currency: string;
  step: string;
  onApply: ((amount: string) => void) | null;
}) {
  if (!onApply) {
    return (
      <span>
        {label} <span style={{ fontVariantNumeric: "tabular-nums" }}>{amount}</span>
      </span>
    );
  }
  const setsTo = priceUnder(amount, step);
  return (
    <Tooltip content={`Price this offer at ${setsTo} ${currency}`}>
      <span>
        {label}{" "}
        <button type="button" style={FIGURE_BTN} onClick={() => onApply(setsTo)}>
          {amount}
        </button>
      </span>
    </Tooltip>
  );
}

export function OfferColnectMarketCard({
  collectionId,
  offerId,
  market,
  assistantPresent,
  editable,
  onApply,
  onRecorded,
}: {
  collectionId: string;
  offerId: string;
  market: OfferColnectMarket;
  assistantPresent: string | null;
  /** Whether the offer's price may still be changed. */
  editable: boolean;
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
                  gridTemplateColumns: "minmax(10rem, 14rem) minmax(16rem, 1fr) minmax(16rem, auto)",
                  columnGap: "1rem",
                  rowGap: "0.25rem",
                  alignItems: "end",
                }}
              >
                {item.rows.map((row) => (
                  <div
                    key={row.key}
                    style={{
                      display: "contents",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.8125rem",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "0.25rem",
                        background: row.highlighted ? "var(--color-accent-soft)" : undefined,
                        fontWeight: row.highlighted ? 600 : 400,
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {row.name}
                      {row.colnectGrade && <span style={{ ...MUTED, marginLeft: "0.375rem" }}>{row.colnectGrade}</span>}
                    </div>
                    <div
                      style={{
                        padding: "0 0.25rem",
                        borderRadius: "0.25rem",
                        background: row.highlighted ? "var(--color-accent-soft)" : undefined,
                      }}
                    >
                      <Strip row={row} currency={currency} step={step} onApply={apply} />
                    </div>
                    <div
                      style={{
                        fontSize: "0.8125rem",
                        color: "var(--color-text-secondary)",
                        display: "flex",
                        gap: "0.75rem",
                        flexWrap: "wrap",
                        padding: "0.25rem 0",
                      }}
                    >
                      {row.count === 0 ? (
                        <span style={{ color: "var(--color-text-muted)" }}>no offers</span>
                      ) : (
                        <>
                          <Figure label="lowest" amount={row.lowest!} currency={currency} step={step} onApply={apply} />
                          <Figure label="median" amount={row.median!} currency={currency} step={step} onApply={apply} />
                          <span>
                            {row.count} offer{row.count === 1 ? "" : "s"}
                          </span>
                        </>
                      )}
                      {row.ownCount > 0 && (
                        <Tooltip content="Your own Colnect offers in this condition — left out of the strip, so this offer never undercuts itself">
                          <span style={{ color: "var(--color-text-muted)" }}>+{row.ownCount} yours</span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                ))}
                {/* The shared axis, under the last row of each item. */}
                <div />
                <div style={{ position: "relative", height: "1rem" }}>
                  {view.ticks.map((t) => (
                    <span
                      key={t.label}
                      style={{
                        position: "absolute",
                        left: pct(t.position),
                        transform: "translateX(-50%)",
                        ...MUTED,
                        fontSize: "0.6875rem",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {t.label}
                    </span>
                  ))}
                </div>
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
