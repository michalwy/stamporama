import type { Metadata } from "next";
import { headers } from "next/headers";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { readSharedProposalDocument, verifyProposalShareToken } from "@/lib/proposal-handout";
import {
  PROPOSAL_SHARE_REFUSAL,
  proposalDocumentLabelLanguage,
  proposalDocumentLabels,
  proposalDocumentPhotoSrcs,
  proposalSharePhotoPath,
} from "@/lib/proposal-document-rules";
import { ProposalDocument } from "@/app/c/[collectionSlug]/offers/proposals/[proposalNo]/document/proposal-document";

// **A proposal's document, for its buyer with a link** (#2288): the collector's printable page's
// contents, addressed by a secret link, for somebody with no account and no session.
//
// Outside `/c/[collectionSlug]` for the reason a post's preview is (#2212) — the reader has no
// collection — so it inherits no collection layout: no sidebar, nothing to navigate into.
//
// **What is on it is the printable page's, and only that**: `readProposalDocument`'s read, drawn by the
// same document. **It stays live** while the proposal is open — it follows the prices, and a lot
// withdrawn is marked no longer available. Once the proposal is sold, declined or gone, the page says
// only that the offer is closed, in the proposal's language.

// A secret link is only secret while nothing publishes it.
const ROBOTS: Metadata["robots"] = { index: false, follow: false, nocache: true };

/** The tab title is the page's word and the proposal's number, in its language. The read here does not
 *  count as the visit — the page's own does. */
export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { token } = await params;
  const access = await verifyProposalShareToken(token, { touch: false });
  if (!access) return { title: "Offer", robots: ROBOTS };
  const shared = await readSharedProposalDocument(access);
  const language = shared.standing === "shown" ? shared.document.language : shared.language;
  const proposalNo = shared.standing === "shown" ? shared.document.proposalNo : shared.proposalNo;
  const word = proposalDocumentLabels(language).offer;
  return { title: proposalNo !== null ? `${word} #${proposalNo}` : word, robots: ROBOTS };
}

/** Requests per address per minute — generous for a buyer reading and reloading one page, and far
 *  below what walking the token space would need. */
const SHARE_PAGE_LIMIT = 60;
const SHARE_WINDOW_MS = 60_000;

interface SharePageProps {
  params: Promise<{ token: string }>;
}

export default async function ProposalSharePage({ params }: SharePageProps) {
  const { token } = await params;

  const limited = rateLimit(`proposal-share:${clientAddress(await headers())}`, SHARE_PAGE_LIMIT, SHARE_WINDOW_MS);
  if (!limited.ok) {
    return <Notice message="Too many requests. Please wait a moment and reload the page." />;
  }

  const access = await verifyProposalShareToken(token);
  if (!access) return <Notice message={PROPOSAL_SHARE_REFUSAL} />;

  const shared = await readSharedProposalDocument(access);
  if (shared.standing !== "shown") {
    const labels = proposalDocumentLabels(shared.language);
    return (
      <Notice
        lang={proposalDocumentLabelLanguage(shared.language)}
        heading={shared.proposalNo !== null ? `${labels.offer} #${shared.proposalNo}` : labels.offer}
        message={labels.closed}
      />
    );
  }

  const { document } = shared;
  return (
    <main style={PAGE}>
      <ProposalDocument
        document={document}
        photoSrc={proposalDocumentPhotoSrcs(document, (photoId) => proposalSharePhotoPath(token, photoId, "full"))}
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

/** A dead link, or a proposal now closed, reads as one sentence with no app around it and nothing of
 *  the proposal. Before a proposal is known there is no language, so those refusals are English. */
function Notice({ message, heading = "Offer", lang = "en" }: { message: string; heading?: string; lang?: string }) {
  return (
    <main style={PAGE} lang={lang}>
      <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--color-text-primary)" }}>{heading}</h1>
      <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>{message}</p>
    </main>
  );
}
