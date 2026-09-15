"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPhilasearchPlatformAction } from "@/app/actions/philasearch";

const SELECT_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  minWidth: "16rem",
};

/**
 * Which of the collection&rsquo;s platforms **is** Philasearch (#742) — the whole of this tab, and the
 * one thing a lot captured from philasearch.com cannot read off its page.
 *
 * The page names the house selling the lot and the house&rsquo;s sale; the house is the lot&rsquo;s
 * seller and the sale its parcel. Which `Contact` of this collection the aggregator itself is, the
 * page cannot say — so it is asked once, here. Exactly one platform can hold it.
 *
 * No draft and no Save — the select is the control, one write per change, matching the Allegro tab.
 */
export function PhilasearchPlatformPanel({
  collectionId,
  platforms,
  selectedId,
}: {
  collectionId: string;
  /** Every platform contact of the collection — a marketplace is the only thing Philasearch can be. */
  platforms: { id: string; name: string }[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function save(contactId: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await setPhilasearchPlatformAction(collectionId, contactId);
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  if (platforms.length === 0) {
    return (
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
        This collection has no platforms yet. Add a contact with the <strong>Platform</strong> role
        under <strong>Contacts</strong>, then point Philasearch at it here.
      </p>
    );
  }

  return (
    <>
      <p
        style={{
          color: "var(--color-text-muted)",
          fontSize: "0.8125rem",
          marginBottom: "1rem",
          lineHeight: 1.5,
        }}
      >
        Which of your platforms is Philasearch. Naming it lets the Stamporama Assistant capture a lot
        you are bidding on straight from its page — the address, the house&rsquo;s lot number, the
        closing time, the opening figure and your own bid go into a lot on this platform, in the
        house&rsquo;s sale of the same name. Leave it unset and the Assistant will say so instead of
        guessing. What a lot actually holds is never read off a listing and is always entered here.
      </p>

      {error && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>
          {error}
        </p>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem 1rem",
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        <label
          htmlFor="philasearch-platform"
          style={{ fontSize: "0.9375rem", color: "var(--color-text-primary)", fontWeight: 500 }}
        >
          Philasearch platform
        </label>
        <select
          id="philasearch-platform"
          value={selectedId ?? ""}
          onChange={(e) => save(e.target.value)}
          disabled={isPending}
          style={SELECT_STYLE}
        >
          <option value="">— not set —</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
