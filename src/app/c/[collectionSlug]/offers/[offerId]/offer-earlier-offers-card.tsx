"use client";

import Link from "next/link";
import {
  describeOutcome,
  earlierOffersAxes,
  isoDay,
  type EarlierAxesView,
  type EarlierAxis,
  type EarlierAxisDot,
  type EarlierOfferRow,
} from "@/lib/earlier-offers-rules";
import type { PriceZone } from "@/lib/offer-price-table";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { PRICE_ZONE_COLOR } from "./offer-price-table";

// **Earlier offers** (#2521) — what the same stamps were offered and sold for before, as a tab of the
// offer's Pricing panel beside the Colnect market (#2522), so the screen does not grow longer.
//
// **Axes first**: one per platform for the offers in the same condition, this offer's platform first,
// and one greyed axis for every offer in another condition — each tinted in the offer's price zones, as
// *Your price* (#2497) and the Colnect market's axes (#2523) are. Each earlier offer is a dot at its
// price: filled where it sold, at what it sold for; hollow where it was listed and did not sell. The
// offer's own price, once set, is an amber line through every axis. **Then a table**, newest first:
// the offer (a link), its date, platform and condition, the price it was listed at and its outcome.
// Rows in another condition are greyed out. A price — a dot, a listed price, a sold amount — is a link
// that puts it in as the offer's price. Every amount is per set and in the offer's currency.
//
// The tab is not drawn where there are no earlier offers. The panel's tab frames and names it, so the
// card draws neither a border nor a heading.

const STRIP_HEIGHT = 26;
const DOT = 11;
const ZONE_BAND_HEIGHT = 14;
const ZONE_TINT_OPACITY = 0.45;
const LABEL_WIDTH = "7.5rem";
const OWN_PRICE_MARK = "2px solid var(--color-warning)";
const GREYED_OPACITY = 0.5;

const pct = (position: number) => `${(position * 100).toFixed(3)}%`;

const PRICE_LINK: React.CSSProperties = {
  padding: 0,
  background: "none",
  border: "none",
  font: "inherit",
  color: "var(--color-accent)",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
  cursor: "pointer",
  fontVariantNumeric: "tabular-nums",
};

const CELL: React.CSSProperties = { padding: "0.25rem 0.5rem", textAlign: "left", whiteSpace: "nowrap" };
const HEAD: React.CSSProperties = { ...CELL, fontWeight: 500, color: "var(--color-text-muted)" };
const NUM: React.CSSProperties = { ...CELL, textAlign: "right", fontVariantNumeric: "tabular-nums" };

/** The offer an earlier row names — its number, and which of its sets where it had several. */
function offerName(row: Pick<EarlierOfferRow, "offerNo" | "setLabel">): string {
  return row.setLabel ? `#${row.offerNo}, ${row.setLabel}` : `#${row.offerNo}`;
}

function Price({
  amount,
  currency,
  target,
  ownPrice,
  onApply,
}: {
  amount: string;
  currency: string;
  target: string;
  ownPrice: string | null;
  onApply: ((amount: string) => void) | null;
}) {
  // A price that already is the offer's is drawn plain: clicking it would change nothing.
  if (!onApply || ownPrice === amount) return <span style={{ fontVariantNumeric: "tabular-nums" }}>{amount}</span>;
  return (
    <Tooltip content={`Use ${amount} ${currency} as the offer's ${target}`} align="end">
      <button type="button" style={PRICE_LINK} onClick={() => onApply(amount)}>
        {amount}
      </button>
    </Tooltip>
  );
}

function Dot({
  dot,
  row,
  currency,
  target,
  onApply,
}: {
  dot: EarlierAxisDot;
  row: EarlierOfferRow | undefined;
  currency: string;
  target: string;
  onApply: ((amount: string) => void) | null;
}) {
  const tip = (
    <span style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
      <strong>
        {dot.amount} {currency}
      </strong>
      {row && (
        <span>
          {offerName(row)} · {row.platformName} · {isoDay(row.date)}
        </span>
      )}
      {row && <span>{dot.sold ? "Sold for this" : `Listed at this — ${describeOutcome(row.outcome)}`}</span>}
      {onApply && <span>Click to use it as the offer&apos;s {target}</span>}
    </span>
  );
  return (
    <span
      style={{
        position: "absolute",
        left: pct(dot.position),
        top: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: dot.sold ? 5 : 4,
        lineHeight: 0,
      }}
    >
      <Tooltip content={tip}>
        <button
          type="button"
          aria-label={`${offerName(row ?? { offerNo: dot.offerNo, setLabel: null })}: ${dot.sold ? "sold" : "listed"} at ${dot.amount} ${currency}`}
          disabled={!onApply}
          onClick={() => onApply?.(dot.amount)}
          style={{ width: DOT, height: DOT, padding: 0, border: "none", background: "none", cursor: onApply ? "pointer" : "default" }}
        >
          <span
            aria-hidden
            style={{
              display: "block",
              width: DOT,
              height: DOT,
              boxSizing: "border-box",
              borderRadius: "50%",
              border: "2px solid var(--color-accent)",
              background: dot.sold ? "var(--color-accent)" : "var(--color-bg-elevated)",
              boxShadow: "0 0 0 1px var(--color-bg-elevated)",
            }}
          />
        </button>
      </Tooltip>
    </span>
  );
}

function Strip({
  axis,
  view,
  rowsBySet,
  currency,
  target,
  onApply,
}: {
  axis: EarlierAxis;
  view: EarlierAxesView;
  rowsBySet: ReadonlyMap<string, EarlierOfferRow>;
  currency: string;
  target: string;
  onApply: ((amount: string) => void) | null;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", opacity: axis.greyed ? GREYED_OPACITY : 1 }}>
      <span
        style={{
          flex: `0 0 ${LABEL_WIDTH}`,
          fontSize: "0.75rem",
          color: axis.greyed ? "var(--color-text-muted)" : "var(--color-text-secondary)",
          fontWeight: axis.greyed ? 400 : 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {axis.label}
      </span>
      <div style={{ position: "relative", flex: 1, height: STRIP_HEIGHT }}>
        {view.zones.map((zone) => (
          <span
            key={zone.key}
            aria-hidden
            style={{
              position: "absolute",
              left: pct(zone.start),
              width: pct(zone.end - zone.start),
              top: (STRIP_HEIGHT - ZONE_BAND_HEIGHT) / 2,
              height: ZONE_BAND_HEIGHT,
              background: PRICE_ZONE_COLOR[zone.key],
              opacity: ZONE_TINT_OPACITY,
            }}
          />
        ))}
        {view.ticks.map((t) => (
          <span
            key={t.label}
            aria-hidden
            style={{ position: "absolute", left: pct(t.position), top: 0, bottom: 0, borderLeft: "1px solid var(--color-border)" }}
          />
        ))}
        <span
          aria-hidden
          style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: "1px solid var(--color-border-strong)", zIndex: 1 }}
        />
        {view.own && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: pct(view.own.position),
              top: 0,
              bottom: 0,
              borderLeft: OWN_PRICE_MARK,
              transform: "translateX(-50%)",
              zIndex: 3,
            }}
          />
        )}
        {axis.dots.map((dot) => (
          <Dot
            key={dot.setId}
            dot={dot}
            row={rowsBySet.get(dot.setId)}
            currency={currency}
            target={target}
            onApply={onApply}
          />
        ))}
      </div>
    </div>
  );
}

function Scale({ view, currency }: { view: EarlierAxesView; currency: string }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <span style={{ flex: `0 0 ${LABEL_WIDTH}`, fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>{currency}</span>
      <div style={{ position: "relative", flex: 1, height: "1rem" }}>
        {view.ticks.map((t) => (
          <span
            key={t.label}
            style={{
              position: "absolute",
              left: pct(t.position),
              transform: `translateX(-${(t.position * 100).toFixed(1)}%)`,
              fontSize: "0.6875rem",
              color: "var(--color-text-secondary)",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Legend({ view }: { view: EarlierAxesView }) {
  const dot = (filled: boolean) => (
    <span
      style={{
        display: "inline-block",
        width: DOT,
        height: DOT,
        boxSizing: "border-box",
        borderRadius: "50%",
        border: "2px solid var(--color-accent)",
        background: filled ? "var(--color-accent)" : "transparent",
      }}
    />
  );
  const item = (swatch: React.ReactNode, label: string, key: string) => (
    <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
      <span aria-hidden style={{ display: "inline-flex", alignItems: "center", height: 14 }}>
        {swatch}
      </span>
      {label}
    </span>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem 1.25rem", fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
      {item(dot(true), "sold, at what it sold for", "sold")}
      {item(dot(false), "listed, not sold", "listed")}
      {view.own && item(<span style={{ display: "inline-block", height: 14, borderLeft: OWN_PRICE_MARK }} />, "your price", "own")}
      {view.zones.map((zone) =>
        item(
          <span
            style={{
              display: "inline-block",
              width: 14,
              height: 10,
              borderRadius: 2,
              background: PRICE_ZONE_COLOR[zone.key],
              opacity: ZONE_TINT_OPACITY,
            }}
          />,
          zone.label,
          zone.key
        )
      )}
    </div>
  );
}

export function OfferEarlierOffersCard({
  collectionSlug,
  rows,
  platformId,
  currency,
  priceZones,
  ownPrice,
  target,
  editable,
  onApply,
}: {
  collectionSlug: string;
  rows: readonly EarlierOfferRow[];
  platformId: string;
  currency: string;
  /** The offer's price zones (#2497), worked out once for the offer. */
  priceZones: readonly PriceZone[];
  /** The figure the seller states — the mark on every axis, and what a click writes. */
  ownPrice: string | null;
  /** The field a click writes, as the hint names it: "price", or an auction's "starting price". */
  target: string;
  editable: boolean;
  onApply: (amount: string) => void;
}) {
  const view = earlierOffersAxes(rows, platformId, priceZones, ownPrice);
  const rowsBySet = new Map(rows.map((row) => [row.setId, row]));
  const apply = editable ? onApply : null;
  const forSets = rows.some((row) => row.forSet !== null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {view && view.axes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {view.axes.map((axis) => (
            <Strip
              key={axis.key}
              axis={axis}
              view={view}
              rowsBySet={rowsBySet}
              currency={currency}
              target={target}
              onApply={apply}
            />
          ))}
          <Scale view={view} currency={currency} />
          <Legend view={view} />
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.75rem", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <th style={HEAD}>Offer</th>
              {forSets && <th style={HEAD}>For</th>}
              <th style={HEAD}>Date</th>
              <th style={HEAD}>Platform</th>
              <th style={HEAD}>Condition</th>
              <th style={{ ...HEAD, textAlign: "right" }}>Listed at</th>
              <th style={HEAD}>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const sold = row.outcome.kind === "sold" ? row.outcome : null;
              return (
                <tr
                  key={row.setId}
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                    color: row.sameCondition ? "var(--color-text-primary)" : "var(--color-text-muted)",
                    opacity: row.sameCondition ? 1 : 0.75,
                  }}
                >
                  <td style={CELL}>
                    <Link href={`/c/${collectionSlug}/offers/${row.offerId}`} style={{ color: "inherit" }}>
                      {offerName(row)}
                    </Link>
                  </td>
                  {forSets && <td style={CELL}>{row.forSet}</td>}
                  <td style={CELL}>{isoDay(row.date)}</td>
                  <td style={CELL}>{row.platformName}</td>
                  <td style={CELL}>
                    {row.conditionLabel ?? "—"}
                    {!row.sameCondition && (
                      <Tooltip content="Another condition than this offer's — not counted in the Last sale rows">
                        <span style={{ marginLeft: "0.25rem" }}>(other)</span>
                      </Tooltip>
                    )}
                  </td>
                  <td style={NUM}>
                    {row.listed === null ? (
                      <span style={{ color: "var(--color-text-muted)" }}>—</span>
                    ) : (
                      <Price amount={row.listed} currency={currency} target={target} ownPrice={ownPrice} onApply={apply} />
                    )}
                  </td>
                  <td style={CELL}>
                    {sold && sold.amount !== null ? (
                      <span style={{ display: "inline-flex", gap: "0.25rem", alignItems: "baseline" }}>
                        <span style={{ color: row.sameCondition ? "var(--color-success)" : undefined, fontWeight: 600 }}>Sold</span>
                        <Price amount={sold.amount} currency={currency} target={target} ownPrice={ownPrice} onApply={apply} />
                        <span style={{ color: "var(--color-text-muted)" }}>{isoDay(sold.soldAt)}</span>
                      </span>
                    ) : (
                      describeOutcome(row.outcome)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
