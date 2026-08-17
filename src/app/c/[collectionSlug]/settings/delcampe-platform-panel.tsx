"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDelcampePlatformAction } from "@/app/actions/delcampe";

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
 * Which of the collection&rsquo;s platforms **is** Delcampe (#608) — the question this tab leads
 * with, exactly as the Colnect and Allegro tabs lead with theirs.
 *
 * It is what the listing profiles below hang off, and what the Easy Uploader export (#610) will read
 * to know whose offers it is building a file for. Exactly one platform can hold it, which is why
 * this is a single select and not a tick on each contact.
 *
 * No draft and no Save — the select is the control, one write per change.
 */
export function DelcampePlatformPanel({
  collectionId,
  platforms,
  selectedId,
}: {
  collectionId: string;
  /** Every platform contact of the collection — a marketplace is the only thing Delcampe can be. */
  platforms: { id: string; name: string }[];
  selectedId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function save(contactId: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await setDelcampePlatformAction(collectionId, contactId);
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  if (platforms.length === 0) {
    return (
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
        This collection has no platforms yet. Add a contact with the <strong>Platform</strong> role
        under <strong>Contacts</strong>, then point Delcampe at it here.
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
        Which of your platforms is Delcampe. Its listings are prepared here like any other
        platform&rsquo;s — the title and description come from that contact&rsquo;s templates, the
        price and quantity from the offer — and are posted by uploading a file rather than through an
        API. Naming the platform is what the listing profiles below, and the upload file itself, hang
        off. Nothing about this switches on the Assistant: there is no Delcampe form to fill from
        here.
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
          htmlFor="delcampe-platform"
          style={{ fontSize: "0.9375rem", color: "var(--color-text-primary)", fontWeight: 500 }}
        >
          Delcampe platform
        </label>
        <select
          id="delcampe-platform"
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
