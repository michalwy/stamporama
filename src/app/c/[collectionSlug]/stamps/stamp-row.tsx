"use client";

import { useState } from "react";
import { formatIssuedDate, moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
import type { StampListItem } from "@/lib/stamps";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import {
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
  STAMP_MUTED_PRIMARY_CHIP,
  PRICE_MAIN,
  PRICE_CONVERTED,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { CatalogNumberChip } from "@/app/c/[collectionSlug]/shared/catalog-number-chip";
import { StalePriceIcon } from "@/app/c/[collectionSlug]/shared/stale-price-icon";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  ColnectChip,
  colnectSearchQueryFor,
} from "@/app/c/[collectionSlug]/shared/colnect-chip";
import { SubtypeChip } from "@/app/c/[collectionSlug]/shared/subtype-chip";
import { CopyCountBadge } from "@/app/c/[collectionSlug]/shared/copy-count-badge";
import { WantChip } from "@/app/c/[collectionSlug]/wants/want-chip";
import { useAddWantAction } from "@/app/c/[collectionSlug]/wants/use-add-want-action";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import {
  RowQuickActions,
  pickRowActions,
} from "@/app/c/[collectionSlug]/shared/row-quick-actions";
import { usePriceDetailsAction } from "@/app/c/[collectionSlug]/shared/use-price-details-action";
import { useDetailPageAction } from "@/app/c/[collectionSlug]/shared/use-detail-page-action";
import { useOffersPopupAction } from "@/app/c/[collectionSlug]/offers/use-offers-popup-action";
import {
  useInventoryPopupAction,
  useInventoryAddAction,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-copy-actions";
import {
  issueLabel,
  orderedCatalogLabels,
  type PickedStamp,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";

interface StampRowProps {
  stamp: StampListItem;
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  isLast: boolean;
  onEdit: (stamp: StampListItem) => void;
  onDelete: (stamp: StampListItem) => void;
}

export function StampRow({
  stamp,
  collectionId,
  areas,
  baseCurrency,
  primaryVendorId,
  vendorMap,
  isLast,
  onEdit,
  onDelete,
}: StampRowProps) {
  const [hovered, setHovered] = useState(false);
  const dateStr = formatIssuedDate(stamp.issuedDay, stamp.issuedMonth, stamp.issuedYear);
  const areaPath = buildAreaPath(areas, stamp.areaId);

  const primaryCN = primaryVendorId
    ? (stamp.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null)
    : null;
  const secondaryCNs = stamp.catalogNumbers.filter(
    (cn) => cn.catalogVendorId !== primaryVendorId
  );

  const firstIssue = stamp.issues[0] ?? null;
  // On at least one checklist of at least one of its issues (#531) — what the old
  // `requiredForCompleteness` flag said, now read off membership.
  const isRequired = stamp.issues.some((m) => m.checklists.some((c) => c.on));

  const popupLabel =
    stamp.name ??
    primaryCN?.number ??
    stamp.catalogNumbers[0]?.number ??
    "(stamp)";

  /** This row's stamp, shaped for a picker summary. Built once and handed to every dialog opened
   *  from the row, so the add-copy form and the want form cannot summarise one stamp two ways. */
  const pickedStamp: PickedStamp = {
    stampId: stamp.id,
    catalogLabels: orderedCatalogLabels(stamp.catalogNumbers, vendorMap, primaryVendorId),
    name: stamp.name,
    secondary:
      [
        firstIssue ? issueLabel(firstIssue.issueName, firstIssue.issueYear) : null,
        areaPath,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    unknownVariant: false,
  };

  const addCopy = useInventoryAddAction({
    collectionId,
    areas,
    target: { kind: "stamp", stampId: stamp.id, initial: pickedStamp },
  });
  const copies = useInventoryPopupAction({
    collectionId,
    areas,
    baseCurrency,
    target: { kind: "stamp", stampId: stamp.id, label: popupLabel },
  });
  // Every offer holding a copy of this stamp (#349) — counted per stamp exactly, like the copies
  // popup beside it, never rolled up from variant children.
  const offers = useOffersPopupAction({
    collectionId,
    target: { kind: "stamp", stampId: stamp.id, label: popupLabel },
  });
  const prices = usePriceDetailsAction({ kind: "stamp", stampId: stamp.id });
  const detailPage = useDetailPageAction("stamp", stamp.id);
  // The same stamp the add-copy dialog is opened on — one shape, so the want form and the copy form
  // cannot summarise one stamp two ways.
  const addWant = useAddWantAction({ collectionId, areas, stamp: pickedStamp });

  const actions: RowAction[] = [
    detailPage,
    addCopy.action,
    addWant.action,
    copies.action,
    offers.action,
    ...(stamp.mainCatalogPrice ? [prices.action] : []),
    { key: "edit", label: "Edit", icon: "edit", onSelect: () => onEdit(stamp) },
    {
      key: "delete",
      label: "Delete",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete(stamp),
    },
  ];

  const actionsMenu = (
    <>
      {/* Edit · add a copy of this stamp · put it on the want list — what a collector repeats on
          the flat list, on hover beside the menu (#454). Wanting sits beside adding a copy because
          the two are the same reflex pointed opposite ways: this one I have, that one I am after.
          There is no "add child stamp" here: variants are added from the issue tree, where the
          parent is on screen. */}
      <RowQuickActions
        actions={pickRowActions(actions, ["detail-page", "edit", "add-copy", "add-want"])}
        visible={hovered}
      />
      <RowActionsMenu actions={actions} ariaLabel="Stamp actions" />
      {addCopy.dialog}
      {addWant.dialog}
      {copies.dialog}
      {offers.dialog}
      {prices.dialog}
    </>
  );

  return (
    <div
      style={{
        borderBottom: isLast ? undefined : "1px solid var(--color-border)",
      }}
    >
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
        {/* First photo as a fixed left column (#112); the rest of the row sits beside it. */}
        <PhotoThumb collectionId={collectionId} photos={stamp.photos} reserveWhenEmpty />

        <div style={{ flex: 1, minWidth: 0 }}>
        {/* Line 1: name + actions (only if name exists) */}
        {stamp.name && (
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
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
              {stamp.name}
            </span>

            {actionsMenu}
          </div>
        )}

        {/* Line 2: area path, date, issue */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginTop: stamp.name ? "0.2rem" : undefined,
          }}
        >
          {areaPath && (
            <span
              style={{
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
              }}
            >
              {areaPath}
            </span>
          )}

          {(dateStr || firstIssue) && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {dateStr}
              {dateStr && firstIssue && ", "}
              {firstIssue && (
                <>
                  {firstIssue.issueName ?? "(unnamed issue)"}
                  {firstIssue.issueYear ? ` (${firstIssue.issueYear})` : ""}
                  {stamp.issues.length > 1 && ` +${stamp.issues.length - 1}`}
                </>
              )}
            </span>
          )}

          {!stamp.name && <span style={{ flex: 1 }} />}

          {!stamp.name && actionsMenu}
        </div>

        {/* Line 3: catalog numbers + main-catalog price */}
        {(primaryCN ||
          secondaryCNs.length > 0 ||
          stamp.colnectId ||
          stamp.copies.total > 0 ||
          stamp.mainCatalogPrice) && (
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
              style={isRequired ? STAMP_PRIMARY_CHIP : STAMP_MUTED_PRIMARY_CHIP}
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
            colnectId={stamp.colnectId}
            searchQuery={colnectSearchQueryFor(primaryCN ?? secondaryCNs[0], vendorMap)}
            size="medium"
          />
          <SubtypeChip subtype={stamp.subtype} size="medium" />
          <CopyCountBadge
            copies={stamp.copies}
            variantCopies={stamp.variantCopies}
            size="medium"
            // Same as the issue tree's (#721): hover previews the breakdown, click opens the
            // row's own *View copies* dialog.
            onOpenCopies={copies.open}
          />
          {/* Beside the copies held, because the two answer one question between them: what the
              collection has of this stamp, and what it is still after (#532). */}
          <WantChip wants={stamp.wants} />
          {stamp.mainCatalogPrice && (
            <span
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "baseline",
                gap: "0.35rem",
              }}
            >
              {stamp.mainCatalogPriceStale && <StalePriceIcon />}
              {/* Derived from the single's price by a format multiplier (#343) — the same
                  `~` + italics the issue list uses for an inferred figure. */}
              {stamp.mainCatalogPriceDerived && (
                <Tooltip
                  align="end"
                  content="Derived from the single's price by this format's multiplier — no price is recorded for the format itself."
                >
                  <span
                    aria-label="Derived from the single's price"
                    style={{ ...PRICE_MAIN, color: "var(--color-text-muted)", cursor: "help" }}
                  >
                    ~
                  </span>
                </Tooltip>
              )}
              {moneySecondaryText(stamp.mainCatalogPrice) && (
                <span style={PRICE_CONVERTED}>{moneySecondaryText(stamp.mainCatalogPrice)}</span>
              )}
              <span
                style={
                  stamp.mainCatalogPriceDerived
                    ? { ...PRICE_MAIN, color: "var(--color-text-muted)", fontStyle: "italic" }
                    : PRICE_MAIN
                }
              >
                {moneyPrimaryText(stamp.mainCatalogPrice)}
              </span>
            </span>
          )}
        </div>
        )}
        </div>
      </div>
    </div>
  );
}
