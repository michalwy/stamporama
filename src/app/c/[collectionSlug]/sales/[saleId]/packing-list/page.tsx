import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getSaleDetail, listSaleCopies } from "@/lib/sales";
import { getAppVersionLabel } from "@/lib/version";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { buildAreaVendorMaps } from "@/lib/area-vendor";
import { loadIssuePrefixMap } from "@/lib/issue-prefix";
import { buildPackingList } from "@/lib/packing-list";
import { formatEntityNo } from "@/lib/quick-jump";
import { saleStatusMeta } from "../../sale-status";
import { PrintButton } from "@/app/c/[collectionSlug]/shared/print-button";
import { GeneratedAt } from "@/app/c/[collectionSlug]/shared/generated-at";
import { PackingSheet } from "./packing-sheet";
import { Icon } from "@/app/icons";

interface PackingListPageProps {
  params: Promise<{ collectionSlug: string; saleId: string }>;
}

export async function generateMetadata({ params }: PackingListPageProps): Promise<Metadata> {
  const { saleId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const sale = await getSaleDetail(session.user.id, saleId);
  if (!sale) return {};
  return { title: `Packing list ${formatEntityNo(sale.saleNo)} — ${sale.platformName}` };
}

/** The sale date is a **calendar date**, not an instant (`soldAt` is `@db.Date`, read back as UTC
 * midnight), so it is printed off the UTC fields exactly as stored — reading it through a zone is
 * what would move it a day. The generated *timestamp* is a real instant and belongs to the
 * collector's zone instead; that one is `GeneratedAt` (#503). */
function formatDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Printable packing list for a sale (#330): the sold copies as a paper checklist, sectioned by
 * storage location so the sheet is a walk-order through the shelves. Everything is server-rendered
 * — no filters, no toggles, no lazy loading — because the artifact is the printout; the interactive
 * packing view lives on the sale detail screen. App chrome (`.no-print`) drops out on paper.
 */
export default async function PackingListPage({ params }: PackingListPageProps) {
  const { collectionSlug, saleId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const sale = await getSaleDetail(session.user.id, saleId);
  if (!sale || sale.collectionId !== collection.id) notFound();

  const [areas, issuePrefixes, locations, copies] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    loadIssuePrefixMap(collection.id),
    getLocations(session.user.id, collection.id),
    listSaleCopies(session.user.id, saleId),
  ]);

  const list = buildPackingList(
    copies,
    areas,
    locations,
    buildAreaVendorMaps(areas, issuePrefixes)
  );
  const status = saleStatusMeta(sale.status);

  return (
    <div className="print-sheet" style={{ padding: "2rem", maxWidth: "56rem" }}>
      {/* Screen-only controls */}
      <div
        className="no-print"
        style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}
      >
        <Link
          href={`/c/${collectionSlug}/sales/${saleId}`}
          style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", textDecoration: "none" }}
        >
          ← Back to the sale
        </Link>
        {/* Browsers won't render CSS page numbers, but their own print header/footer does — so
            point at it rather than pretend the sheet can number its pages itself. */}
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          For page numbers, enable “Headers and footers” in the print dialog.
        </span>
        <PrintButton />
      </div>

      {/* Sheet header — who and what this parcel is */}
      <header style={{ borderBottom: "2px solid var(--color-border-strong)", paddingBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
          {/* The sale's own number (#432) rides in the title (#474): it is this collection's name
              for the transaction, so it identifies the sheet before anything else on it — and it is
              the reference quoted back on paper. `Order` below is the *marketplace's* number, which
              is a different thing and stays where it was. */}
          <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
            Packing list {formatEntityNo(sale.saleNo)}
          </h1>
          <span style={{ fontSize: "1rem", color: "var(--color-text-secondary)" }}>
            {sale.platformName}
            {sale.buyerName ? ` — ${sale.buyerName}` : ""}
          </span>
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
          <Meta label="Sold" value={formatDate(sale.soldAt)} />
          {sale.externalRef && <Meta label="Order" value={sale.externalRef} />}
          <Meta label="Buyer" value={sale.buyerName ?? "unknown"} />
          {/* How the parcel goes out (#468) — printed only when the buyer's choice is recorded,
              since an empty "Shipping: —" tells the packer nothing they can act on. It sits beside
              the buyer because it is the other half of "where this parcel is going". */}
          {sale.shippingMethodName && <Meta label="Shipping" value={sale.shippingMethodName} />}
          <Meta label="Status" value={status.label} />
          <Meta
            label="Copies"
            value={`${list.totalCopies} in ${sale.lines.length} sold ${sale.lines.length === 1 ? "set" : "sets"}`}
          />
          <Meta label="Packed" value={`${list.packedCopies} of ${list.totalCopies}`} />
        </div>
      </header>

      <PackingSheet collectionId={collection.id} itemNoPad={collection.itemNoPad} list={list} />

      {/* The legend closes the document — it is read once, after the last row, so it stays in the
          flow rather than repeating at the foot of every page. */}
      <footer
        style={{
          marginTop: "1.5rem",
          paddingTop: "0.625rem",
          borderTop: "1px solid var(--color-border)",
          fontSize: "0.6875rem",
          color: "var(--color-text-muted)",
        }}
      >
        A ticked box (<Icon name="check" size="xs" />) is a copy already marked packed in Stamporama; empty boxes are for ticking
        by hand as you pack.
      </footer>

      {/* Pinned to the foot of every printed page (`.print-footer`). It carries enough to identify
          the sale on its own — a page that gets separated from the stack has to be matchable back
          to its order without the header — plus the provenance of the printout itself. */}
      <div
        className="print-footer"
        style={{
          marginTop: "0.5rem",
          fontSize: "0.6875rem",
          color: "var(--color-text-muted)",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <span>
          <strong style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>
            {formatEntityNo(sale.saleNo)} · {sale.platformName}
            {sale.buyerName ? ` — ${sale.buyerName}` : ""}
          </strong>
          {sale.externalRef ? ` · #${sale.externalRef}` : ""} · sold {formatDate(sale.soldAt)} ·{" "}
          {list.totalCopies} {list.totalCopies === 1 ? "copy" : "copies"} · {status.label}
        </span>
        <span>
          Stamporama {getAppVersionLabel()} · {collection.name} · generated{" "}
          <GeneratedAt iso={new Date().toISOString()} />
        </span>
      </div>
    </div>
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
