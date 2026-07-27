"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { languageLabel } from "@/lib/languages";
import type { TitleFallback } from "@/lib/offer-title-template";

// Filling a **missing translation where the generated title needs it** (#299/#300).
//
// #298 made untranslated tokens visible in the title preview; this is the other half — each gap is
// listed with the default text it rendered and an input for the target language, and saving it is an
// ordinary entity mutation that happens **immediately and independently of the offer**. A translation
// is entity data, not offer data: it must survive cancelling the dialog it was typed in, and it must
// be the same row the entity's own translations dialog writes (#293–#296).
//
// Two surfaces share this file: the gaps panel (#299) and the popover a flagged token in the preview
// opens (#300) — the latter is the same editor over a filtered list, so there is one save path and
// one notion of what a gap is.

/** How a gap reads on screen: which entity it belongs to, and which of its fields. Keyed by the
 * `entityType:entityField` pair the server reports. */
const GAP_LABELS: Readonly<Record<string, string>> = {
  "stamp:name": "Stamp",
  "issue:name": "Issue",
  "condition:name": "Condition",
  "condition:abbreviation": "Condition (abbr.)",
  "certificateStatus:name": "Certificate",
  "certificateStatus:abbreviation": "Certificate (abbr.)",
  "area:titleName": "Area",
  "subtype:name": "Subtype",
  "format:name": "Format",
  "format:abbreviation": "Format (abbr.)",
};

/** A stable identity for one gap — the entity row + field it would be written on. */
export function gapKey(gap: TitleFallback): string {
  return `${gap.entityType}:${gap.entityId}:${gap.entityField}`;
}

function gapLabel(gap: TitleFallback): string {
  return GAP_LABELS[`${gap.entityType}:${gap.entityField}`] ?? gap.field;
}

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.3125rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

interface GapRowProps {
  collectionId: string;
  language: string;
  gap: TitleFallback;
  /** Called after the entity translation is stored, so the caller can re-render the title it
   * generates. The gap then disappears from the list the caller re-reads. */
  onSaved: () => void;
  autoFocus?: boolean;
}

/**
 * One gap: what it is, the default-language text that rendered instead, and an input for the target
 * language. Saves on Enter or on blur, never on every keystroke — a half-typed translation is not
 * worth a write, and the save is a real entity mutation.
 */
function GapRow({ collectionId, language, gap, onSaved, autoFocus }: GapRowProps) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | undefined>();
  // What is already stored, so blurring an untouched (or re-blurred) input writes nothing.
  const savedValue = useRef("");

  async function save() {
    const next = value.trim();
    if (next === savedValue.current) return;
    setState("saving");
    setError(undefined);
    const { saveEntityTranslationAction } = await import("@/app/actions/translations");
    const result = await saveEntityTranslationAction(collectionId, {
      entityType: gap.entityType,
      entityId: gap.entityId,
      entityField: gap.entityField,
      language,
      value: next,
    });
    if (result.status === "success") {
      savedValue.current = next;
      setState("saved");
      onSaved();
    } else {
      setState("error");
      setError(result.message);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span
        style={{
          flex: "0 0 8.5rem",
          fontSize: "0.75rem",
          color: "var(--color-text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={`${gapLabel(gap)} — ${gap.defaultValue}`}
      >
        <strong style={{ fontWeight: 600 }}>{gapLabel(gap)}</strong>{" "}
        <span style={{ color: "var(--color-text-muted)" }}>{gap.defaultValue}</span>
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setState("idle");
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // The panel lives inside the compose dialog; Enter here means "save this field", not
          // "submit the offer".
          e.preventDefault();
          e.stopPropagation();
          void save();
        }}
        placeholder={gap.defaultValue}
        aria-label={`${gapLabel(gap)} in ${languageLabel(language)}`}
        disabled={state === "saving"}
        autoFocus={autoFocus}
        style={{ ...INPUT_STYLE, flex: 1, minWidth: 0 }}
      />
      <span
        style={{
          flex: "0 0 4.5rem",
          fontSize: "0.6875rem",
          color: state === "error" ? "var(--color-danger)" : "var(--color-text-muted)",
        }}
        title={error}
      >
        {state === "saving" ? "Saving…" : state === "saved" ? "✓ Saved" : state === "error" ? "Failed" : ""}
      </span>
    </div>
  );
}

export interface TranslationGapsPanelProps {
  collectionId: string;
  /** The language the title resolved in. Null (the collection's default) means nothing can fall
   * back and the panel never renders. */
  language: string | null;
  gaps: readonly TitleFallback[];
  onSaved: () => void;
  /** Extra note under the heading, e.g. which texts the gaps were collected from. */
  note?: string;
  /** Cap on the visible rows before the list scrolls. */
  maxHeight?: string;
}

/**
 * The **"Missing <language> translations"** panel (#299): every entity field the generated text
 * rendered untranslated, each fillable in place. Renders nothing when there is nothing missing, so
 * a fully translated collection never sees it.
 */
export function TranslationGapsPanel({
  collectionId,
  language,
  gaps,
  onSaved,
  note,
  maxHeight = "9rem",
}: TranslationGapsPanelProps) {
  if (!language || gaps.length === 0) return null;
  return (
    <div>
      <span
        style={{
          fontSize: "0.6875rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          color: "var(--color-warning)",
        }}
      >
        Missing {languageLabel(language)} translations
      </span>
      {note && (
        <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.125rem 0 0" }}>
          {note}
        </p>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.375rem",
          marginTop: "0.375rem",
          maxHeight,
          overflowY: "auto",
        }}
      >
        {gaps.map((gap) => (
          <GapRow
            key={gapKey(gap)}
            collectionId={collectionId}
            language={language}
            gap={gap}
            onSaved={onSaved}
          />
        ))}
      </div>
    </div>
  );
}

export interface TranslationGapPopoverProps {
  collectionId: string;
  language: string;
  gaps: readonly TitleFallback[];
  /** Where the flagged token sits on screen — the popover opens just under it. */
  anchor: { left: number; bottom: number };
  onSaved: () => void;
  onClose: () => void;
}

/**
 * The same editor as a **popover on a flagged token** (#300): click the dotted-underlined run in the
 * title preview and fix that token's translation without opening the full panel.
 *
 * It shows the gaps behind *that token* — usually one, but a token aggregates over every copy in
 * scope, so a two-copy set with two untranslated stamp names shows both rather than pretending the
 * run maps to a single entity.
 */
export function TranslationGapPopover({
  collectionId,
  language,
  gaps,
  anchor,
  onSaved,
  onClose,
}: TranslationGapPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Closing the popover must not also close the dialog it floats above.
      e.stopImmediatePropagation();
      onClose();
    }
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [onClose]);

  if (typeof document === "undefined" || gaps.length === 0) return null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Translate into ${languageLabel(language)}`}
      style={{
        position: "fixed",
        // Kept inside the viewport for a token near the right edge of a wide dialog.
        left: Math.min(anchor.left, Math.max(8, window.innerWidth - 30 * 16 - 8)),
        top: anchor.bottom + 6,
        zIndex: 300,
        width: "28rem",
        maxWidth: "calc(100vw - 1rem)",
        padding: "0.75rem",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "0.5rem",
        background: "var(--color-bg-elevated)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--color-warning)" }}>
          {languageLabel(language)} translation
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ border: "none", background: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "0.875rem", lineHeight: 1 }}
        >
          ✕
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginTop: "0.5rem" }}>
        {gaps.map((gap, i) => (
          <GapRow
            key={gapKey(gap)}
            collectionId={collectionId}
            language={language}
            gap={gap}
            onSaved={onSaved}
            autoFocus={i === 0}
          />
        ))}
      </div>
    </div>,
    document.body
  );
}
