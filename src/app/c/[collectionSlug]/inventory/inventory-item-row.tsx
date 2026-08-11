"use client";

import { useState, type ReactNode } from "react";
import {
  formatIssuedDate,
  moneyPrimaryText,
  moneySecondaryText,
  type MoneyLike,
} from "@/app/stamp-display";
import type { ItemListItem } from "@/lib/items";
import type { CopyValuation } from "@/lib/valuation";
import { resolveCostBasis } from "@/lib/cost-basis";
import { deliveryStateLabel, deliveryStateToken, isDelivered } from "@/lib/delivery-state";
import { describeDisposal, disposalReasonLabel, disposalReasonToken } from "@/lib/disposal";
import { formatItemNo } from "@/lib/item-number";
import { useCollectionItemNoPad } from "./use-inventory-query";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import {
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
  PRICE_MAIN,
  PRICE_CONVERTED,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { CatalogNumberChip } from "@/app/c/[collectionSlug]/shared/catalog-number-chip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useDetailPageAction } from "@/app/c/[collectionSlug]/shared/use-detail-page-action";
import {
  RowQuickActions,
  pickRowActions,
} from "@/app/c/[collectionSlug]/shared/row-quick-actions";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  ColnectChip,
  colnectSearchQueryFor,
} from "@/app/c/[collectionSlug]/shared/colnect-chip";
import { SubtypeChip } from "@/app/c/[collectionSlug]/shared/subtype-chip";
import { WantChip } from "@/app/c/[collectionSlug]/wants/want-chip";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { buildLocationPath } from "@/app/c/[collectionSlug]/shared/location-helpers";
import { useContacts } from "@/app/c/[collectionSlug]/contacts/use-contacts-query";
import { PhotoThumb } from "./photo-thumb";
import { Icon } from "@/app/icons";

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

/** Disposal chip (#394/#395), tinted exactly as a delivery-state chip is — the two are sibling
 * axes and a collector reads them in the same glance. */
function disposalChipStyle(reason: string | null): React.CSSProperties {
  const token = reason ? disposalReasonToken(reason) : "error";
  if (token === "muted") return CHIP;
  return {
    ...CHIP,
    color: `var(--color-${token})`,
    borderColor: `var(--color-${token}-border, var(--color-border))`,
    background: `var(--color-${token}-soft, var(--color-bg-page))`,
  };
}

/** Sold chip (#393), tinted like its sibling axes. `success` rather than the disposal chip's error
 * tint: a copy that sold left the collection the way it was meant to — the chip states an outcome,
 * it does not raise an alarm. */
function soldChipStyle(): React.CSSProperties {
  return {
    ...CHIP,
    color: "var(--color-success)",
    borderColor: "var(--color-success-border)",
    background: "var(--color-success-soft)",
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

/** Catalog valuation (ADR-0007 §7). Uncertain values (unknown variant, valued at the lowest child
 * price) are prefixed `~` and muted; unpriced ones show `—`; a price in a currency with no base
 * rate falls back to its own currency. Takes the valuation rather than the copy, so a duplicate
 * group's shared per-copy figure renders identically to a row's (#372). */
export function CopyValue({
  value: v,
  baseCurrency,
  onSetPrice,
}: {
  value: CopyValuation;
  baseCurrency: string;
  /** When provided, the value area becomes an inline catalog-price editor (#121): a
   * "+ price" link when unpriced, and a click-to-edit affordance when priced. */
  onSetPrice?: () => void;
}) {
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
  /** Set while quick offer mode is armed (#537): the entry above creates the offer outright rather
   * than opening the create dialog, so it names the platform and status it will use. */
  quickOffer?: { platformName: string; stateLabel: string };
  /** When provided, adds a "Go to purchase" menu entry on a copy that came from a purchase order
   * (#387). Shown **only** when the copy has one: a copy entered by hand was never bought through
   * an order, so there is no precondition to explain — nothing on the row promises otherwise. */
  onViewPurchase?: (item: ItemListItem) => void;
  /** When provided, adds a "View offers" menu entry opening the read-only popup of every offer
   * referencing this copy (#276). Unconditional — a sold copy's past listings are as much the
   * question as a live one's, and the row carries no offer count to hide it by. */
  onViewOffers?: (item: ItemListItem) => void;
  /** When provided, adds the disposal entry (#395): *No longer held* on a copy still in hand, and
   * *Mark as held again* on one already disposed of. The two are one prop because they are one
   * axis — the row is always in exactly one of the two states. */
  onDispose?: (item: ItemListItem) => void;
  onRestore?: (item: ItemListItem) => void;
  /** The platform the list is currently working through (#506) — the one named by the *Not offered
   * on X* / *Excluded from X* filter. It is what makes a one-click row entry possible at all: a
   * decision is always about one platform, and with none in scope the copy form is where the whole
   * set is edited. Null when no platform is picked, and the entry is then simply absent. */
  exclusionPlatform?: { id: string; name: string } | null;
  /** Set aside this copy from {@link exclusionPlatform}, or bring it back (#506). */
  onSetPlatformExclusion?: (item: ItemListItem, platformId: string, excluded: boolean) => void;
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
  quickOffer,
  onViewOffers,
  onViewPurchase,
  onDispose,
  onRestore,
  exclusionPlatform,
  onSetPlatformExclusion,
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
  // A disposed copy (#394) fails the same test from the other end — it arrived and then left — so
  // it carries its own reason rather than the delivery one.
  const delivered = isDelivered(item.deliveryState);
  const disposed = item.disposedAt != null;
  const listable = delivered && !disposed;
  const offerHint = disposed
    ? "You no longer hold this copy, so it cannot be listed. Mark it as held again first."
    : delivered
      ? undefined
      : `Only a delivered copy can be listed — this one is ${deliveryStateLabel(
          item.deliveryState
        ).toLowerCase()}.`;

  // Platforms this copy is deliberately never listed on (#506), named from the collection's own
  // contacts. Read here rather than threaded down, for the reason `useCollectionItemNoPad` is: the
  // copy row is rendered from eight screens, and one shared, cached query costs less than one more
  // prop through all of them. An id with no contact behind it is a platform since deleted, whose
  // exclusion means nothing any more, so it is chipped as nothing.
  const { data: contacts } = useContacts(collectionId);
  const excludedNames = item.excludedPlatformIds
    .map((id) => contacts?.find((c) => c.id === id)?.name)
    .filter((name): name is string => !!name);
  const excludedHere =
    !!exclusionPlatform && item.excludedPlatformIds.includes(exclusionPlatform.id);

  const detailPage = useDetailPageAction("copy", item.id);

  const menuActions: RowAction[] = [
    detailPage,
    ...(item.unknownVariant
      ? [{ key: "identify", label: "Identify variant", icon: "variant", onSelect: () => onIdentify?.(item) } as RowAction]
      : []),
    ...(item.hasHistory
      ? [{ key: "history", label: "View history", icon: "refresh", onSelect: () => onViewHistory?.(item) } as RowAction]
      : []),
    ...(onViewOffers
      // Same "▤" as the stamp/issue lists' read-only "View copies" popup — one icon for
      // "open a read-only list of related records".
      ? [{ key: "offers", label: "View offers", icon: "list", onSelect: () => onViewOffers(item) } as RowAction]
      : []),
    ...(onViewPurchase && item.purchase
      ? [{
          key: "purchase",
          label: "Go to purchase",
          icon: "receipt",
          hint: item.purchase.label,
          onSelect: () => onViewPurchase(item),
        } as RowAction]
      : []),
    ...(onAddToOffer && item.forSale
      ? [{
          key: "add-to-offer",
          label: "Add to offer",
          icon: "addToOffer",
          disabled: !listable,
          hint: offerHint,
          onSelect: () => onAddToOffer(item),
        } as RowAction]
      : []),
    ...(onAddToNewOffer && item.forSale
      ? [{
          key: "add-to-new-offer",
          label: quickOffer ? `New offer on ${quickOffer.platformName}` : "Add to new offer",
          icon: "newOffer",
          disabled: !listable,
          // The blocked reason still wins: a copy that cannot be listed is why the entry is dead,
          // and the mode is beside the point on it.
          hint: !listable
            ? offerHint
            : quickOffer
              ? `Created straight away as ${quickOffer.stateLabel}, with no dialog.`
              : offerHint,
          onSelect: () => onAddToNewOffer(item),
        } as RowAction]
      : []),
    // Disposal (#394/#395). Exactly one of the two shows, because a copy is either held or not.
    // A copy that has not arrived keeps the entry **visible but disabled** with the reason, the
    // same rule the offer entries follow (#273): that axis belongs to delivery, and silently
    // dropping the entry leaves the restriction unguessable.
    ...(onDispose && !disposed
      ? [{
          key: "dispose",
          label: "No longer held",
          icon: "disposed",
          disabled: !delivered,
          hint: delivered
            ? undefined
            : `A copy that has not arrived is handled by its delivery state — this one is ${deliveryStateLabel(
                item.deliveryState
              ).toLowerCase()}.`,
          onSelect: () => onDispose(item),
        } as RowAction]
      : []),
    ...(onRestore && disposed
      ? [{
          key: "restore",
          label: "Mark as held again",
          icon: "restore",
          onSelect: () => onRestore(item),
        } as RowAction]
      : []),
    // Kept off a platform for good (#506) — the one-click answer to the worklist's own question,
    // so it is only offered while a platform is in scope, and it toggles: the row is either set
    // aside there or it is not.
    ...(onSetPlatformExclusion && exclusionPlatform
      ? [{
          key: "platform-exclusion",
          label: excludedHere
            ? `List on ${exclusionPlatform.name} again`
            : `Never list on ${exclusionPlatform.name}`,
          icon: excludedHere ? "check" : "excluded",
          hint: excludedHere
            ? `This copy is set aside from ${exclusionPlatform.name}; bring it back into that worklist.`
            : `Keep this copy out of the "not offered on ${exclusionPlatform.name}" worklist for good.`,
          onSelect: () =>
            onSetPlatformExclusion(item, exclusionPlatform.id, !excludedHere),
        } as RowAction]
      : []),
    { key: "edit", label: "Edit", icon: "edit", onSelect: () => onEdit?.(item) },
    ...(onEditStamp
      ? [{ key: "edit-stamp", label: "Edit stamp", icon: "stamp", onSelect: () => onEditStamp(item) } as RowAction]
      : []),
    {
      key: "delete",
      label: "Delete",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete?.(item),
    },
  ];

  const rowActions = actionsOverride ?? menuActions;

  // A read-only surface still gets **one** icon: the way to the copy's own screen (#517). Going to
  // a record's page is navigation, not action — `readOnly` is about not editing a copy from a
  // screen that is not the Copies list, and it would be a strange kind of read-only that refused
  // to let you read more. This is what puts the icon on the copies list inside the stamp and issue
  // detail screens, and on the copies popup (#110) it shares that list with.
  const actions = readOnly ? (
    <RowQuickActions actions={[detailPage]} visible={hovered} />
  ) : (
    <>
      {/* Edit the copy · edit the stamp behind it · put it on an existing offer · start a new
          one from it — what is repeated while working the Copies list, on hover beside the menu
          (#454). Both offer verbs are promoted because they are one decision made per copy
          ("does this join a listing or open one"), and sending the collector into the menu for
          half of it would make the promoted half the accidental default. Fed the same objects
          the menu gets, so an overridden action list promotes whatever it actually offers and a
          screen that drops one simply shows one icon fewer. */}
      <RowQuickActions
        actions={pickRowActions(rowActions, [
          "detail-page",
          "edit",
          "edit-stamp",
          "add-to-offer",
          "add-to-new-offer",
        ])}
        visible={hovered}
      />
      <RowActionsMenu actions={rowActions} ariaLabel="Copy actions" />
    </>
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
            colnectId={item.colnectId}
            searchQuery={colnectSearchQueryFor(primaryCN ?? secondaryCNs[0], vendorMap)}
          />
          <SubtypeChip subtype={item.subtype} />
          {/* Whether this stamp is wanted, and whether **this copy** would satisfy one (#532). On a
              purchase order being sorted that is the question the row exists to answer; on the
              Copies list it is the upgrade signal, since holding a copy never closes a want. */}
          <WantChip
            wants={item.wants}
            copy={{
              stampId: item.stampId,
              conditionId: item.conditionId,
              certificateStatusId: item.certificateStatusId,
              formatId: item.formatId,
            }}
          />
          {!hasCatalog && !item.stampName && (
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>(stamp)</span>
          )}
          {unknownVariantChip}
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline" }}>
            <CopyValue value={item.value} baseCurrency={baseCurrency} onSetPrice={onSetCatalogPrice} />
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
                <Icon name="location" size="sm" />{" "}
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
                  <Icon name="location" size="sm" /> {locationPath}
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
          {/* Sold (#393). A sold copy is hidden until *Include sold* is on (#207), so the chip only
              ever appears in the mixed view it exists for — where a row that has left the
              collection is otherwise indistinguishable from one still in it. Chipped whenever it
              applies, for the same reason the disposal chip below is: it is never the default, and
              it changes how every other chip on the row should be read. */}
          {item.sold && (
            <Tooltip content="This copy has been sold and left the collection. It is only listed here because sold copies are being shown.">
              <span style={soldChipStyle()}><Icon name="sell" size="sm" /> Sold</span>
            </Tooltip>
          )}
          {/* Disposal (#394/#395). Chipped whenever it applies — unlike delivery, where the
              common state is deliberately left unlabelled, "no longer held" is never the default
              and is the one fact that changes how every other chip on this row should be read. */}
          {disposed && (
            <Tooltip content={describeDisposal(item) ?? ""}>
              <span style={disposalChipStyle(item.disposalReason)}>
                <Icon name="disposed" size="sm" /> {item.disposalReason ? disposalReasonLabel(item.disposalReason) : "No longer held"}
              </span>
            </Tooltip>
          )}
          {/* Never listed on these platforms (#506). One chip whatever the number of platforms —
              it is a single decision about where this copy is *not* sold, and a chip each would
              grow with a list nobody reads across. Muted, because it says what will not happen. */}
          {excludedNames.length > 0 && (
            <Tooltip
              content={`Deliberately never listed on ${excludedNames.join(
                ", "
              )} — kept out of the "not offered" worklist for ${
                excludedNames.length === 1 ? "that platform" : "those platforms"
              }.`}
            >
              <span style={{ ...CHIP, color: "var(--color-text-muted)", fontStyle: "italic" }}>
                <Icon name="excluded" size="sm" /> not on {excludedNames.join(", ")}
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
              <span style={META}><Icon name="notes" size="sm" /> notes</span>
            </Tooltip>
          )}
          {trailingChips}
        </div>
        </div>
      </div>
    </div>
  );
}
