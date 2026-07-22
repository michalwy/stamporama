"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OfferListItem } from "@/lib/offers";
import { isTerminalState, manualTransitions } from "@/lib/offer-rules";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { OfferStateChip, NeedsActionChip } from "./offer-badges";

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
  active: { label: "Resume", icon: "▶" },
  paused: { label: "Pause", icon: "⏸" },
  withdrawn: { label: "Withdraw", icon: "⇤" },
};

interface OfferRowProps {
  offer: OfferListItem;
  collectionSlug: string;
  isLast: boolean;
  onEdit: (offer: OfferListItem) => void;
  onSetState: (offer: OfferListItem, state: "active" | "paused" | "withdrawn") => void;
  onDelete: (offer: OfferListItem) => void;
}

/** A single offer as a stacked card row: its derived label + actions on top, then platform /
 * state / quantity / price chips. The whole row opens the offer's detail (compose) screen. */
export function OfferRow({ offer, collectionSlug, isLast, onEdit, onSetState, onDelete }: OfferRowProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const detailHref = `/c/${collectionSlug}/offers/${offer.id}`;
  const terminal = isTerminalState(offer.state);

  const stateActions: RowAction[] = manualTransitions(offer.state)
    .filter((s): s is "active" | "paused" | "withdrawn" => s !== "sold")
    .map((s) => {
      // Publishing a preparing offer reads "Activate"; resuming a paused one keeps "Resume".
      const activating = offer.state === "preparing" && s === "active";
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
          >
            {offer.label}
          </span>
          <span style={{ flex: 1 }} />
          <span onClick={(e) => e.stopPropagation()}>
            <RowActionsMenu actions={menuActions} ariaLabel="Offer actions" />
          </span>
        </div>

        {/* Line 2: platform / state / quantity / price */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
          <span style={CHIP} title="Platform">{offer.platformName}</span>
          <OfferStateChip state={offer.state} />
          {offer.needsAction && <NeedsActionChip soldCopyCount={offer.soldCopyCount} />}
          {offer.setCount > 1 && (
            <span style={CHIP} title="Sets in this offer">{offer.setCount}×</span>
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
              <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>No price yet</span>
            ) : (
              <>{offer.price} {offer.currency}</>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
