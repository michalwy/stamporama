"use client";

import { useState } from "react";
import { PhotoLightbox, ThumbPreview, type ViewablePhoto } from "@/app/photo-viewer";

// **The scans, on a page reached by a share link** (#666; the buyer's page joined it in #699).
//
// The reason the pictures are on this page at all is that deciding whether to accept a stamp means
// looking at the perforation, the cancel and the gum — and at a thumbnail's size none of that is
// visible. So the row's pictures behave the way every other picture in the app does: resting on one
// enlarges it beside the row, clicking it opens the full variant with the copy's other scans
// reachable from there. Both come from `@/app/photo-viewer`, the same preview and the same overlay
// the collector's own screens draw, so a partner's hover and a collector's hover are one behaviour.
//
// **Nothing new is served.** These ids come off the one thing the token names — a trade's own lines,
// a sale's own candidates — and are addressed through that token's own photo route, which refuses
// any photo that is not among them, the `full` variant included.
//
// It lives outside both `/t` and `/s` because it belongs to neither: what differs between the two
// pages is the address the pictures come from, which is why `base` is a prop and not a token.

/**
 * How many pictures a row shows at rest.
 *
 * Front and back of a copy is the normal case, and that is what the two slots are for. A row is a
 * line of text with its pictures beside it, and a strip wider than the line it belongs to stops
 * reading as a row — so a third scan is behind the last thumbnail's `+n` rather than in the column,
 * one click from being looked at properly.
 */
const MAX_THUMBS = 2;

function photoUrl(base: string, photoId: string, variant: "thumb" | "full"): string {
  return `${base}/${photoId}/${variant}`;
}

/** What one scan is called. A share page knows no roles — the pictures are the copy's, in the order
 *  the collection holds them, and *Scan 2* is as much as can honestly be said about the second
 *  one. */
function scanLabel(index: number, total: number): string {
  return total === 1 ? "Scan" : `Scan ${index + 1}`;
}

export function SharePhotos({ base, photoIds }: { base: string; photoIds: string[] }) {
  // Which scan the lightbox is open on, or null for closed. The strip owns it so that opening on
  // the second thumbnail opens *there* rather than at the start of the copy's pictures.
  const [openAt, setOpenAt] = useState<number | null>(null);

  if (photoIds.length === 0) return null;

  const photos: ViewablePhoto[] = photoIds.map((photoId, index) => ({
    key: photoId,
    src: photoUrl(base, photoId, "full"),
    label: scanLabel(index, photoIds.length),
  }));
  const shown = photos.slice(0, MAX_THUMBS);
  const hidden = photos.length - shown.length;

  return (
    <>
      {shown.map((photo, index) => (
        <ThumbPreview
          key={photo.key}
          src={photo.src}
          thumbSrc={photoUrl(base, photo.key, "thumb")}
          label={photo.label}
          style={{ flex: "0 0 auto" }}
        >
          <button
            type="button"
            className="ts-thumb-btn"
            aria-label={`View ${photo.label}`}
            onClick={() => setOpenAt(index)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="ts-thumb" src={photoUrl(base, photo.key, "thumb")} alt="" />
            {/* Said on the last thumbnail rather than beside the strip: the count is about what is
                behind this picture, and it is the picture the click opens onto. */}
            {index === shown.length - 1 && hidden > 0 && (
              <span className="ts-thumb-more">+{hidden}</span>
            )}
          </button>
        </ThumbPreview>
      ))}

      {openAt !== null && (
        <PhotoLightbox
          photos={photos}
          index={openAt}
          onIndex={setOpenAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </>
  );
}
