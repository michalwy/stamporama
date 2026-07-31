"use client";

import { useState } from "react";
import { formatIssuedDate } from "@/app/stamp-display";
import type { AuctionLotLineItem } from "@/lib/auction-lines";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import {
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
  PRICE_MAIN,
  PRICE_CONVERTED,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { CatalogNumberChip } from "@/app/c/[collectionSlug]/shared/catalog-number-chip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  ColnectChip,
  colnectSearchQueryFor,
} from "@/app/c/[collectionSlug]/shared/colnect-chip";
import { SubtypeChip } from "@/app/c/[collectionSlug]/shared/subtype-chip";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";

// One composition line, in the **same visual language as a copy row** (`InventoryItemRow`): photo
// on the left, then name, area + date + issue, catalog chips beside the value, and the condition
// line at the foot. A collector reading a parcel screen is reading stamps, and they should read the
// same wherever they are.
//
// It is deliberately **not** `InventoryItemRow` itself. A line is a stamp the lot is *described* as
// holding, not a copy that exists: there is no internal copy number, no location, no disposition, no
// delivery state and no cost basis, because nothing has been bought yet. Rendering it through the
// copy row would print `#00000` and four empty slots and call that consistency. What a line has and
// a copy does not is **quantity**, which is the last chip on the condition line.

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

const META: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

const META_INLINE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
  flexShrink: 0,
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
  maxWidth: "20rem",
  flexShrink: 0,
};

/**
 * The line's catalogue value, rendered the way a copy's is (#244 vocabulary): the figure that
 * counts as the emphasised primary, the per-unit price as a muted secondary when the line holds
 * more than one, `~` + muted italics when the value is a lowest-variant estimate (#238), and a
 * **+ catalog value** link in the price slot when nothing is priced — never a `⋮` entry, because
 * pricing belongs where the price is (#228, #341).
 */
function LineValue({
  line,
  onSetPrice,
}: {
  line: AuctionLotLineItem;
  onSetPrice?: () => void;
}) {
  if (line.unpriced) {
    if (onSetPrice) {
      return (
        <Tooltip content="No catalogue price for this stamp at that condition and format — set one without leaving the lot">
          <button
            type="button"
            onClick={onSetPrice}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--color-accent)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            + catalog value
          </button>
        </Tooltip>
      );
    }
    return (
      <Tooltip content="No catalogue price recorded for this condition and format.">
        <span style={{ ...META, fontVariantNumeric: "tabular-nums" }}>—</span>
      </Tooltip>
    );
  }
  if (line.unconvertible) {
    return (
      <Tooltip content={`This stamp is priced, but there is no rate into ${line.currency}.`}>
        <span style={{ ...META, fontVariantNumeric: "tabular-nums" }}>n/a</span>
      </Tooltip>
    );
  }

  const inner = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "0.35rem",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {line.uncertain && <span style={{ ...PRICE_MAIN, color: "var(--color-text-muted)" }}>~</span>}
      {/* Only worth showing when it differs from the line's own figure. */}
      {line.quantity > 1 && (
        <span style={PRICE_CONVERTED}>
          {line.quantity} × {line.unitValue}
        </span>
      )}
      <span
        style={
          line.uncertain
            ? { ...PRICE_MAIN, color: "var(--color-text-muted)", fontStyle: "italic" }
            : PRICE_MAIN
        }
      >
        {line.lineValue} {line.currency}
      </span>
    </span>
  );
  const title = line.uncertain
    ? "Estimated from the cheapest variant of this stamp — which one the lot holds is not recorded."
    : `Catalogue value, in the sale's currency`;
  if (onSetPrice) {
    return (
      <Tooltip content={`${title} — click to edit`} align="end">
        <button
          type="button"
          onClick={onSetPrice}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textDecoration: "underline dotted",
            textUnderlineOffset: "0.2em",
          }}
        >
          {inner}
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={title} align="end">
      {inner}
    </Tooltip>
  );
}

export function AuctionLotLineRow({
  collectionId,
  line,
  areas,
  primaryVendorId,
  vendorMap,
  isLast,
  readOnly = false,
  onSetPrice,
  onEdit,
  onDelete,
}: {
  collectionId: string;
  line: AuctionLotLineItem;
  areas: CollectionAreaData[];
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  isLast: boolean;
  /** Hides the row's ⋮ menu. Set on a settled lot, whose composition is history (#28), and in the
   * parcel-wide flat view, where the line's own card — and so the edit form — is not on screen.
   * It does **not** suppress the price slot: `onSetPrice` decides that, because quick-adding a
   * catalogue value opens a dialog and works from anywhere. */
  readOnly?: boolean;
  onSetPrice?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const primaryCN = primaryVendorId
    ? (line.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null)
    : null;
  const secondaryCNs = line.catalogNumbers.filter((cn) => cn.catalogVendorId !== primaryVendorId);
  const hasCatalog = line.catalogNumbers.length > 0;

  const areaPath = buildAreaPath(areas, line.areaId);
  const dateStr = formatIssuedDate(line.issuedDay, line.issuedMonth, line.issuedYear);
  const hasIssue = !!(line.issueName || line.issueYear);

  const actions: RowAction[] = [
    { key: "edit", label: "Edit line", icon: "✎", onSelect: () => onEdit?.() },
    {
      key: "delete",
      label: "Remove from lot",
      icon: "✕",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete?.(),
    },
  ];
  const menu = readOnly ? null : <RowActionsMenu actions={actions} ariaLabel="Line actions" />;

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: "0.75rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}
      >
        <PhotoThumb collectionId={collectionId} photos={line.photos} reserveWhenEmpty size="5.5rem" />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Line 1: stamp name + actions */}
          {line.stampName && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span
                style={{
                  flex: 1,
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {line.stampName}
              </span>
              {menu}
            </div>
          )}

          {/* Line 2: area path, issue date, issue */}
          {(areaPath || dateStr || hasIssue || !line.stampName) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginTop: line.stampName ? "0.2rem" : undefined,
              }}
            >
              {areaPath && <span style={AREA_CHIP}>{areaPath}</span>}
              {(dateStr || hasIssue) && (
                <span style={META_INLINE}>
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
              {!line.stampName && <span style={{ flex: 1 }} />}
              {!line.stampName && menu}
            </div>
          )}

          {/* Line 3: catalog numbers + catalogue value */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              marginTop: "0.6rem",
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
            <ColnectChip
              colnectId={line.colnectId}
              searchQuery={colnectSearchQueryFor(primaryCN ?? secondaryCNs[0], vendorMap)}
            />
            <SubtypeChip subtype={line.subtype} />
            {!hasCatalog && !line.stampName && (
              <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>(stamp)</span>
            )}
            {line.unknownVariant && (
              <Tooltip content="The line points at the base stamp: which variant the lot holds is not recorded, so the value is the cheapest of them.">
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
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline" }}>
              <LineValue line={line} onSetPrice={onSetPrice} />
            </span>
          </div>

          {/* Line 4: condition, format, quantity — what a copy row carries here, minus everything
              that only exists once the piece is actually owned. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginTop: "0.6rem",
              flexWrap: "wrap",
            }}
          >
            <Tooltip content={line.conditionName}>
              <span style={CHIP}>{line.conditionAbbreviation}</span>
            </Tooltip>
            {/* No certificate is the unmarked default (ADR-0006 §2) and renders nothing — most
                material carries none, and chipping it would badge nearly every line. */}
            {line.certificateStatusAbbreviation && (
              <Tooltip content={`Certificate: ${line.certificateStatusName}`}>
                <span style={CHIP}>{line.certificateStatusAbbreviation}</span>
              </Tooltip>
            )}
            {/* A single is the unmarked default and renders nothing (ADR-0020) — there is no such
                dictionary row, and labelling most of a list "single" is noise. */}
            {line.formatAbbreviation && (
              <Tooltip content={line.formatName ?? ""}>
                <span style={CHIP}>{line.formatAbbreviation}</span>
              </Tooltip>
            )}
            {/* Likewise: one of something is the default, so only a real multiple is chipped. */}
            {line.quantity > 1 && (
              <Tooltip content="How many of this stamp, at this condition and format, the lot holds">
                <span style={{ ...CHIP, fontVariantNumeric: "tabular-nums" }}>×{line.quantity}</span>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
