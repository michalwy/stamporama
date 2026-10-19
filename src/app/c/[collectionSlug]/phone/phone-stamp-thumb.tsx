"use client";

import { photoThumbUrl } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { THUMB_OBJECT_FIT } from "@/app/photo-viewer";

// The thumbnail at the start of a phone stamp row (#2075): an issue's stamps when browsing and the
// search's hits. The photo is `loadPhoneStampThumbs`' — the stamp screen's own picture rule — and a
// stamp with none keeps an empty frame of the same size, so the rows stay aligned. It is part of the
// row's link, not a target of its own: a tap anywhere on the row opens the stamp.
//
// A client module only because the photo address and the fit rule live in client modules; it holds
// no state.

/** Big enough to tell one stamp from its neighbours at arm's length, small enough to leave the
 *  row's words their width. */
const PHONE_THUMB_SIZE = "4rem";

export function PhoneStampThumb({
  collectionId,
  photoId,
}: {
  collectionId: string;
  photoId: string | null;
}) {
  const frame = {
    flexShrink: 0,
    display: "block",
    width: PHONE_THUMB_SIZE,
    height: PHONE_THUMB_SIZE,
    borderRadius: "0.375rem",
    background: "var(--color-bg-muted)",
    boxSizing: "border-box",
  } as const;
  if (!photoId) return <span aria-hidden style={{ ...frame, border: "1px solid var(--color-border)" }} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the collection's own photo route
    <img
      src={photoThumbUrl(collectionId, photoId)}
      alt=""
      loading="lazy"
      style={{ ...frame, objectFit: THUMB_OBJECT_FIT }}
    />
  );
}
