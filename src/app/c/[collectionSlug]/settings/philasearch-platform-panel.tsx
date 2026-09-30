"use client";

import { setPhilasearchPlatformAction } from "@/app/actions/philasearch";
import { MarketplacePlatformSelect } from "./marketplace-platform-select";

interface PhilasearchPlatformProps {
  collectionId: string;
  /** Every platform contact of the collection — a marketplace is the only thing Philasearch can be. */
  platforms: { id: string; name: string }[];
  selectedId: string | null;
}

/**
 * The Philasearch page (#742, #1473): which of the collection&rsquo;s platforms **is** Philasearch —
 * the one thing a lot captured from philasearch.com cannot read off its page. The page names the
 * house selling the lot and the house&rsquo;s sale; which `Contact` of this collection the
 * aggregator itself is, it cannot say — so it is asked once, in the page header, where every
 * marketplace page puts its platform choice (`MarketplacePlatformSelect`). Exactly one platform can
 * hold it.
 *
 * In the body, with the platform chosen up there, what is left is one line saying what the choice
 * does today — or, with no platform to choose from, how to get one. What the Assistant reads off a
 * lot's page is the user guide's to explain, not this page's.
 */
export function PhilasearchPlatformPanel({
  collectionId,
  platforms,
  selectedId,
}: PhilasearchPlatformProps) {
  const muted: React.CSSProperties = {
    margin: 0,
    color: "var(--color-text-muted)",
    fontSize: "0.875rem",
  };

  if (platforms.length === 0) {
    return (
      <p style={muted}>
        This collection has no platforms yet. Add a contact with the <strong>Platform</strong> role
        under <strong>Contacts</strong>, then point Philasearch at it here.
      </p>
    );
  }

  const selected = platforms.find((p) => p.id === selectedId);
  return (
    <>
      <MarketplacePlatformSelect
        id="philasearch-platform"
        ariaLabel="Philasearch platform"
        platforms={platforms}
        selectedId={selectedId}
        save={(contactId) => setPhilasearchPlatformAction(collectionId, contactId)}
      />
      <p style={muted}>
        {selected ? (
          <>
            A lot the Assistant captures from philasearch.com lands on{" "}
            <strong style={{ color: "var(--color-text-primary)" }}>{selected.name}</strong>, in the
            house&rsquo;s sale of the same name.
          </>
        ) : (
          <>Not set — the Assistant will say so rather than capture a lot from philasearch.com.</>
        )}
      </p>
    </>
  );
}
