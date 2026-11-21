"use client";

import type { CSSProperties } from "react";
import { recordBidLabel } from "@/lib/facebook-bidding-rules";
import type { PhonePostLot } from "@/lib/phone-post-view";
import { DialogError } from "@/app/dialog-shell";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { useHydrated } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { formatRelative } from "@/app/c/[collectionSlug]/auctions/auction-format";
import { bidFieldStyle, recordBidButton } from "../../offers/[offerId]/phone-offer-bidding";
import { useRecordBid } from "../../use-record-bid";

/**
 * A lot's *Record bid* under its row on the post's phone screen (#2630): the bid typed as it comes in,
 * without opening the lot's own screen — the same write as there (#2010) and at the desk (#1545), so a
 * bid recorded here is the lot's price, dated by `priceCheckedAt`. Each lot saves on its own: a bid
 * typed in one row stays while another row's is recorded. Shown while `lot.bidding` is set — the one
 * rule the offer's screen and the desk follow; once the lot has closed the button reads *Record
 * winning bid*, as there.
 *
 * When the bid was recorded is relative to the phone's clock, so it is drawn after mount.
 */
export function PhonePostLotBid({
  collectionId,
  lot,
  bidding,
}: {
  collectionId: string;
  lot: PhonePostLot;
  bidding: NonNullable<PhonePostLot["bidding"]>;
}) {
  const hydrated = useHydrated();
  const { bid, setBid, error, isPending, record, canRecord } = useRecordBid(
    collectionId,
    lot.offerId,
    `Bid recorded on lot ${lot.lotNo}`
  );

  return (
    <form
      aria-label={`Bid on lot ${lot.lotNo}`}
      style={FORM}
      onSubmit={(e) => {
        e.preventDefault();
        record();
      }}
    >
      <p style={LINE}>
        {bidding.closed && <span style={{ color: "var(--color-warning)", fontWeight: 600 }}>Closed · </span>}
        {bidding.hasBid
          ? `Bid recorded${hydrated && bidding.priceCheckedAt ? ` ${formatRelative(bidding.priceCheckedAt, new Date())}` : ""}`
          : "No bid recorded yet"}
      </p>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <TextInput
          inputMode="decimal"
          value={bid}
          onChange={(e) => setBid(e.target.value)}
          placeholder={`Bid in ${lot.price.currency}`}
          aria-label={`Highest bid on lot ${lot.lotNo}`}
          disabled={isPending}
          {...NO_AUTOFILL}
          style={{ ...bidFieldStyle, flex: 1, minWidth: 0 }}
        />
        <button
          type="submit"
          style={{ ...recordBidButton, flexShrink: 0, opacity: canRecord ? 1 : 0.6 }}
          disabled={!canRecord}
        >
          {isPending ? "Recording…" : recordBidLabel(bidding.closed)}
        </button>
      </div>
      <DialogError>{error}</DialogError>
    </form>
  );
}

const FORM: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  padding: "0.5rem 0.75rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-elevated)",
};

const LINE: CSSProperties = {
  margin: 0,
  fontSize: "0.875rem",
  color: "var(--color-text-secondary)",
};
