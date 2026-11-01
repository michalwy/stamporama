"use client";

import Link from "next/link";
import type { OfferTextStatus, PrepareOffer } from "@/lib/offers";
import type { OfferState } from "@/lib/offer-rules";
import { isPhotoRunBlocker } from "@/lib/offer-photo-readiness";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { CheckCell } from "@/app/c/[collectionSlug]/shared/cell-target";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import { DragGrip, dragStyle, InsertionLine, type DragList } from "@/app/c/[collectionSlug]/shared/reorder-list";
import { OfferStateChip } from "../offer-badges";
import { PreparePriceField, PrepareReadiness, PrepareTitleField } from "../prepare/prepare-offer-parts";

// One lot of a group worked on from its screen (#1863, #2313) — a Facebook post's lot, or a proposal's:
// its photos, its number, its offer (its number and title, both links to it), where it stands, and its `⋮`. While the
// group may still change, its title is edited in place and its price typed into the compact price table,
// with what still stops it from being marked ready (#2031). What only one of the screens has — a post's
// caption, its listing link, its untranslated names — comes in as facts and slots, so the row itself is
// one implementation for both.

const MUTED: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const LINK: React.CSSProperties = { color: "var(--color-accent)" };

const STEP_LINK: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  font: "inherit",
  color: "var(--color-accent)",
  textDecoration: "underline",
  textUnderlineOffset: "0.15em",
  cursor: "pointer",
};

export const LOT_LIST: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0 };

const LOT_ROW_PAD = "0.875rem";

// The tick cell comes first and runs the row's whole height (#2082, as on every list row, #1589), so
// the row itself does not wrap: what follows the cell does, in `LOT_BODY`.
const LOT_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  padding: `${LOT_ROW_PAD} 0`,
  borderBottom: "1px solid var(--color-border)",
};

const LOT_BODY: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  gap: "0.75rem 1.25rem",
};

const LOT_FACTS: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "0.25rem 0.75rem",
  margin: "0.5rem 0 0",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
};

/** One line of the row's facts: a label and what stands against it. */
export interface LotFact {
  key: string;
  label: string;
  value: React.ReactNode;
  /** A warning's colour, for a fact that asks for something to be done. */
  tone?: "warning" | "secondary";
}

const DASH = <span style={MUTED}>—</span>;

/** The lot's price once it is no longer typed in the row: the figure, or a dash. */
export function priceFact(label: string, amount: string | null, currency: string): LotFact {
  return {
    key: "price",
    label,
    value: amount ? (
      <>
        {amount} {currency}
      </>
    ) : (
      DASH
    ),
  };
}

export function stateFact(state: OfferState): LotFact {
  return { key: "state", label: "State", value: <OfferStateChip state={state} /> };
}

/** The sales the lot left on, each a link — a dash until it sells. */
export function saleFact(collectionSlug: string, sales: readonly { id: string; saleNo: number }[]): LotFact {
  return {
    key: "sale",
    label: "Sale",
    value:
      sales.length > 0
        ? sales.map((sale, i) => (
            <span key={sale.id}>
              {i > 0 && ", "}
              <Link href={`/c/${collectionSlug}/sales/${sale.id}`} style={LINK}>
                Sale #{sale.saleNo}
              </Link>
            </span>
          ))
        : DASH,
  };
}

/** Where its title and description stand against their templates (#1983), only when that is worth
 *  saying: out of date, or written by hand. */
export function textFacts(text: OfferTextStatus | null): LotFact[] {
  const marks = text ? [text.outOfDate && "Out of date", text.handWritten && "Written by hand"].filter(Boolean) : [];
  if (!text || marks.length === 0) return [];
  return [{ key: "text", label: "Text", value: marks.join(" · "), tone: text.outOfDate ? "warning" : "secondary" }];
}

/** The lot's offer number, a link to the offer as the title beside it is (#2313, #2324). */
function OfferLink({ href, offerNo }: { href: string; offerNo: number }) {
  return (
    <Link
      href={href}
      aria-label={`Open offer #${offerNo}`}
      style={{ ...LINK, flexShrink: 0, display: "inline-flex", alignItems: "center" }}
    >
      <EntityNoChip entity="offer" no={offerNo} prefix="o" />
    </Link>
  );
}

/** Where a dragged lot lands (#1986) — a list item of its own, since the lots are an `<ol>`. */
export function DropLine() {
  return (
    <li aria-hidden style={{ listStyle: "none" }}>
      <InsertionLine />
    </li>
  );
}

/** What the row's pricing parts are given while the lot is priced in it (#2031). */
export interface LotRowPricing {
  /** The lot as a Prepare row — its price, title and readiness are edited here. */
  prepare: PrepareOffer;
  setPriceInput: (el: HTMLInputElement | null) => void;
  onPriceEnter: () => void;
  /** The lot's price as it is typed, for a group's totals (#2218). */
  onPriceDraft?: (text: string) => void;
  onPriceSaved: (field: "price" | "startingPrice", value: string | null) => void;
  /** The title was saved — the lot is read again, and only it (#2221). */
  onTitleChanged: () => void;
  /** Opens *Fill catalogue values* for this lot (#2220); absent while it has none to type. */
  onFillCatalogue?: () => void;
  /** Opens the lot's covers walk: the photos not yet checked, or every one again (#2114). */
  onCheckCovers: (mode: "unchecked" | "all") => void;
  /** What a Ready lot's row says while its photos are being made again. */
  generatingNote: string;
}

export function GroupLotRow({
  lotNo,
  drag,
  index,
  rowRef,
  collectionSlug,
  lot,
  photos,
  photoStyle,
  caption,
  facts,
  actions,
  select,
  pricing,
}: {
  /** The lot's number in the order drawn — its own, or the one a move just gave it (#1986). */
  lotNo: number;
  /** The lots' drag-to-reorder, null while they keep their order. */
  drag: DragList | null;
  index: number;
  rowRef?: (el: HTMLLIElement | null) => void;
  collectionSlug: string;
  lot: { offerId: string; offerNo: number; title: string; state: OfferState };
  photos: React.ReactNode;
  /** How the photos' cell sits in the row. */
  photoStyle: React.CSSProperties;
  caption?: React.ReactNode | null;
  facts: LotFact[];
  actions: RowAction[];
  /** The lot's tick (#2050), or null for a lot that can no longer be ticked — its cell kept empty so the
   *  photos stay in line. Absent where the screen ticks no lots. */
  select?: { ticked: boolean | null; onToggle: () => void };
  /** Its price, title and readiness edited in the row, while the group may still change. */
  pricing: LotRowPricing | null;
}) {
  const item = drag?.itemProps(index);
  const prepare = pricing?.prepare ?? null;
  const offerHref = `/c/${collectionSlug}/offers/${lot.offerId}`;
  return (
    <li
      {...item}
      ref={(el) => {
        rowRef?.(el);
        item?.ref(el);
      }}
      style={{ ...LOT_ROW, ...dragStyle(drag, index) }}
    >
      {select &&
        (select.ticked !== null ? (
          <CheckCell bleed={{ top: LOT_ROW_PAD, bottom: LOT_ROW_PAD }} style={SELECT_STRIP}>
            <input
              type="checkbox"
              checked={select.ticked}
              onChange={select.onToggle}
              aria-label={`Tick lot ${lotNo}`}
              style={{ cursor: "pointer" }}
            />
          </CheckCell>
        ) : (
          <div aria-hidden style={SELECT_STRIP} />
        ))}
      <div style={{ ...LOT_BODY, ...(select ? {} : { paddingLeft: "0.25rem" }) }}>
        <div style={photoStyle}>{photos}</div>
        <div style={{ flex: "1 1 16rem", minWidth: "16rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
              {drag && (
                <span
                  {...drag.handleProps(index)}
                  style={{ cursor: "grab", display: "inline-flex", verticalAlign: "middle", marginRight: "0.25rem" }}
                >
                  <DragGrip label="Drag to move this lot" />
                </span>
              )}
              <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>Lot {lotNo}</span>
              {!prepare && (
                <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.375rem", marginLeft: "0.5rem" }}>
                  <OfferLink href={offerHref} offerNo={lot.offerNo} />
                  <Link href={offerHref} style={LINK}>
                    {lot.title}
                  </Link>
                </span>
              )}
            </p>
            <RowActionsMenu actions={actions} ariaLabel={`Lot ${lotNo} actions`} />
          </div>
          {/* While the group may still change (#2031): the title, still the link to the offer, edited in
              place from the pencil beside it (#2324) — the price table with the lot's own figure, and,
              while it is being prepared, what still stops it from being marked ready. */}
          {pricing && prepare && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", margin: "0.375rem 0 0" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.375rem", minWidth: 0 }}>
                <OfferLink href={offerHref} offerNo={lot.offerNo} />
                <PrepareTitleField offer={prepare} onChanged={pricing.onTitleChanged} inputWidth="24rem" href={offerHref} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <PreparePriceField
                  ref={(el) => pricing.setPriceInput(el)}
                  offer={prepare}
                  onEnter={pricing.onPriceEnter}
                  onSaved={pricing.onPriceSaved}
                  onDraft={pricing.onPriceDraft}
                  onFillCatalogue={pricing.onFillCatalogue}
                />
              </div>
              {lot.state === "preparing" && (
                <PrepareReadiness offer={prepare} onCheckCovers={() => pricing.onCheckCovers("unchecked")} />
              )}
              {lot.state === "ready" && (
                <ReadyLotPhotos offer={prepare} onCheckCovers={pricing.onCheckCovers} generatingNote={pricing.generatingNote} />
              )}
            </div>
          )}
          <dl style={LOT_FACTS}>
            {facts.map((fact) => (
              <Fact key={fact.key} fact={fact} />
            ))}
          </dl>
        </div>
        {caption && <div style={{ flex: "2 1 22rem", minWidth: "22rem" }}>{caption}</div>}
      </div>
    </li>
  );
}

function Fact({ fact }: { fact: LotFact }) {
  const color =
    fact.tone === "warning" ? "var(--color-warning)" : fact.tone === "secondary" ? "var(--color-text-secondary)" : undefined;
  return (
    <>
      <dt style={MUTED}>{fact.label}</dt>
      <dd style={{ margin: 0, ...(color ? { color } : {}) }}>{fact.value}</dd>
    </>
  );
}

/**
 * A Ready lot's photos (#2114), under its price while its group may still change: its covers walked
 * again — the photos not yet checked while there are any, every one otherwise — and, while its photos
 * are being made again, the screen's note on that. The lot stays Ready.
 */
function ReadyLotPhotos({
  offer,
  onCheckCovers,
  generatingNote,
}: {
  offer: PrepareOffer;
  onCheckCovers: (mode: "unchecked" | "all") => void;
  generatingNote: string;
}) {
  const generating = offer.readyBlockers.some(isPhotoRunBlocker);
  const { covers } = offer;
  const walkable = covers.needed && covers.photoCount + covers.otherCount > 0;
  if (!generating && !walkable) return null;
  return (
    <p style={{ ...MUTED, margin: 0, display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
      {walkable && (
        <Tooltip content="Change the covers on this lot's photos. It stays Ready, and its photos are made again.">
          <button
            type="button"
            onClick={() => onCheckCovers(covers.uncheckedCount > 0 ? "unchecked" : "all")}
            style={STEP_LINK}
          >
            {covers.uncheckedCount > 0 ? `Check covers (${covers.uncheckedCount})` : "Review every photo"}
          </button>
        </Tooltip>
      )}
      {generating && <span>{generatingNote}</span>}
    </p>
  );
}
