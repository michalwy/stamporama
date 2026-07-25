"use client";

import { Fragment, useState } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { languageLabel } from "@/lib/languages";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

/** One translatable field of the entity, e.g. the area's title name, or a condition's name and
 * abbreviation (#294). Each is rendered once per language. */
export interface TranslationField {
  /** Stable key the values record is keyed by (matches the entity's own column name). */
  key: string;
  /** Field label shown per language when the entity has more than one field. */
  label: string;
  /** The default-language value, shown as the input's placeholder so the fallback is visible. */
  defaultValue?: string;
}

/** Translated values: language code → field key → text. Blank / missing means "fall back to the
 * entity's default-language value". */
export type TranslationValues = Record<string, Record<string, string>>;

export interface TranslationsDialogProps {
  /** Dialog title, e.g. "Title name translations". */
  title: string;
  /** Label for the confirm button. Defaults to "Done" — the dialog stages values back into the
   * entity form rather than persisting them, so a "Save…" label would over-promise. */
  actionLabel?: string;
  /** One-line explanation shown above the languages. */
  description?: string;
  /** Languages to edit, in display order — the collection's languages in use (#293). */
  languages: string[];
  fields: TranslationField[];
  values: TranslationValues;
  /** Stacking base when opened on top of another dialog (default 200 — above the standard 100). */
  zIndexBase?: number;
  onCancel: () => void;
  onSave: (values: TranslationValues) => void;
}

/** How many languages have at least one non-blank field — the "2/3" badge on the opener button. */
export function countTranslated(languages: string[], values: TranslationValues): number {
  return languages.filter((lang) =>
    Object.values(values[lang] ?? {}).some((v) => v.trim())
  ).length;
}

/**
 * Reusable **translations dialog** (#293): edit an entity's per-language text one language at a
 * time, instead of growing the entity's own form by a field per language. The entity form keeps a
 * single default-language input and opens this from a button beside it.
 *
 * `onSave` **stages** values back into the entity form; it does not persist them. The entity's own
 * dialog stays the single logical save (so Cancel there discards translations too, and a brand-new
 * entity — which has no id yet — is handled the same way as an existing one). The confirm button is
 * labelled "Done" rather than "Save" to match.
 *
 * Generic over the entity's translatable `fields`, so the same dialog serves the area title name
 * now and condition / certificate status (two fields each), issue and stamp names later
 * (#294–#296). `languages` is the set needing a translation — the platforms' listing languages
 * minus the collection's default language, since text in that language already lives in the
 * entity's own column. When it is empty the caller does not offer the button at all.
 *
 * The panel height is **fixed** and the language grid scrolls inside it, so adding languages never
 * stretches the dialog.
 *
 * Rendered through a portal to `document.body`: it is opened from *inside* another dialog's form,
 * and `DialogShell`'s panel is `transform`ed, which would otherwise anchor this dialog's fixed
 * positioning to that panel instead of the viewport.
 */
export function TranslationsDialog({
  title,
  actionLabel = "Done",
  description,
  languages,
  fields,
  values,
  zIndexBase = 200,
  onCancel,
  onSave,
}: TranslationsDialogProps) {
  const [draft, setDraft] = useState<TranslationValues>(() =>
    Object.fromEntries(
      languages.map((lang) => [
        lang,
        Object.fromEntries(fields.map((f) => [f.key, values[lang]?.[f.key] ?? ""])),
      ])
    )
  );

  function update(lang: string, key: string, value: string) {
    setDraft((prev) => ({ ...prev, [lang]: { ...prev[lang], [key]: value } }));
  }

  /**
   * Enter confirms the dialog, as it would in any other. The inputs cannot rely on a form's implicit
   * submission: this dialog portals out of the entity form, so in the DOM they belong to no form
   * at all. Wrapping them in their own `<form>` would be worse — React bubbles events along the
   * *React* tree, so the inner submit would still reach the entity form's `onSubmit` and save the
   * whole entity. Hence an explicit key handler, with propagation stopped for the same reason.
   */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    onSave(draft);
  }

  const singleField = fields.length === 1;

  // Portals need the DOM. This dialog only ever renders after a click, so it is never part of a
  // server render or the hydration pass — the guard is just belt and braces.
  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title={title}
      onClose={onCancel}
      maxWidth="34rem"
      /* Fixed height: the language list scrolls inside the dialog instead of stretching it as
         more languages are added. */
      height="26rem"
      zIndexBase={zIndexBase}
    >
      <DialogBody>
        <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", margin: "0 0 1rem" }}>
          {description ??
            "One entry per language your platforms list in. Leave a field blank to use the default text."}
        </p>

        {/* Language down the left, its field(s) on the right — compact enough that a long language
            list stays scannable while scrolling. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(5rem, auto) 1fr",
            columnGap: "0.75rem",
            rowGap: "0.75rem",
            alignItems: "start",
          }}
        >
          {languages.map((lang) => (
            <Fragment key={lang}>
              <span
                style={{
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  color: "var(--color-text-secondary)",
                  paddingTop: "0.5rem",
                }}
              >
                {languageLabel(lang)}
              </span>
              <div>
                {fields.map((field, fieldIndex) => (
                  <div key={field.key} style={{ marginTop: fieldIndex === 0 ? 0 : "0.5rem" }}>
                    {!singleField && (
                      <LabelWithError htmlFor={`translation-${lang}-${field.key}`}>
                        {field.label}
                      </LabelWithError>
                    )}
                    <input
                      id={`translation-${lang}-${field.key}`}
                      type="text"
                      value={draft[lang]?.[field.key] ?? ""}
                      onChange={(e) => update(lang, field.key, e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={field.defaultValue || undefined}
                      aria-label={
                        singleField ? `${field.label} — ${languageLabel(lang)}` : undefined
                      }
                      data-autofocus={
                        lang === languages[0] && fieldIndex === 0 ? true : undefined
                      }
                      style={INPUT_STYLE}
                    />
                  </div>
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      </DialogBody>

      <DialogActions
        actionLabel={actionLabel}
        onCancel={onCancel}
        onAction={() => onSave(draft)}
      />
    </DialogShell>,
    document.body
  );
}
