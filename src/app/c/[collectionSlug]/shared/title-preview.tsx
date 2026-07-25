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

/** The same mark as a control, when the surface can fix the translation from here (#300). Styled as
 * text rather than a button so the title still reads as a title. */
const FIXABLE_STYLE: React.CSSProperties = {
  ...MARK_STYLE,
  cursor: "pointer",
  padding: 0,
  border: "none",
  background: "none",
  font: "inherit",
  color: "inherit",
};

export interface TitlePreviewTextProps {
  segments: readonly TitleSegment[];
  /** Makes each flagged run clickable, reporting the copy field it rendered from and where it sits
   * on screen — the caller opens the translation popover there (#300). Omitted where there is
   * nothing to fix in place, e.g. the platform template builder's sample-copy preview. */
  onFixField?: (field: string, anchor: { left: number; bottom: number }) => void;
}

/** The rendered title, with segments that fell back to the default language dotted-underlined and
 * explained on hover. Renders as plain text when nothing fell back. */
export function TitlePreviewText({ segments, onFixField }: TitlePreviewTextProps) {
  return (
    <>
      {segments.map((s, i) => {
        if (!s.fellBack) return <span key={i}>{s.text}</span>;
        const field = s.field;
        if (!onFixField || !field) {
          return (
            <span key={i} style={MARK_STYLE} title="No translation for this language — the default text is used">
              {s.text}
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            style={FIXABLE_STYLE}
            title="No translation for this language — click to add one"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onFixField(field, { left: rect.left, bottom: rect.bottom });
            }}
          >
            {s.text}
          </button>
        );
      })}
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
