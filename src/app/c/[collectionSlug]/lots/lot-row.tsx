"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LotListItem } from "@/lib/sale-lots";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { KindChip, StateChip, SaleStatusChip } from "./lot-badges";

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

interface LotRowProps {
  lot: LotListItem;
  collectionSlug: string;
  baseCurrency: string;
  isLast: boolean;
  onRename: (lot: LotListItem) => void;
  onDissolve: (lot: LotListItem) => void;
  onDelete: (lot: LotListItem) => void;
}

/** A single lot as a stacked card row (mirrors `PurchaseRow`): label + actions on top, then
 * kind / state / derived-sale chips, then member count and aggregate value. The whole row
 * opens the composition detail screen. */
export function LotRow({
  lot,
  collectionSlug,
  baseCurrency,
  isLast,
  onRename,
  onDissolve,
  onDelete,
}: LotRowProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const detailHref = `/c/${collectionSlug}/lots/${lot.id}`;
  const memberNoun = lot.kind === "unit" ? "copy" : "sub-lot";
  const memberPlural = lot.kind === "unit" ? "copies" : "sub-lots";
  const dissolvable = lot.state !== "dissolved" && lot.saleStatus === "available";

  const menuActions: RowAction[] = [
    { key: "open", label: "Open", icon: "↗", onSelect: () => router.push(detailHref) },
    { key: "rename", label: "Rename", icon: "✎", onSelect: () => onRename(lot) },
    ...(dissolvable
      ? [{ key: "dissolve", label: "Dissolve", icon: "⇤", onSelect: () => onDissolve(lot) } as RowAction]
      : []),
    {
      key: "delete",
      label: "Delete",
      icon: "✕",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete(lot),
    },
  ];

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
          opacity: lot.state === "dissolved" ? 0.6 : 1,
        }}
      >
        {/* Line 1: label + actions */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: lot.title ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              fontStyle: lot.title ? undefined : "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "70%",
            }}
          >
            {lot.label}
          </span>
          <span style={{ flex: 1 }} />
          <span onClick={(e) => e.stopPropagation()}>
            <RowActionsMenu actions={menuActions} ariaLabel="Lot actions" />
          </span>
        </div>

        {/* Line 2: kind / state / sale-status chips */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
          <KindChip kind={lot.kind} />
          <StateChip state={lot.state} />
          <SaleStatusChip status={lot.saleStatus} />
          {lot.groupedInto > 0 && (
            <span
              style={{ ...CHIP, color: "var(--color-text-muted)", borderStyle: "dashed" }}
              title={`Grouped as a sub-lot in ${lot.groupedInto} quantity lot${lot.groupedInto === 1 ? "" : "s"}`}
            >
              in quantity lot{lot.groupedInto > 1 ? ` ×${lot.groupedInto}` : ""}
            </span>
          )}
        </div>

        {/* Line 3: member count + offers + value */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
          <span style={CHIP}>
            {lot.memberCount} {lot.memberCount === 1 ? memberNoun : memberPlural}
          </span>
          {lot.offerCount > 0 && (
            <span style={CHIP} title="Active + inactive offers">
              {lot.offerCount} offer{lot.offerCount === 1 ? "" : "s"}
            </span>
          )}
          {lot.value != null && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: "0.875rem",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                color: "var(--color-text-primary)",
                whiteSpace: "nowrap",
              }}
              title="Catalog value of the packaged copies"
            >
              {lot.value} {baseCurrency}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
