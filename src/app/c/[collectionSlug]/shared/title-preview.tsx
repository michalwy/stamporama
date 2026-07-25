"use client";

import type { TitleSegment } from "@/lib/offer-title-template";

// Shared rendering of a generated-title preview with its **untranslated** parts flagged (#298).
// Used by the platform's template builder (which renders segments client-side as you type) and by
// the offer compose dialog (which gets them from a server action, #297). Flagging is informational
// only — a title is generated either way and stays editable (#209).

const MARK_STYLE: React.CSSProperties = {
  textDecoration: "underline dotted",
  textDecorationColor: "var(--color-warning)",
  textUnderlineOffset: "0.2em",
  cursor: "help",
};

/** The rendered title, with segments that fell back to the default language dotted-underlined and
 * explained on hover. Renders as plain text when nothing fell back. */
export function TitlePreviewText({ segments }: { segments: readonly TitleSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.fellBack ? (
          <span key={i} style={MARK_STYLE} title="No translation for this language — the default text is used">
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}

/** The summary line naming the tokens that fell back. Renders nothing when they all translated —
 * a collection without translations never sees this. */
export function TitleFallbackNote({ tokens }: { tokens: readonly string[] }) {
  if (tokens.length === 0) return null;
  return (
    <p style={{ fontSize: "0.6875rem", color: "var(--color-warning)", margin: "0.5rem 0 0" }}>
      Default language used for {tokens.join(", ")} — no translation entered for this language.
    </p>
  );
}
