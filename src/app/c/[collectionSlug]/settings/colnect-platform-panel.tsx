"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setColnectPlatformAction } from "@/app/actions/colnect";

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
 * Which of the collection's platforms **is** Colnect (#406) — the setting the other two panels on
 * this tab quietly depend on, so it leads the tab.
 *
 * It lives here rather than as a field on the contact form because it is one fact per collection,
 * not a property every contact is asked about: the collector setting up Colnect is already on this
 * tab mapping catalogs and conditions, and a picker naming the platform reads as the question they
 * are actually answering. Exactly one platform can hold it — Colnect is one marketplace — which is
 * why this is a single select and not a tick on each contact.
 *
 * What it switches on is the listing checks (#406): with it set, the bulk listing workspace tests
 * every offer on that platform against Colnect's requirements. Unset, nothing anywhere is checked,
 * which is the right default for a collection that lists by hand.
 *
 * No draft and no Save — the select is the control, one write per change, matching the condition
 * mapping below it.
 */
export function ColnectPlatformPanel({
  collectionId,
  platforms,
  selectedId,
}: {
  collectionId: string;
  /** Every platform contact of the collection — a listing platform is the only thing Colnect can be. */
  platforms: { id: string; name: string }[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function save(contactId: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await setColnectPlatformAction(collectionId, contactId);
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  if (platforms.length === 0) {
    return (
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
        This collection has no platforms yet. Add a contact with the <strong>Platform</strong> role
        under <strong>Contacts</strong>, then point Colnect at it here.
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
        Which of your platforms is Colnect. Naming it lets the bulk listing workspace check offers
        headed there against what Colnect&rsquo;s sale form needs — an item-ID on every stamp, a
        grade for every condition, and sets that are interchangeable. Leave it unset and nothing is
        checked anywhere; every platform is then listed by hand, exactly as before.
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
          htmlFor="colnect-platform"
          style={{ fontSize: "0.9375rem", color: "var(--color-text-primary)", fontWeight: 500 }}
        >
          Colnect platform
        </label>
        <select
          id="colnect-platform"
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
