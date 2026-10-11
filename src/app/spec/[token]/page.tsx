import type { Metadata } from "next";
import { headers } from "next/headers";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { verifyOfferSpecificationShareToken } from "@/lib/offer-specification-share";
import { readOfferSpecification } from "@/lib/offer-specification";
import {
  OFFER_SPECIFICATION_SHARE_REFUSAL,
  offerSpecificationSharePhotoPath,
} from "@/lib/offer-specification-share-rules";
import {
  SpecificationDocument,
  specificationThumbs,
} from "@/app/c/[collectionSlug]/offers/[offerId]/specification/specification-document";

// **An offer's specification, for a buyer with a link** (#1760): the printable page's contents
// (#1758), addressed by a secret link, for somebody with no account and no session.
//
// It sits outside `/c/[collectionSlug]` for the reason the trade partner's and the sale buyer's pages
// do (#640, #699) — the reader has no collection, and a slug would be a second name for what the
// token already resolves — so it inherits no collection layout: no sidebar, nothing to navigate into.
//
// **What is on it is the printable page's, and only that**: `readOfferSpecification`, the same read,
// drawn by the same `SpecificationDocument`, so the rows, the fields and the thumbnails are the same
// and as they stand when the page is opened — a copy sold since the link was made is gone from it.
// No price, no value, no other offer and nothing else from the collection; the specification's row
// type has no field for any of it.

export const metadata: Metadata = {
  title: "Specification",
  // A secret link is only secret while nothing publishes it.
  robots: { index: false, follow: false, nocache: true },
};

/** Requests per address per minute — generous for a buyer reading and reloading one page, and far
 *  below what walking the token space would need. */
const SHARE_PAGE_LIMIT = 60;
const SHARE_WINDOW_MS = 60_000;

interface SharePageProps {
  params: Promise<{ token: string }>;
}

export default async function OfferSpecificationSharePage({ params }: SharePageProps) {
  const { token } = await params;

  const limited = rateLimit(
    `offer-spec-share:${clientAddress(await headers())}`,
    SHARE_PAGE_LIMIT,
    SHARE_WINDOW_MS
  );
  if (!limited.ok) {
    return <Refusal message="Too many requests. Please wait a moment and reload the page." />;
  }

  const access = await verifyOfferSpecificationShareToken(token);
  if (!access) return <Refusal message={OFFER_SPECIFICATION_SHARE_REFUSAL} />;

  const spec = await readOfferSpecification(access.ownerId, access.offerId);
  if (!spec) return <Refusal message={OFFER_SPECIFICATION_SHARE_REFUSAL} />;

  return (
    <main style={PAGE}>
      <SpecificationDocument
        spec={spec}
        thumbSrc={specificationThumbs(spec, (photoId) =>
          offerSpecificationSharePhotoPath(token, photoId)
        )}
      />
    </main>
  );
}

const PAGE: React.CSSProperties = {
  padding: "2rem",
  maxWidth: "60rem",
  margin: "0 auto",
  minHeight: "100vh",
  background: "var(--color-bg-page)",
};

/** A dead link reads as one sentence, with no app around it and nothing of the offer. */
function Refusal({ message }: { message: string }) {
  return (
    <main style={PAGE}>
      <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
        Specification
      </h1>
      <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        {message}
      </p>
    </main>
  );
}
