"use client";

import { useState } from "react";
import { titleFallbackKey, type TitleFallback, type TitleSegment } from "@/lib/offer-title-template";
import { languageLabel } from "@/lib/languages";
import { Tooltip } from "./tooltip";
import { TranslationGapPopover, gapLabel } from "./translation-gaps";

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
        // The wrapper stays `display: inline` so a flagged run keeps flowing (and line-breaking)
        // with the rest of the title instead of becoming an atomic inline-flex box.
        if (!onFixField || !field) {
          return (
            <Tooltip
              key={i}
              content="No translation for this language — the default text is used"
              style={{ display: "inline" }}
            >
              <span style={MARK_STYLE}>{s.text}</span>
            </Tooltip>
          );
        }
        return (
          <Tooltip
            key={i}
            content="No translation for this language — click to add one"
            style={{ display: "inline" }}
          >
            <button
              type="button"
              style={FIXABLE_STYLE}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                onFixField(field, { left: rect.left, bottom: rect.bottom });
              }}
            >
              {s.text}
            </button>
          </Tooltip>
        );
      })}
    </>
  );
}

/** What the warning line needs to let each untranslated name be translated where it is reported
 * (#1733). */
export interface TitleFallbackFix {
  collectionId: string;
  /** The language the preview resolved in. Null (the collection's default) cannot fall back, so
   * there is nothing to translate into and the names stay plain. */
  language: string | null;
  /** The entity names behind the flagged tokens, one per row and field to write. */
  gaps: readonly TitleFallback[];
  /** Called once a translation is stored; the caller re-renders the preview, whose fresh `gaps` no
   * longer carry the one just filled. */
  onSaved: () => void;
}

const NAME_LINK_STYLE: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  font: "inherit",
  color: "inherit",
  textDecoration: "underline",
  textUnderlineOffset: "0.15em",
  cursor: "pointer",
};

/** The summary line naming the tokens that fell back. Renders nothing when they all translated —
 * a collection without translations never sees this.
 *
 * With `fix`, it also names **each untranslated name** as a link (*Netherlands → Polish*) opening a
 * field for that one name (#1733): the collector fixes the gap where it is reported instead of
 * leaving for the area, issue or stamp it lives on. The saved text is the entity's own translation,
 * so it applies everywhere that name is used in that language. */
export function TitleFallbackNote({ tokens, fix }: { tokens: readonly string[]; fix?: TitleFallbackFix }) {
  const [open, setOpen] = useState<{ key: string; anchor: { left: number; bottom: number } } | null>(null);
  if (tokens.length === 0) return null;
  const language = fix?.language ?? null;
  const gaps = fix && language ? fix.gaps : [];
  const languageName = language ? languageLabel(language) : "";
  // A name whose translation was just saved leaves the refreshed `gaps`, and its field goes with it.
  const openGap = open ? gaps.find((g) => titleFallbackKey(g) === open.key) : undefined;
  return (
    <p style={{ fontSize: "0.6875rem", color: "var(--color-warning)", margin: "0.5rem 0 0" }}>
      Default language used for {tokens.join(", ")} — no translation entered for this language
      {gaps.length === 0 ? (
        "."
      ) : (
        <>
          :{" "}
          {gaps.map((gap, i) => (
            <span key={titleFallbackKey(gap)}>
              {i > 0 && ", "}
              <Tooltip
                content={`${gapLabel(gap)} — click to enter its ${languageName} text`}
                style={{ display: "inline" }}
              >
                <button
                  type="button"
                  style={NAME_LINK_STYLE}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setOpen({ key: titleFallbackKey(gap), anchor: { left: rect.left, bottom: rect.bottom } });
                  }}
                >
                  {gap.defaultValue} → {languageName}
                </button>
              </Tooltip>
            </span>
          ))}
        </>
      )}
      {fix && language && open && openGap && (
        <TranslationGapPopover
          collectionId={fix.collectionId}
          language={language}
          gaps={[openGap]}
          anchor={open.anchor}
          onSaved={fix.onSaved}
          onClose={() => setOpen(null)}
        />
      )}
    </p>
  );
}
