"use client";

import { forwardRef, useState, useTransition } from "react";
import type { PrepareOffer } from "@/lib/offers";
import { isAuctionListing, pricingReadyFor } from "@/lib/offer-rules";
import { isCoverReadinessBlocker, isPhotoReadinessBlocker } from "@/lib/offer-photo-readiness";
import { formatEntityNo } from "@/lib/quick-jump";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { InlineText } from "@/app/c/[collectionSlug]/shared/inline-text";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { OfferPriceStrip } from "../[offerId]/offer-price-table";
import { NotMarkedReadyChip, ReadyWhenPhotosDoneChip } from "../offer-badges";

// The parts of a Prepare row (#1894, #1941, #1942) that a Facebook post's screen draws on each of its
// lots too (#2031): the title edited in place, what still stops the offer from being marked ready, and
// the price — the compact table with the offer's own figure typed in its last column. One component
// each, so the two screens cannot come to price or ready an offer differently.

/** A link-styled control on a row's meta line. */
const ROW_LINK: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.125rem",
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--color-accent)",
  font: "inherit",
  fontWeight: 600,
  cursor: "pointer",
};

/** *Check covers (N)* among the row's blockers (#1942): a blocker the row itself clears. */
const COVERS_LINK: React.CSSProperties = {
  ...ROW_LINK,
  color: "var(--color-warning)",
  textDecoration: "underline",
};

/** The row's price field: small, as an editor inside a list row is (`control-style.ts`). */
const PRICE_INPUT: React.CSSProperties = {
  width: "5.5rem",
  padding: "0.1875rem 0.375rem",
  borderRadius: "0.3125rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  font: "inherit",
  fontSize: "0.875rem",
  fontWeight: 600,
  textAlign: "right",
};

/** The figure the seller states on this offer (#449) — the asking price of a quick buy, the starting
 *  price of an auction — as the field shows it: blank while there is none. */
function statedPrice(offer: PrepareOffer): string {
  if (isAuctionListing(offer.listingType)) return offer.startingPrice ?? "";
  return offer.price === "0.00" ? "" : offer.price;
}

/**
 * The offer's title, edited in place as on the offer's own screen: editing starts from what is shown,
 * the derived label included (#363), an untouched field saves nothing, and blank clears it back to the
 * derived label (#209). `onChanged` follows a save — the title is part of the ready gate (#636).
 */
export function PrepareTitleField({
  offer,
  onChanged,
  inputWidth = "28rem",
}: {
  offer: PrepareOffer;
  onChanged: () => void;
  inputWidth?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(value: string) {
    setError(null);
    startTransition(async () => {
      const { patchOfferAction } = await import("@/app/actions/offers");
      const result = await patchOfferAction(offer.id, "name", value);
      if (result.status === "error") setError(result.message);
      else onChanged();
    });
  }

  return (
    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "0.125rem" }}>
      <div
        style={{
          minWidth: 0,
          overflow: "hidden",
          fontSize: "0.875rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        <InlineText
          value={offer.name ?? offer.label}
          placeholder="Listing title"
          display={
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {offer.name ?? offer.label}
            </span>
          }
          editable
          isPending={isPending}
          inputType="text"
          inputStyle={{ width: inputWidth, maxWidth: "100%" }}
          onSave={save}
        />
      </div>
      {error && <span style={{ fontSize: "0.75rem", color: "var(--color-error)" }}>{error}</span>}
    </div>
  );
}

/**
 * What still stands between the offer and Ready, one reason each — they are fixed in different places —
 * so a bulk *Mark ready*'s refusals are seen before it is run (#1894). The photo half is not among
 * them: *Mark ready* generates the photos itself and waits for them (#1893), so it is said as a note
 * instead. Nor are the unchecked covers, which the row offers to check (#1942): `onCheckCovers` opens
 * the walk, which the row draws outside itself so a click inside it is not a click on the row.
 */
export function PrepareReadiness({
  offer,
  onCheckCovers,
}: {
  offer: PrepareOffer;
  onCheckCovers: () => void;
}) {
  const auction = isAuctionListing(offer.listingType);
  const priced = pricingReadyFor(offer.listingType, "ready", offer.price, offer.startingPrice);
  const coverBlocker = offer.readyBlockers.find(isCoverReadinessBlocker) ?? null;
  const blockers = offer.readyBlockers.filter((b) => !isPhotoReadinessBlocker(b) && !isCoverReadinessBlocker(b));
  const photosToGenerate = offer.readyBlockers.some(isPhotoReadinessBlocker);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.25rem 0.75rem", fontSize: "0.75rem" }}>
      {offer.readyAfterPhotos && <ReadyWhenPhotosDoneChip />}
      {!offer.readyAfterPhotos && offer.readyAfterPhotosRefusal && (
        <NotMarkedReadyChip reason={offer.readyAfterPhotosRefusal} />
      )}
      {!priced && (
        <span style={{ color: "var(--color-warning)", fontWeight: 500 }}>
          {auction ? "No starting price yet" : "No price yet"}
        </span>
      )}
      {coverBlocker && (
        <Tooltip content={`${coverBlocker.title}. Go through them here — cover what must not show, or mark nothing to cover.`}>
          <button type="button" onClick={onCheckCovers} style={COVERS_LINK}>
            Check covers ({coverBlocker.count})
          </button>
        </Tooltip>
      )}
      {blockers.map((blocker, i) => (
        <Tooltip key={`${blocker.code}-${i}`} content={blocker.message}>
          <span style={{ color: "var(--color-warning)", fontWeight: 500 }}>
            {blocker.title}
            {blocker.subjects.length > 0 ? `: ${blocker.subjects.join(", ")}` : ""}
          </span>
        </Tooltip>
      ))}
      {photosToGenerate && !offer.readyAfterPhotos && (
        <Tooltip content="The listing photos are missing or out of date. Mark ready generates them first, and the offer turns ready once they are done.">
          <span style={{ color: "var(--color-text-muted)" }}>Photos generated on Mark ready</span>
        </Tooltip>
      )}
      {priced && blockers.length === 0 && !coverBlocker && !offer.readyAfterPhotos && (
        <span style={{ color: "var(--color-success)", fontWeight: 500 }}>Can be marked ready</span>
      )}
    </div>
  );
}

/**
 * The offer's price: the compact price table, the offer's own figure typed in its last column.
 *
 * A standing field rather than `InlineText`'s click-to-edit, because pricing a batch is typing one
 * figure after another down the list: **Enter** leaves the field, which saves it, and puts the caret in
 * the next row's (`onEnter`). A figure is saved when the field is left, by Enter, Tab or a click
 * elsewhere, and only when it changed; a figure clicked in the table becomes the price.
 */
export const PreparePriceField = forwardRef<
  HTMLInputElement,
  {
    offer: PrepareOffer;
    /** Enter in the price field: move on to the next row's. */
    onEnter: () => void;
    /** A price was saved — the row's new stated figure, or null once cleared. */
    onSaved: (field: "price" | "startingPrice", value: string | null) => void;
  }
>(function PreparePriceField({ offer, onEnter, onSaved }, ref) {
  const auction = isAuctionListing(offer.listingType);
  const field = auction ? "startingPrice" : "price";
  const saved = statedPrice(offer);
  // The field's text, following the saved figure until it is typed in (adjusted during render).
  const [draft, setDraft] = useState(saved);
  const [syncedFrom, setSyncedFrom] = useState(saved);
  if (syncedFrom !== saved) {
    setSyncedFrom(saved);
    setDraft(saved);
  }
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(raw: string) {
    const value = raw.trim();
    if (value === saved) return;
    setError(null);
    startTransition(async () => {
      const { patchOfferAction } = await import("@/app/actions/offers");
      const result = await patchOfferAction(offer.id, field, value);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      onSaved(field, value === "" ? null : Number(value).toFixed(2));
    });
  }

  // The figure the margin under the field is worked out from: what is being typed, once it is one.
  const typed = Number(draft.trim());
  const ownAmount = draft.trim() !== "" && Number.isFinite(typed) && typed > 0 ? typed.toFixed(2) : null;

  return (
    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.125rem" }}>
      <OfferPriceStrip
        offer={{ ...offer, priceBase: null }}
        ownAmount={ownAmount}
        target={auction ? "starting price" : "price"}
        ownLabel={auction ? "Starting price" : "Your price"}
        disabled={isPending}
        onApply={(amount) => {
          setDraft(amount);
          save(amount);
        }}
        priceEditor={
          <NumericInput
            ref={ref}
            kind="amount"
            value={draft}
            placeholder="—"
            aria-label={`${auction ? "Starting price" : "Price"} of offer ${formatEntityNo(offer.offerNo)}`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => save(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter();
              } else if (e.key === "Escape") {
                setDraft(saved);
                setError(null);
              }
            }}
            style={{
              ...PRICE_INPUT,
              border: `1px solid ${error ? "var(--color-error)" : "var(--color-border-strong)"}`,
            }}
          />
        }
      />
      {error && <span style={{ fontSize: "0.75rem", color: "var(--color-error)" }}>{error}</span>}
    </div>
  );
});
