"use client";

import { useState, type ReactNode } from "react";
import { formatIssuedDate } from "@/app/stamp-display";
import type { ItemListItem } from "@/lib/items";
import { resolveCostBasis } from "@/lib/cost-basis";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import {
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
  formatStampCN,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { buildLocationPath } from "@/app/c/[collectionSlug]/shared/location-helpers";
import { PhotoStrip } from "./photo-strip";

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

/** A soft-tinted chip so each disposition is visually distinct without being
 * loud: a pale, theme-aware background with colored text and border. */
function dispositionChip(token: string): React.CSSProperties {
  return {
    ...CHIP,
    color: `var(--color-disposition-${token})`,
    borderColor: `var(--color-disposition-${token}-border)`,
    background: `var(--color-disposition-${token}-soft)`,
  };
}

const DISPOSITIONS = [
  { key: "inCollection", label: "In collection", token: "collection" },
  { key: "forSale", label: "For sale", token: "sale" },
  { key: "forTrade", label: "For trade", token: "trade" },
] as const;

const META: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

/** Storage location chip (#56): muted breadcrumb of the location path plus an optional
 * in-location ref, truncated so a deep path doesn't blow out the row. */
const LOCATION_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "18rem",
};

/** Muted breadcrumb chip for the stamp's area path (mirrors the stamps list). */
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

/** Muted date/issue line (mirrors the stamps list). */
const META_INLINE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

/** Catalog valuation of a copy (ADR-0007 §7). Uncertain values (unknown variant, valued
 * at the lowest child price) are prefixed `~` and muted; unpriced copies show `—`;
 * a price in a currency with no base rate falls back to its own currency. */
function CopyValue({
  item,
  baseCurrency,
  onSetPrice,
}: {
  item: ItemListItem;
  baseCurrency: string;
  /** When provided, the value area becomes an inline catalog-price editor (#121): a
   * "+ price" link when unpriced, and a click-to-edit affordance when priced. */
  onSetPrice?: () => void;
}) {
  const v = item.value;
  if (v.unpriced) {
    if (onSetPrice) {
      return (
        <Tooltip content="Set the catalog value for this condition on the primary catalog">
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
      <Tooltip content="No catalog price recorded for this condition.">
        <span style={{ ...META, fontVariantNumeric: "tabular-nums" }}>—</span>
      </Tooltip>
    );
  }
  const converted = v.baseAmountDisplay != null;
  const text = converted
    ? `${v.baseAmountDisplay} ${baseCurrency}`
    : `${v.amount} ${v.currency}`;
  const title = v.uncertain
    ? "Estimated from the lowest child-variant price — the specific variant isn't identified yet."
    : converted
      ? "Catalog value"
      : `Catalog value (no ${baseCurrency} rate available)`;
  const valueStyle: React.CSSProperties = {
    fontSize: "0.875rem",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    color: v.uncertain ? "var(--color-text-muted)" : "var(--color-text-primary)",
    fontStyle: v.uncertain ? "italic" : undefined,
    whiteSpace: "nowrap",
  };
  if (onSetPrice) {
    return (
      <Tooltip content={`${title} — click to edit`} align="end">
        <button
          type="button"
          onClick={onSetPrice}
          style={{
            ...valueStyle,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textDecoration: "underline dotted",
            textUnderlineOffset: "0.2em",
          }}
        >
          {v.uncertain ? "~" : ""}
          {text}
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={title} align="end">
      <span style={valueStyle}>
        {v.uncertain ? "~" : ""}
        {text}
      </span>
    </Tooltip>
  );
}

/** Acquisition cost-basis of a copy (ADR-0009, #123), resolved through the shared
 * `resolveCostBasis` accessor: a frozen base-currency amount, a **pending** marker while
 * the owning lot is still open, or nothing at all for copies with no cost-basis (added by
 * hand, or dropped from a lot). This is the general-purpose read-only surface; the lot
 * intake screen renders its own editable cost chip. */
function CostBasisChip({ item, baseCurrency }: { item: ItemListItem; baseCurrency: string }) {
  const cb = resolveCostBasis(item);
  if (cb.state === "known") {
    return (
      <Tooltip content="What this copy cost you (base currency), frozen when its purchase lot closed.">
        <span style={{ ...CHIP, fontVariantNumeric: "tabular-nums" }}>
          cost {cb.amount} {baseCurrency}
        </span>
      </Tooltip>
    );
  }
  if (cb.state === "pending") {
    return (
      <Tooltip content="Cost-basis is pending — it is frozen when this copy's purchase lot is closed.">
        <span style={{ ...CHIP, color: "var(--color-text-muted)", fontStyle: "italic" }}>
          cost pending
        </span>
      </Tooltip>
    );
  }
  return null;
}

interface InventoryItemRowProps {
  /** Owning collection, for building collection-scoped photo URLs (#112). */
  collectionId: string;
  item: ItemListItem;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  isLast: boolean;
  /** Read-only mode hides the row actions (used by the inventory popup, #110). */
  readOnly?: boolean;
  /** Replace the default edit/identify/history/delete menu with a custom action set
   * (used by the lot intake view, which offers "Remove from lot", #121). */
  actionsOverride?: RowAction[];
  /** Extra chips appended to the last (condition/disposition) line — e.g. the lot
   * delivery state and cost-basis on the intake screen (#121). */
  trailingChips?: ReactNode;
  /** Tint the row background to flag it (e.g. a copy blocking a lot close, #121). */
  highlight?: boolean;
  /** When provided, the catalog-value area becomes an inline price editor (#121). */
  onSetCatalogPrice?: () => void;
  /** When provided, the location chip becomes a button (with an "＋ location" affordance when
   * none is set) that opens a location picker — inline filing during lot sorting (#121). */
  onSetLocation?: () => void;
  /** Suppress the built-in disposition chips — the lot view renders its own interactive
   * disposition editor in `trailingChips` instead (#121). */
  hideDispositions?: boolean;
  /** Show the copy's acquisition cost-basis chip (#123). On by default for the general
   * copy views (Copies list, inventory popup); the lot intake screen leaves it off because
   * it renders its own live/frozen cost chip in `trailingChips`. */
  showCostBasis?: boolean;
  onEdit?: (item: ItemListItem) => void;
  onIdentify?: (item: ItemListItem) => void;
  onViewHistory?: (item: ItemListItem) => void;
  onDelete?: (item: ItemListItem) => void;
}

export function InventoryItemRow({
  collectionId,
  item,
  areas,
  locations,
  baseCurrency,
  primaryVendorId,
  vendorMap,
  isLast,
  readOnly = false,
  actionsOverride,
  trailingChips,
  highlight = false,
  onSetCatalogPrice,
  onSetLocation,
  hideDispositions = false,
  showCostBasis = false,
  onEdit,
  onIdentify,
  onViewHistory,
  onDelete,
}: InventoryItemRowProps) {
  const [hovered, setHovered] = useState(false);

  const primaryCN = primaryVendorId
    ? (item.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null)
    : null;
  const secondaryCNs = item.catalogNumbers.filter(
    (cn) => cn.catalogVendorId !== primaryVendorId
  );
  const hasCatalog = item.catalogNumbers.length > 0;

  const areaPath = buildAreaPath(areas, item.areaId);
  const dateStr = formatIssuedDate(item.issuedDay, item.issuedMonth, item.issuedYear);
  const hasIssue = !!(item.issueName || item.issueYear);

  const dispositions = DISPOSITIONS.filter((d) => item[d.key]);

  const locationPath = buildLocationPath(locations, item.locationId);

  const menuActions: RowAction[] = [
    ...(item.unknownVariant
      ? [{ key: "identify", label: "Identify variant", icon: "◈", onSelect: () => onIdentify?.(item) }]
      : []),
    ...(item.hasHistory
      ? [{ key: "history", label: "View history", icon: "↻", onSelect: () => onViewHistory?.(item) }]
      : []),
    { key: "edit", label: "Edit", icon: "✎", onSelect: () => onEdit?.(item) },
    {
      key: "delete",
      label: "Delete",
      icon: "✕",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete?.(item),
    },
  ];

  const actions = readOnly ? null : (
    <RowActionsMenu actions={actionsOverride ?? menuActions} ariaLabel="Copy actions" />
  );

  const unknownVariantChip = item.unknownVariant && (
    <Tooltip content="Copy is linked to the base stamp; the specific variant is unknown.">
      <span
        style={{ ...CHIP, color: "var(--color-warning)", borderColor: "var(--color-warning-border, var(--color-border))" }}
      >
        unknown variant
      </span>
    </Tooltip>
  );

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: "0.75rem 1.25rem",
          background: hovered
            ? "var(--color-bg-row-hover)"
            : highlight
              ? "var(--color-error-soft, var(--color-bg-page))"
              : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
        }}
      >
        {/* Line 1: stamp name + actions (only when the copy's stamp is named) */}
        {item.stampName && (
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
              {item.stampName}
            </span>
            {actions}
          </div>
        )}

        {/* Line 2: area path, date, issue (actions here when there is no name) */}
        {(areaPath || dateStr || hasIssue || !item.stampName) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginTop: item.stampName ? "0.2rem" : undefined,
            }}
          >
            {areaPath && <span style={AREA_CHIP}>{areaPath}</span>}

            {(dateStr || hasIssue) && (
              <span style={META_INLINE}>
                {dateStr}
                {dateStr && hasIssue && ", "}
                {hasIssue && (
                  <>
                    {item.issueName ?? "(unnamed issue)"}
                    {item.issueYear ? ` (${item.issueYear})` : ""}
                  </>
                )}
              </span>
            )}

            {!item.stampName && <span style={{ flex: 1 }} />}
            {!item.stampName && actions}
          </div>
        )}

        {/* Line 3: catalog numbers + catalog valuation */}
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
            <span style={STAMP_PRIMARY_CHIP}>
              {formatStampCN(primaryCN.number, vendorMap.get(primaryCN.catalogVendorId))}
            </span>
          )}
          {secondaryCNs.map((cn) => (
            <span key={cn.catalogVendorId} style={STAMP_SECONDARY_CHIP}>
              {formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId))}
            </span>
          ))}
          {!hasCatalog && !item.stampName && (
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>(stamp)</span>
          )}
          {unknownVariantChip}
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline" }}>
            <CopyValue item={item} baseCurrency={baseCurrency} onSetPrice={onSetCatalogPrice} />
          </span>
        </div>

        {/* Line 4: condition, disposition, certificate, location, notes */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginTop: "0.6rem",
            flexWrap: "wrap",
          }}
        >
          <Tooltip content={item.conditionName}>
            <span style={CHIP}>{item.conditionAbbreviation}</span>
          </Tooltip>
          {item.certificateStatusName && (
            <Tooltip content="Certificate status">
              <span style={CHIP}>{item.certificateStatusName}</span>
            </Tooltip>
          )}
          {onSetLocation ? (
            <Tooltip
              content={
                locationPath
                  ? `Stored in ${locationPath}${item.locationRef ? ` · ${item.locationRef}` : ""} — click to change`
                  : "Click to file this copy in a location"
              }
            >
              <button
                type="button"
                onClick={onSetLocation}
                style={{ ...LOCATION_CHIP, cursor: "pointer" }}
              >
                📍{" "}
                {locationPath ? (
                  <>
                    {locationPath}
                    {item.locationRef ? ` · ${item.locationRef}` : ""}
                  </>
                ) : (
                  "Set location"
                )}
              </button>
            </Tooltip>
          ) : (
            locationPath && (
              <Tooltip
                content={`Stored in ${locationPath}${item.locationRef ? ` · ${item.locationRef}` : ""}`}
              >
                <span style={LOCATION_CHIP}>
                  📍 {locationPath}
                  {item.locationRef ? ` · ${item.locationRef}` : ""}
                </span>
              </Tooltip>
            )
          )}
          {!hideDispositions &&
            dispositions.map((d) => (
              <span key={d.key} style={dispositionChip(d.token)}>
                {d.label}
              </span>
            ))}
          {showCostBasis && <CostBasisChip item={item} baseCurrency={baseCurrency} />}
          {item.notes && (
            <Tooltip content={item.notes}>
              <span style={META}>📝 notes</span>
            </Tooltip>
          )}
          {trailingChips}
        </div>

        {/* Attached photos (#112): thumbnails with front/back distinguished, full-size on click. */}
        <PhotoStrip collectionId={collectionId} photos={item.photos} />
      </div>
    </div>
  );
}
