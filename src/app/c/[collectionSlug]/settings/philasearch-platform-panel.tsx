"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPhilasearchPlatformAction } from "@/app/actions/philasearch";
import { SETTINGS_FIELD_SELECT_STYLE } from "./settings-field-grid";
import { SettingsPageAction } from "./settings-page-frame";

interface PhilasearchPlatformProps {
  collectionId: string;
  /** Every platform contact of the collection — a marketplace is the only thing Philasearch can be. */
  platforms: { id: string; name: string }[];
  selectedId: string | null;
}

/**
 * Which of the collection&rsquo;s platforms **is** Philasearch (#742) — the one thing a lot captured
 * from philasearch.com cannot read off its page.
 *
 * The page names the house selling the lot and the house&rsquo;s sale; the house is the lot&rsquo;s
 * seller and the sale its parcel. Which `Contact` of this collection the aggregator itself is, the
 * page cannot say — so it is asked once, here. Exactly one platform can hold it.
 *
 * It sits in the **page header** (#1473), where every marketplace page puts its platform choice:
 * it is what names the marketplace at all, so it belongs beside the page's title rather than among
 * the settings under it. The page's body puts it there through `SettingsPageAction`. Nothing is
 * rendered while the collection has no platforms — the page body says what to do instead.
 *
 * No draft and no Save — the select is the control, one write per change, matching the Allegro tab.
 */
function PhilasearchPlatformSelect({
  collectionId,
  platforms,
  selectedId,
}: PhilasearchPlatformProps) {
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

  if (platforms.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <label
          htmlFor="philasearch-platform"
          style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}
        >
          Platform
        </label>
        <select
          id="philasearch-platform"
          aria-label="Philasearch platform"
          value={selectedId ?? ""}
          onChange={(e) => save(e.target.value)}
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
      {error && <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-error)" }}>{error}</p>}
    </div>
  );
}

/**
 * The Philasearch page (#742, #1473): the platform choice, portalled into the header, and in the
 * body — with the platform chosen up there — what is left is
 * one line saying what the choice does today — or, with no platform to choose from, how to get one.
 * What the Assistant reads off a lot's page is the user guide's to explain, not this page's.
 */
export function PhilasearchPlatformPanel(props: PhilasearchPlatformProps) {
  const { platforms, selectedId } = props;
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
      <SettingsPageAction>
        <PhilasearchPlatformSelect {...props} />
      </SettingsPageAction>
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
