import { normalizeLanguage } from "./languages";

// Shared rules for per-language entity text (#265, #293–#296, #338, #344, #738). Eleven entities now
// carry translation child tables — area title name, condition, certificate status and format (name
// + abbreviation), issue name, stamp name, stamp subtype name and the four stamp-attribute
// dictionaries (#72) — and every one of them parses the same form fields, writes rows the same way,
// and resolves the same fallback. That logic lives here once.
//
// Pure — no Prisma, no React, no `server-only`. Persistence is supplied by the caller as two
// callbacks in {@link syncEntityTranslations}, so this module stays unit-testable and the per-entity
// domain modules keep their own typed Prisma delegates.

/**
 * Per-language values for one entity: language code → field key → text. `null` and blank both mean
 * "no translation — fall back to the entity's default-language column", so a cleared input and a
 * never-filled one are one state.
 */
export type TranslationValueMap = Record<string, Record<string, string | null>>;

/** The entities that carry a translation child table (#293–#296, #338, #344). Names the row a
 * missing translation is filled on (#299), which is why it lives here rather than in any one
 * entity's module — the gap-filling path dispatches over it. */
export type TranslatableEntity =
  | "stamp"
  | "issue"
  | "condition"
  | "certificateStatus"
  | "area"
  | "subtype"
  | "format"
  // The four stamp-attribute dictionaries (#72), translatable since #738 put them in listing texts:
  // a Polish listing says `karminowy` where the collection's row reads `Carmine`. Denomination and
  // perforation are not here and never will be — they are printed as printed, and no language
  // rewrites `11½`.
  | "color"
  | "watermark"
  | "paper"
  | "printing";

/** The translatable columns of each entity, in the order their forms show them. Also the guard the
 * single-field save path validates an incoming field name against. */
export const TRANSLATABLE_ENTITY_FIELDS: Readonly<Record<TranslatableEntity, readonly string[]>> = {
  stamp: ["name"],
  issue: ["name"],
  condition: ["name", "abbreviation"],
  certificateStatus: ["name", "abbreviation"],
  area: ["titleName"],
  subtype: ["name"],
  format: ["name", "abbreviation"],
  color: ["name"],
  watermark: ["name"],
  paper: ["name"],
  printing: ["name"],
};

/** The form-field name a translated value is submitted under: `titleName:pl`, `abbreviation:de`. */
export function translationFieldName(fieldKey: string, language: string): string {
  return `${fieldKey}:${language}`;
}

/**
 * Read `<field>:<lang>` inputs out of a submitted form into a {@link TranslationValueMap}. The entity
 * forms render one hidden input per (field, language) — including blank ones — so a language present
 * in the form but blank in every field is reported with null values and its row is **deleted** rather
 * than left stale. Languages absent from the form are absent from the result and left untouched.
 *
 * `fieldKeys` are the entity's translatable columns; anything else in the form is ignored, which
 * matters because these forms also carry the plain default-language `name` / `titleName` inputs.
 */
export function parseTranslationValues(
  formData: FormData,
  fieldKeys: readonly string[]
): TranslationValueMap {
  const out: TranslationValueMap = {};
  for (const fieldKey of fieldKeys) {
    const prefix = `${fieldKey}:`;
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith(prefix) || typeof value !== "string") continue;
      const language = normalizeLanguage(key.slice(prefix.length));
      if (!language) continue;
      out[language] ??= {};
      out[language][fieldKey] = value.trim() || null;
    }
  }
  return out;
}

/**
 * Write an entity's translation rows through caller-supplied persistence.
 *
 * A language whose fields are **all** blank has its row removed — that is what "fall back to the
 * default" is stored as. Any non-blank field upserts the row, with the blank siblings written as
 * null so each field falls back on its own (a Polish condition may translate `Mint Never Hinged`
 * while leaving `MNH` alone). Languages missing from `values` are never touched, so a form that only
 * renders the languages currently in use cannot drop translations for a language that was
 * temporarily removed from the platform list.
 *
 * Sequential rather than concurrent: these are a handful of rows per save, and callers pass a
 * transaction client that must not be used from parallel promises.
 */
export async function syncEntityTranslations(
  values: TranslationValueMap | undefined,
  handlers: {
    upsert: (language: string, fields: Record<string, string | null>) => Promise<void>;
    remove: (language: string) => Promise<void>;
  }
): Promise<void> {
  if (!values) return;
  for (const [rawLanguage, rawFields] of Object.entries(values)) {
    const language = normalizeLanguage(rawLanguage);
    if (!language) continue;
    const fields: Record<string, string | null> = {};
    let hasValue = false;
    for (const [key, value] of Object.entries(rawFields)) {
      const trimmed = (value ?? "").trim();
      fields[key] = trimmed || null;
      if (trimmed) hasValue = true;
    }
    if (hasValue) await handlers.upsert(language, fields);
    else await handlers.remove(language);
  }
}

/**
 * Collapse fetched translation rows into the `Record<language, value>` shape the entity's read model
 * and its form expose. Only languages with a non-blank value appear, so "row exists but this field is
 * null" is indistinguishable from "no row" — which is exactly the fallback semantics.
 */
export function translationsByLanguage<T extends { language: string }>(
  rows: readonly T[],
  pick: (row: T) => string | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const value = pick(row)?.trim();
    if (value) out[row.language] = value;
  }
  return out;
}

/** A resolved translatable field: the text to render, and whether it came from the entity's
 * default-language column instead of a translation for the asked-for language (#298). */
export interface ResolvedTranslation {
  value: string | null;
  fellBack: boolean;
}

/**
 * {@link resolveTranslation}, additionally reporting whether the value **fell back** to the
 * default-language column (#298) — so a preview can flag the tokens that are not really translated.
 *
 * `fellBack` is only ever true when a language was actually asked for *and* something rendered:
 * resolving without a language is not a fallback (nothing was expected to be translated), and an
 * absent optional relation (a copy with no certificate status) has no text to translate either.
 */
export function resolveTranslationWithFallback<T extends { language: string }>(
  rows: readonly T[] | undefined,
  language: string | null,
  pick: (row: T) => string | null | undefined,
  fallback: string | null
): ResolvedTranslation {
  const value = resolveTranslation(rows, language, pick, fallback);
  const translated = language && rows ? rows.find((r) => r.language === language) : undefined;
  return { value, fellBack: !!language && !!value && !(translated && pick(translated)?.trim()) };
}

/**
 * Resolve one translatable field for `language`, falling back to the entity's default-language
 * value. Falls back on a null language, a missing row, and a blank value alike — the token always
 * renders something rather than leaving a gap in a generated title. Use
 * {@link resolveTranslationWithFallback} where the caller wants to *surface* the fallback (#298).
 */
export function resolveTranslation<T extends { language: string }>(
  rows: readonly T[] | undefined,
  language: string | null,
  pick: (row: T) => string | null | undefined,
  fallback: string
): string;
/** A nullable fallback (an optional relation, e.g. an item with no certificate status) stays null —
 * there is nothing to translate. */
export function resolveTranslation<T extends { language: string }>(
  rows: readonly T[] | undefined,
  language: string | null,
  pick: (row: T) => string | null | undefined,
  fallback: string | null
): string | null;
export function resolveTranslation<T extends { language: string }>(
  rows: readonly T[] | undefined,
  language: string | null,
  pick: (row: T) => string | null | undefined,
  fallback: string | null
): string | null {
  if (!language || !rows) return fallback;
  const value = rows.find((r) => r.language === language);
  return (value && pick(value)?.trim()) || fallback;
}
