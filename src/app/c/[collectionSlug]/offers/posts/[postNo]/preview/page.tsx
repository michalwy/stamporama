import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { findFacebookPostId } from "@/lib/facebook-posts";
import { parseFacebookPostNo } from "@/lib/facebook-post-rules";
import { readFacebookPostPreview } from "@/lib/facebook-post-preview";
import { facebookPostPreviewLabels, facebookPostPreviewPhotoSrcs } from "@/lib/facebook-post-preview-rules";
import { PrintButton } from "@/app/c/[collectionSlug]/shared/print-button";
import { Screen } from "@/app/screen";
import { FacebookPostPreviewDocument } from "./post-preview-document";

interface PageProps {
  params: Promise<{ collectionSlug: string; postNo: string }>;
}

/** Resolve the address to the post's preview, or null for a post that is not the collector's. */
async function readPage(params: PageProps["params"]) {
  const { collectionSlug, postNo: rawPostNo } = await params;
  const postNo = parseFacebookPostNo(rawPostNo);
  if (postNo === undefined) return null;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { signedOut: true as const };
  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) return null;
  const postId = await findFacebookPostId(session.user.id, collection.id, postNo);
  if (!postId) return null;
  const preview = await readFacebookPostPreview(session.user.id, postId, collection.id);
  if (!preview) return null;
  return { signedOut: false as const, collectionSlug, collectionId: collection.id, preview };
}

/** The tab title is what the browser offers as the PDF's name — the buyer's file, so in the post's
 *  language. */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const page = await readPage(params);
  if (!page || page.signedOut) return {};
  const word = facebookPostPreviewLabels(page.preview.language).preview;
  return { title: page.preview.title ? `${page.preview.title} — ${word}` : `${word} #${page.preview.postNo}` };
}

/**
 * **A Facebook post's preview for a buyer** (#2212), as a page the collector prints or saves as a PDF:
 * the post as it will appear, its text and every lot with its number, title, price and photos.
 * Printed through the browser (`@media print` in `globals.css`), as the specification is (#1758).
 * Everything on it is for the buyer — nothing about the collection, the copies or the sale.
 */
export default async function FacebookPostPreviewPage({ params }: PageProps) {
  const page = await readPage(params);
  if (page?.signedOut) redirect(await signInPath());
  if (!page) notFound();
  const { preview, collectionSlug, collectionId } = page;
  const labels = facebookPostPreviewLabels(preview.language);

  return (
    <Screen cap="postPreview" className="print-sheet">
      {/* Screen-only controls */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
        <Link
          href={`/c/${collectionSlug}/offers/posts/${preview.postNo}`}
          style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)", textDecoration: "none" }}
        >
          ← Post #{preview.postNo}
        </Link>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          To keep it as a PDF, choose “Save as PDF” in the print dialog.
        </span>
        <PrintButton />
      </div>

      {preview.standing === "shown" ? (
        <FacebookPostPreviewDocument
          preview={preview}
          photoSrc={facebookPostPreviewPhotoSrcs(preview, (photoId) => `/api/collections/${collectionId}/photos/${photoId}/full`)}
        />
      ) : (
        // What a buyer with the link sees now: the post is being prepared again, or is over.
        <p style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
          {preview.standing === "updating" ? labels.updating : labels.gone}
        </p>
      )}
    </Screen>
  );
}
