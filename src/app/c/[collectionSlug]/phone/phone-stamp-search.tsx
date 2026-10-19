import type { CSSProperties } from "react";
import Link from "next/link";
import type { CollectionSearchStamp } from "@/lib/collection-search";
import { phoneSearchHit, phoneSearchMiss } from "@/lib/phone-search-view";
import { phoneStampPath } from "@/lib/phone";
import { Icon } from "@/app/icons";
import { PHONE_TAP_TARGET, phoneButton, phoneRow } from "@/app/phone-screen";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { PhoneStampThumb } from "./phone-stamp-thumb";

/**
 * The phone start screen's search (#2004, ADR-0072): one field, the desk's own *have I got this?*
 * search behind it (`searchCollection`), and its stamps as rows that say at once whether copies are
 * held and whether the stamp is wanted, each with its thumbnail at the start (#2075). A row opens
 * the phone stamp screen.
 *
 * A plain GET form: the query is the page's `q`, so the phone's back gesture returns to the hits and
 * the page reads them on the server — no client state, nothing to keep in step.
 */
export function PhoneStampSearch({
  action,
  collectionId,
  collectionSlug,
  query,
  stamps,
  thumbs,
  full,
}: {
  /** Where the form goes — the phone start screen itself. */
  action: string;
  collectionId: string;
  collectionSlug: string;
  /** What was searched for, trimmed; empty when nothing was. */
  query: string;
  stamps: readonly CollectionSearchStamp[];
  /** Each hit's thumbnail photo by stamp id (`loadPhoneStampThumbs`); a stamp absent has none. */
  thumbs: ReadonlyMap<string, string>;
  /** The search came back at its cap, so there may be more than these. */
  full: boolean;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <form action={action} role="search" style={{ display: "flex", gap: "0.5rem" }}>
        <TextInput
          type="search"
          name="q"
          defaultValue={query}
          aria-label="Find a stamp"
          placeholder="Mi PL 200, a name, #901"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          {...NO_AUTOFILL}
          style={FIELD}
        />
        <button type="submit" aria-label="Search" style={SEARCH_BUTTON}>
          <Icon name="search" size="lg" />
        </button>
      </form>

      {query &&
        (stamps.length === 0 ? (
          <p style={NOTE}>{phoneSearchMiss(query)}</p>
        ) : (
          <nav style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {stamps.map((stamp) => {
              const hit = phoneSearchHit(stamp);
              return (
                <Link
                  key={stamp.stampId}
                  href={phoneStampPath(collectionSlug, stamp.stampId)}
                  style={{ ...phoneRow, alignItems: "flex-start" }}
                >
                  <PhoneStampThumb collectionId={collectionId} photoId={thumbs.get(stamp.stampId) ?? null} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    <span style={ELLIPSIS}>{hit.title}</span>
                    <span style={{ ...SECONDARY, ...ELLIPSIS }}>{hit.numbers}</span>
                    {hit.place && <span style={{ ...SECONDARY, ...ELLIPSIS }}>{hit.place}</span>}
                    <span style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                      <span style={hit.isHeld ? HELD_CHIP : CHIP}>{hit.held}</span>
                      {hit.wanted && (
                        <span style={WANTED_CHIP}>
                          <Icon name="wants" size="sm" />
                          {hit.wanted}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              );
            })}
            {full && (
              <p style={NOTE}>The first {stamps.length} stamps found — type more to narrow it.</p>
            )}
          </nav>
        ))}
    </section>
  );
}

/** A thumb's search field: the phone's tap target, not the desk's form height (`formControl`). */
const FIELD: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: PHONE_TAP_TARGET,
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.5rem",
  fontSize: "1rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const SEARCH_BUTTON: CSSProperties = {
  ...phoneButton,
  minWidth: PHONE_TAP_TARGET,
  background: "var(--color-action-primary)",
  color: "#fff",
};

const ELLIPSIS: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const SECONDARY: CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 400,
  color: "var(--color-text-secondary)",
};

const CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.125rem 0.5rem",
  borderRadius: "0.25rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  background: "var(--color-bg-muted)",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

const HELD_CHIP: CSSProperties = {
  ...CHIP,
  background: "var(--color-success-soft)",
  color: "var(--color-success)",
};

const WANTED_CHIP: CSSProperties = {
  ...CHIP,
  background: "var(--color-accent-soft)",
  color: "var(--color-accent)",
};

const NOTE: CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-muted)",
};
