"use client";

import { useState } from "react";
import {
  TranslationsDialog,
  countTranslated,
  type TranslationField,
  type TranslationValues,
} from "./translations-dialog";

// The opener half of the per-language entity text UI (#293–#296): a 🌐 icon button that sits beside
// an entity form's default-language input, badged with how many languages still fall back, plus the
// hidden `<field>:<lang>` inputs that carry the staged values along the form's existing save path
// (parsed server-side by `parseTranslationValues` in `src/lib/translations.ts`).
//
// Extracted from the areas panel once condition / certificate status (#294), issue (#295) and stamp
// (#296) needed the same wiring — five copies of "button + badge + hidden inputs + dialog + staged
// state" is exactly the duplication the shared dialog was meant to avoid.

const buttonStyle: React.CSSProperties = {
  position: "relative",
  flexShrink: 0,
  width: "2.25rem",
  height: "2.25rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "1rem",
  lineHeight: 1,
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

const badgeStyle: React.CSSProperties = {
  position: "absolute",
  top: "-0.3rem",
  right: "-0.3rem",
  minWidth: "1rem",
  height: "1rem",
  padding: "0 0.2rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "0.625rem",
  fontWeight: 700,
  lineHeight: 1,
  color: "var(--color-bg-elevated)",
  background: "var(--color-text-muted)",
  borderRadius: "0.5rem",
  boxSizing: "border-box",
};

export interface TranslationsFieldProps {
  /** Title of the dialog this opens, e.g. "Condition translations". */
  dialogTitle: string;
  /** One-line explanation shown above the languages in the dialog. */
  description?: string;
  /** Languages needing a translation — the collection's platforms' languages minus its default
   * language. The caller renders nothing at all when this is empty. */
  languages: string[];
  /** The field(s) this button translates — normally exactly one, since an entity with several
   * translatable fields gives each its own button (#294). `defaultValue` should be the *live* value
   * of the form's default-language input, so the dialog's placeholder shows what a blank entry
   * falls back to. */
  fields: TranslationField[];
  /** Staged values, owned by the enclosing form so Cancel there discards them. */
  values: TranslationValues;
  onChange: (values: TranslationValues) => void;
  /** Told when the dialog opens/closes, so an enclosing dialog can stop dismissing itself on
   * Esc / backdrop click while this one is up. */
  onOpenChange?: (open: boolean) => void;
  /** Accessible name for the opener button, e.g. "Edit condition translations". */
  ariaLabel: string;
  disabled?: boolean;
}

/**
 * 🌐 opener + hidden inputs for an entity form's per-language text. Render it next to the entity's
 * own default-language input, inside the entity's `<form>`:
 *
 * ```tsx
 * {languages.length > 0 && (
 *   <TranslationsField … values={translations} onChange={setTranslations} />
 * )}
 * ```
 *
 * The badge counts the languages still **missing** a translation, so it reads as "these will fall
 * back to the default text" and disappears once every language is filled in.
 */
export function TranslationsField({
  dialogTitle,
  description,
  languages,
  fields,
  values,
  onChange,
  onOpenChange,
  ariaLabel,
  disabled,
}: TranslationsFieldProps) {
  const [open, setOpen] = useState(false);

  function setOpenState(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }

  const missing = languages.length - countTranslated(languages, values);

  return (
    <>
      {/* Values ride along as hidden inputs on the entity's existing save path; a cleared one
          submits blank, which drops that language's translation row. */}
      {languages.map((lang) =>
        fields.map((field) => (
          <input
            key={`${field.key}:${lang}`}
            type="hidden"
            name={`${field.key}:${lang}`}
            value={values[lang]?.[field.key] ?? ""}
          />
        ))
      )}
      <button
        type="button"
        onClick={() => setOpenState(true)}
        disabled={disabled}
        title={
          missing > 0
            ? `Translations — ${missing} of ${languages.length} language${languages.length !== 1 ? "s" : ""} still using the default`
            : "Translations — every language set"
        }
        aria-label={ariaLabel}
        style={buttonStyle}
      >
        🌐
        {missing > 0 && <span style={badgeStyle}>{missing}</span>}
      </button>

      {open && (
        <TranslationsDialog
          title={dialogTitle}
          description={description}
          languages={languages}
          fields={fields}
          values={values}
          onCancel={() => setOpenState(false)}
          onSave={(next) => {
            // Already complete over `languages` × `fields` — the dialog seeds its draft that way.
            onChange(next);
            setOpenState(false);
          }}
        />
      )}
    </>
  );
}
