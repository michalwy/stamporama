"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ItemListItem } from "@/lib/items";
import type { OfferListItem } from "@/lib/offers";
import { isTerminalState } from "@/lib/offer-rules";
import { formatItemNo } from "@/lib/item-number";
import { DialogShell, DialogBody } from "@/app/dialog-shell";
import {
  OfferStateChip,
  NeedsActionChip,
  InActiveBiddingChip,
} from "@/app/c/[collectionSlug]/offers/offer-badges";
import { useOffersForItem } from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { useCollectionItemNoPad } from "./use-inventory-query";

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

const HINT: React.CSSProperties = {
  color: MUTED,
  fontSize: "0.9375rem",
};

interface ItemOffersPopupDialogProps {
  collectionId: string;
  collectionSlug: string;
  /** The copy whose offers are listed; also names the dialog. */
  item: ItemListItem;
  onClose: () => void;
}

/**
 * Read-focused popup listing every offer that references one copy (#276) — all platforms, all
 * states, live listings first. Opened from the Copies list row menu so "where is this copy listed,
 * and for how much?" is answered without leaving the list; closing returns to it. Each row shows
 * the same platform / state / price presentation as the Offers list, opens the offer's detail
 * screen on click, and carries the platform listing link when one is recorded.
 */
export function ItemOffersPopupDialog({
  collectionId,
  collectionSlug,
  item,
  onClose,
}: ItemOffersPopupDialogProps) {
  const itemNoPad = useCollectionItemNoPad(collectionId);
  const { data: offers = [], isLoading } = useOffersForItem(collectionId, item.id, true);

  const label = item.stampName ?? formatItemNo(item.itemNo, itemNoPad);

  return (
    <DialogShell
      title={`Offers · ${label}`}
      onClose={onClose}
      maxWidth="min(94vw, 56rem)"
      height="min(80vh, 40rem)"
    >
      <DialogBody>
        {isLoading && <div style={HINT}>Loading offers…</div>}

        {!isLoading && offers.length === 0 && (
          <div style={HINT}>This copy is not listed in any offer yet.</div>
        )}

        {offers.length > 0 && (
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              overflow: "clip",
              background: "var(--color-bg-elevated)",
            }}
          >
            {offers.map((offer, i) => (
              <ItemOfferRow
                key={offer.id}
                offer={offer}
                collectionSlug={collectionSlug}
                isLast={i === offers.length - 1}
              />
            ))}
          </div>
        )}
      </DialogBody>
    </DialogShell>
  );
}

/** One offer as a read-only row: label on top, then platform / state / quantity / listing link and
 * the asking price. Mirrors the Offers list row's presentation minus its actions and lifecycle
 * controls — this popup answers a question, it does not manage the listing. */
function ItemOfferRow({
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
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(detailHref);
      }}
      style={{
        padding: "0.75rem 1.25rem",
        borderBottom: isLast ? undefined : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
        transition: "background 0.1s ease",
        cursor: "pointer",
        opacity: isTerminalState(offer.state) ? 0.7 : 1,
      }}
    >
      <div
        style={{
          fontSize: "0.9375rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={offer.name ?? offer.label}
      >
        {offer.name ?? offer.label}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          marginTop: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <span style={CHIP} title="Platform">
          {offer.platformName}
        </span>
        <OfferStateChip state={offer.state} />
        {offer.needsAction && <NeedsActionChip soldCopyCount={offer.soldCopyCount} />}
        {offer.inActiveBidding && <InActiveBiddingChip />}
        {offer.setCount > 1 && (
          <span style={CHIP} title="Sets in this offer">
            {offer.setCount}×
          </span>
        )}
        {offer.url && (
          <a
            href={offer.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open the platform listing"
            style={{ ...CHIP, color: "var(--color-accent)", textDecoration: "none" }}
          >
            🔗 Listing
          </a>
        )}
        <span
          style={{
            marginLeft: "auto",
            fontSize: "0.875rem",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: "var(--color-text-primary)",
            whiteSpace: "nowrap",
          }}
          title="Asking price"
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
      </div>
    </div>
  );
}
