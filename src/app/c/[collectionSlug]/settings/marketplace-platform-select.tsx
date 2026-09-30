"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SETTINGS_FIELD_SELECT_STYLE } from "./settings-field-grid";
import { SettingsPageAction } from "./settings-page-frame";

type SaveResult = { status: "success" } | { status: "error"; message: string };

/**
 * Which of the collection&rsquo;s platforms a marketplace page is about — **in the page header**
 * (#1473, #1475), where every marketplace page puts it: it is what names the marketplace at all, so
 * it sits beside the page's title rather than among the settings under it. The page's body renders
 * this and `SettingsPageAction` carries it up there.
 *
 * No draft and no Save — the select is the control, one write per change. Nothing is rendered while
 * the collection has no platforms; the page body says what to do instead.
 */
export function MarketplacePlatformSelect({
  id,
  ariaLabel,
  platforms,
  selectedId,
  save,
}: {
  id: string;
  /** "Allegro platform" — what the search index finds it by. */
  ariaLabel: string;
  /** Every platform contact of the collection — a marketplace is the only thing it can be. */
  platforms: { id: string; name: string }[];
  selectedId: string | null;
  save: (contactId: string) => Promise<SaveResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

  function choose(contactId: string) {
    setError(undefined);
    startTransition(async () => {
      const result = await save(contactId);
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  if (platforms.length === 0) return null;

  return (
    <SettingsPageAction>
      <div
        style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label htmlFor={id} style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
            Platform
          </label>
          <select
            id={id}
            aria-label={ariaLabel}
            value={selectedId ?? ""}
            onChange={(e) => choose(e.target.value)}
            disabled={isPending}
            style={{ ...SETTINGS_FIELD_SELECT_STYLE, minWidth: "14rem" }}
          >
            <option value="">— not set —</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-error)" }}>{error}</p>
        )}
      </div>
    </SettingsPageAction>
  );
}
