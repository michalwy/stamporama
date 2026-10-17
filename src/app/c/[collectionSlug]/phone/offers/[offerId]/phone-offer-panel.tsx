"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { PhoneOffer } from "@/lib/phone-offers";
import { OFFER_STATE_LABEL } from "@/lib/offer-rules";
import {
  PHONE_OFFER_MOVE_TARGET,
  phoneOfferMoves,
  type PhoneOfferMove,
} from "@/lib/phone-offer-moves";
import { baseBtn } from "@/app/button-style";
import { ConfirmDialog, DialogError } from "@/app/dialog-shell";
import { Icon, type IconName } from "@/app/icons";
import { THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import { PHONE_TAP_TARGET } from "@/app/phone-screen";
import { useToast } from "@/app/toast-provider";
import { OfferStateChip } from "@/app/c/[collectionSlug]/offers/offer-badges";
import { useInvalidateOffers } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { withdrawOfferMessage } from "@/app/c/[collectionSlug]/offers/withdraw-offer-message";
import { PhoneOfferPrice } from "../phone-offer-price";
import { PhoneOfferSell } from "./phone-offer-sell";
import { PhoneOfferBidding } from "./phone-offer-bidding";

const MOVE: Record<PhoneOfferMove, { label: string; icon: IconName }> = {
  pause: { label: "Pause", icon: "pause" },
  resume: { label: "Resume", icon: "resume" },
  withdraw: { label: "Withdraw…", icon: "withdraw" },
};

/**
 * The phone offer screen's body (#2008): what tells the collector it is the right offer, and the
 * moves the phone makes on it. Every move is the desk's own `setOfferStateAction`, so the server
 * applies the desk's rules and refuses in the desk's words; Withdraw asks first, in the desk's
 * sentence. Afterwards the page is read again from the server and every offer list is marked stale,
 * so going back to the list shows the offer where it now is.
 *
 * *Sell* (#2009) comes first, while the offer has a set left to sell: it is the move the screen is
 * opened for at a fair or on a quick buy.
 *
 * A Facebook group auction that is up shows its bidding above them (#2010): the bid recorded as it
 * comes in, and once it has closed, the winning bid, after which *Sell* closes it to the winner or
 * *Withdraw* takes it down when nobody bid.
 */
export function PhoneOfferPanel({
  collectionId,
  collectionSlug,
  offer,
}: {
  collectionId: string;
  collectionSlug: string;
  offer: PhoneOffer;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { invalidateAll } = useInvalidateOffers();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const moves = phoneOfferMoves(offer.state);

  function move(which: PhoneOfferMove) {
    const target = PHONE_OFFER_MOVE_TARGET[which];
    setError(undefined);
    startTransition(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offer.id, target);
      if (result.status === "success") {
        setConfirmWithdraw(false);
        void invalidateAll(collectionId);
        router.refresh();
        toast({ message: `This offer is now ${OFFER_STATE_LABEL[target].toLowerCase()}` });
      } else setError(result.message);
    });
  }

  return (
    <>
      <div
        style={{
          aspectRatio: "1",
          borderRadius: "0.5rem",
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-elevated)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {offer.photoId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/collections/${collectionId}/photos/${offer.photoId}/full`}
            alt={offer.title}
            style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
          />
        ) : (
          <span style={{ fontSize: "0.9375rem", color: "var(--color-text-muted)" }}>No picture</span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <h2
          style={{
            margin: 0,
            fontSize: "1.125rem",
            fontWeight: 600,
            lineHeight: 1.35,
            color: "var(--color-text-primary)",
          }}
        >
          {offer.title}
        </h2>
        <div style={{ fontSize: "1.125rem" }}>
          <PhoneOfferPrice offer={offer} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.9375rem",
            color: "var(--color-text-secondary)",
          }}
        >
          {offer.platformName}
          <OfferStateChip state={offer.state} />
        </div>
      </div>

      {offer.bidding && <PhoneOfferBidding collectionId={collectionId} offer={offer} bidding={offer.bidding} />}

      {/* Keyed on the price, so a bid recorded above becomes the price *Sell* offers. */}
      {offer.setsLeft > 0 && (
        <PhoneOfferSell
          key={offer.price}
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          offer={offer}
        />
      )}

      {moves.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {!confirmWithdraw && <DialogError>{error}</DialogError>}
          {moves.map((which) => (
            <button
              key={which}
              type="button"
              disabled={isPending}
              onClick={() => {
                if (which === "withdraw") {
                  setError(undefined);
                  setConfirmWithdraw(true);
                } else move(which);
              }}
              style={which === "withdraw" ? WITHDRAW_BUTTON : MOVE_BUTTON}
            >
              <Icon name={MOVE[which].icon} />
              {MOVE[which].label}
            </button>
          ))}
        </div>
      )}

      {confirmWithdraw && (
        <ConfirmDialog
          title="Withdraw offer"
          message={withdrawOfferMessage(offer.withdrawTakesPost)}
          actionLabel="Withdraw"
          pendingLabel="Withdrawing…"
          variant="destructive"
          isPending={isPending}
          error={error}
          onClose={() => !isPending && setConfirmWithdraw(false)}
          onConfirm={() => move("withdraw")}
        />
      )}
    </>
  );
}

const MOVE_BUTTON: CSSProperties = {
  ...baseBtn,
  minHeight: PHONE_TAP_TARGET,
  gap: "0.5rem",
  fontSize: "1rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-strong)",
};

const WITHDRAW_BUTTON: CSSProperties = {
  ...MOVE_BUTTON,
  color: "var(--color-error)",
  border: "1px solid var(--color-error-border)",
};
