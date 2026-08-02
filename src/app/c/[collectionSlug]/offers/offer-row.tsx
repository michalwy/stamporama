"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OfferListItem } from "@/lib/offers";
import {
  isTerminalState,
  manualTransitions,
  priceLabel,
  pricingReadyFor,
  quickAdvanceTarget,
  requiresSets,
  type ManualOfferTarget,
} from "@/lib/offer-rules";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  OfferStateChip,
  NeedsActionChip,
  InActiveBiddingChip,
  ListingTypeChip,
} from "./offer-badges";

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

const TRANSITION_LABEL: Record<string, { label: string; icon: string }> = {
  ready: { label: "Mark ready", icon: "✓" },
  preparing: { label: "Back to preparing", icon: "↩" },
  active: { label: "Resume", icon: "▶" },
  paused: { label: "Pause", icon: "⏸" },
  withdrawn: { label: "Withdraw", icon: "⇤" },
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
function advanceLabel(to: ManualOfferTarget): { label: string; icon: string } {
  return to === "active" ? { label: "Activate", icon: "▲" } : TRANSITION_LABEL[to];
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
        icon: activating ? "▲" : TRANSITION_LABEL[s].icon,
        danger: s === "withdrawn",
        onSelect: () => onSetState(offer, s),
      };
    });

  const menuActions: RowAction[] = [
    { key: "open", label: "Open", icon: "↗", onSelect: () => router.push(detailHref) },
    ...(offer.url
      ? [{ key: "listing", label: "Open listing", icon: "🔗", onSelect: () => window.open(offer.url!, "_blank", "noopener,noreferrer") } as RowAction]
      : []),
    ...(terminal
      ? []
      : [{ key: "edit", label: "Edit", icon: "✎", onSelect: () => onEdit(offer) } as RowAction]),
    ...stateActions,
    ...(!terminal && offer.setCount > 0
      ? [{ key: "sell", label: "Sell", icon: "💰", onSelect: () => onSell(offer) } as RowAction]
      : []),
    ...(offer.inActiveBidding
      ? [
          {
            key: "clear-bidding",
            label: "Clear active bidding",
            icon: "🔨",
            onSelect: () => onSetInActiveBidding(offer, false),
          } as RowAction,
        ]
      : offer.state === "active"
        ? [
            {
              key: "mark-bidding",
              label: "Mark in active bidding",
              icon: "🔨",
              onSelect: () => onSetInActiveBidding(offer, true),
            } as RowAction,
          ]
        : []),
    {
      key: "duplicate",
      label: "List on another platform",
      icon: "⧉",
      onSelect: () => onDuplicate(offer),
    },
    {
      key: "delete",
      label: "Delete",
      icon: "✕",
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

        {/* Line 2: platform / state / quantity / price */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
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
                🔗 Listing
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
                <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>No price yet</span>
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
