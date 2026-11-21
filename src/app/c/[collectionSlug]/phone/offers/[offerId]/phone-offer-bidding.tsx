"use client";

import type { CSSProperties } from "react";
import type { PhoneOffer } from "@/lib/phone-offers";
import { FACEBOOK_CLOSED_ADVICE, recordBidLabel } from "@/lib/facebook-bidding-rules";
import { DialogError } from "@/app/dialog-shell";
import { PHONE_TAP_TARGET, phoneButton } from "@/app/phone-screen";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { formatRelative } from "@/app/c/[collectionSlug]/auctions/auction-format";
import { useRecordBid } from "../../use-record-bid";

/**
 * A Facebook group auction's bidding on the phone (#2010, ADR-0072): the standing bid typed as it
 * comes in, through the desk card's own write (`useRecordBid`, shared with the post's screen), so the desk
 * shows it exactly as if typed there — the offer's price, dated by `priceCheckedAt`. Once the closing
 * time has passed the screen says so in the desk's words, and the bid typed is the winning one: the
 * figure *Sell* offers as the price. The closing itself is the screen's own *Sell* or *Withdraw*
 * (#1777), as at the desk.
 *
 * The times are relative to the phone's clock and in its locale, so they are drawn after mount.
 */
export function PhoneOfferBidding({
  collectionId,
  offer,
  bidding,
}: {
  collectionId: string;
  offer: PhoneOffer;
  bidding: NonNullable<PhoneOffer["bidding"]>;
}) {
  const hydrated = useHydrated();
  const { bid, setBid, error, isPending, record, canRecord } = useRecordBid(collectionId, offer.id, "Bid recorded");
  const now = new Date();

  return (
    <form
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        padding: "0.75rem",
        borderRadius: "0.5rem",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
      }}
      onSubmit={(e) => {
        e.preventDefault();
        record();
      }}
    >
      <p style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
        Bidding
      </p>
      {bidding.closed ? (
        <p style={{ ...lineStyle, color: "var(--color-warning)", fontWeight: 600 }}>
          Closed{hydrated && bidding.endsAt ? ` ${formatRelative(bidding.endsAt, now)}` : ""} —{" "}
          {FACEBOOK_CLOSED_ADVICE}
        </p>
      ) : (
        hydrated && bidding.endsAt && <p style={lineStyle}>Closes {formatRelative(bidding.endsAt, now)}</p>
      )}
      <p style={lineStyle}>
        {bidding.hasBid ? (
          <>
            Highest bid{" "}
            <strong style={{ color: "var(--color-text-primary)" }}>
              {offer.price} {offer.currency}
            </strong>
            {hydrated && bidding.priceCheckedAt && ` · recorded ${formatRelative(bidding.priceCheckedAt, now)}`}
          </>
        ) : (
          "No bid recorded yet."
        )}
      </p>
      <TextInput
        inputMode="decimal"
        value={bid}
        onChange={(e) => setBid(e.target.value)}
        placeholder={`Highest bid in ${offer.currency}`}
        aria-label="Highest bid"
        disabled={isPending}
        {...NO_AUTOFILL}
        style={bidFieldStyle}
      />
      <DialogError>{error}</DialogError>
      <button
        type="submit"
        style={{ ...recordBidButton, opacity: canRecord ? 1 : 0.6 }}
        disabled={!canRecord}
      >
        {isPending ? "Recording…" : recordBidLabel(bidding.closed)}
      </button>
    </form>
  );
}

const lineStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-secondary)",
};

/** The bid's button, shared with each lot's bid on the post's screen (#2630). */
export const recordBidButton: CSSProperties = {
  ...phoneButton,
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-strong)",
};

/** The bid's field, shared with each lot's bid on the post's screen (#2630). */
export const bidFieldStyle: CSSProperties = {
  width: "100%",
  minHeight: PHONE_TAP_TARGET,
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "1rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-page)",
  boxSizing: "border-box",
};
