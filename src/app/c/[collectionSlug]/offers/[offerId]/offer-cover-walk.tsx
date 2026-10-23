"use client";

import { useRef, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { offerKeys, useInvalidateOffers } from "../use-offers-query";
import { formatEntityNo } from "@/lib/quick-jump";
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
//
// The Prepare screen opens the same walk from a row, and walks the ticked offers in one pass
// (`OffersCoverWalk`, #1942) — both through `PhotoCoverWalkDialog`, so neither can drift from the
// offer's own.

/** Mark the offer's unchecked photos *nothing to cover* — all, or one copy's (#1701). All of them is
 *  the photos asked about, and the other areas' too while the walk includes them (#1891). */
const markNothingToCover =
  (offerId: string, includeOtherAreas = false): MarkNothingToCover =>
  async (itemId) => {
    const { markOfferNothingToCoverAction } = await import("@/app/actions/photo-covers");
    const result = await markOfferNothingToCoverAction(offerId, itemId, includeOtherAreas);
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
 *
 * Either way only the photos asked about are walked — copies with a stamp in an area that may carry
 * forbidden symbols (#1891) — until *Include photos from other areas* adds the rest; it starts ticked
 * with `includeOtherAreas`, for an offer with nothing asked about. Switching it reads the list again
 * and starts the walk over, so what was saved meanwhile shows as saved.
 */
export function OfferCoverWalk({
  collectionId,
  offerId,
  mode,
  includeOtherAreas = false,
  onClose,
  onChanged,
}: {
  collectionId: string;
  offerId: string;
  mode: "unchecked" | "all";
  includeOtherAreas?: boolean;
  onClose: () => void;
  /** Once the walk has closed having saved or marked anything, and again once the images are queued
   *  — for a screen that shows the offer's blockers from a read of its own (Prepare, #1942). */
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const { invalidateDetail } = useInvalidateOffers();
  const [regenerate, setRegenerate] = useState(true);
  const [includeOthers, setIncludeOthers] = useState(includeOtherAreas);
  // Bumped when the walk starts over — a key of its own, so a refetch for any other reason (the
  // window regaining focus) never restarts the walk under the collector.
  const [walkNo, setWalkNo] = useState(0);
  // A photo saved before the walk was started over still counts when it closes; `touchedRef` counts a
  // bulk *nothing to cover* as well, which changes the blockers but draws nothing.
  const savedRef = useRef(false);
  const touchedRef = useRef(false);
  const [, startTransition] = useTransition();
  const { data, isLoading, isFetching, refetch } = useQuery<OfferCoverWalk>({
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

  const otherCount = data.photos.filter((p) => !p.asked).length;
  const photos: CoverWalkEntry[] = data.photos
    .filter((p) => (p.asked || includeOthers) && (mode === "all" || !p.checked))
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

  const switchOthers = (next: boolean) => {
    void refetch().then(() => {
      setIncludeOthers(next);
      setWalkNo((n) => n + 1);
    });
  };

  return (
    <PhotoCoverWalkDialog
      key={walkNo}
      collectionId={collectionId}
      title={mode === "all" ? "Covers on this offer's photos" : "Check photos for symbols to cover"}
      photos={photos}
      defaultStyle={data.defaultStyle}
      defaultColor={data.defaultColor}
      onMarkNothingToCover={markNothingToCover(offerId, includeOthers)}
      carryCovers
      onSaved={(saved) => {
        if (saved) savedRef.current = true;
        touchedRef.current = true;
        refresh();
      }}
      footerNote={
        <span style={{ display: "inline-flex", gap: "1rem", color: "var(--color-text-secondary)" }}>
          {otherCount > 0 && (
            <Tooltip content="Photos of copies from areas whose stamps carry no forbidden symbols — never asked about, but they can still be covered">
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
                <input
                  type="checkbox"
                  checked={includeOthers}
                  disabled={isFetching}
                  onChange={(e) => switchOthers(e.target.checked)}
                />
                Include photos from other areas
              </label>
            </Tooltip>
          )}
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
            <input type="checkbox" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} />
            Regenerate photos when done
          </label>
        </span>
      }
      onClose={(changed) => {
        onClose();
        refresh();
        if (changed || touchedRef.current) onChanged?.();
        if (!(changed || savedRef.current) || !regenerate) return;
        startTransition(async () => {
          const { generateOfferPhotosAction } = await import("@/app/actions/offers");
          // A plan with nothing to render refuses; there is nothing to say about that here.
          await generateOfferPhotosAction(offerId);
          refresh();
          onChanged?.();
        });
      }}
    />
  );
}

/**
 * The ticked offers' cover walk on the Prepare screen (#1942): every photo still unchecked that their
 * ready gate asks about, offer after offer in the order given, in **one** walk — so a series spread
 * over many offers is covered in one pass, its covers carried from photo to photo (#1703). A photo two
 * of the offers share is asked about once, under the first; checking it clears it for both.
 *
 * *Nothing to cover on the remaining photos* reaches the current offer's, as in its own walk; the
 * photos of other areas are not offered — this walk is for clearing the blocker. New covers start in
 * the first offer's platform style, which the editor changes like any other.
 *
 * With *Regenerate photos when done*, the offers a photo was saved for are queued again on close.
 * `onChanged` follows as the offer walk's does, for the screen to read its rows again.
 *
 * `all` walks every photo asked about again, checked ones included — a Facebook post's Ready lots
 * once nothing is left unchecked (#2114), which stay Ready while their photos are made again.
 */
export function OffersCoverWalk({
  collectionId,
  offers,
  mode = "unchecked",
  onClose,
  onChanged,
}: {
  collectionId: string;
  offers: { id: string; offerNo: number }[];
  mode?: "unchecked" | "all";
  onClose: () => void;
  onChanged: () => void;
}) {
  const [regenerate, setRegenerate] = useState(true);
  const savedFor = useRef(new Set<string>());
  const touchedRef = useRef(false);
  const [, startTransition] = useTransition();
  const offerIds = offers.map((o) => o.id);
  const { data, isLoading } = useQuery<OfferCoverWalk[]>({
    queryKey: [...offerKeys.all(collectionId), "cover-walks", offerIds],
    queryFn: () =>
      Promise.all(
        offerIds.map(async (offerId) => {
          const res = await fetch(`/api/collections/${collectionId}/offers/${offerId}/photo-covers`);
          if (!res.ok) throw new Error("Failed to load the photos to check");
          return res.json();
        })
      ),
    // Read once per opening and then kept by the dialog itself.
    staleTime: 0,
    gcTime: 0,
  });

  if (isLoading || !data) return null;

  const seen = new Set<string>();
  const photos: CoverWalkEntry[] = offers.flatMap((offer, i) =>
    data[i].photos
      .filter((p) => p.asked && (mode === "all" || !p.checked) && !seen.has(p.photoId))
      .map((p) => {
        seen.add(p.photoId);
        return {
          photoId: p.photoId,
          itemId: p.itemId,
          label: `${formatEntityNo(offer.offerNo)} · ${photoLabel(p)}`,
          side: p.side,
          checked: p.checked,
          covers: p.covers,
          group: offer.id,
        };
      })
  );

  return (
    <PhotoCoverWalkDialog
      collectionId={collectionId}
      title={`${mode === "all" ? "Covers on the photos" : "Check photos for symbols to cover"} — ${offers.length} offer${offers.length === 1 ? "" : "s"}`}
      photos={photos}
      defaultStyle={data[0].defaultStyle}
      defaultColor={data[0].defaultColor}
      onMarkNothingToCover={(itemId, group) => markNothingToCover(group!)(itemId)}
      carryCovers
      onSaved={(saved, entry) => {
        if (saved && entry?.group) savedFor.current.add(entry.group);
        touchedRef.current = true;
      }}
      footerNote={
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", color: "var(--color-text-secondary)" }}>
          <input type="checkbox" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} />
          Regenerate photos when done
        </label>
      }
      onClose={() => {
        onClose();
        if (!touchedRef.current) return;
        onChanged();
        const toRegenerate = [...savedFor.current];
        if (!regenerate || toRegenerate.length === 0) return;
        startTransition(async () => {
          const { generateOfferPhotosAction } = await import("@/app/actions/offers");
          // One at a time, in walk order; a plan with nothing to render refuses, which says nothing here.
          for (const offerId of toRegenerate) await generateOfferPhotosAction(offerId);
          onChanged();
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
