/**
 * Finding a setting by typing its name (#1470), over the entries of `settings-nav.ts`.
 *
 * A setting often lives on a page whose name does not say so — *retention* is on Photos & storage,
 * *base currency* on Collection — so the search reaches past the entry names to the fields and
 * sections on each page. Only the open page is rendered, so what the others hold cannot be read off
 * the screen: it is declared here, beside the entry list, **in the words the page shows**.
 *
 * Two kinds of word, kept apart on purpose (decided with the collector on 2026-09-29):
 *
 * - `label` is the text the page itself shows, character for character. It is what a match is
 *   named by in the navigation and what the screen looks for when it opens the page at the field,
 *   and `tests/unit/settings-search.test.ts` checks that every label still appears in its page's
 *   source — so a field renamed on its page fails the suite instead of silently leaving the search
 *   behind.
 * - `words` are what a collector might type that the page does not say (*retention* for "Keep
 *   closed listings' images"). They are found, never shown.
 *
 * What goes in: section headings, card titles and the labels of fields shown on the page as it
 * opens. Not what lives inside a dialog, since nothing there can be scrolled to, and not the rows of
 * a list, which are the collector's data rather than the page's settings. An entry's tabs are
 * searched from `parts` and need no line here.
 */

import { SETTINGS_ENTRIES, type SettingsEntry, type SettingsEntryKey } from "./settings-nav";

export interface SettingsField {
  /** The text the page shows, exactly. */
  label: string;
  /** The tab it is on, for an entry with tabs; its first tab when left out. */
  part?: string;
  /** Words that find it without being on the page. */
  words?: readonly string[];
}

/** Every entry has a line, so a new entry without one does not compile. */
export const SETTINGS_FIELDS: Readonly<Record<SettingsEntryKey, readonly SettingsField[]>> = {
  general: [
    { label: "Base currency" },
    { label: "Default language" },
    { label: "Copy number width" },
    { label: "Danger zone" },
    { label: "Reset to demo data" },
  ],
  storage: [
    { label: "Photo storage" },
    { label: "Local cache" },
    { label: "Keep closed listings' images", words: ["retention"] },
    { label: "Keep card scans of finished batches", words: ["retention"] },
  ],
  // The dictionaries and templates show only their rows until a page's own issue gives it a detail
  // (#1471, #1474): nothing on them is a field yet, and their names are the entries'.
  catalogs: [],
  conditions: [],
  certificates: [],
  formats: [],
  subtypes: [],
  attributes: [],
  "size-presets": [],
  duplicates: [
    { label: "Duplicate catalog numbers" },
    { label: "Policy" },
    { label: "Duplicate report" },
  ],
  scanning: [],
  tags: [],
  "album-templates": [],
  "hawid-stock": [],
  ornaments: [],
  refcards: [],
  collages: [],
  shipping: [],
  // The header's platform choice is found on the first tab; the tabs themselves come from `parts`.
  allegro: [
    { label: "Allegro platform" },
    { label: "Application", words: ["account"] },
    { label: "Client ID" },
    { label: "Application name" },
    { label: "Client secret" },
    { label: "Use Allegro’s sandbox" },
    { label: "Connection" },
    { label: "Permissions granted to this application" },
    { label: "What each kind of stamp was listed as", part: "categories", words: ["learned"] },
    {
      label: "What each category’s parameters were answered with",
      part: "categories",
      words: ["learned"],
    },
  ],
  // The header's platform choice is found on the first tab; the tabs themselves come from `parts`.
  delcampe: [
    { label: "Delcampe platform" },
    { label: "Delcampe’s own category list", part: "categories" },
    { label: "What each kind of stamp was uploaded as", part: "categories", words: ["learned"] },
  ],
  philasearch: [{ label: "Philasearch platform" }],
  acceptance: [],
  bids: [
    { label: "Bargain floor" },
    { label: "Walk-away ceiling" },
    { label: "Catalogue fallback" },
  ],
  "auction-reminder": [
    { label: "Email me the watched auctions ending each day" },
    { label: "Sent at" },
    { label: "Time zone" },
  ],
  colnect: [
    { label: "Colnect platform" },
    { label: "Colnect catalog mapping" },
    { label: "Colnect condition mapping" },
    { label: "Colnect attribute mapping" },
    { label: "Colnect list sync" },
    { label: "Mirrors" },
    { label: "Source of truth" },
  ],
  assistant: [
    { label: "Connect Stamporama Assistant" },
    { label: "Assistant tokens" },
    { label: "Collection ID" },
  ],
  email: [
    { label: "Provider" },
    { label: "Sent from" },
    { label: "Sent to" },
    { label: "Not delivered" },
  ],
};

/** A field or tab that matched, and where the page is opened to show it. */
export interface SettingsFieldMatch {
  label: string;
  /** The tab to open, or null for an entry without tabs. */
  part: string | null;
  /** A tab of the entry, or a field or section on its page. */
  kind: "part" | "field";
}

export interface SettingsMatch {
  entry: SettingsEntry;
  /** Empty when only the entry's own name matched. */
  fields: SettingsFieldMatch[];
}

/**
 * Case and accents are not what a collector is looking for, and neither is the typographic
 * apostrophe a label may carry where the keyboard types a straight one.
 */
export function normalizeSettingsText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function tokensOf(query: string): string[] {
  return normalizeSettingsText(query).split(" ").filter(Boolean);
}

/**
 * The entries a query finds, in the navigation's order, each with the fields and tabs that matched.
 * Null for a query with nothing in it: that is the whole navigation, not an empty result.
 *
 * Every word typed has to be found. The entry's name counts towards a field, so *allegro profiles*
 * finds Allegro's listing profiles; but at least one word has to be the field's own, or *allegro*
 * alone would list every field on the page under an entry that already matched by name.
 */
export function searchSettings(query: string): SettingsMatch[] | null {
  const tokens = tokensOf(query);
  if (tokens.length === 0) return null;

  const matches: SettingsMatch[] = [];
  for (const entry of SETTINGS_ENTRIES) {
    const name = normalizeSettingsText(entry.label);
    const entryMatched = tokens.every((t) => name.includes(t));

    const candidates: (SettingsFieldMatch & { text: string })[] = [
      ...(entry.parts ?? []).map((p) => ({
        label: p.label,
        part: p.key,
        kind: "part" as const,
        text: normalizeSettingsText(p.label),
      })),
      ...SETTINGS_FIELDS[entry.key].map((f) => ({
        label: f.label,
        part: entry.parts ? (f.part ?? entry.parts[0].key) : null,
        kind: "field" as const,
        text: normalizeSettingsText([f.label, ...(f.words ?? [])].join(" ")),
      })),
    ];

    const fields: SettingsFieldMatch[] = [];
    for (const c of candidates) {
      const own = tokens.some((t) => c.text.includes(t));
      const all = tokens.every((t) => c.text.includes(t) || name.includes(t));
      if (own && all && !fields.some((f) => f.label === c.label && f.part === c.part)) {
        fields.push({ label: c.label, part: c.part, kind: c.kind });
      }
    }

    if (entryMatched || fields.length > 0) matches.push({ entry, fields });
  }
  return matches;
}
