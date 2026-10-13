import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import type { CSSProperties } from "react";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getSuppliesStock, type SupplyStockData } from "@/lib/packing-supplies";
import { Screen } from "@/app/screen";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";

export const metadata = { title: "Packing supplies" };

interface SuppliesPageProps {
  params: Promise<{ collectionSlug: string }>;
}

// The packing supplies' stock (#1897, ADR-0068): per supply, what is on hand, what it is worth at
// FIFO cost, and the batches it is made of with the intake document each came from. A screen that
// reads — the batches are written on their orders, the supplies named in Settings, and what sales
// used (#1898) on the sales.

const NUM: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const CELL: CSSProperties = { padding: "0.375rem 0.75rem", borderTop: "1px solid var(--color-border)" };
const HEAD: CSSProperties = {
  padding: "0.375rem 0.75rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "var(--color-text-muted)",
  textAlign: "left",
};

export default async function SuppliesPage({ params }: SuppliesPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const stock = await getSuppliesStock(session.user.id, collection.id);
  const base = `/c/${collectionSlug}`;

  return (
    <Screen>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", margin: "0 0 0.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          Packing supplies
        </h2>
        {stock.supplies.length > 0 && (
          <span style={{ fontSize: "0.9375rem", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            {stock.totalValueBase != null
              ? `${stock.totalValueBase} ${stock.baseCurrency} on hand`
              : `Value on hand not known in ${stock.baseCurrency}`}
          </span>
        )}
      </div>
      <p style={{ margin: "0 0 1.5rem", fontSize: "0.9375rem", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
        Each supply line of a purchase order is a batch, costed at its price plus its share of the
        order&apos;s shipping. A sale&apos;s packing supplies are taken oldest batch first.{" "}
        <Link href={`${base}/settings?tab=packing-supplies`}>Name your supplies in Settings</Link>.
      </p>

      {stock.supplies.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>No packing supplies yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {stock.supplies.map((supply) => (
            <SupplySection
              key={supply.id}
              supply={supply}
              baseCurrency={stock.baseCurrency}
              base={base}
            />
          ))}
        </div>
      )}
    </Screen>
  );
}

function SupplySection({
  supply,
  baseCurrency,
  base,
}: {
  supply: SupplyStockData;
  baseCurrency: string;
  base: string;
}) {
  return (
    <section
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        background: "var(--color-bg-elevated)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", padding: "0.75rem 1.25rem" }}>
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{supply.name}</span>
        <span style={{ flex: 1 }} />
        <span style={{ ...NUM, color: "var(--color-text-secondary)" }}>{supply.onHand} on hand</span>
        <span style={{ ...NUM, minWidth: "8rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {supply.valueBase != null ? `${supply.valueBase} ${baseCurrency}` : "—"}
        </span>
      </div>
      {supply.shortUnits > 0 && (
        <p style={{ margin: 0, padding: "0 1.25rem 0.5rem", fontSize: "0.8125rem", color: "var(--color-warning, var(--color-text-muted))" }}>
          {supply.shortUnits} used on sales but not in stock — those sales&apos; shipping lacks their
          cost until a purchase of this supply covers them.
        </p>
      )}
      {supply.unvaluedBatches > 0 && (
        <p style={{ margin: 0, padding: "0 1.25rem 0.5rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          {supply.unvaluedBatches} batch{supply.unvaluedBatches === 1 ? "" : "es"} bought in another
          currency without a rate into {baseCurrency}, so the value is not stated.
        </p>
      )}
      {supply.batches.length === 0 ? (
        <p style={{ margin: 0, padding: "0 1.25rem 0.75rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Never bought — add it as a supply line of a purchase order.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr>
              <th style={HEAD}>Bought on</th>
              <th style={HEAD}>Date</th>
              <th style={{ ...HEAD, ...NUM }}>Bought</th>
              <th style={{ ...HEAD, ...NUM }}>On hand</th>
              <th style={{ ...HEAD, ...NUM }}>Batch cost</th>
              <th style={{ ...HEAD, ...NUM }}>Unit cost</th>
              <th style={{ ...HEAD, ...NUM }}>Value</th>
            </tr>
          </thead>
          <tbody>
            {supply.batches.map((batch) => (
              <tr key={batch.id}>
                <td style={CELL}>
                  <EntityNoChip entity="purchase" no={batch.purchase.purchaseNo} prefix="p" />{" "}
                  <Link href={`${base}/purchases/${batch.purchase.id}`}>
                    {batch.purchase.name ??
                      (batch.purchase.kind === "opening_balance" ? "Opening balance" : "Purchase")}
                  </Link>
                  {batch.purchase.kind === "opening_balance" && (
                    <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      opening balance
                    </span>
                  )}
                </td>
                <td style={{ ...CELL, whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
                  {batch.purchase.purchasedAt}
                </td>
                <td style={{ ...CELL, ...NUM }}>{batch.quantity}</td>
                <td style={{ ...CELL, ...NUM }}>{batch.onHand}</td>
                <td style={{ ...CELL, ...NUM, color: "var(--color-text-secondary)" }}>
                  {batch.costTx} {batch.currency}
                </td>
                <td style={{ ...CELL, ...NUM }}>
                  {batch.unitCostBase != null ? `${batch.unitCostBase} ${baseCurrency}` : "—"}
                </td>
                <td style={{ ...CELL, ...NUM }}>
                  {batch.valueBase != null ? `${batch.valueBase} ${baseCurrency}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
