import type { Metadata } from "next";
import { headers } from "next/headers";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import {
  readSharedOfferSpecification,
  verifyOfferSpecificationShareToken,
} from "@/lib/offer-specification-share";
import { specificationLabelLanguage, specificationLabels } from "@/lib/offer-specification-labels";
import { formatEntityNo } from "@/lib/quick-jump";
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
// drawn by the same `SpecificationDocument`, so the rows, the fields and the thumbnails are the same.
// No price, no value, no other offer and nothing else from the collection; the specification's row
// type has no field for any of it.
//
// **And only while it is the specification the collector sent.** Once anything on it has changed —
// a copy sold or added, a condition, the title — or the offer has closed, the page shows the offer's
// number and a notice to ask the seller for a current specification, in the offer's language, and
// none of the contents (`readSharedOfferSpecification`).

// A secret link is only secret while nothing publishes it.
const ROBOTS: Metadata["robots"] = { index: false, follow: false, nocache: true };

/** The tab title is the page's word in the offer's language, with the offer's number. The read here
 *  does not count as the visit — the page's own does. */
export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { token } = await params;
  const access = await verifyOfferSpecificationShareToken(token, { touch: false });
  const shared = access ? await readSharedOfferSpecification(access) : null;
  if (!shared) return { title: "Specification", robots: ROBOTS };
  const language = shared.standing === "current" ? shared.spec.language : shared.language;
  const offerNo = shared.standing === "current" ? shared.spec.offerNo : shared.offerNo;
  return {
    title: `${specificationLabels(language).specification} ${formatEntityNo(offerNo)}`,
    robots: ROBOTS,
  };
}

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

  const shared = await readSharedOfferSpecification(access);
  if (!shared) return <Refusal message={OFFER_SPECIFICATION_SHARE_REFUSAL} />;

  if (shared.standing !== "current") {
    const labels = specificationLabels(shared.language);
    return (
      <Refusal
        lang={specificationLabelLanguage(shared.language)}
        heading={`${formatEntityNo(shared.offerNo)} · ${labels.specification}`}
        message={labels.changed}
      />
    );
  }

  const { spec } = shared;
  return (
    <main style={PAGE} lang={specificationLabelLanguage(spec.language)}>
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

/** A dead or outdated link reads as one sentence, with no app around it and nothing of the offer's
 *  contents. Before an offer is known there is no offer language, so those refusals are English. */
function Refusal({
  message,
  heading = "Specification",
  lang = "en",
}: {
  message: string;
  heading?: string;
  lang?: string;
}) {
  return (
    <main style={PAGE} lang={lang}>
      <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--color-text-primary)" }}>
        {heading}
      </h1>
      <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
        {message}
      </p>
    </main>
  );
}
