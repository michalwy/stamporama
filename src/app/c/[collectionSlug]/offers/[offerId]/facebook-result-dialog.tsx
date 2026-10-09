"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  DialogActions,
  DialogBody,
  DialogShell,
  LabelWithError,
} from "@/app/dialog-shell";
import type { FacebookWinnerLookup } from "@/lib/facebook-results";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { isAuctionListing, type OfferListingType } from "@/lib/offer-rules";
import { formControl } from "@/app/control-style";

// Recording who won a Facebook auction and for how much (#1545; ADR-0061 §4). The winner is typed as
// their profile shows them, with the profile's link when it is to hand; the dialog says, while it is
// filled in, which contact that is — or that a new buyer will be created — and offers the winner's
// sales still open on Facebook, because several lots won by one person are usually one parcel. Saving
// records the sale, as every other platform's result does. A quick buy (#1671) is recorded the same
// way, in its own words: its buyer, and the price it sold for — starting from its asking price.

const INPUT_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const FIELD_GAP: React.CSSProperties = { marginBottom: "1rem" };

const MUTED: React.CSSProperties = {
  margin: "0.25rem 0 0",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.5,
};

const NEW_SALE = "";

/** `YYYY-MM-DD` of an instant in the collector's own zone — the day the auction closed, as they saw it,
 *  or today for a quick buy. */
function localDay(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function FacebookResultDialog({
  offerId,
  listingType,
  currency,
  standingBid,
  endsAt,
  onRecorded,
  onClose,
}: {
  offerId: string;
  /** An auction asks for its winner and winning bid; a quick buy for its buyer and price (#1671). */
  listingType: OfferListingType;
  currency: string;
  /** The bid recorded while it ran, `0.00` when none was — or a quick buy's asking price. The final
   *  price starts from it. */
  standingBid: string;
  /** ISO-8601 closing time, or null for today; the sale is dated the day it closed. */
  endsAt: string | null;
  onRecorded: (saleId: string) => void;
  onClose: () => void;
}) {
  const auction = isAuctionListing(listingType);
  const [winnerName, setWinnerName] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [price, setPrice] = useState(standingBid === "0.00" ? "" : standingBid);
  const [soldOn, setSoldOn] = useState(() => localDay(endsAt));
  const [saleId, setSaleId] = useState(NEW_SALE);
  const [fetched, setFetched] = useState<FacebookWinnerLookup | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  // Who the typed winner is, re-read a moment after typing stops: the same lookup the save makes, so
  // what the dialog says and what the save does cannot disagree.
  const typed = !!winnerName.trim() || !!profileUrl.trim();
  useEffect(() => {
    if (!typed) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { lookupFacebookWinnerAction } = await import("@/app/actions/facebook");
      const result = await lookupFacebookWinnerAction(offerId, winnerName, profileUrl);
      if (cancelled) return;
      setFetched(result);
      // A sale that is no longer offered cannot stay chosen.
      setSaleId((current) => (result.openSales.some((s) => s.id === current) ? current : NEW_SALE));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [offerId, winnerName, profileUrl, typed]);
  // Nothing typed asks nothing: an answer about what was cleared away is not shown.
  const lookup = typed ? fetched : null;

  function save() {
    setError(undefined);
    startTransition(async () => {
      const { recordFacebookSaleAction } = await import("@/app/actions/facebook");
      const result = await recordFacebookSaleAction(offerId, {
        winnerName,
        profileUrl,
        price,
        soldOn,
        saleId: saleId || null,
      });
      if (result.status === "success") onRecorded(result.saleId);
      else setError(result.message);
    });
  }

  if (typeof document === "undefined") return null;

  const who = lookup?.contact
    ? lookup.contact.matchedBy === "profile"
      ? `${lookup.contact.name} — found by their profile link.`
      : `${lookup.contact.name} — an existing contact${lookup.contact.facebookProfileUrl ? "" : profileUrl.trim() ? "; the link will be added to it" : ""}.`
    : winnerName.trim() && !lookup?.conflict
      ? `A new buyer, ${winnerName.trim()}, will be created.`
      : null;

  return createPortal(
    <DialogShell title={auction ? "Record result" : "Record sale"} onClose={onClose} maxWidth="32rem">
      <DialogBody>
        <div style={FIELD_GAP}>
          <LabelWithError htmlFor="fb-winner-name">{auction ? "Winner" : "Buyer"}</LabelWithError>
          <TextInput
            id="fb-winner-name"
            value={winnerName}
            onChange={(e) => setWinnerName(e.target.value)}
            placeholder="Their name as the profile shows it"
            disabled={isPending}
            style={INPUT_STYLE}
            autoFocus
          />
        </div>
        <div style={FIELD_GAP}>
          <LabelWithError htmlFor="fb-winner-profile">Profile link</LabelWithError>
          <TextInput
            id="fb-winner-profile"
            type="url"
            value={profileUrl}
            onChange={(e) => setProfileUrl(e.target.value)}
            placeholder="https://www.facebook.com/… (optional)"
            disabled={isPending}
            style={INPUT_STYLE}
          />
          {lookup?.conflict ? (
            <p role="alert" style={{ ...MUTED, color: "var(--color-error)" }}>
              {lookup.conflict}
            </p>
          ) : (
            who && <p style={MUTED}>{who}</p>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
          <div style={{ flex: 1 }}>
            <LabelWithError htmlFor="fb-final-price">
              {auction ? "Winning bid" : "Price"} ({currency})
            </LabelWithError>
            <NumericInput
              kind="amount"
              id="fb-final-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={isPending}
              style={INPUT_STYLE}
            />
          </div>
          <div style={{ flex: 1 }}>
            <LabelWithError htmlFor="fb-sold-on">Sold on</LabelWithError>
            <input
              id="fb-sold-on"
              type="date"
              value={soldOn}
              onChange={(e) => setSoldOn(e.target.value)}
              disabled={isPending}
              style={INPUT_STYLE}
            />
          </div>
        </div>
        <div>
          <LabelWithError>Sale</LabelWithError>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", fontSize: "0.875rem" }}>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="radio"
                name="fb-sale"
                checked={saleId === NEW_SALE}
                onChange={() => setSaleId(NEW_SALE)}
                disabled={isPending}
              />
              A new sale
            </label>
            {lookup?.openSales.map((s) => (
              <label key={s.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="radio"
                  name="fb-sale"
                  checked={saleId === s.id}
                  onChange={() => setSaleId(s.id)}
                  disabled={isPending}
                />
                Add to sale #{s.saleNo} · {new Date(`${s.soldOn}T00:00:00`).toLocaleDateString()} ·{" "}
                {s.lineCount} {s.lineCount === 1 ? "line" : "lines"} · {s.status}
              </label>
            ))}
          </div>
          {lookup?.contact && lookup.openSales.length === 0 && (
            <p style={MUTED}>{lookup.contact.name} has no open sale on Facebook in {currency}.</p>
          )}
        </div>
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Recording…" : "Record sale"}
        variant="primary"
        onCancel={onClose}
        onAction={save}
        disabled={isPending || !winnerName.trim() || !price.trim() || !!lookup?.conflict}
        error={error}
      />
    </DialogShell>,
    document.body
  );
}
