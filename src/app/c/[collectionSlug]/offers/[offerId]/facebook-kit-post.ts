import type { FacebookKitLot, FacebookOfferKit } from "@/lib/facebook-auctions";
import type { FacebookMultiLotLayout } from "@/lib/facebook-group-rules";
import {
  facebookCaptionedPostGaps,
  facebookPartsText,
  facebookPostGaps,
  facebookPostSource,
  renderFacebookCaptionedPost,
  renderFacebookPostParts,
  type FacebookCaptionedPostGaps,
  type FacebookPostPart,
} from "@/lib/facebook-post-rules";
import { formatFacebookPost } from "@/lib/facebook-post-format";
import { sanitizeDescriptionHtml } from "@/app/c/[collectionSlug]/shared/rendered-description";

// A Facebook offer's post text as the browser draws it (#1544, #1772, #1800) — for the offer's card,
// and for the repost dialog, which shows what goes up again. Here because the closing time it states
// is a local time and the browser is the one place the collector's zone is known (#490). A captioned
// post (#1841) is its shared text and, per lot, the caption under that lot's photo.

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

/** A text as the card draws and copies it: its source, and formatted (#1772). */
export interface FacebookKitText {
  /** The Markdown as filled in. */
  source: string;
  /** Formatted for the card and the clipboard — sanitised HTML, and the plain text beside it. */
  html: string;
  plain: string;
}

/** One lot's caption in a captioned post (#1841), under that lot's photo. */
export interface FacebookKitCaption extends FacebookKitText {
  offerId: string;
  offerNo: number;
  lotNo: number | null;
}

export interface FacebookKitPost extends FacebookKitText {
  /** How the post is laid out (#1841): in `captions`, the text above is the post's shared text and
   *  each lot's is in `captions`. */
  layout: FacebookMultiLotLayout;
  /** Each lot's caption, in lot order — empty unless the post is captioned. */
  captions: FacebookKitCaption[];
  /** What it is missing (#1692) — none on a post already published, which nothing here changes.
   *  `missingPostText` and `missingPostTitle` (#1862) are a captioned post's alone. */
  gaps: FacebookCaptionedPostGaps;
  /** When the post was published and its text frozen (#1800), or null while it follows the template. */
  frozenAt: string | null;
}

const NO_GAPS: FacebookCaptionedPostGaps = {
  missingTemplates: [],
  emptyOwnTemplates: [],
  emptyPlaceholders: [],
  missingPostText: false,
  missingPostTitle: false,
};

function kitText(parts: readonly FacebookPostPart[]): FacebookKitText {
  const formatted = formatFacebookPost(parts);
  return { source: facebookPartsText(parts), html: sanitizeDescriptionHtml(formatted.html), plain: formatted.plain };
}

/**
 * The post: a lot that has been published as it was posted, the rest from the group's templates and
 * their figures now (#1800). `live` names the lots drawn as they would go up **now** — a repost's.
 */
export function renderFacebookKitPost(
  kit: FacebookOfferKit,
  live: (lot: FacebookKitLot) => boolean = () => false
): FacebookKitPost {
  const { templates, captions, layout, standingNote, lots, frozenAt, post: name } = facebookPostSource(
    { ...kit.group, layout: kit.layout, post: kit.post },
    kit.lots,
    formatClosesAt,
    live
  );
  if (layout === "captions") {
    const post = renderFacebookCaptionedPost(captions, standingNote, lots, name);
    return {
      ...kitText(post.post),
      layout,
      captions: post.captions.map((caption, i) => ({
        ...kitText(caption.parts),
        offerId: kit.lots.find((l) => l.lotNo === caption.lotNo)?.offerId ?? kit.lots[i].offerId,
        offerNo: caption.offerNo,
        lotNo: caption.lotNo,
      })),
      gaps: frozenAt ? NO_GAPS : facebookCaptionedPostGaps(captions, standingNote, lots, name),
      frozenAt,
    };
  }
  return {
    ...kitText(renderFacebookPostParts(templates, standingNote, lots)),
    layout,
    captions: [],
    gaps: frozenAt
      ? NO_GAPS
      : { ...facebookPostGaps(templates, standingNote, lots), missingPostText: false, missingPostTitle: false },
    frozenAt,
  };
}
