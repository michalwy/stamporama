"use client";

import Link from "next/link";
import { useOfferNeighbours } from "../use-offers-query";
import { offerListContextQuery, type OfferListContext } from "../list-context";

const STEP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border-strong)",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const STEP_DISABLED: React.CSSProperties = {
  ...STEP,
  color: "var(--color-text-muted)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-page)",
  cursor: "default",
};

interface OfferListNavProps {
  collectionId: string;
  collectionSlug: string;
  offerId: string;
  context: OfferListContext;
}

/**
 * Previous / next through the filtered offer list the collector came from (#429): preparing a batch
 * is a walk through that list, and going back to it after each offer is the step this removes.
 *
 * Rendered only where the URL carries a list context — an offer opened from a search, a copy's
 * "View offers" popup or a bookmark is not part of any walk, and a next/previous there would be
 * pointing at a list nobody chose. Both ends are **disabled, not hidden** (#273): a step that
 * silently disappears at the end of a batch reads as a bug, and the position beside it is what says
 * why. The whole strip is absent while the position is unknown — an offer that is not in the
 * filtered set at all has no place in it to step from.
 */
export function OfferListNav({ collectionId, collectionSlug, offerId, context }: OfferListNavProps) {
  const { data } = useOfferNeighbours(collectionId, offerId, context);
  if (!data || data.position === null) return null;

  const query = offerListContextQuery(context);
  const href = (id: string) => `/c/${collectionSlug}/offers/${id}${query}`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      {data.previousId ? (
        <Link href={href(data.previousId)} title="Previous offer in the filtered list" style={STEP}>
          ‹ Previous
        </Link>
      ) : (
        <span style={STEP_DISABLED} aria-disabled="true">
          ‹ Previous
        </span>
      )}
      <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
        {data.position} of {data.total}
      </span>
      {data.nextId ? (
        <Link href={href(data.nextId)} title="Next offer in the filtered list" style={STEP}>
          Next ›
        </Link>
      ) : (
        <span style={STEP_DISABLED} aria-disabled="true">
          Next ›
        </span>
      )}
    </div>
  );
}
