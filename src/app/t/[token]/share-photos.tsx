"use client";

import { useState } from "react";
import { PhotoLightbox, ThumbPreview, type ViewablePhoto } from "@/app/photo-viewer";

// **The scans, on the partner's page** (#666).
//
// The reason the pictures are on this page at all is that deciding whether to accept a stamp means
// looking at the perforation, the cancel and the gum — and at a thumbnail's size none of that is
// visible. So the row's pictures behave the way every other picture in the app does: resting on one
// enlarges it beside the row, clicking it opens the full variant with the copy's other scans
// reachable from there. Both come from `@/app/photo-viewer`, the same preview and the same overlay
// the collector's own screens draw, so a partner's hover and a collector's hover are one behaviour.
//
// **Nothing new is served.** These ids come off this trade's own lines and are addressed through the
// token's own route, which refuses any photo that is not on them — the `full` variant included, which
// it has served since #640.

/**
 * How many pictures a row shows at rest.
 *
 * Front and back of a copy is the normal case, and that is what the two slots are for. A row is a
 * line of text with its pictures beside it, and a strip wider than the line it belongs to stops
 * reading as a row — so a third scan is behind the last thumbnail's `+n` rather than in the column,
 * one click from being looked at properly.
 */
const MAX_THUMBS = 2;

function photoUrl(token: string, photoId: string, variant: "thumb" | "full"): string {
  return `/api/t/${encodeURIComponent(token)}/photos/${photoId}/${variant}`;
}

/** What one scan is called. The partner's page knows no roles — a give line's pictures are the
 *  copy's, in the order the collection holds them, and *Scan 2* is as much as can honestly be said
 *  about the second one. */
function scanLabel(index: number, total: number): string {
  return total === 1 ? "Scan" : `Scan ${index + 1}`;
}

export function SharePhotos({ token, photoIds }: { token: string; photoIds: string[] }) {
  // Which scan the lightbox is open on, or null for closed. The strip owns it so that opening on
  // the second thumbnail opens *there* rather than at the start of the copy's pictures.
  const [openAt, setOpenAt] = useState<number | null>(null);

  if (photoIds.length === 0) return null;

  const photos: ViewablePhoto[] = photoIds.map((photoId, index) => ({
    key: photoId,
    src: photoUrl(token, photoId, "full"),
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
          thumbSrc={photoUrl(token, photo.key, "thumb")}
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
            <img className="ts-thumb" src={photoUrl(token, photo.key, "thumb")} alt="" />
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
