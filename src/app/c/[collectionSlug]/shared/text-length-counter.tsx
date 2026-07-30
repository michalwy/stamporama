"use client";

import { Tooltip } from "./tooltip";
import { textLengthState } from "@/lib/listing-text-limits";

// How long a listing text is against what the platform accepts (#403). One component for both
// surfaces that show a listing text — the offer's own screen and the bulk listing kit (#322) — so
// the figure and the wording cannot drift between the place a text is written and the place it is
// carried into the platform's form.
//
// It renders **nothing** when the platform states no limit, which is the normal case: the caller
// makes one call and never a conditional of its own. Past the limit it warns and says by how much,
// and stops there — the text is the collector's and nothing truncates it.

export function TextLengthCounter({
  text,
  limit,
  what,
}: {
  /** The text as **stored** — the source, which is what the copy control puts on the clipboard and
   * what the platform's field will hold. While a field is being edited the caller passes the draft,
   * since a counter that lags a keystroke behind is what this exists to avoid. */
  text: string | null | undefined;
  /** The platform's cap, or null/undefined when it states none. */
  limit: number | null | undefined;
  /** What is being counted, for the hint — "description", "private note". */
  what: string;
}) {
  const state = textLengthState(text, limit);
  if (!state) return null;
  const { length, limit: max, over } = state;

  return (
    <Tooltip
      content={
        over > 0
          ? `${over} character${over === 1 ? "" : "s"} too long — this platform accepts ${max} for the ${what}. Shorten it before posting; nothing is cut for you.`
          : `This platform accepts ${max} characters for the ${what}`
      }
    >
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: over > 0 ? 600 : 500,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          color: over > 0 ? "var(--color-warning)" : "var(--color-text-muted)",
        }}
      >
        {length} / {max}
        {over > 0 && ` · over by ${over}`}
      </span>
    </Tooltip>
  );
}
