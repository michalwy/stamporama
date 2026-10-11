import type { FacebookKitLot, FacebookOfferKit } from "@/lib/facebook-auctions";
import {
  facebookPostGaps,
  facebookPostSource,
  renderFacebookPostParts,
  renderFacebookPostText,
  type FacebookPostGaps,
} from "@/lib/facebook-post-rules";
import { formatFacebookPost } from "@/lib/facebook-post-format";
import { sanitizeDescriptionHtml } from "@/app/c/[collectionSlug]/shared/rendered-description";

// A Facebook offer's post text as the browser draws it (#1544, #1772, #1800) — for the offer's card,
// and for the repost dialog, which shows what goes up again. Here because the closing time it states
// is a local time and the browser is the one place the collector's zone is known (#490).

/** `Sun 5 Oct, 20:00` in the collector's own locale and zone. */
function formatClosesAt(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export interface FacebookKitPost {
  /** The post's source: its Markdown as filled in. */
  source: string;
  /** Formatted for the card and the clipboard — sanitised HTML, and the plain text beside it. */
  html: string;
  plain: string;
  /** What it is missing (#1692) — none on a post already published, which nothing here changes. */
  gaps: FacebookPostGaps;
  /** When the post was published and its text frozen (#1800), or null while it follows the template. */
  frozenAt: string | null;
}

const NO_GAPS: FacebookPostGaps = { missingTemplates: [], emptyOwnTemplates: [], emptyPlaceholders: [] };

/**
 * The post: a lot that has been published as it was posted, the rest from the group's templates and
 * their figures now (#1800). `live` names the lots drawn as they would go up **now** — a repost's.
 */
export function renderFacebookKitPost(
  kit: FacebookOfferKit,
  live: (lot: FacebookKitLot) => boolean = () => false
): FacebookKitPost {
  const { templates, standingNote, lots, frozenAt } = facebookPostSource(kit.group, kit.lots, formatClosesAt, live);
  const formatted = formatFacebookPost(renderFacebookPostParts(templates, standingNote, lots));
  return {
    source: renderFacebookPostText(templates, standingNote, lots),
    html: sanitizeDescriptionHtml(formatted.html),
    plain: formatted.plain,
    gaps: frozenAt ? NO_GAPS : facebookPostGaps(templates, standingNote, lots),
    frozenAt,
  };
}
