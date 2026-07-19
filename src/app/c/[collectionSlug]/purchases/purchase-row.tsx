"use client";

import { useState } from "react";
import type { PurchaseListItem } from "@/lib/purchases";
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

const META_INLINE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const STATUS: Record<string, { label: string; token: string }> = {
  preparing: { label: "Preparing", token: "muted" },
  in_transit: { label: "In transit", token: "accent" },
  arrived: { label: "Arrived", token: "success" },
};

/** Soft-tinted status chip so the delivery state reads at a glance, mirroring the
 * inventory disposition chips. Falls back to a neutral chip for unknown values. */
function statusChip(status: string): { style: React.CSSProperties; label: string } {
  const meta = STATUS[status];
  if (!meta) return { style: CHIP, label: status };
  if (meta.token === "muted") return { style: CHIP, label: meta.label };
  return {
    label: meta.label,
    style: {
      ...CHIP,
      color: `var(--color-${meta.token})`,
      borderColor: `var(--color-${meta.token}-border, var(--color-border))`,
      background: `var(--color-${meta.token}-soft, var(--color-bg-page))`,
    },
  };
}

interface PurchaseRowProps {
  purchase: PurchaseListItem;
  isLast: boolean;
  onEdit: (purchase: PurchaseListItem) => void;
  onDelete: (purchase: PurchaseListItem) => void;
}

/** A single purchase as a stacked card row (mirrors `InventoryItemRow`): supplier and
 * total on top, then a meta line (date · status), then the line-count / shipping chips. */
export function PurchaseRow({ purchase: p, isLast, onEdit, onDelete }: PurchaseRowProps) {
  const [hovered, setHovered] = useState(false);
  const status = statusChip(p.status);

  const menuActions: RowAction[] = [
    { key: "edit", label: "Edit", icon: "✎", onSelect: () => onEdit(p) },
    {
      key: "delete",
      label: "Delete",
      icon: "✕",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete(p),
    },
  ];

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: "0.75rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
        }}
      >
        {/* Line 1: supplier (· via platform) + actions */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: p.contactName ? "var(--color-text-primary)" : "var(--color-text-muted)",
              fontStyle: p.contactName ? undefined : "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flexShrink: 0,
              maxWidth: "60%",
            }}
          >
            {p.contactName ?? "No supplier"}
          </span>
          {p.platformName && (
            <span style={META_INLINE} title={`Bought via ${p.platformName}`}>
              via {p.platformName}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <RowActionsMenu actions={menuActions} ariaLabel="Purchase actions" />
        </div>

        {/* Line 2: date + status */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.2rem" }}>
          <span style={META_INLINE}>{p.purchasedAt}</span>
          <span style={status.style} title="Delivery status">
            {status.label}
          </span>
        </div>

        {/* Line 3: line-count / shipping chips + total */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            marginTop: "0.6rem",
            flexWrap: "wrap",
          }}
        >
          <span style={CHIP}>
            {p.lotCount} lot{p.lotCount === 1 ? "" : "s"}
          </span>
          {p.expenseCount > 0 && (
            <span style={CHIP}>
              {p.expenseCount} expense{p.expenseCount === 1 ? "" : "s"}
            </span>
          )}
          {p.shippingCost && (
            <span style={CHIP} title="Shipping / shared cost">
              🚚 {p.shippingCost} {p.currency}
            </span>
          )}
          <span
            style={{
              marginLeft: "auto",
              fontSize: "0.875rem",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text-primary)",
              whiteSpace: "nowrap",
            }}
            title="Total (lots + expenses + shipping)"
          >
            {p.total} {p.currency}
          </span>
        </div>
      </div>
    </div>
  );
}
