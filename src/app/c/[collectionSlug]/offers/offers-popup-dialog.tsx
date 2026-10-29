"use client";

import { useParams } from "next/navigation";
import type { OfferLookupTarget } from "@/lib/offers";
import { DialogShell, DialogBody } from "@/app/dialog-shell";
import { OfferTargetList, OFFERS_EMPTY_TEXT } from "./related-offers-card";
import { useOffersForTarget } from "./use-offers-query";

const HINT: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.9375rem",
};

/** What the popup is scoped to: one copy (#276), a stamp, or an issue (#349). The label names the
 * dialog. Mirrors the read-only copies popup's targeting (#110). */
export type OffersPopupTarget = OfferLookupTarget & { label: string };

interface OffersPopupDialogProps {
  collectionId: string;
  target: OffersPopupTarget;
  onClose: () => void;
}

/**
 * Read-focused popup listing every offer that references a copy of the target (#276, #349) — one
 * copy, a stamp, or an issue — across all platforms, in the states its chips show (#2263), live
 * listings first. Opened from the Copies / Stamps / Issues row menus so "is this listed, where, and
 * for how much?" is answered without leaving the list; closing returns to it. Each row shows the same platform /
 * state / price presentation as the Offers list, opens the offer's detail screen on click, and
 * carries the platform listing link when one is recorded.
 */
export function OffersPopupDialog({ collectionId, target, onClose }: OffersPopupDialogProps) {
  // The popup only ever renders under /c/[collectionSlug], so the slug the offer links need is read
  // from the route rather than threaded through every list row that can open it.
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const { data: offers = [], isLoading } = useOffersForTarget(collectionId, target, true);

  return (
    <DialogShell
      title={`Offers · ${target.label}`}
      onClose={onClose}
      maxWidth="min(94vw, 56rem)"
      height="min(80vh, 40rem)"
    >
      <DialogBody>
        {isLoading && <div style={HINT}>Loading offers…</div>}

        {!isLoading && offers.length === 0 && <div style={HINT}>{OFFERS_EMPTY_TEXT[target.kind]}</div>}

        {offers.length > 0 && (
          <OfferTargetList collectionId={collectionId} collectionSlug={collectionSlug} offers={offers} />
        )}
      </DialogBody>
    </DialogShell>
  );
}
