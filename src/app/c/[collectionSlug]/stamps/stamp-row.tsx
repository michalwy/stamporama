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
  formatStampCN,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { StalePriceIcon } from "@/app/c/[collectionSlug]/shared/stale-price-icon";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { usePriceDetailsAction } from "@/app/c/[collectionSlug]/shared/use-price-details-action";
import {
  useInventoryPopupAction,
  useInventoryAddAction,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-copy-actions";
import {
  issueLabel,
  primaryLabel,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { PhotoStrip } from "@/app/c/[collectionSlug]/inventory/photo-strip";

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
  const isRequired = stamp.issues.some((m) => m.requiredForCompleteness);

  const popupLabel =
    stamp.name ??
    primaryCN?.number ??
    stamp.catalogNumbers[0]?.number ??
    "(stamp)";

  const addCopy = useInventoryAddAction({
    collectionId,
    areas,
    target: {
      kind: "stamp",
      stampId: stamp.id,
      initial: {
        stampId: stamp.id,
        primary: primaryLabel(
          stamp.catalogNumbers.map((cn) => cn.number),
          stamp.name
        ),
        secondary:
          [
            firstIssue
              ? issueLabel(firstIssue.issueName, firstIssue.issueYear)
              : null,
            areaPath,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        unknownVariant: false,
      },
    },
  });
  const copies = useInventoryPopupAction({
    collectionId,
    areas,
    baseCurrency,
    target: { kind: "stamp", stampId: stamp.id, label: popupLabel },
  });
  const prices = usePriceDetailsAction({ kind: "stamp", stampId: stamp.id });

  const actions: RowAction[] = [
    addCopy.action,
    copies.action,
    ...(stamp.mainCatalogPrice ? [prices.action] : []),
    { key: "edit", label: "Edit", icon: "✎", onSelect: () => onEdit(stamp) },
    {
      key: "delete",
      label: "Delete",
      icon: "✕",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete(stamp),
    },
  ];

  const actionsMenu = (
    <>
      <RowActionsMenu actions={actions} ariaLabel="Stamp actions" />
      {addCopy.dialog}
      {copies.dialog}
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
        }}
      >
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
        {(primaryCN || secondaryCNs.length > 0 || stamp.mainCatalogPrice) && (
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
            <span style={isRequired ? STAMP_PRIMARY_CHIP : STAMP_MUTED_PRIMARY_CHIP}>
              {formatStampCN(primaryCN.number, vendorMap.get(primaryCN.catalogVendorId))}
            </span>
          )}
          {secondaryCNs.map((cn) => (
            <span key={cn.catalogVendorId} style={STAMP_SECONDARY_CHIP}>
              {formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId))}
            </span>
          ))}
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
              {moneySecondaryText(stamp.mainCatalogPrice) && (
                <span style={PRICE_CONVERTED}>{moneySecondaryText(stamp.mainCatalogPrice)}</span>
              )}
              <span style={PRICE_MAIN}>{moneyPrimaryText(stamp.mainCatalogPrice)}</span>
            </span>
          )}
        </div>
        )}

        {/* Catalog-level photos (#137): front/back distinguished from extras, full-size on click. */}
        <PhotoStrip collectionId={collectionId} photos={stamp.photos} />
      </div>
    </div>
  );
}
