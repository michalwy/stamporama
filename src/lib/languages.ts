// Languages used for per-language entity text (#265, #293). A language is a free ISO 639-1 code
// stored on `Contact.titleLanguage`; the list below only drives the picker, so a code outside it
// still renders (shown as the bare code). Pure — no Prisma, no React.

/** ISO 639-1 codes offered in the platform language picker, with English display names. */
export const COMMON_LANGUAGES: { code: string; label: string }[] = [
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "de", label: "German" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "hu", label: "Hungarian" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "no", label: "Norwegian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "sk", label: "Slovak" },
  { code: "sv", label: "Swedish" },
  { code: "uk", label: "Ukrainian" },
];

const LABEL_BY_CODE = new Map(COMMON_LANGUAGES.map((l) => [l.code, l.label]));

/**
 * Normalise a stored / submitted language code: trimmed, lower-cased, region suffix dropped
 * (`pl-PL` → `pl`). Returns null for blanks so "not set" stays a single representation.
 */
export function normalizeLanguage(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return code || null;
}

/** Human label for a language code, e.g. `Polish (pl)`. Unknown codes render as the bare code. */
export function languageLabel(code: string): string {
  const label = LABEL_BY_CODE.get(code);
  return label ? `${label} (${code})` : code;
}
