"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OfferListItem } from "@/lib/offers";
import {
  isAuctionListing,
  isTerminalState,
  manualTransitions,
  priceLabel,
  pricingReadyFor,
  quickAdvanceTarget,
  requiresSets,
  type ManualOfferTarget,
} from "@/lib/offer-rules";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  OfferStateChip,
  AuctionEndedChip,
  NeedsActionChip,
  PlatformSaleChip,
  InActiveBiddingChip,
  ListingTypeChip,
} from "./offer-badges";
import { Icon, type IconName } from "@/app/icons";

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

const TRANSITION_LABEL: Record<string, { label: string; icon: IconName }> = {
  ready: { label: "Mark ready", icon: "check" },
  preparing: { label: "Back to preparing", icon: "revert" },
  active: { label: "Resume", icon: "resume" },
  paused: { label: "Pause", icon: "pause" },
  withdrawn: { label: "Withdraw", icon: "withdraw" },
};

const QUICK_ADVANCE_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-accent)",
  color: "var(--color-accent)",
  background: "var(--color-accent-soft)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** Label + icon for the one-click advance to `to` — publishing a `ready` offer reads "Activate";
 * marking a `preparing` one ready keeps the plain transition label. */
function advanceLabel(to: ManualOfferTarget): { label: string; icon: IconName } {
  return to === "active" ? { label: "Activate", icon: "activate" } : TRANSITION_LABEL[to];
}

interface OfferRowProps {
  offer: OfferListItem;
  collectionSlug: string;
  /** The list's active filters as a query string (#429), carried into the offer this row opens so
   * the detail screen can step to the next one without a trip back here. */
  listContextQuery: string;
  isLast: boolean;
  onEdit: (offer: OfferListItem) => void;
  onSetState: (offer: OfferListItem, state: ManualOfferTarget) => void;
  onDuplicate: (offer: OfferListItem) => void;
  onSell: (offer: OfferListItem) => void;
  onSetInActiveBidding: (offer: OfferListItem, value: boolean) => void;
  onDelete: (offer: OfferListItem) => void;
}

/** A single offer as a stacked card row: its derived label + actions on top, then platform /
 * state / quantity / price chips. The whole row opens the offer's detail (compose) screen. */
export function OfferRow({
  offer,
  collectionSlug,
  listContextQuery,
  isLast,
  onEdit,
  onSetState,
  onDuplicate,
  onSell,
  onSetInActiveBidding,
  onDelete,
}: OfferRowProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  // The detail screen walks the same filtered list this row is in (#429), so the row hands the
  // filter context on with the offer it opens.
  const detailHref = `/c/${collectionSlug}/offers/${offer.id}${listContextQuery}`;
  const terminal = isTerminalState(offer.state);

  // One-click advance through the linear part of the lifecycle (#255). Only shown where the next
  // move is unambiguous and permitted — a target that would list something needs ≥1 set, else the
  // server would reject it; ambiguous/terminal states fall back to the ⋮ menu.
  const advanceTo = terminal ? null : quickAdvanceTarget(offer.state);
  const canAdvance =
    advanceTo !== null &&
    (!requiresSets(advanceTo) || offer.setCount > 0) &&
    // Ready / Active need an asking price too (#336) — and, on an auction, the starting price it was
    // listed at (#449). The step is offered from the detail screen, where both are editable, rather
    // than as a button here that would only fail.
    pricingReadyFor(offer.listingType, advanceTo, offer.price, offer.startingPrice);

  const stateActions: RowAction[] = manualTransitions(offer.state)
    .filter((s): s is ManualOfferTarget => s !== "sold")
    .map((s) => {
      // Publishing a ready offer reads "Activate"; resuming a paused one keeps "Resume".
      const activating = offer.state === "ready" && s === "active";
      return {
        key: s,
        label: activating ? "Activate" : TRANSITION_LABEL[s].label,
        icon: activating ? "activate" : TRANSITION_LABEL[s].icon,
        danger: s === "withdrawn",
        onSelect: () => onSetState(offer, s),
      };
    });

  const menuActions: RowAction[] = [
    { key: "open", label: "Open", icon: "open", onSelect: () => router.push(detailHref) },
    ...(offer.url
      ? [{ key: "listing", label: "Open listing", icon: "externalLink", onSelect: () => window.open(offer.url!, "_blank", "noopener,noreferrer") } as RowAction]
      : []),
    ...(terminal
      ? []
      : [{ key: "edit", label: "Edit", icon: "edit", onSelect: () => onEdit(offer) } as RowAction]),
    ...stateActions,
    ...(!terminal && offer.setCount > 0
      ? [{ key: "sell", label: "Sell", icon: "sell", onSelect: () => onSell(offer) } as RowAction]
      : []),
    ...(offer.inActiveBidding
      ? [
          {
            key: "clear-bidding",
            label: "Clear active bidding",
            icon: "bidding",
            onSelect: () => onSetInActiveBidding(offer, false),
          } as RowAction,
        ]
      : offer.state === "active"
        ? [
            {
              key: "mark-bidding",
              label: "Mark in active bidding",
              icon: "bidding",
              onSelect: () => onSetInActiveBidding(offer, true),
            } as RowAction,
          ]
        : []),
    {
      key: "duplicate",
      label: "List on another platform",
      icon: "duplicate",
      onSelect: () => onDuplicate(offer),
    },
    {
      key: "delete",
      label: "Delete",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete(offer),
    },
  ];

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
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
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          cursor: "pointer",
          opacity: terminal ? 0.7 : 1,
        }}
      >
        {/* Line 1: offer label + actions */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "70%",
            }}
            title={offer.name ?? offer.label}
          >
            {offer.name ?? offer.label}
          </span>
          <span style={{ flex: 1 }} />
          <span onClick={(e) => e.stopPropagation()}>
            <RowActionsMenu actions={menuActions} ariaLabel="Offer actions" />
          </span>
        </div>

        {/* Line 2: number / platform / state / quantity / price */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
          {/* The offer's own short number (#416/#470), leading the line as it does on a purchase or
              a sale row: it identifies the row rather than describing it, and it is what the
              quick-jump box (#431) and the `/o/<slug>/<no>` address are typed from. */}
          <EntityNoChip entity="offer" no={offer.offerNo} prefix="o" />
          <Tooltip content="Platform">
            <span style={CHIP}>{offer.platformName}</span>
          </Tooltip>
          <OfferStateChip state={offer.state} />
          {canAdvance && advanceTo && (() => {
            const { label, icon } = advanceLabel(advanceTo);
            return (
              <Tooltip content={label}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetState(offer, advanceTo);
                  }}
                  aria-label={label}
                  style={QUICK_ADVANCE_BTN}
                >
                  <span aria-hidden>{icon}</span>
                  {label}
                </button>
              </Tooltip>
            );
          })()}
          {offer.needsAction && <NeedsActionChip soldCopyCount={offer.soldCopyCount} />}
          {/* An auction (#449) — shown because the figure at the end of this line is then a standing
              bid rather than a price the seller set. "In bidding" beside it is the other question:
              whether anyone has actually bid (#215). */}
          <ListingTypeChip listingType={offer.listingType} />
          {offer.inActiveBidding && <InActiveBiddingChip />}
          {/* …and whether that bidding is over with nobody having settled it (#490): the auction's
              moment has passed, somebody bid, and only the collector can say what became of it. */}
          {offer.needsResolution && <AuctionEndedChip />}
          {/* …and the end of that road: the marketplace has taken an order for this listing and no
              sale is recorded here yet (#499). It sits after the auction chips because it is what
              they turn into, and because it is the one that is no longer a question. */}
          {offer.platformSale && (
            <PlatformSaleChip
              paymentStatus={offer.platformSale.paymentStatus}
              orderId={offer.platformSale.orderId}
              platformName={offer.platformName}
            />
          )}
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
          <Tooltip content={priceLabel(offer.listingType)} align="end" style={{ marginLeft: "auto" }}>
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
                // An unbid auction is not unpriced — it is up with nobody having bid (#449).
                <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>
                  {isAuctionListing(offer.listingType) ? "No bids yet" : "No price yet"}
                </span>
              ) : (
                <>
                  {offer.price} {offer.currency}
                  {offer.priceBase && (
                    <span style={{ marginLeft: "0.375rem", fontWeight: 500, fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      ≈ {offer.priceBase} {offer.baseCurrency}
                    </span>
                  )}
                </>
              )}
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
