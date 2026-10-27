import type { Metadata } from "next";
import { headers } from "next/headers";
import { clientAddress, rateLimit } from "@/lib/rate-limit";
import { readSharedFacebookPostPreview, verifyFacebookPostPreviewToken } from "@/lib/facebook-post-preview";
import {
  FACEBOOK_POST_PREVIEW_REFUSAL,
  facebookPostPreviewLabelLanguage,
  facebookPostPreviewLabels,
  facebookPostPreviewPhotoPath,
  facebookPostPreviewPhotoSrcs,
} from "@/lib/facebook-post-preview-rules";
import { FacebookPostPreviewDocument } from "@/app/c/[collectionSlug]/offers/posts/[postNo]/preview/post-preview-document";

// **A Facebook post's preview, for a buyer with a link** (#2212): the collector's printable page's
// contents, addressed by a secret link, for somebody with no account and no session.
//
// Outside `/c/[collectionSlug]` for the reason the specification's page is (#1760) — the reader has no
// collection — so it inherits no collection layout: no sidebar, nothing to navigate into.
//
// **What is on it is the printable page's, and only that**: `readFacebookPostPreview`'s read, drawn by
// the same document. **It stays live**: the post's link in the group appears once the group has
// approved it, and lots that sold are marked. While the post is being prepared again, and once it is
// withdrawn or deleted, the page says only that, in the post's language.

// A secret link is only secret while nothing publishes it.
const ROBOTS: Metadata["robots"] = { index: false, follow: false, nocache: true };

/** The tab title is the post's title, or the page's word in the post's language. The read here does
 *  not count as the visit — the page's own does. */
export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { token } = await params;
  const access = await verifyFacebookPostPreviewToken(token, { touch: false });
  if (!access) return { title: "Preview", robots: ROBOTS };
  const shared = await readSharedFacebookPostPreview(access);
  if (shared.standing === "shown") {
    const { preview } = shared;
    return { title: preview.title ?? facebookPostPreviewLabels(preview.language).preview, robots: ROBOTS };
  }
  return { title: facebookPostPreviewLabels(shared.language).preview, robots: ROBOTS };
}

/** Requests per address per minute — generous for a buyer reading and reloading one page, and far
 *  below what walking the token space would need. */
const SHARE_PAGE_LIMIT = 60;
const SHARE_WINDOW_MS = 60_000;

interface SharePageProps {
  params: Promise<{ token: string }>;
}

export default async function FacebookPostPreviewSharePage({ params }: SharePageProps) {
  const { token } = await params;

  const limited = rateLimit(`fb-preview:${clientAddress(await headers())}`, SHARE_PAGE_LIMIT, SHARE_WINDOW_MS);
  if (!limited.ok) {
    return <Notice message="Too many requests. Please wait a moment and reload the page." />;
  }

  const access = await verifyFacebookPostPreviewToken(token);
  if (!access) return <Notice message={FACEBOOK_POST_PREVIEW_REFUSAL} />;

  const shared = await readSharedFacebookPostPreview(access);
  if (shared.standing !== "shown") {
    const labels = facebookPostPreviewLabels(shared.language);
    return (
      <Notice
        lang={facebookPostPreviewLabelLanguage(shared.language)}
        heading={labels.preview}
        message={shared.standing === "updating" ? labels.updating : labels.gone}
      />
    );
  }

  const { preview } = shared;
  return (
    <main style={PAGE}>
      <FacebookPostPreviewDocument
        preview={preview}
        photoSrc={facebookPostPreviewPhotoSrcs(preview, (photoId) => facebookPostPreviewPhotoPath(token, photoId, "full"))}
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

/** A dead link, or a post not shown now, reads as one sentence with no app around it and nothing of the
 *  post. Before a post is known there is no post language, so those refusals are English. */
function Notice({ message, heading = "Preview", lang = "en" }: { message: string; heading?: string; lang?: string }) {
  return (
    <main style={PAGE} lang={lang}>
      <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--color-text-primary)" }}>{heading}</h1>
      <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>{message}</p>
    </main>
  );
}
