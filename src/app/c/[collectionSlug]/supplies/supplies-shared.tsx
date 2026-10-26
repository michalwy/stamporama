"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { SupplyUseEntry } from "@/lib/packing-supplies";
import { describeUncostedSupplies } from "@/lib/supply-stock";

// What the Packing supplies screen's summary, detail dialog and register draw alike (#2195, #2196).

export const NUM: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
export const CELL: CSSProperties = { padding: "0.375rem 0.75rem", borderTop: "1px solid var(--color-border)" };
export const HEAD: CSSProperties = {
  padding: "0.375rem 0.75rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "var(--color-text-muted)",
  textAlign: "left",
};
export const CARD: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
};
export const TABLE: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" };

export type OwnUse = Extract<SupplyUseEntry, { kind: "own" }>;

/** A figure that leaves units out is marked incomplete, as a sale's supplies are (#1898). */
export function CostFigure({
  cost,
  baseCurrency,
}: {
  cost: { costBase: string | number; shortUnits: number; unratedUnits: number };
  baseCurrency: string;
}) {
  const amount = typeof cost.costBase === "number" ? cost.costBase.toFixed(2) : cost.costBase;
  const uncosted = describeUncostedSupplies(cost);
  if (!uncosted) return <>{`${amount} ${baseCurrency}`}</>;
  return (
    <>
      {`${amount} ${baseCurrency}`}
      <Tooltip content={`Incomplete: ${uncosted} — they cost nothing here until a purchase of the supply covers them`}>
        <span style={{ marginLeft: "0.5rem", color: "var(--color-warning)" }}>incomplete</span>
      </Tooltip>
    </>
  );
}

/** The intake document a batch came from, as a link. */
export function PurchaseDocument({
  base,
  purchase,
}: {
  base: string;
  purchase: { id: string; purchaseNo: number; kind: string; name: string | null };
}) {
  return (
    <>
      <EntityNoChip entity="purchase" no={purchase.purchaseNo} prefix="p" />{" "}
      <Link href={`${base}/purchases/${purchase.id}`}>
        {purchase.name ?? (purchase.kind === "opening_balance" ? "Opening balance" : "Purchase")}
      </Link>
      {purchase.kind === "opening_balance" && (
        <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          opening balance
        </span>
      )}
    </>
  );
}

/** The sale a supply was used on, as a link, with its buyer where known. */
export function SaleDocument({
  base,
  sale,
}: {
  base: string;
  sale: { id: string; saleNo: number; platformName: string; buyerName: string | null };
}) {
  return (
    <>
      <EntityNoChip entity="sale" no={sale.saleNo} prefix="s" />{" "}
      <Link href={`${base}/sales/${sale.id}`}>Sale on {sale.platformName}</Link>
      {sale.buyerName && (
        <span style={{ marginLeft: "0.5rem", color: "var(--color-text-muted)" }}>{sale.buyerName}</span>
      )}
    </>
  );
}

/** A use outside sales, with its note. */
export function OwnUseDocument({ note }: { note: string | null }) {
  return (
    <>
      <span style={{ color: "var(--color-text-primary)" }}>Outside sales</span>
      {note && <span style={{ marginLeft: "0.5rem", color: "var(--color-text-muted)" }}>{note}</span>}
    </>
  );
}
