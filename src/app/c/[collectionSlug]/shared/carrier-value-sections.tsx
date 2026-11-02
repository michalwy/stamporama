"use client";

import { useQuery } from "@tanstack/react-query";
import type { CollectionAreaData } from "@/lib/areas";
import type { CarrierValuationRead, CarrierComponentRead } from "@/lib/carrier-values";
import { faultReductionNote } from "@/lib/fault-reduction";
import { PIECE_PRICE_LABELS } from "@/lib/piece-valuation";
import { pieceValueRule } from "@/lib/piece-value-words";
import { CollapsibleSection } from "./collapsible-section";
import { Dash, Empty, Muted, Warn, numStyle } from "./price-matrix";
import { StampIdentity } from "./stamp-identity";
import { Tooltip } from "./tooltip";
import { useAreaVendorMaps } from "./use-area-vendor-maps";

/**
 * The Valuation window's answer for a **piece** (#2359; ADR-0076) — a cover, a fragment, several
 * stamps on one piece of paper. No one stamp's grid describes it: its value is computed by its
 * valuation method from its stamps' prices. Two sections:
 *
 * - **Value of this piece** — the computed figure, the method and where it came from, the franking,
 *   and the prices it missed. The same figure every total, the offer price prefill and the trade's
 *   own valuation read.
 * - **Its stamps at their used prices** — each stamp at the piece's condition, in its own format,
 *   with no certificate, times its quantity: what *Sum of used* adds up. A stamp with no price is
 *   marked rather than counted as zero.
 *
 * How the value was reached, price by price, is #2353's.
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
  if (!query.data.multiStamp) {
    return (
      <Empty>
        This copy is one stamp on its own, so it is valued from the catalog — open the valuation from
        its stamp.
      </Empty>
    );
  }
  return <CarrierSections data={query.data} collectionId={collectionId} areas={areas} />;
}

function CarrierSections({
  data,
  collectionId,
  areas,
}: {
  data: CarrierValuationRead;
  collectionId: string;
  areas: CollectionAreaData[];
}) {
  const { suggestion } = data;
  const missing = suggestion.unpricedCount + suggestion.unconvertibleCount;

  return (
    <>
      <CollapsibleSection title="Value of this piece" defaultOpen>
        <PieceFigure data={data} areas={areas} />
      </CollapsibleSection>

      <CollapsibleSection title="Its stamps at their used prices" defaultOpen>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Muted>
            Each stamp on the piece at its condition ({data.conditionName}), in its own format and with
            no certificate, times how many of it there are — at the latest catalog edition, in{" "}
            {data.baseCurrency}.
          </Muted>
          <ComponentTable data={data} collectionId={collectionId} areas={areas} />
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <div style={{ ...numStyle, fontWeight: 600 }}>
              {suggestion.totalBaseAmount === null ? (
                <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
                  None of its stamps has a used price.
                </span>
              ) : (
                <>
                  Sum: {suggestion.totalBaseAmount} {data.baseCurrency}
                </>
              )}
            </div>
            {suggestion.partial && suggestion.totalBaseAmount !== null && (
              <span style={{ color: "var(--color-warning)", fontSize: "0.8125rem" }}>
                Partial — {missing} of {data.components.length} stamps{" "}
                {missing === 1 ? "is" : "are"} not in the sum.
              </span>
            )}
          </div>
        </div>
      </CollapsibleSection>
    </>
  );
}

/** The computed value, how it was reached in one line, and what it missed. */
function PieceFigure({ data, areas }: { data: CarrierValuationRead; areas: CollectionAreaData[] }) {
  const value = data.value;
  const piece = value?.piece;
  if (!value || !piece) return null;
  const source =
    piece.methodSource.kind === "copy"
      ? "set on this copy"
      : piece.methodSource.kind === "area"
        ? `from ${areaName(areas, piece.methodSource.areaId)}`
        : "the collection's default";
  // The value modifier (#2357) and the fault reduction (#1560) adjust the computed figure; each is
  // said beside it.
  const modifier = value.valueModifier;
  const reduction = value.faultReduction;
  const computed = modifier ? modifier.fullAmount : reduction ? reduction.fullAmount : value.amount;
  const stampLabel = (componentId: string) => {
    const index = data.components.findIndex((c) => c.id === componentId);
    const entry = data.components[index];
    return entry?.catalogNumbers[0]?.number ?? entry?.stampName ?? `stamp ${index + 1}`;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
        {value.unpriced ? (
          <Muted>No price this method reads is recorded, so the piece is unpriced.</Muted>
        ) : (
          <span style={{ ...numStyle, fontSize: "1.125rem", fontWeight: 600 }}>
            {computed} {value.currency}
          </span>
        )}
        {modifier && !value.unpriced && (
          <span style={{ ...numStyle, color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>
            · modified to {reduction ? reduction.fullAmount : value.amount} {value.currency}
            {modifier.note ? ` (${modifier.note})` : ""}
          </span>
        )}
        {reduction && !value.unpriced && (
          <span style={{ ...numStyle, color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>
            · counted at {value.amount} {value.currency}, {faultReductionNote(reduction.percent)}
          </span>
        )}
      </div>
      <Muted>
        {pieceValueRule(piece)} — method {source}.
      </Muted>
      {piece.missing.length > 0 && (
        <div style={{ color: "var(--color-warning)", fontSize: "0.8125rem" }}>
          Partial — missing:{" "}
          {piece.missing
            .map((m) => `${PIECE_PRICE_LABELS[m.price]} price of ${stampLabel(m.componentId)}`)
            .join(", ")}
          .
        </div>
      )}
    </div>
  );
}

function areaName(areas: CollectionAreaData[], areaId: string): string {
  return areas.find((a) => a.id === areaId)?.name ?? "its area";
}

function ComponentTable({
  data,
  collectionId,
  areas,
}: {
  data: CarrierValuationRead;
  collectionId: string;
  areas: CollectionAreaData[];
}) {
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={TABLE}>
        <thead>
          <tr>
            <th style={TH}>Stamp</th>
            <th style={TH}>Format</th>
            <th style={{ ...TH, textAlign: "right" }}>Qty</th>
            <th style={{ ...TH, textAlign: "right" }}>Each</th>
            <th style={{ ...TH, textAlign: "right" }}>In the sum</th>
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
                <UnitFigure entry={entry} baseCurrency={data.baseCurrency} />
              </td>
              <td style={{ ...TD, ...numStyle, textAlign: "right" }}>
                {entry.share.status === "priced" ? (
                  `${entry.share.lineBaseAmount.toFixed(2)} ${data.baseCurrency}`
                ) : (
                  <Dash />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnitFigure({ entry, baseCurrency }: { entry: CarrierComponentRead; baseCurrency: string }) {
  const { share, valuation } = entry;
  if (share.status === "unpriced") {
    return (
      <Tooltip
        content="No used price for this stamp at the piece's condition, in this format, without a certificate — so it is left out of the sum."
        align="end"
      >
        <span style={{ color: "var(--color-warning)", cursor: "default" }}>no catalog price</span>
      </Tooltip>
    );
  }
  if (share.status === "unconvertible") {
    return (
      <span style={numStyle}>
        {valuation.amount} {valuation.currency}
        <Warn content={`No ${valuation.currency} → ${baseCurrency} rate, so it is left out of the sum.`} />
      </span>
    );
  }
  const figure = `${share.unitBaseAmount.toFixed(2)} ${baseCurrency}`;
  if (!valuation.uncertain) return <span style={numStyle}>{figure}</span>;
  return (
    <Tooltip
      content="The variant of this stamp is not identified, so this is the lowest price among its variants."
      align="end"
    >
      <span style={{ ...numStyle, color: "var(--color-text-muted)", fontStyle: "italic", cursor: "default" }}>
        ~{figure}
      </span>
    </Tooltip>
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
