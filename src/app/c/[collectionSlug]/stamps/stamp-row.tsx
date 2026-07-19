"use client";

import { useState } from "react";
import { formatIssuedDate, moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
import type { StampListItem } from "@/lib/stamps";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import {
  rowBtnStyle,
  rowBtnDangerStyle,
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
  STAMP_MUTED_PRIMARY_CHIP,
  PRICE_MAIN,
  PRICE_CONVERTED,
  formatStampCN,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { StalePriceIcon } from "@/app/c/[collectionSlug]/shared/stale-price-icon";
import { AllPricesButton } from "@/app/c/[collectionSlug]/shared/all-prices-button";
import { InventoryPopupButton } from "@/app/c/[collectionSlug]/inventory/inventory-popup-button";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";

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
  const inventoryButton = (
    <InventoryPopupButton
      collectionId={collectionId}
      areas={areas}
      baseCurrency={baseCurrency}
      target={{ kind: "stamp", stampId: stamp.id, label: popupLabel }}
    />
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

            {inventoryButton}
            <button
              type="button"
              onClick={() => onEdit(stamp)}
              style={rowBtnStyle}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(stamp)}
              style={rowBtnDangerStyle}
            >
              Delete
            </button>
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

          {!stamp.name && (
            <>
              {inventoryButton}
              <button
                type="button"
                onClick={() => onEdit(stamp)}
                style={rowBtnStyle}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onDelete(stamp)}
                style={rowBtnDangerStyle}
              >
                Delete
              </button>
            </>
          )}
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
              <AllPricesButton stampId={stamp.id} />
            </span>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
