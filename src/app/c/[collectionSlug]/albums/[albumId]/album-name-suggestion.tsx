"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/dialog-shell";
import {
  acceptAlbumNameSuggestionAction,
  dismissAlbumNameSuggestionAction,
} from "@/app/actions/albums";
import { languageLabel } from "@/lib/languages";

// The name an album is offered once its area has one in the album's language (#1311).
//
// An album named after its area before that translation existed carries the default-language name,
// and it is printed at the top of every card. The album **offers** the translated name and never
// takes it by itself — #797's rule that a name is never silently replaced — so this is a question
// with two answers, shown on the album screen and in the page editor alike, since the page editor is
// where the running head is looked at.

const BTN: React.CSSProperties = {
  padding: "0.3125rem 0.625rem",
  background: "transparent",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

interface AlbumNameSuggestionProps {
  albumId: string;
  name: string;
  suggestion: string;
  language: string;
}

export function AlbumNameSuggestion({ albumId, name, suggestion, language }: AlbumNameSuggestionProps) {
  const router = useRouter();
  /** The count the server asked about before renaming: printed cards that would stop matching. */
  const [confirm, setConfirm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function accept(acknowledged: number | null) {
    setError(null);
    startTransition(async () => {
      const result = await acceptAlbumNameSuggestionAction(albumId, suggestion, acknowledged);
      if (result.status === "confirm") {
        setConfirm(result.diverging);
        return;
      }
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setConfirm(null);
      setNotice(result.status === "success" ? (result.message ?? null) : null);
      router.refresh();
    });
  }

  function dismiss() {
    setError(null);
    startTransition(async () => {
      const result = await dismissAlbumNameSuggestionAction(albumId, suggestion);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      style={{
        marginBottom: "1rem",
        padding: "0.625rem 0.875rem",
        border: "1px solid var(--color-accent-border)",
        background: "var(--color-accent-soft)",
        borderRadius: "0.5rem",
        fontSize: "0.8125rem",
        lineHeight: 1.6,
        color: "var(--color-text-primary)",
      }}
    >
      <div>
        Use the name in {languageLabel(language)}: <strong>{suggestion}</strong>?
      </div>
      <div style={{ color: "var(--color-text-muted)" }}>
        This album is called {name}, the area&apos;s name in the collection&apos;s default language,
        and that is what prints at the top of every page. Nothing changes until you choose.
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button
          type="button"
          disabled={isPending}
          onClick={() => accept(null)}
          style={{ ...BTN, cursor: isPending ? "default" : "pointer" }}
        >
          Use {suggestion}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={dismiss}
          style={{ ...BTN, cursor: isPending ? "default" : "pointer" }}
        >
          Keep {name}
        </button>
      </div>
      {error && confirm === null && (
        <p style={{ color: "var(--color-error)", margin: "0.5rem 0 0" }}>{error}</p>
      )}
      {notice && <p style={{ color: "var(--color-text-muted)", margin: "0.5rem 0 0" }}>{notice}</p>}

      {confirm !== null && (
        <ConfirmDialog
          title="Printed cards will report a difference"
          message={
            confirm === 1
              ? `One printed card that matches this album today carries ${name} at the top. It stays exactly as printed, and Printed cards on the album screen will say what differs. Rename the album anyway?`
              : `${confirm} printed cards that match this album today carry ${name} at the top. They stay exactly as printed, and Printed cards on the album screen will say what differs on each. Rename the album anyway?`
          }
          actionLabel="Rename it anyway"
          pendingLabel="Renaming…"
          variant="primary"
          isPending={isPending}
          error={error ?? undefined}
          onClose={() => {
            if (isPending) return;
            setConfirm(null);
            setError(null);
          }}
          onConfirm={() => accept(confirm)}
        />
      )}
    </div>
  );
}
