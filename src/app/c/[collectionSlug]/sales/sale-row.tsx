"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SaleListItem } from "@/lib/sales";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";

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

/** Format a `@db.Date` (midnight-UTC) as `YYYY-MM-DD` without a timezone shift. */
function formatSaleDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

interface SaleRowProps {
  sale: SaleListItem;
  collectionSlug: string;
  isLast: boolean;
  onDelete: (sale: SaleListItem) => void;
}

/** A single sale as a stacked card row: date + platform on top, then item/line counts and the
 * net proceeds. The whole row opens the sale detail screen. */
export function SaleRow({ sale, collectionSlug, isLast, onDelete }: SaleRowProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const detailHref = `/c/${collectionSlug}/sales/${sale.id}`;

  const menuActions: RowAction[] = [
    { key: "view", label: "View", icon: "↗", onSelect: () => router.push(detailHref) },
    {
      key: "delete",
      label: "Delete",
      icon: "✕",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete(sale),
    },
  ];

  const unitWord = sale.itemCount === 1 ? "copy" : "copies";
  const lineWord = sale.lineCount === 1 ? "unit" : "units";

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => router.push(detailHref)}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(detailHref);
        }}
        style={{
          padding: "0.75rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          cursor: "pointer",
        }}
      >
        {/* Line 1: date + platform + actions */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatSaleDate(sale.soldAt)}
          </span>
          <span
            style={{
              fontSize: "0.9375rem",
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "55%",
            }}
          >
            {sale.platformName}
            {sale.buyerName ? ` · ${sale.buyerName}` : ""}
            {sale.externalRef ? ` · #${sale.externalRef}` : ""}
          </span>
          <span style={{ flex: 1 }} />
          <span onClick={(e) => e.stopPropagation()}>
            <RowActionsMenu actions={menuActions} ariaLabel="Sale actions" />
          </span>
        </div>

        {/* Line 2: counts + proceeds */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            marginTop: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <span style={CHIP} title="Sold units">
            {sale.lineCount} {lineWord}
          </span>
          <span style={CHIP} title="Physical copies that left">
            {sale.itemCount} {unitWord}
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: "0.875rem",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text-primary)",
              whiteSpace: "nowrap",
            }}
            title="Net proceeds (base currency): buyer-side proceeds converted to base, minus my shipping"
          >
            {sale.netProceeds} {sale.baseCurrency}
          </span>
        </div>
      </div>
    </div>
  );
}
