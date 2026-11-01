import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { findProposalId } from "@/lib/proposals";
import { parseProposalNo } from "@/lib/proposal-rules";
import { readProposalDocument } from "@/lib/proposal-handout";
import { proposalDocumentLabels, proposalDocumentPhotoSrcs } from "@/lib/proposal-document-rules";
import { PrintButton } from "@/app/c/[collectionSlug]/shared/print-button";
import { Screen } from "@/app/screen";
import { ProposalDocument } from "./proposal-document";

interface PageProps {
  params: Promise<{ collectionSlug: string; proposalNo: string }>;
}

/** Resolve the address to the proposal, or null for one that is not the collector's. */
async function resolve(params: PageProps["params"]) {
  const { collectionSlug, proposalNo: raw } = await params;
  const proposalNo = parseProposalNo(raw);
  if (proposalNo === undefined) return null;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { signedOut: true as const };
  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) return null;
  const proposalId = await findProposalId(session.user.id, collection.id, proposalNo);
  if (!proposalId) return null;
  return { signedOut: false as const, userId: session.user.id, collectionSlug, collectionId: collection.id, proposalId };
}

/** The tab title is what the browser offers as the PDF's name — the buyer's file, so in the
 *  proposal's language. */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const page = await resolve(params);
  if (!page || page.signedOut) return {};
  const document = await readProposalDocument(page.userId, page.proposalId, page.collectionId);
  if (!document) return {};
  return { title: `${proposalDocumentLabels(document.language).offer} #${document.proposalNo}` };
}

/**
 * **A proposal's document for its buyer** (#2288), as a page the collector prints or saves as a PDF:
 * every lot with its number, title, price and photos, and the total. Printed through the browser
 * (`@media print` in `globals.css`), as a post's preview is (#2212). Everything on it is for the buyer —
 * nothing about the collection, the copies or the offers behind the lots.
 *
 * Opening it changes nothing: only *Mark sent* marks a proposal Sent (#2329).
 */
export default async function ProposalDocumentPage({ params }: PageProps) {
  const page = await resolve(params);
  if (page?.signedOut) redirect(await signInPath());
  if (!page) notFound();
  const { userId, proposalId, collectionSlug, collectionId } = page;
  const document = await readProposalDocument(userId, proposalId, collectionId);
  if (!document) notFound();
  const labels = proposalDocumentLabels(document.language);

  return (
    <Screen cap="proposalDocument" className="print-sheet">
      {/* Screen-only controls */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
        <Link
          href={`/c/${collectionSlug}/offers/proposals/${document.proposalNo}`}
          style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", textDecoration: "none" }}
        >
          ← Proposal #{document.proposalNo}
        </Link>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          To keep it as a PDF, choose “Save as PDF” in the print dialog.
        </span>
        <PrintButton />
      </div>

      {document.standing === "shown" ? (
        <ProposalDocument
          document={document}
          photoSrc={proposalDocumentPhotoSrcs(document, (photoId) => `/api/collections/${collectionId}/photos/${photoId}/full`)}
        />
      ) : (
        // What a buyer with the link sees now: the proposal is sold or declined.
        <p style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>{labels.closed}</p>
      )}
    </Screen>
  );
}
