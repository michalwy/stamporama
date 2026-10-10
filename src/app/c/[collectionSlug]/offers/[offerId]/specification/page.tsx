import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { readOfferSpecification } from "@/lib/offer-specification";
import { formatEntityNo } from "@/lib/quick-jump";
import { PrintButton } from "@/app/c/[collectionSlug]/shared/print-button";
import { SpecificationSheet } from "./specification-sheet";

interface PageProps {
  params: Promise<{ collectionSlug: string; offerId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { offerId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const spec = await readOfferSpecification(session.user.id, offerId);
  if (!spec) return {};
  // The tab title is what the browser offers as the PDF's file name, so it leads with the number.
  return { title: `Specification ${formatEntityNo(spec.offerNo)} — ${spec.title}` };
}

/**
 * An offer's **specification** for buyers (#1758): every copy the offer holds, with what a buyer
 * asks about it, as a page the browser prints or saves as a PDF.
 *
 * Printed through the browser (`@media print` in `globals.css`), as the packing list and the parcel
 * enclosure are. **Everything on it is for the buyer**: the offer's number and title, and the
 * copies. Nothing about the collector, the platform, the price, the value, packing or the sale — so
 * no generated-at footer naming the collection either, which the collector's own sheets carry.
 */
export default async function OfferSpecificationPage({ params }: PageProps) {
  const { collectionSlug, offerId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const spec = await readOfferSpecification(session.user.id, offerId);
  if (!spec || spec.collectionId !== collection.id) notFound();

  const count = spec.rows.length;

  return (
    <div className="print-sheet" style={{ padding: "2rem", maxWidth: "60rem" }}>
      {/* Screen-only controls */}
      <div
        className="no-print"
        style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}
      >
        <Link
          href={`/c/${collectionSlug}/offers/${offerId}`}
          style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", textDecoration: "none" }}
        >
          ← Offer {formatEntityNo(spec.offerNo)}
        </Link>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          To keep it as a PDF, choose “Save as PDF” in the print dialog.
        </span>
        <PrintButton />
      </div>

      <header style={{ borderBottom: "2px solid var(--color-border-strong)", paddingBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
            {formatEntityNo(spec.offerNo)} · {spec.title}
          </h1>
        </div>
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          Specification — {count} {count === 1 ? "copy" : "copies"}
        </p>
      </header>

      <SpecificationSheet collectionId={spec.collectionId} rows={spec.rows} />
    </div>
  );
}
