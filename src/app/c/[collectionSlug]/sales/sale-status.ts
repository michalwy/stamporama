import type { CSSProperties } from "react";
import { SALE_STATUS_ORDER, type SaleStatus } from "@/lib/sale-status";

// Shared presentation for a sale's fulfillment status (#191), used by the list row badge and the
// detail-view inline control so the label + tint stay in sync. Order comes from the domain module.
export { SALE_STATUS_ORDER, type SaleStatus };

/** Label + semantic color token per status. `muted` renders as the plain chip; every other token
 * maps to `--color-{token}` / `-soft` / `-border` tints (mirrors the purchase status chip). */
export const SALE_STATUS_META: Record<SaleStatus, { label: string; token: string }> = {
  ordered: { label: "Ordered", token: "muted" },
  paid: { label: "Paid", token: "accent" },
  packed: { label: "Packed", token: "accent" },
  sent: { label: "Sent", token: "accent" },
  received: { label: "Received", token: "success" },
};

const BASE_CHIP: CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

/** Tinted chip style for a status token. `muted` keeps the neutral chip. */
export function saleStatusChipStyle(token: string): CSSProperties {
  if (token === "muted") return BASE_CHIP;
  return {
    ...BASE_CHIP,
    color: `var(--color-${token})`,
    borderColor: `var(--color-${token}-border, var(--color-border))`,
    background: `var(--color-${token}-soft, var(--color-bg-page))`,
  };
}

/** Meta for any stored status string, falling back to a raw label for unknown values. */
export function saleStatusMeta(status: string): { label: string; token: string } {
  return SALE_STATUS_META[status as SaleStatus] ?? { label: status, token: "muted" };
}
