"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { offerKeys, useInvalidateOffers } from "../use-offers-query";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  NothingToCoverConfirm,
  nothingToCoverLabel,
  PhotoCoverWalkDialog,
  type CoverWalkEntry,
  type MarkNothingToCover,
} from "../../shared/photo-cover-walk-dialog";
import type { OfferCoverWalk, OfferCoverWalkPhoto } from "@/lib/offer-photo-generation";

// An offer's cover walk (#1665): the copy photos its images are made from, read when the walk opens.
// Opened from the Photos card and from beside **Mark ready** when unchecked photos are what holds the
// offer back — one component, so both open the same walk. Beside it, the bulk *nothing to cover*
// (#1701), offered on the Photos card and inside the walk. Its walk carries covers from one photo to
// the next of the same side (#1703); the copy page's, one copy's sides, has nothing to carry.

/** Mark the offer's unchecked photos *nothing to cover* — all, or one copy's (#1701). */
const markNothingToCover =
  (offerId: string): MarkNothingToCover =>
  async (itemId) => {
    const { markOfferNothingToCoverAction } = await import("@/app/actions/photo-covers");
    const result = await markOfferNothingToCoverAction(offerId, itemId);
    return result.status === "error" ? { error: result.message } : { photoIds: result.photoIds };
  };

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
    .map((p) => ({
      photoId: p.photoId,
      itemId: p.itemId,
      label: photoLabel(p),
      side: p.side,
      checked: p.checked,
      covers: p.covers,
    }));

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
      onMarkNothingToCover={markNothingToCover(offerId)}
      carryCovers
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

/**
 * *Nothing to cover on the remaining N photos* (#1701), on the offer beside the button that opens the
 * walk: every photo still unchecked marked at once, after one confirmation naming the count. Marking
 * draws nothing, so the stored images stay current and nothing is regenerated.
 */
export function OfferNothingToCoverButton({
  collectionId,
  offerId,
  count,
  disabled,
  style,
}: {
  collectionId: string;
  offerId: string;
  count: number;
  disabled?: boolean;
  style: React.CSSProperties;
}) {
  const queryClient = useQueryClient();
  const { invalidateDetail } = useInvalidateOffers();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const off = disabled || isPending;

  const confirm = () => {
    setError(undefined);
    startTransition(async () => {
      const result = await markNothingToCover(offerId)(null);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: offerKeys.photoPlan(collectionId, offerId) }),
        invalidateDetail(collectionId, offerId),
      ]);
    });
  };

  return (
    <>
      <Tooltip content="Mark every photo not yet checked as having nothing to cover, without going through them">
        <button
          type="button"
          disabled={off}
          onClick={() => setConfirming(true)}
          style={{ ...style, opacity: off ? 0.5 : 1, cursor: off ? "default" : "pointer" }}
        >
          {nothingToCoverLabel(count, "all")}
        </button>
      </Tooltip>
      {confirming && (
        <NothingToCoverConfirm
          count={count}
          scope="all"
          isPending={isPending}
          error={error}
          onConfirm={confirm}
          onClose={() => {
            if (isPending) return;
            setConfirming(false);
            setError(undefined);
          }}
        />
      )}
    </>
  );
}
