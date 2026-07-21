"use client";

import type { LotKind, LotState, LotSaleStatus } from "@/lib/sale-lot-rules";

// Shared chip presentation for lot kind / lifecycle state / derived sale status (ADR-0012
// §2/§3, #164), reused by the list rows and the detail header so a lot reads identically
// everywhere.

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

function tinted(token: string, label: string, title?: string) {
  return (
    <span
      style={{
        ...CHIP,
        color: `var(--color-${token})`,
        borderColor: `var(--color-${token}-border, var(--color-border))`,
        background: `var(--color-${token}-soft, var(--color-bg-page))`,
      }}
      title={title}
    >
      {label}
    </span>
  );
}

const KIND_LABEL: Record<LotKind, string> = {
  unit: "Unit",
  quantity: "Quantity",
};

export function KindChip({ kind }: { kind: LotKind }) {
  return (
    <span style={CHIP} title={kind === "unit" ? "A single stamp or an indivisible komplet" : "A group of interchangeable sub-lots"}>
      {KIND_LABEL[kind]}
    </span>
  );
}

const STATE: Record<LotState, { token: string | null; label: string }> = {
  draft: { token: null, label: "Draft" },
  ready: { token: "accent", label: "Ready" },
  dissolved: { token: null, label: "Dissolved" },
};

export function StateChip({ state }: { state: LotState }) {
  const meta = STATE[state];
  if (!meta.token) return <span style={CHIP} title="Lifecycle state">{meta.label}</span>;
  return tinted(meta.token, meta.label, "Lifecycle state");
}

const SALE: Record<LotSaleStatus, { token: string | null; label: string }> = {
  available: { token: null, label: "Available" },
  "partially-sold": { token: "warning", label: "Partially sold" },
  sold: { token: "success", label: "Sold" },
};

/** Derived sale status. `available` is the resting state, so it renders nothing to avoid
 * chip clutter — only the notable states (partial / sold) show. */
export function SaleStatusChip({ status }: { status: LotSaleStatus }) {
  const meta = SALE[status];
  if (status === "available" || !meta.token) return null;
  return tinted(meta.token, meta.label, "Derived from member sale records");
}
