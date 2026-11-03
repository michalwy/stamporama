"use client";

import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { useStampPhotos } from "@/app/c/[collectionSlug]/stamps/use-stamps-query";

/**
 * **A stamp's picture on a row of a piece's stamps** (#2390) — the stamps-on-piece list and the
 * piece's price panel, in identification, in the copy's Edit dialog and in its Valuation window. In a
 * set like an overprint series every row reads the same, and the picture is what the piece in hand is
 * checked against.
 *
 * It is the stamp's own picture — the variant's when a variant is picked — never the piece's, read
 * through the same cached query the identification step uses, so a photo it just replaced is the one
 * shown here too. A stamp without one keeps the empty placeholder, so the rows stay aligned. Out of
 * the Tab order: a picture is looked at, never a stop between two fields.
 */
export function PieceStampThumb({
  collectionId,
  stampId,
  size = "3rem",
}: {
  collectionId: string;
  stampId: string;
  size?: string;
}) {
  const { data: photos } = useStampPhotos(collectionId, stampId);
  return (
    <PhotoThumb
      collectionId={collectionId}
      photos={photos ?? []}
      plain
      reserveWhenEmpty
      size={size}
      tabIndex={-1}
    />
  );
}
