"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAllegroPlatformAction } from "@/app/actions/allegro";

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
 * Which of the collection&rsquo;s platforms **is** Allegro (#355) — the whole of this tab, and the
 * one thing a captured auction lot cannot read off the listing it came from.
 *
 * The Assistant reads an allegro.pl auction page and hands over its URL, title, seller, closing time
 * and current bid. Every one of those is stated on the page; which `Contact` of this collection
 * Allegro is, is not — so it is asked once, here, instead of on every capture. Exactly one platform
 * can hold it, which is why this is a single select and not a tick on each contact.
 *
 * No draft and no Save — the select is the control, one write per change, matching the Colnect tab.
 */
export function AllegroPlatformPanel({
  collectionId,
  platforms,
  selectedId,
}: {
  collectionId: string;
  /** Every platform contact of the collection — a marketplace is the only thing Allegro can be. */
  platforms: { id: string; name: string }[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function save(contactId: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await setAllegroPlatformAction(collectionId, contactId);
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  if (platforms.length === 0) {
    return (
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
        This collection has no platforms yet. Add a contact with the <strong>Platform</strong> role
        under <strong>Contacts</strong>, then point Allegro at it here.
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
        Which of your platforms is Allegro. Naming it lets the Stamporama Assistant capture an
        auction you are watching straight from its page — the listing&rsquo;s address, title, seller,
        closing time and current bid go into a lot on this platform, in the seller&rsquo;s open
        parcel. Leave it unset and the Assistant will say so instead of guessing; lots are then added
        by hand under <strong>Auctions</strong>, exactly as before. What a lot actually holds is
        never read off a listing and is always entered here.
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
          htmlFor="allegro-platform"
          style={{ fontSize: "0.9375rem", color: "var(--color-text-primary)", fontWeight: 500 }}
        >
          Allegro platform
        </label>
        <select
          id="allegro-platform"
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
