"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { offerKeys, useInvalidateOffers } from "../use-offers-query";
import { PhotoCoverWalkDialog, type CoverWalkEntry } from "../../shared/photo-cover-walk-dialog";
import type { OfferCoverWalk, OfferCoverWalkPhoto } from "@/lib/offer-photo-generation";

// An offer's cover walk (#1665): the copy photos its images are made from, read when the walk opens.
// Opened from the Photos card and from beside **Mark ready** when unchecked photos are what holds the
// offer back — one component, so both open the same walk.

function photoLabel(photo: OfferCoverWalkPhoto): string {
  const side = photo.side === "front" ? "front" : photo.side === "back" ? "back" : photo.title || "extra";
  return `${photo.copyLabel} — ${side}`;
}

/**
 * `mode`: `unchecked` walks only the photos never checked (what the ready gate counts); `all` revisits
 * every one. With `regenerate` the offer's images are queued again when the walk closes having
 * changed something, which is what *regenerated when covers change* means in practice — a stale image
 * would otherwise keep a symbol showing the collector has just covered.
 */
export function OfferCoverWalk({
  collectionId,
  offerId,
  mode,
  onClose,
}: {
  collectionId: string;
  offerId: string;
  mode: "unchecked" | "all";
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { invalidateDetail } = useInvalidateOffers();
  const [regenerate, setRegenerate] = useState(true);
  const [, startTransition] = useTransition();
  const { data, isLoading } = useQuery<OfferCoverWalk>({
    queryKey: offerKeys.coverWalk(collectionId, offerId),
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/offers/${offerId}/photo-covers`);
      if (!res.ok) throw new Error("Failed to load the photos to check");
      return res.json();
    },
    // The list is read once per opening and then kept by the dialog itself.
    staleTime: 0,
    gcTime: 0,
  });

  if (isLoading || !data) return null;

  const photos: CoverWalkEntry[] = data.photos
    .filter((p) => mode === "all" || !p.checked)
    .map((p) => ({ photoId: p.photoId, label: photoLabel(p), checked: p.checked, covers: p.covers }));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: offerKeys.photoPlan(collectionId, offerId) });
    void invalidateDetail(collectionId, offerId);
  };

  return (
    <PhotoCoverWalkDialog
      collectionId={collectionId}
      title={mode === "all" ? "Covers on this offer's photos" : "Check photos for symbols to cover"}
      photos={photos}
      defaultStyle={data.defaultStyle}
      onSaved={refresh}
      footerNote={
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", color: "var(--color-text-secondary)" }}>
          <input type="checkbox" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} />
          Regenerate photos when done
        </label>
      }
      onClose={(changed) => {
        onClose();
        refresh();
        if (!changed || !regenerate) return;
        startTransition(async () => {
          const { generateOfferPhotosAction } = await import("@/app/actions/offers");
          // A plan with nothing to render refuses; there is nothing to say about that here.
          await generateOfferPhotosAction(offerId);
          refresh();
        });
      }}
    />
  );
}
