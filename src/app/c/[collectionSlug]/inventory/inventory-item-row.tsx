"use client";

import { useState, type ReactNode } from "react";
import {
  formatIssuedDate,
  moneyPrimaryText,
  moneySecondaryText,
  type MoneyLike,
} from "@/app/stamp-display";
import type { ItemListItem } from "@/lib/items";
import { resolveCostBasis } from "@/lib/cost-basis";
import { deliveryStateLabel, deliveryStateToken, isDelivered } from "@/lib/delivery-state";
import { formatItemNo } from "@/lib/item-number";
import { useCollectionItemNoPad } from "./use-inventory-query";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import {
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
  PRICE_MAIN,
  PRICE_CONVERTED,
  formatStampCN,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { ColnectChip } from "@/app/c/[collectionSlug]/shared/colnect-chip";
import { SubtypeChip } from "@/app/c/[collectionSlug]/shared/subtype-chip";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { buildLocationPath } from "@/app/c/[collectionSlug]/shared/location-helpers";
import { PhotoThumb } from "./photo-thumb";

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

/** Delivery-state chip (#272), tinted from the shared vocabulary the same way a disposition is.
 * `muted` (a value outside the vocabulary) falls back to the plain chip. */
function deliveryChipStyle(state: string): React.CSSProperties {
  const token = deliveryStateToken(state);
  if (token === "muted") return CHIP;
  return {
    ...CHIP,
    color: `var(--color-${token})`,
    borderColor: `var(--color-${token}-border, var(--color-border))`,
    background: `var(--color-${token}-soft, var(--color-bg-page))`,
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

/** Internal copy number (#268). Monospaced and zero-padded so a column of them lines up the way
 * the numbers do on the physical pieces, and muted because it identifies the row rather than
 * describing the stamp. */
const ITEM_NO_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontVariantNumeric: "tabular-nums",
  fontFamily: "monospace",
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
  // Display the catalog price the same way as the issue list (#244): the base-currency
  // value as the emphasised primary (prefixed `≈` when converted), with the original
  // catalog currency as a muted secondary when it differs. A price in a currency with no
  // base rate falls back to showing just its own currency.
  const money: MoneyLike = {
    amount: v.amount!,
    currency: v.currency!,
    convertedAmount: v.currency === baseCurrency ? null : v.baseAmountDisplay,
    baseCurrency,
  };
  const primaryText = moneyPrimaryText(money);
  const secondaryText = moneySecondaryText(money);
  const noRate = v.currency !== baseCurrency && v.baseAmountDisplay == null;
  const title = v.uncertain
    ? "Estimated from the lowest child-variant price — the specific variant isn't identified yet."
    : noRate
      ? `Catalog value (no ${baseCurrency} rate available)`
      : "Catalog value";
  const inner = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "0.35rem",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {v.uncertain && <span style={{ ...PRICE_MAIN, color: "var(--color-text-muted)" }}>~</span>}
      {secondaryText && <span style={PRICE_CONVERTED}>{secondaryText}</span>}
      <span
        style={
          v.uncertain
            ? { ...PRICE_MAIN, color: "var(--color-text-muted)", fontStyle: "italic" }
            : PRICE_MAIN
        }
      >
        {primaryText}
      </span>
    </span>
  );
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
  /** Suppress the built-in delivery-state chip (#272), for the same reason as
   * `hideDispositions`: the lot intake screen renders an editable delivery control of its
   * own in `trailingChips` and would otherwise show the state twice. */
  hideDeliveryState?: boolean;
  /** Show the copy's acquisition cost-basis chip (#123). On by default for the general
   * copy views (Copies list, inventory popup); the lot intake screen leaves it off because
   * it renders its own live/frozen cost chip in `trailingChips`. */
  showCostBasis?: boolean;
  onEdit?: (item: ItemListItem) => void;
  /** When provided, adds an "Edit stamp" menu entry that opens the shared stamp edit
   * dialog for the copy's underlying stamp (name, catalog numbers, prices) (#243). */
  onEditStamp?: (item: ItemListItem) => void;
  onIdentify?: (item: ItemListItem) => void;
  onViewHistory?: (item: ItemListItem) => void;
  onDelete?: (item: ItemListItem) => void;
  /** When provided, adds an "Add to offer" menu entry — shown only for a *for sale*, delivered
   * copy (the copies eligible to list, mirroring the compose picker's eligibility) (#188). */
  onAddToOffer?: (item: ItemListItem) => void;
  /** When provided, adds an "Add to new offer" menu entry beside "Add to offer" (same eligibility),
   * jumping straight into offer creation seeded with this copy, skipping the picker (#277). */
  onAddToNewOffer?: (item: ItemListItem) => void;
  /** When provided, adds a "View offers" menu entry opening the read-only popup of every offer
   * referencing this copy (#276). Unconditional — a sold copy's past listings are as much the
   * question as a live one's, and the row carries no offer count to hide it by. */
  onViewOffers?: (item: ItemListItem) => void;
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
  hideDeliveryState = false,
  showCostBasis = false,
  onEdit,
  onEditStamp,
  onIdentify,
  onViewHistory,
  onDelete,
  onAddToOffer,
  onAddToNewOffer,
  onViewOffers,
}: InventoryItemRowProps) {
  const [hovered, setHovered] = useState(false);
  const itemNoPad = useCollectionItemNoPad(collectionId);

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

  // Only a for-sale, in-hand copy is listable — matches the offer compose picker's eligibility
  // (For sale + delivered + unsold); the sold guard is enforced server-side (#188, ADR-0013 §4).
  // A for-sale copy that has not arrived keeps both entries **visible but disabled**, carrying the
  // reason: dropping them silently left the restriction unguessable (#273). Not-for-sale copies
  // still show nothing — that disposition is set on the row itself, so it explains itself.
  const delivered = isDelivered(item.deliveryState);
  const offerHint = delivered
    ? undefined
    : `Only a delivered copy can be listed — this one is ${deliveryStateLabel(
        item.deliveryState
      ).toLowerCase()}.`;

  const menuActions: RowAction[] = [
    ...(item.unknownVariant
      ? [{ key: "identify", label: "Identify variant", icon: "◈", onSelect: () => onIdentify?.(item) }]
      : []),
    ...(item.hasHistory
      ? [{ key: "history", label: "View history", icon: "↻", onSelect: () => onViewHistory?.(item) }]
      : []),
    ...(onViewOffers
      // Same "▤" as the stamp/issue lists' read-only "View copies" popup — one icon for
      // "open a read-only list of related records".
      ? [{ key: "offers", label: "View offers", icon: "▤", onSelect: () => onViewOffers(item) }]
      : []),
    ...(onAddToOffer && item.forSale
      ? [{
          key: "add-to-offer",
          label: "Add to offer",
          icon: "🏷",
          disabled: !delivered,
          hint: offerHint,
          onSelect: () => onAddToOffer(item),
        }]
      : []),
    ...(onAddToNewOffer && item.forSale
      ? [{
          key: "add-to-new-offer",
          label: "Add to new offer",
          icon: "🆕",
          disabled: !delivered,
          hint: offerHint,
          onSelect: () => onAddToNewOffer(item),
        }]
      : []),
    { key: "edit", label: "Edit", icon: "✎", onSelect: () => onEdit?.(item) },
    ...(onEditStamp
      ? [{ key: "edit-stamp", label: "Edit stamp", icon: "◆", onSelect: () => onEditStamp(item) }]
      : []),
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
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}
      >
        {/* First photo as a fixed left column (#112); the rest of the row sits beside it. */}
        <PhotoThumb collectionId={collectionId} photos={item.photos} reserveWhenEmpty size="5.5rem" />

        <div style={{ flex: 1, minWidth: 0 }}>
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
          <ColnectChip colnectId={item.colnectId} />
          <SubtypeChip subtype={item.subtype} />
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
          <Tooltip content="Internal copy number — assigned automatically, not editable">
            <span style={ITEM_NO_CHIP}>{formatItemNo(item.itemNo, itemNoPad)}</span>
          </Tooltip>
          <Tooltip content={item.conditionName}>
            <span style={CHIP}>{item.conditionAbbreviation}</span>
          </Tooltip>
          {item.certificateStatusName && (
            <Tooltip content="Certificate status">
              <span style={CHIP}>{item.certificateStatusName}</span>
            </Tooltip>
          )}
          {/* Only multiples get a chip. A single is the unmarked default, so labelling it would
              put a badge on nearly every row and say nothing. */}
          {item.formatAbbreviation && (
            <Tooltip content={item.formatName ?? "Format"}>
              <span style={CHIP}>{item.formatAbbreviation}</span>
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
          {/* Delivery state (#272). Only a copy that is *not* delivered is chipped: delivered is
              what a copy added by hand starts as and what every sorted copy ends as, so badging
              it would put a label on nearly every row and say nothing — the same reasoning that
              leaves a single format unlabelled above. */}
          {!hideDeliveryState && !delivered && (
            <Tooltip
              content={`Delivery state: ${deliveryStateLabel(
                item.deliveryState
              )}. A copy must be delivered before it can be listed for sale.`}
            >
              <span style={deliveryChipStyle(item.deliveryState)}>
                {deliveryStateLabel(item.deliveryState)}
              </span>
            </Tooltip>
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
        </div>
      </div>
    </div>
  );
}
