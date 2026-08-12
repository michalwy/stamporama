"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { OfferListItem, OfferLookupTarget } from "@/lib/offers";
import { isTerminalState } from "@/lib/offer-rules";
import { ROW_LINK_ABOVE, RowLink } from "@/app/c/[collectionSlug]/shared/row-link";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { DetailCard } from "@/app/c/[collectionSlug]/shared/detail-page";
import {
  OfferStateChip,
  NeedsActionChip,
  InActiveBiddingChip,
  ListingOutOfDateChip,
} from "./offer-badges";
import { useOffersForTarget } from "./use-offers-query";
import { Icon } from "@/app/icons";

// The offers a copy / stamp / issue is on (#276, #349). Two surfaces read this: the row-menu popup
// (`offers-popup-dialog.tsx`) and the detail screens' Offers card (#517/#518/#519), which shows the
// same rows inline rather than behind a click. One row component, so the popup and the card cannot
// present one listing two ways.

const MUTED = "var(--color-text-muted)";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

/** Empty-state wording per target — the sentence a collector reads is about the thing they opened,
 * not about "the target". Read by the **popup** only: a popup was opened to ask this question and
 * owes an answer, whereas the detail card is simply absent when there is nothing on it (#536). */
export const OFFERS_EMPTY_TEXT: Record<OfferLookupTarget["kind"], string> = {
  item: "This copy is not listed in any offer yet.",
  stamp: "No copy of this stamp is listed in any offer yet.",
  issue: "No copy from this issue is listed in any offer yet.",
};

/** One offer as a read-only row: label on top, then platform / state / quantity / listing link and
 * the asking price. Mirrors the Offers list row's presentation minus its actions and lifecycle
 * controls — this row answers a question, it does not manage the listing. */
export function OfferTargetRow({
  offer,
  collectionSlug,
  isLast,
}: {
  offer: OfferListItem;
  collectionSlug: string;
  isLast: boolean;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const detailHref = `/c/${collectionSlug}/offers/${offer.id}`;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => router.push(detailHref)}
      style={{
        position: "relative",
        padding: "0.75rem 1.25rem",
        borderBottom: isLast ? undefined : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
        transition: "background 0.1s ease",
        cursor: "pointer",
        opacity: isTerminalState(offer.state) ? 0.7 : 1,
      }}
    >
      <RowLink
        href={detailHref}
        label={offer.name ?? offer.label}
        title={offer.name ?? offer.label}
      />

      <div
        style={{
          fontSize: "0.9375rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {offer.name ?? offer.label}
      </div>

      {/* Above the row's link overlay (#557): every chip here carries a tooltip and one is a
          marketplace link. A plain click still opens the offer, through the row's handler. */}
      <div
        style={{
          ...ROW_LINK_ABOVE,
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          marginTop: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <Tooltip content="Platform">
          <span style={CHIP}>{offer.platformName}</span>
        </Tooltip>
        <OfferStateChip state={offer.state} />
        {offer.needsAction && <NeedsActionChip soldCopyCount={offer.soldCopyCount} />}
        {offer.inActiveBidding && <InActiveBiddingChip />}
        {/* …and whether the live listing still matches what this offer says (#542) — the same flag
            the list row and the offer's own screen carry, so a related listing does not read as
            fine here and out of date one click away. */}
        {offer.listingOutOfDate && <ListingOutOfDateChip since={offer.listingOutOfDate} />}
        {offer.setCount > 1 && (
          <Tooltip content="Sets in this offer">
            <span style={CHIP}>{offer.setCount}×</span>
          </Tooltip>
        )}
        {offer.url && (
          <Tooltip content="Open the platform listing">
            <a
              href={offer.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
            >
              <Icon name="externalLink" size="sm" /> Listing
            </a>
          </Tooltip>
        )}
        <Tooltip content="Asking price" align="end" style={{ marginLeft: "auto" }}>
          <span
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text-primary)",
              whiteSpace: "nowrap",
            }}
          >
            {offer.price === "0.00" ? (
              <span style={{ color: MUTED, fontWeight: 500 }}>No price yet</span>
            ) : (
              <>
                {offer.price} {offer.currency}
                {offer.priceBase && (
                  <span
                    style={{
                      marginLeft: "0.375rem",
                      fontWeight: 500,
                      fontSize: "0.75rem",
                      color: MUTED,
                    }}
                  >
                    ≈ {offer.priceBase} {offer.baseCurrency}
                  </span>
                )}
              </>
            )}
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

/** The Offers card of a detail screen: every offer holding a copy of the target, live listings
 * first, each opening the offer's own screen. Read-only, like the popup it shares rows with. */
export function RelatedOffersCard({
  collectionId,
  target,
}: {
  collectionId: string;
  target: OfferLookupTarget;
}) {
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const { data: offers = [], isLoading } = useOffersForTarget(collectionId, target, true);

  return (
    <DetailCard
      title="Offers"
      count={offers.length || null}
      empty={isLoading || offers.length === 0}
    >
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.5rem",
          overflow: "clip",
          background: "var(--color-bg-elevated)",
        }}
      >
        {offers.map((offer, i) => (
          <OfferTargetRow
            key={offer.id}
            offer={offer}
            collectionSlug={collectionSlug}
            isLast={i === offers.length - 1}
          />
        ))}
      </div>
    </DetailCard>
  );
}
