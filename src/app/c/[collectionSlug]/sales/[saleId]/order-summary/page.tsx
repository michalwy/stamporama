import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getSaleDetail, listSaleCopies, saleCopySetOrder } from "@/lib/sales";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { buildAreaVendorMaps } from "@/lib/area-vendor";
import { loadIssuePrefixMap } from "@/lib/issue-prefix";
import { buildPackingList, type PackingSet } from "@/lib/packing-list";
import { orderSummarySetOrder, orderSummaryTotals, sortCopiesInSetOrder } from "@/lib/order-summary";
import { formatEntityNo } from "@/lib/quick-jump";
import { saleLineHeading } from "@/lib/sale-line-name";
import { isSaleCancelled } from "@/lib/sale-status";
import { saleStatusMeta } from "../../sale-status";
import { PrintButton } from "@/app/c/[collectionSlug]/shared/print-button";
import { Screen } from "@/app/screen";
import { OrderSummarySheet, type OrderSummarySet } from "./order-summary-sheet";
import { SalePrintFooter } from "../sale-print-footer";

interface OrderSummaryPageProps {
  params: Promise<{ collectionSlug: string; saleId: string }>;
}

export async function generateMetadata({ params }: OrderSummaryPageProps): Promise<Metadata> {
  const { saleId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const sale = await getSaleDetail(session.user.id, saleId);
  if (!sale) return {};
  // The title is what a saved PDF is named after, so it says what the document is and whose.
  return { title: `Order summary ${formatEntityNo(sale.saleNo)} — ${sale.platformName}` };
}

/** The sale date is a calendar date stored as UTC midnight — printed off the UTC fields, as the
 *  packing list prints it. */
function formatDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * The buyer's order summary (#2512): what the buyer bought and what it came to, to print or save as
 * PDF and send. Built like the packing list (#330) — a server-rendered sheet, the screen-only
 * controls dropping out on paper — but written for the buyer: **nothing on it is the collector's**.
 * No locations, tick boxes, refs, copy numbers, packed counts, costs or profit, and no note (#2379).
 * The one exception is the page footer, which is the packing list's own (#2519) and so names the
 * collection.
 *
 * Every set prints with its copies or by its title only (the sheet's switch). A cancelled sale
 * (#2500) still prints — its sets as the sale kept them, its status *Cancelled*. Printing it changes
 * nothing on the sale.
 */
export default async function OrderSummaryPage({ params }: OrderSummaryPageProps) {
  const { collectionSlug, saleId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const sale = await getSaleDetail(session.user.id, saleId);
  if (!sale || sale.collectionId !== collection.id) notFound();

  const cancelled = isSaleCancelled(sale.status);
  const money = (amount: string) => `${amount} ${sale.currency}`;

  let sets: OrderSummarySet[];
  let setPrices: string[];
  // The copies the sale holds, as the packing list counts them — none once it is cancelled.
  let copyCount = 0;
  if (cancelled) {
    // A cancelled sale's copies went back to stock; what it keeps is each set's name and price.
    sets = sale.cancelledLines.map((l) => ({
      id: l.id,
      title: l.offerNo !== null ? `${formatEntityNo(l.offerNo)} · ${l.title}` : l.title,
      numbers: l.numbers,
      price: l.freeExtra ? null : money(l.price),
      freeExtra: l.freeExtra,
      copyCount: null,
      rows: [],
    }));
    sets = [...sets.filter((s) => !s.freeExtra), ...sets.filter((s) => s.freeExtra)];
    setPrices = sale.cancelledLines.filter((l) => !l.freeExtra).map((l) => l.price);
  } else {
    const [areas, issuePrefixes, locations, copies, setOrder] = await Promise.all([
      getCollectionAreas(session.user.id, collection.id),
      loadIssuePrefixMap(collection.id),
      getLocations(session.user.id, collection.id),
      listSaleCopies(session.user.id, saleId),
      saleCopySetOrder(session.user.id, saleId),
    ]);
    const positions = orderSummarySetOrder(sale.lines);
    const bySetId = new Map<string, PackingSet>(
      sale.lines.map((line) => [
        line.id,
        {
          id: line.id,
          title: saleLineHeading(line.name),
          numbers: line.name.numbers,
          onNoOffer: line.offerSetId === null,
          freeExtra: line.freeExtra,
          price: line.freeExtra ? "" : money(line.price),
          position: positions.get(line.id) ?? 0,
        },
      ])
    );
    // One row per copy, in the set's own order — not the shelf order the packing list walks.
    const list = buildPackingList(
      sortCopiesInSetOrder(copies, setOrder).map((c) => ({ ...c, set: bySetId.get(c.saleLineId) ?? null })),
      areas,
      locations,
      buildAreaVendorMaps(areas, issuePrefixes),
      { grouping: "set", rowOrder: "given", merge: false }
    );
    copyCount = list.totalCopies;
    const rowsBySet = new Map(list.groups.map((g) => [g.set?.id ?? "", g.rows]));
    sets = [...sale.lines]
      .sort((a, b) => (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0))
      .map((line) => ({
        id: line.id,
        title: saleLineHeading(line.name),
        numbers: line.name.numbers,
        price: line.freeExtra ? null : money(line.price),
        freeExtra: line.freeExtra,
        copyCount: line.copyCount,
        rows: rowsBySet.get(line.id) ?? [],
      }));
    setPrices = sale.lines.filter((l) => !l.freeExtra).map((l) => l.price);
  }

  const totals = orderSummaryTotals({
    setPrices,
    // A total-anchored sale's handling is derived from the total; the helper derives it itself.
    buyerHandling: sale.buyerPaidTotal != null ? null : sale.buyerHandling,
    buyerPaidTotal: sale.buyerPaidTotal,
  });
  const status = saleStatusMeta(sale.status);

  return (
    <Screen cap="sheet" className="print-sheet">
      {/* Screen-only controls */}
      <div
        className="no-print"
        style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}
      >
        <Link
          href={`/c/${collectionSlug}/sales/${saleId}`}
          style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", textDecoration: "none" }}
        >
          ← Sale {formatEntityNo(sale.saleNo)}
        </Link>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          To send it as a PDF, choose “Save as PDF” in the print dialog.
        </span>
        <PrintButton />
      </div>

      <header style={{ borderBottom: "2px solid var(--color-border-strong)", paddingBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
            Order summary {formatEntityNo(sale.saleNo)}
          </h1>
          <span style={{ fontSize: "1rem", color: "var(--color-text-secondary)" }}>{sale.platformName}</span>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.375rem 1.5rem",
            margin: "0.625rem 0 0",
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
          }}
        >
          <Meta label="Date" value={formatDate(sale.soldAt)} />
          {sale.buyerName && <Meta label="Buyer" value={sale.buyerName} />}
          {sale.shippingOptionName && <Meta label="Shipping" value={sale.shippingOptionName} />}
          <Meta label="Status" value={status.label} />
        </div>
      </header>

      <OrderSummarySheet collectionId={collection.id} sets={sets} />

      {/* The totals, the same in either mode. */}
      <table
        style={{
          marginTop: "1.5rem",
          marginLeft: "auto",
          borderCollapse: "collapse",
          fontSize: "0.875rem",
          color: "var(--color-text-primary)",
          breakInside: "avoid",
        }}
      >
        <tbody>
          <TotalRow
            label={`Items (${totals.sets} ${totals.sets === 1 ? "set" : "sets"})`}
            value={money(totals.items)}
          />
          <TotalRow label="Shipping" value={money(totals.shipping)} />
          <TotalRow label="Total" value={money(totals.total)} strong />
        </tbody>
      </table>

      {/* The packing list's page footer (#2519), so a sale's two printouts carry the same one. */}
      <SalePrintFooter sale={sale} copyCount={copyCount} collectionName={collection.name} />
    </Screen>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const cell: React.CSSProperties = {
    padding: "0.25rem 0 0.25rem 2rem",
    fontWeight: strong ? 700 : undefined,
    borderTop: strong ? "1px solid var(--color-border-strong)" : undefined,
  };
  return (
    <tr>
      <td style={{ ...cell, paddingLeft: 0, color: strong ? undefined : "var(--color-text-secondary)" }}>{label}</td>
      <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {value}
      </td>
    </tr>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ fontWeight: 600, color: "var(--color-text-muted)" }}>{label}: </span>
      <span style={{ color: "var(--color-text-primary)" }}>{value}</span>
    </span>
  );
}
