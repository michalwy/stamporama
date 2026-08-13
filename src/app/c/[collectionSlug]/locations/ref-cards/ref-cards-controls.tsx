"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LocationData } from "@/lib/locations";
import { flattenLocationTree } from "@/app/c/[collectionSlug]/shared/location-helpers";

/** A page of cards is a few dozen; the cap is here so a mistyped count cannot render a book. */
export const MAX_CARDS = 200;

const FIELD: React.CSSProperties = {
  padding: "0.3125rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
};

/**
 * Screen-only controls for the blank ref-card sheet (#565): which location the strip is for, the ref
 * it starts at, and how many cards to print. They rewrite the URL rather than hold state, so the
 * sheet stays a plain server render (the packing list's rule, #330) and a strip can be bookmarked
 * or reprinted from history exactly as it came out.
 *
 * Changing the **location** deliberately drops the start ref: the counter belongs to the location,
 * so carrying `A147` over to another box would suggest a strip that box knows nothing about.
 */
export function RefCardsControls({
  collectionSlug,
  locations,
  locationId,
  start,
  count,
}: {
  collectionSlug: string;
  locations: LocationData[];
  locationId: string;
  start: string;
  count: number;
}) {
  const router = useRouter();
  const [draftStart, setDraftStart] = useState(start);
  const [draftCount, setDraftCount] = useState(String(count));

  function go(next: { locationId?: string; start?: string; count?: string }) {
    const sp = new URLSearchParams();
    const loc = next.locationId ?? locationId;
    if (loc) sp.set("locationId", loc);
    const s = next.start ?? draftStart;
    if (s.trim()) sp.set("start", s.trim());
    sp.set("count", next.count ?? draftCount);
    router.replace(`/c/${collectionSlug}/locations/ref-cards?${sp.toString()}`);
  }

  return (
    <form
      className="no-print"
      onSubmit={(e) => {
        e.preventDefault();
        go({});
      }}
      style={{ display: "flex", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={LABEL}>Location</span>
        <select
          value={locationId}
          onChange={(e) => {
            setDraftStart("");
            go({ locationId: e.target.value, start: "" });
          }}
          style={{ ...FIELD, minWidth: "14rem" }}
        >
          <option value="">— Choose a location</option>
          {flattenLocationTree(locations).map(({ location, depth }) => (
            <option
              key={location.id}
              value={location.id}
              // A grouping node holds no copies, so it has no ref counter to continue.
              disabled={!location.assignable}
            >
              {"  ".repeat(depth)}
              {location.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={LABEL}>Start at</span>
        <input
          type="text"
          value={draftStart}
          onChange={(e) => setDraftStart(e.target.value)}
          placeholder="A147"
          style={{ ...FIELD, width: "7rem", fontVariantNumeric: "tabular-nums" }}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={LABEL}>Cards</span>
        <input
          type="number"
          min={1}
          max={MAX_CARDS}
          value={draftCount}
          onChange={(e) => setDraftCount(e.target.value)}
          style={{ ...FIELD, width: "5rem" }}
        />
      </label>

      <button
        type="submit"
        style={{ ...FIELD, cursor: "pointer", fontWeight: 600, color: "var(--color-text-primary)" }}
      >
        Update
      </button>
    </form>
  );
}
