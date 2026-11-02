"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { catalogLabel } from "@/lib/area-vendor";
import type { CollectionAreaData } from "@/lib/areas";
import type { CarrierValuationRead } from "@/lib/carrier-values";
import { faultReductionNote } from "@/lib/fault-reduction";
import { FRANKINGS, FRANKING_LABELS, isFranking, type Franking } from "@/lib/piece-valuation";
import { onPiecePrice } from "@/lib/piece-value-words";
import type { CopyValuation, PieceValuation } from "@/lib/valuation";
import { valueModifierLabel } from "@/lib/value-modifier";
import { formControl } from "@/app/control-style";
import { useInvalidateInventory } from "../inventory/use-inventory-query";
import { CollapsibleSection } from "./collapsible-section";
import { onPiecePriceHeading, PieceArithmetic, PiecePriceFigure } from "./piece-value-breakdown";
import { Empty, Muted, numStyle } from "./price-matrix";
import { StampIdentity } from "./stamp-identity";
import { useAreaVendorMaps } from "./use-area-vendor-maps";

/**
 * The Valuation window's answer for a **piece** (#2359; ADR-0076) — a cover, a fragment, several
 * stamps on one piece of paper. No one stamp's grid describes it: its value is computed by its
 * valuation method from its stamps' prices. One section, read top to bottom as the value is reached
 * (#2353):
 *
 * - each stamp on the piece with its **used** price and its price **on the piece** — the one the
 *   method reads here (EF, MeF or MiF on a cover, by what is on it; on piece for a fragment), a missing
 *   one marked on its stamp;
 * - the **computed value** with its arithmetic, the method and where it came from, and the franking,
 *   which can be changed here and the value follows;
 * - the copy's **modifier** (#2357) with its note and its **fault reduction** (#1560), ending in the
 *   copy's value — the figure every total, the offer price prefill and the trade's own valuation read.
 */
export function CarrierValueSections({
  collectionId,
  itemId,
  areas,
}: {
  collectionId: string;
  itemId: string;
  areas: CollectionAreaData[];
}) {
  const query = useQuery<CarrierValuationRead>({
    // Under the inventory prefix, so an edit's `invalidateList` re-reads this with the list and its
    // totals — the window and the row it was opened from cannot show two figures.
    queryKey: ["inventory", collectionId, "carrierValuation", itemId] as const,
    queryFn: async () => {
      const { getCarrierValuationAction } = await import("@/app/actions/items");
      return getCarrierValuationAction(itemId);
    },
  });

  if (query.isLoading) return <div style={{ color: "var(--color-text-muted)" }}>Loading value…</div>;
  if (!query.data) return <Empty>The value of this copy could not be read.</Empty>;
  const value = query.data.value;
  if (!query.data.multiStamp || !value?.piece) {
    return (
      <Empty>
        This copy is one stamp on its own, so it is valued from the catalog — open the valuation from
        its stamp.
      </Empty>
    );
  }
  return (
    <CollapsibleSection title="Value of this piece" defaultOpen>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <Muted>
          Each stamp on the piece at its condition ({query.data.conditionName}), with no certificate, at
          the latest catalog edition, in {query.data.baseCurrency}.
        </Muted>
        <StampPriceTable data={query.data} piece={value.piece} collectionId={collectionId} areas={areas} />
        <PieceFigure
          data={query.data}
          value={value}
          piece={value.piece}
          collectionId={collectionId}
          areas={areas}
        />
      </div>
    </CollapsibleSection>
  );
}

/** The computed value, how it was reached, the franking, then the modifier and faults down to the
 *  copy's value. */
function PieceFigure({
  data,
  value,
  piece,
  collectionId,
  areas,
}: {
  data: CarrierValuationRead;
  value: CopyValuation;
  piece: PieceValuation;
  collectionId: string;
  areas: CollectionAreaData[];
}) {
  const maps = useAreaVendorMaps(areas, collectionId);
  const source =
    piece.methodSource.kind === "copy"
      ? "set on this copy"
      : piece.methodSource.kind === "area"
        ? `from ${areaName(areas, piece.methodSource.areaId)}`
        : "the collection's default";
  // The value modifier (#2357) and the fault reduction (#1560) adjust the computed figure, in that
  // order; each is a line of its own under it.
  const modifier = value.valueModifier;
  const reduction = value.faultReduction;
  const computed = modifier ? modifier.fullAmount : reduction ? reduction.fullAmount : value.amount;
  const modified = reduction ? reduction.fullAmount : value.amount;
  const label = (componentId: string) => {
    const index = data.components.findIndex((c) => c.id === componentId);
    const entry = data.components[index];
    if (!entry) return `stamp ${index + 1}`;
    return catalogLabel(
      {
        areaId: entry.areaId,
        issueId: entry.issueId,
        catalogNumbers: entry.catalogNumbers,
        name: entry.stampName,
      },
      maps
    );
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
        <span style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>Computed value</span>
        {value.unpriced ? (
          <Muted>none — no price this method reads is recorded, so the piece is unpriced.</Muted>
        ) : (
          <span style={{ ...numStyle, fontSize: "1.125rem", fontWeight: 600 }}>
            {computed} {value.currency}
            {piece.partial && (
              <span style={{ color: "var(--color-warning)", fontSize: "0.8125rem", fontWeight: 400 }}>
                {" "}
                partial
              </span>
            )}
          </span>
        )}
      </div>
      <PieceArithmetic piece={piece} label={label} methodSource={source} />
      {piece.kind === "on_cover" && (
        <FrankingField collectionId={collectionId} itemId={data.itemId} franking={piece.franking} />
      )}
      {!value.unpriced && (modifier || reduction) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto auto",
            justifyContent: "start",
            columnGap: "1rem",
            rowGap: "0.25rem",
            fontSize: "0.8125rem",
          }}
        >
          {modifier && (
            <>
              <span style={{ color: "var(--color-text-muted)" }}>
                Modifier {valueModifierLabel(modifier, value.currency)}
                {modifier.note ? ` (${modifier.note})` : ""}
              </span>
              <span style={numStyle}>
                {modified} {value.currency}
              </span>
            </>
          )}
          {reduction && (
            <>
              <span style={{ color: "var(--color-text-muted)" }}>
                {faultReductionNote(reduction.percent)}
              </span>
              <span style={numStyle}>
                {value.amount} {value.currency}
              </span>
            </>
          )}
        </div>
      )}
      {!value.unpriced && (
        <div style={{ ...numStyle, fontWeight: 600 }}>
          Value of this copy: {value.amount} {value.currency}
        </div>
      )}
    </div>
  );
}

/** How the cover was franked (#2359), changed here (#2353): the value is re-read with the list. */
function FrankingField({
  collectionId,
  itemId,
  franking,
}: {
  collectionId: string;
  itemId: string;
  franking: Franking;
}) {
  const { invalidateList } = useInvalidateInventory();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem" }}>
      <label htmlFor="valuation-franking">Franking</label>
      <select
        id="valuation-franking"
        value={franking}
        disabled={saving}
        onChange={async (e) => {
          const next = e.target.value;
          if (!isFranking(next)) return;
          setSaving(true);
          setError(null);
          const { setCopyFrankingAction } = await import("@/app/actions/items");
          const r = await setCopyFrankingAction(itemId, next);
          if (r.error) setError(r.error);
          else await invalidateList(collectionId);
          setSaving(false);
        }}
        style={{ ...formControl, padding: "0.15rem 0.4rem", fontSize: "0.8125rem" }}
      >
        {FRANKINGS.map((f) => (
          <option key={f} value={f}>
            {FRANKING_LABELS[f]}
          </option>
        ))}
      </select>
      {error && <span style={{ color: "var(--color-danger)" }}>{error}</span>}
    </div>
  );
}

function areaName(areas: CollectionAreaData[], areaId: string): string {
  return areas.find((a) => a.id === areaId)?.name ?? "its area";
}

function StampPriceTable({
  data,
  piece,
  collectionId,
  areas,
}: {
  data: CarrierValuationRead;
  piece: PieceValuation;
  collectionId: string;
  areas: CollectionAreaData[];
}) {
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const onPiece = onPiecePrice(piece);
  const heading = onPiecePriceHeading(piece);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={TABLE}>
        <thead>
          <tr>
            <th style={TH}>Stamp</th>
            <th style={TH}>Format</th>
            <th style={{ ...TH, textAlign: "right" }}>Qty</th>
            <th style={{ ...TH, textAlign: "right" }}>Used</th>
            {heading && <th style={{ ...TH, textAlign: "right" }}>{heading}</th>}
          </tr>
        </thead>
        <tbody>
          {data.components.map((entry) => (
            <tr key={entry.id}>
              <td style={TD}>
                <StampIdentity
                  stamp={{
                    name: entry.stampName,
                    catalogNumbers: entry.catalogNumbers,
                    colnectId: entry.colnectId,
                    subtype: entry.subtype,
                  }}
                  vendorMap={vendorMapFor(entry.areaId, entry.issueId)}
                  primaryVendorId={primaryVendorByArea.get(entry.areaId ?? "") ?? null}
                  size="small"
                />
              </td>
              <td style={TD}>
                {entry.formatName ?? <span style={{ color: "var(--color-text-muted)" }}>single</span>}
              </td>
              <td style={{ ...TD, ...numStyle, textAlign: "right" }}>×{entry.quantity}</td>
              <td style={{ ...TD, textAlign: "right" }}>
                <PiecePriceFigure piece={piece} componentId={entry.id} price="used" />
              </td>
              {onPiece && (
                <td style={{ ...TD, textAlign: "right" }}>
                  <PiecePriceFigure piece={piece} componentId={entry.id} price={onPiece} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  border: "1px solid var(--color-border)",
  fontSize: "0.8125rem",
};

const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "0.4rem 0.6rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  fontWeight: 500,
};

const TD: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "middle",
};
