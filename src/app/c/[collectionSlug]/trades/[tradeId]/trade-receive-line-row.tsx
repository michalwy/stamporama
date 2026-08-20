"use client";

import { useState } from "react";
import { formatIssuedDate } from "@/app/stamp-display";
import type { CollectionAreaData } from "@/lib/areas";
import type { TradeReceiveLineData } from "@/lib/trade-lines";
import {
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { CatalogNumberChip } from "@/app/c/[collectionSlug]/shared/catalog-number-chip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { CopyValue } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { SubtypeChip } from "@/app/c/[collectionSlug]/shared/subtype-chip";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import type { AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";

// One line of the **receive** side (#637), in the same visual language as the auction composition
// line — catalog chips, the stamp's name, where and when it is from, then the condition line.
//
// It is deliberately **not** `InventoryItemRow`, for the reason an auction line is not: the partner's
// stamps are in nobody's inventory, so there is no copy number, no location, no disposition, no
// delivery state and no cost basis. Rendering it through the copy row would print `#00000` and five
// empty slots and call that consistency. What it has and a copy does not is **quantity**.
//
// What it *does* share is the **thumbnail**, in the same reserved 5.5rem column the copy row uses,
// so the two sides of a section line up and both read as stamps rather than as a list beside a
// table. The picture is the collection's own of that stamp — the partner has photographed nothing —
// which is why it is often missing here, and why the column is reserved anyway: rows whose text
// jumps left and right by 5.5rem are harder to read down than a few empty slots.
//
// The give side is the other way round and *is* rendered through `InventoryItemRow`: a give line
// names a copy that exists, with all of that.

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

const META_INLINE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

const AREA_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "16rem",
  flexShrink: 0,
};

export function TradeReceiveLineRow({
  collectionId,
  line,
  areas,
  vendorMaps,
  isLast,
  baseCurrency,
  editable,
  onEdit,
  onEditValue,
  onSetCatalogPrice,
  onRemove,
}: {
  /** For the collection-scoped photo route. */
  collectionId: string;
  line: TradeReceiveLineData;
  areas: CollectionAreaData[];
  vendorMaps: AreaVendorMaps;
  isLast: boolean;
  baseCurrency: string;
  editable: boolean;
  onEdit: () => void;
  /** The line's value (#638): a figure of the collector's own, and which publisher this one line is
   *  read in. Separate from *Edit line*, which is about **what** is coming — the stamp, the
   *  condition, how many — where this is about what it is worth. */
  onEditValue: () => void;
  /** Price this stamp on the primary catalogue without leaving the trade (#638), the affordance the
   *  purchase-order intake row already carries. Absent on a locked list — but note this writes a
   *  price on the **stamp**, not on the trade, which is why it is offered at all: a receive line
   *  routinely names material from an area the collection has never touched, and the collector is
   *  standing there with the partner's list and a catalogue open. */
  onSetCatalogPrice?: () => void;
  onRemove: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const primaryVendorId = line.areaId
    ? (vendorMaps.primaryVendorByArea.get(line.areaId) ?? null)
    : null;
  const vendorMap = vendorMaps.vendorMapFor(line.areaId, line.issueId);
  const primaryCN = primaryVendorId
    ? (line.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null)
    : null;
  const secondaryCNs = line.catalogNumbers.filter(
    (cn) => cn.catalogVendorId !== primaryVendorId
  );

  const areaPath = buildAreaPath(areas, line.areaId);
  const dateStr = formatIssuedDate(line.issuedDay, line.issuedMonth, line.issuedYear);
  const hasIssue = !!(line.issueName || line.issueYear);

  const actions: RowAction[] = [
    { key: "edit", label: "Edit line", icon: "edit", onSelect: onEdit },
    {
      key: "value",
      label: "Set value",
      icon: "prices",
      hint: "A figure of my own for this line, and which publisher it is read in.",
      onSelect: onEditValue,
    },
    {
      key: "remove",
      label: "Remove from trade",
      icon: "remove",
      danger: true,
      separatorBefore: true,
      onSelect: onRemove,
    },
  ];

  const body = (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "0.625rem 0.75rem",
        background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
        transition: "background 0.1s ease",
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        minWidth: 0,
      }}
    >
      <PhotoThumb collectionId={collectionId} photos={line.photos} reserveWhenEmpty size="5.5rem" />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {line.stampName || "(unnamed stamp)"}
          </span>
          {editable && <RowActionsMenu actions={actions} ariaLabel="Line actions" />}
        </div>

        {(areaPath || dateStr || hasIssue) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginTop: "0.2rem",
              minWidth: 0,
            }}
          >
            {areaPath && <span style={AREA_CHIP}>{areaPath}</span>}
            {(dateStr || hasIssue) && (
              <span style={{ ...META_INLINE, overflow: "hidden", textOverflow: "ellipsis" }}>
                {dateStr}
                {dateStr && hasIssue && ", "}
                {hasIssue && (
                  <>
                    {line.issueName ?? "(unnamed issue)"}
                    {line.issueYear ? ` (${line.issueYear})` : ""}
                  </>
                )}
              </span>
            )}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            marginTop: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          {primaryCN && (
            <CatalogNumberChip
              number={primaryCN.number}
              vendor={vendorMap.get(primaryCN.catalogVendorId)}
              style={STAMP_PRIMARY_CHIP}
            />
          )}
          {secondaryCNs.map((cn) => (
            <CatalogNumberChip
              key={cn.catalogVendorId}
              number={cn.number}
              vendor={vendorMap.get(cn.catalogVendorId)}
              style={STAMP_SECONDARY_CHIP}
            />
          ))}
          <SubtypeChip subtype={line.subtype} />
          {line.unknownVariant && (
            <Tooltip content="The line points at the base stamp: which variant is coming is not recorded.">
              <span
                style={{
                  ...CHIP,
                  color: "var(--color-warning)",
                  borderColor: "var(--color-warning-border, var(--color-border))",
                }}
              >
                unknown variant
              </span>
            </Tooltip>
          )}
          {/* At the end of the catalogue-number line, which is exactly where `InventoryItemRow` puts
              it — so the two columns of a section carry the figure at the same height and can be
              read across. Per piece; the quantity is chipped on the line below. */}
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline" }}>
            <CopyValue
              value={line.value}
              baseCurrency={baseCurrency}
              onSetPrice={onSetCatalogPrice}
            />
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            marginTop: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <Tooltip content={line.conditionName}>
            <span style={CHIP}>{line.conditionAbbreviation}</span>
          </Tooltip>
          {/* No certificate is the unmarked default (ADR-0006 §2) and draws nothing; so does the
              single (ADR-0020) and so does a quantity of one. Only what was actually said is chipped. */}
          {line.certificateStatusAbbreviation && (
            <Tooltip content={`Certificate: ${line.certificateStatusName}`}>
              <span style={CHIP}>{line.certificateStatusAbbreviation}</span>
            </Tooltip>
          )}
          {line.formatAbbreviation && (
            <Tooltip content={line.formatName ?? ""}>
              <span style={CHIP}>{line.formatAbbreviation}</span>
            </Tooltip>
          )}
          {line.quantity > 1 && (
            <Tooltip content="How many of this stamp, at this condition and format, are coming">
              <span style={{ ...CHIP, fontVariantNumeric: "tabular-nums" }}>×{line.quantity}</span>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>{body}</div>
  );
}
