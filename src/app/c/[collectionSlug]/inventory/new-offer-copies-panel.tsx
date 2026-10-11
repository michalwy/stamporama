"use client";

import { useMemo, useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { ItemListItem } from "@/lib/items";
import type { LocationData } from "@/lib/locations";
import {
  duplicateStamps,
  newOfferCopiesSummary,
  orderNewOfferCopies,
  type NewOfferCopyOrder,
} from "@/lib/new-offer-copies";
import { offerCostEstimateNotes } from "@/lib/offer-cost";
import { Icon } from "@/app/icons";
import { ROW_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { Segmented } from "@/app/c/[collectionSlug]/shared/segmented";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { CopyCostAside } from "@/app/c/[collectionSlug]/shared/copy-cost-aside";
import { COST_ESTIMATE_STYLE } from "@/app/c/[collectionSlug]/shared/cost-estimate-text";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { InventoryItemRow } from "./inventory-item-row";

// What is going into a new offer (#1793), beside the *New offer* form opened on copies already
// chosen: every copy as a full row, the set's count, catalogue value and cost, the stamps it holds
// twice, and a way to take a copy out before the offer is created.
//
// A doubled stamp is a question about **one set** (the collector, 2026-10-11): packaged one set each,
// the offer is a quantity of singles and no set holds anything twice, so there is nothing to warn of.
//
// The rules — what *the same stamp* means, how the cost is counted, the orders — are the pure
// `new-offer-copies.ts`; this draws them. Removing a copy here only drops it from the offer being
// made: the caller holds what is left, and the Copies list's selection is never touched.

const MUTED = "var(--color-text-muted)";

const LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: MUTED,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const FIGURE: React.CSSProperties = {
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const ORDER_OPTIONS: { value: NewOfferCopyOrder; label: string; title: string }[] = [
  { value: "picked", label: "As picked", title: "The order the copies were picked in." },
  { value: "value", label: "Catalogue value", title: "Highest catalogue value first." },
  { value: "cost", label: "Cost", title: "Highest cost first." },
];

export interface NewOfferCopiesPanelProps {
  collectionId: string;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  /** The copies still going into the offer, in the order they were picked. */
  copies: ItemListItem[];
  /** Whether the copies go in as one set, the only packaging in which a stamp can be doubled. */
  oneSet: boolean;
  /** Takes a copy out of the offer being made. Never offered on the last copy. */
  onRemove: (itemId: string) => void;
  disabled?: boolean;
}

export function NewOfferCopiesPanel({
  collectionId,
  baseCurrency,
  areas,
  locations,
  copies,
  oneSet,
  onRemove,
  disabled = false,
}: NewOfferCopiesPanelProps) {
  const [order, setOrder] = useState<NewOfferCopyOrder>("picked");
  const vendorMaps = useAreaVendorMaps(areas, collectionId);
  const summary = useMemo(() => newOfferCopiesSummary(copies), [copies]);
  const dupes = useMemo(() => duplicateStamps(oneSet ? copies : []), [copies, oneSet]);
  const ordered = useMemo(() => orderNewOfferCopies(copies, order), [copies, order]);
  const lastOne = copies.length <= 1;

  const { catalogue, cost } = summary;
  const catalogueHint = [
    "The copies' catalogue values summed, in the collection currency",
    ...(catalogue.uncertain
      ? ["~ an unknown-variant copy counts at its cheapest variant, so the total is a floor"]
      : []),
    ...(catalogue.unpricedCount > 0
      ? [`${catalogue.unpricedCount} cop${catalogue.unpricedCount === 1 ? "y has" : "ies have"} no catalogue value and ${catalogue.unpricedCount === 1 ? "is" : "are"} left out`]
      : []),
  ].join(" — ");
  const costHint = [
    `What these copies cost you — ${cost.knownCount} costed`,
    ...offerCostEstimateNotes(cost.estimatedCount, cost.unestimated),
    ...(cost.noneCount > 0 ? [`${cost.noneCount} no cost recorded`] : []),
  ].join(" — ");

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {/* The warning on opening (#1793): a stamp in twice is most often an accident, and the rows
          that say so may be below the fold. It follows removals and goes with the last double. */}
      {dupes.doubledStamps > 0 && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.625rem 0.75rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-warning-border)",
            background: "var(--color-warning-soft)",
            color: "var(--color-warning)",
            fontSize: "0.8125rem",
          }}
        >
          <Icon name="warning" size="sm" />
          <span>
            <strong>
              {dupes.doubledStamps === 1
                ? "1 stamp is going in more than once"
                : `${dupes.doubledStamps} stamps are going in more than once`}
            </strong>{" "}
            — {dupes.doubledCopies} copies, marked below.
          </span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-end", gap: "1.5rem", flexWrap: "wrap" }}>
        <SummaryFigure label="Copies" value={String(summary.count)} />
        <Tooltip content={catalogueHint}>
          <SummaryFigure
            label={`Catalogue · ${baseCurrency}`}
            value={catalogue.amount === null ? "—" : `${catalogue.uncertain ? "~" : ""}${catalogue.amount}`}
            note={catalogue.unpricedCount > 0 ? `${catalogue.unpricedCount} unpriced` : undefined}
          />
        </Tooltip>
        <Tooltip content={costHint}>
          <SummaryFigure
            label={`Cost · ${baseCurrency}`}
            value={cost.amount === null ? "—" : `${cost.estimated ? "~" : ""}${cost.amount}`}
            estimated={cost.estimated && cost.amount !== null}
          />
        </Tooltip>
        <div style={{ marginLeft: "auto" }}>
          <Segmented label="Order" value={order} onChange={setOrder} options={ORDER_OPTIONS} />
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          border: "1px solid var(--color-border)",
          borderRadius: "0.5rem",
        }}
      >
        {ordered.map((copy, i) => {
          const sameStamp = dupes.copiesOfSameStamp.get(copy.id);
          const actions: RowAction[] = [
            {
              key: "remove",
              label: "Remove from this offer",
              icon: "remove",
              danger: true,
              disabled: disabled || lastOne,
              hint: lastOne ? "An offer needs at least one copy." : "The Copies list keeps it selected.",
              onSelect: () => onRemove(copy.id),
            },
          ];
          return (
            <InventoryItemRow
              key={copy.id}
              collectionId={collectionId}
              item={copy}
              areas={areas}
              locations={locations}
              baseCurrency={baseCurrency}
              primaryVendorId={copy.areaId ? (vendorMaps.primaryVendorByArea.get(copy.areaId) ?? null) : null}
              vendorMap={vendorMaps.vendorMapFor(copy.areaId, copy.issueId)}
              isLast={i === ordered.length - 1}
              highlight={sameStamp !== undefined}
              highlightTone="warning"
              trailingChips={sameStamp !== undefined ? <SameStampChip count={sameStamp} /> : undefined}
              valueAside={<CopyCostAside copy={copy} baseCurrency={baseCurrency} whole="offer" />}
              actionsOverride={actions}
              promote={["remove"]}
            />
          );
        })}
      </div>
    </div>
  );
}

function SummaryFigure({
  label,
  value,
  note,
  estimated = false,
}: {
  label: string;
  value: string;
  note?: string;
  estimated?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
      <span style={LABEL}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: "0.375rem" }}>
        <span style={{ ...FIGURE, ...(estimated ? COST_ESTIMATE_STYLE : {}) }}>{value}</span>
        {note && <span style={{ fontSize: "0.75rem", color: MUTED }}>{note}</span>}
      </span>
    </div>
  );
}

/** The marker on a copy whose stamp the offer holds more than once (#1793) — the row's tint says
 *  *look again*, the chip says why. */
function SameStampChip({ count }: { count: number }) {
  return (
    <Tooltip content="The same stamp as another copy going into this offer, whatever its condition.">
      <span
        style={{
          ...ROW_CHIP,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          color: "var(--color-warning)",
          borderColor: "var(--color-warning-border)",
          background: "var(--color-warning-soft)",
        }}
      >
        <Icon name="warning" size="xs" /> same stamp ×{count}
      </span>
    </Tooltip>
  );
}
