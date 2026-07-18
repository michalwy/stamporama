"use client";

import { useState } from "react";
import type { ItemListItem } from "@/lib/items";
import { rowBtnStyle, rowBtnDangerStyle } from "@/app/c/[collectionSlug]/shared/chip-styles";

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

const DISPOSITION_CHIP: React.CSSProperties = {
  ...CHIP,
  color: "var(--color-accent)",
  borderColor: "var(--color-accent-soft)",
  background: "var(--color-accent-soft)",
};

const META: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

function acquiredText(item: ItemListItem): string | null {
  return item.acquiredDate ? `Acquired ${item.acquiredDate}` : null;
}

/** Catalog valuation of a copy (ADR-0007 §7). Uncertain values (unknown variant, valued
 * at the lowest child price) are prefixed `~` and muted; unpriced copies show `—`;
 * a price in a currency with no base rate falls back to its own currency. */
function CopyValue({ item, baseCurrency }: { item: ItemListItem; baseCurrency: string }) {
  const v = item.value;
  if (v.unpriced) {
    return (
      <span style={{ ...META, fontVariantNumeric: "tabular-nums" }} title="No catalog price recorded for this condition.">
        —
      </span>
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
  return (
    <span
      title={title}
      style={{
        fontSize: "0.875rem",
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        color: v.uncertain ? "var(--color-text-muted)" : "var(--color-text-primary)",
        fontStyle: v.uncertain ? "italic" : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {v.uncertain ? "~" : ""}
      {text}
    </span>
  );
}

interface InventoryItemRowProps {
  item: ItemListItem;
  baseCurrency: string;
  isLast: boolean;
  onEdit: (item: ItemListItem) => void;
  onIdentify: (item: ItemListItem) => void;
  onViewHistory: (item: ItemListItem) => void;
  onDelete: (item: ItemListItem) => void;
}

export function InventoryItemRow({
  item,
  baseCurrency,
  isLast,
  onEdit,
  onIdentify,
  onViewHistory,
  onDelete,
}: InventoryItemRowProps) {
  const [hovered, setHovered] = useState(false);

  const catalogText = item.catalogNumbers.map((c) => c.number).join(", ");
  const issueText = [item.issueName ?? null, item.issueYear ? `(${item.issueYear})` : null]
    .filter(Boolean)
    .join(" ");
  const acquired = acquiredText(item);
  const price =
    item.purchasePrice != null
      ? `${item.purchasePrice}${item.purchaseCurrency ? ` ${item.purchaseCurrency}` : ""}`
      : null;

  const dispositions: string[] = [];
  if (item.inCollection) dispositions.push("In collection");
  if (item.forSale) dispositions.push("For sale");
  if (item.forTrade) dispositions.push("For trade");

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
          flexDirection: "column",
          gap: "0.375rem",
        }}
      >
        {/* Line 1: identity + actions */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
            {catalogText && (
              <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
                {catalogText}
              </span>
            )}
            {item.stampName && (
              <span style={{ fontSize: "0.9375rem", color: "var(--color-text-primary)" }}>
                {item.stampName}
              </span>
            )}
            {!catalogText && !item.stampName && (
              <span style={{ fontSize: "0.9375rem", color: "var(--color-text-muted)" }}>(stamp)</span>
            )}
            {issueText && <span style={META}>· {issueText}</span>}
            {item.unknownVariant && (
              <span
                style={{ ...CHIP, color: "var(--color-warning)", borderColor: "var(--color-warning-border, var(--color-border))" }}
                title="Copy is linked to the base stamp; the specific variant is unknown."
              >
                unknown variant
              </span>
            )}
          </div>
          <CopyValue item={item} baseCurrency={baseCurrency} />
          <div style={{ display: "flex", gap: "0.375rem", flexShrink: 0 }}>
            {item.unknownVariant && (
              <button type="button" style={rowBtnStyle} onClick={() => onIdentify(item)}>
                Identify variant
              </button>
            )}
            {item.hasHistory && (
              <button type="button" style={rowBtnStyle} onClick={() => onViewHistory(item)}>
                History
              </button>
            )}
            <button type="button" style={rowBtnStyle} onClick={() => onEdit(item)}>
              Edit
            </button>
            <button type="button" style={rowBtnDangerStyle} onClick={() => onDelete(item)}>
              Delete
            </button>
          </div>
        </div>

        {/* Line 2: condition, disposition, certificate, price, acquired, notes */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={CHIP} title={item.conditionName}>
            {item.conditionAbbreviation}
          </span>
          {dispositions.map((d) => (
            <span key={d} style={DISPOSITION_CHIP}>
              {d}
            </span>
          ))}
          {item.certificateStatusName && (
            <span style={CHIP} title="Certificate status">
              {item.certificateStatusName}
            </span>
          )}
          {item.contactName && (
            <span style={META} title="Acquisition source">
              From {item.contactName}
            </span>
          )}
          {price && <span style={META}>{price}</span>}
          {acquired && <span style={META}>{acquired}</span>}
          {item.notes && (
            <span style={META} title={item.notes}>
              📝 notes
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
