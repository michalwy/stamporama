"use client";

import { forwardRef, useState, useTransition } from "react";
import type { PrepareOffer } from "@/lib/offers";
import { isAuctionListing, pricingReadyFor } from "@/lib/offer-rules";
import { isPhotoReadinessBlocker } from "@/lib/offer-photo-readiness";
import { formatEntityNo } from "@/lib/quick-jump";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import {
  PhotoLightbox,
  THUMB_OBJECT_FIT,
  ThumbPreview,
} from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import { CheckCell } from "@/app/c/[collectionSlug]/shared/cell-target";
import { ROW_OPEN_STYLE, RowTitleLink, useRowOpen } from "@/app/c/[collectionSlug]/shared/row-open";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { OfferPriceStrip } from "../[offerId]/offer-price-table";
import { NotMarkedReadyChip, ReadyWhenPhotosDoneChip } from "../offer-badges";

/** How many pictures a row draws before it says how many more there are. */
const STRIP_PICTURES = 4;
const THUMB = "3.25rem";

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
 * One Preparing offer on the Prepare screen (#1894): its pictures, what it is, what still stands
 * between it and Ready, and its price — the compact price table with the offer's own price typed in
 * its last column.
 *
 * The price is a standing field rather than `InlineText`'s click-to-edit, because pricing a batch is
 * typing one figure after another down the list: **Enter** leaves the field, which saves it, and puts
 * the caret in the next row's (`onEnter`). A figure is saved when the field is left, by Enter, Tab or a
 * click elsewhere, and only when it changed.
 */
export const PrepareOfferRow = forwardRef<
  HTMLInputElement,
  {
    collectionId: string;
    collectionSlug: string;
    offer: PrepareOffer;
    selected: boolean;
    onToggle: (offer: PrepareOffer) => void;
    /** Enter in the price field: move on to the next row's. */
    onEnter: () => void;
    /** A price was saved — the row's new stated figure, or null once cleared. */
    onSaved: (field: "price" | "startingPrice", value: string | null) => void;
  }
>(function PrepareOfferRow({ collectionId, collectionSlug, offer, selected, onToggle, onEnter, onSaved }, ref) {
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
  const [lightbox, setLightbox] = useState<number | null>(null);

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

  // What still stands between the offer and Ready. The photo half is not among them: *Mark ready*
  // generates the photos itself and waits for them (#1893), so it is said as a note instead.
  const priced = pricingReadyFor(offer.listingType, "ready", offer.price, offer.startingPrice);
  const blockers = offer.readyBlockers.filter((b) => !isPhotoReadinessBlocker(b));
  const photosToGenerate = offer.readyBlockers.some(isPhotoReadinessBlocker);

  const shown = offer.pictures.slice(0, STRIP_PICTURES);
  const more = offer.pictures.length - shown.length;

  // A click nothing on the row wanted opens the offer (#1591) — the field, the figures, the pictures
  // and the box each keep their own.
  const href = `/c/${collectionSlug}/offers/${offer.id}`;
  const rowOpen = useRowOpen(href);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      {...rowOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "stretch",
        borderTop: "1px solid var(--color-border)",
        ...ROW_OPEN_STYLE,
        ...(selected
          ? { background: "var(--color-accent-soft)" }
          : hovered
            ? { background: "var(--color-bg-row-hover)" }
            : {}),
      }}
    >
      <CheckCell style={SELECT_STRIP}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(offer)}
          aria-label={`Select offer ${offer.name ?? offer.label}`}
          style={{ cursor: "pointer" }}
        />
      </CheckCell>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.625rem 1.25rem 0.625rem 0",
        }}
      >
        {/* The stamps the price is set for — the generated images once there are any (#1894). */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", flexShrink: 0, width: `calc(${STRIP_PICTURES} * ${THUMB} + 4.5rem)` }}>
          {shown.map((picture, index) => (
            <ThumbPreview
              key={picture.photoId}
              src={`/api/collections/${collectionId}/photos/${picture.photoId}/full`}
              thumbSrc={`/api/collections/${collectionId}/photos/${picture.photoId}/thumb`}
              label={picture.label}
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setLightbox(index)}
                aria-label={`View ${picture.label}`}
                style={{
                  width: THUMB,
                  height: THUMB,
                  padding: 0,
                  borderRadius: "0.375rem",
                  overflow: "hidden",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-page)",
                  cursor: "pointer",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/collections/${collectionId}/photos/${picture.photoId}/thumb`}
                  alt={picture.label}
                  style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT, display: "block" }}
                />
              </button>
            </ThumbPreview>
          ))}
          {more > 0 && (
            <Tooltip content={`${more} more — open them all`}>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setLightbox(STRIP_PICTURES)}
                style={{
                  padding: "0.125rem 0.375rem",
                  border: "none",
                  background: "none",
                  color: "var(--color-text-secondary)",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                +{more}
              </button>
            </Tooltip>
          )}
          {offer.pictures.length === 0 && (
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>No photos</span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", minWidth: 0 }}>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", flexShrink: 0 }}>
              {formatEntityNo(offer.offerNo)}
            </span>
            <RowTitleLink
              href={href}
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {offer.name ?? offer.label}
            </RowTitleLink>
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            {[
              offer.facebookGroupName ? `${offer.platformName} · ${offer.facebookGroupName}` : offer.platformName,
              auction ? "Auction" : null,
              `${offer.setCount} ${offer.setCount === 1 ? "set" : "sets"}`,
              `${offer.itemCount} ${offer.itemCount === 1 ? "copy" : "copies"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {/* What still blocks Ready, one reason each — they are fixed in different places — so the
              bulk action's refusals are seen before it is run (#1894). */}
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
            {priced && blockers.length === 0 && !offer.readyAfterPhotos && (
              <span style={{ color: "var(--color-success)", fontWeight: 500 }}>Can be marked ready</span>
            )}
          </div>
        </div>

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
      </div>

      {lightbox !== null && (
        <PhotoLightbox
          collectionId={collectionId}
          photos={offer.pictures.map((picture, i) => ({
            id: picture.photoId,
            role: null,
            title: picture.label,
            sortOrder: i,
          }))}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
});
