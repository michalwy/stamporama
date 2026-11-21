// Languages used for per-language entity text (#265, #293). A language is a free ISO 639-1 code
// stored on `Platform.titleLanguage`; the list below only drives the picker, so a code outside it
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

/** Whether a normalised code reads as an ISO 639 code — two or three letters. */
export function isLanguageCode(code: string | null | undefined): code is string {
  return !!code && /^[a-z]{2,3}$/.test(code);
}

/**
 * The languages a material for a buyer can be put into (#2603): the ones the collection already uses —
 * its own default language first, then its platforms' listing languages and its albums' languages,
 * by name — plus any of `keep` (the language a contact already has, say) outside them, so a choice
 * made before is never dropped from its own selector. Normalised and each once. Using a language
 * nothing uses yet means adding it there first.
 */
export function languageChoices(
  defaultLanguage: string | null | undefined,
  usedLanguages: readonly (string | null | undefined)[],
  keep: readonly (string | null | undefined)[] = []
): string[] {
  const first = normalizeLanguage(defaultLanguage);
  const rest = new Set<string>();
  for (const value of [...usedLanguages, ...keep]) {
    const code = normalizeLanguage(value);
    if (code && code !== first) rest.add(code);
  }
  const byName = [...rest].sort((a, b) => languageLabel(a).localeCompare(languageLabel(b)));
  return first ? [first, ...byName] : byName;
}

/** The language a material for a buyer opens in (#2603): the contact's, else the one the material
 *  used before the contact had any — for a proposal the Direct platform's listing language, else the
 *  collection's. */
export function buyerMaterialLanguage(
  contactLanguage: string | null | undefined,
  ...fallbacks: (string | null | undefined)[]
): string | null {
  for (const value of [contactLanguage, ...fallbacks]) {
    const code = normalizeLanguage(value);
    if (code) return code;
  }
  return null;
}
