/**
 * What the Settings screen's navigation holds, and how an address reaches it (#1469; ADR-0059).
 *
 * A plain module rather than part of the screen, for `nav-sections.ts`'s reason: what the entries
 * *are* is a fact about the app's shape, and the address rules have to be answerable — and tested —
 * without rendering anything.
 */

import { SECTION_LABELS, SECTION_TINTS, type SectionKey } from "../nav-sections";
import { STAMP_ATTRIBUTE_KINDS, STAMP_ATTRIBUTE_LABELS } from "@/lib/stamp-attribute-kinds";

/**
 * The groups mirror the sidebar's sections, **in their tints** (#1465): a collector looking for the
 * carriers already knows they are a Selling thing, because that is where the sales are. *General*
 * leads and *System* closes, and neither is a section of the app, so neither has a tint — the same
 * answer the sidebar gives Overview and its footer.
 */
export type SettingsGroupKey = "general" | SectionKey | "system";

export interface SettingsGroup {
  key: SettingsGroupKey;
  label: string;
  /** The section's hue from `SECTION_TINTS`, or null for General and System. */
  tint: string | null;
}

/** A tab inside an entry: the panels of one thing (#1465). */
export interface SettingsPart {
  key: string;
  label: string;
}

/** What `?tab=` carries. An entry that inherited a tab of the old strip kept that tab's key. */
export type SettingsEntryKey =
  | "general"
  | "storage"
  | "catalogs"
  | "conditions"
  | "certificates"
  | "formats"
  | "subtypes"
  | "attributes"
  | "size-presets"
  | "duplicates"
  | "scanning"
  | "tags"
  | "album-templates"
  | "hawid-stock"
  | "ornaments"
  | "refcards"
  | "collages"
  | "shipping"
  | "allegro"
  | "delcampe"
  | "philasearch"
  | "acceptance"
  | "bids"
  | "auction-reminder"
  | "colnect"
  | "assistant"
  | "email";

export interface SettingsEntry {
  key: SettingsEntryKey;
  group: SettingsGroupKey;
  label: string;
  /** The one-line ⓘ hint beside the page title. */
  hint: string;
  /** Its tabs, the first being the default and never written into the address. */
  parts?: readonly SettingsPart[];
}

const sectionGroup = (key: SectionKey): SettingsGroup => ({
  key,
  label: SECTION_LABELS[key],
  tint: SECTION_TINTS[key],
});

/** In the sidebar's own order, General first and System last. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { key: "general", label: "General", tint: null },
  sectionGroup("catalog"),
  sectionGroup("collection"),
  sectionGroup("selling"),
  sectionGroup("buying"),
  sectionGroup("partners"),
  { key: "system", label: "System", tint: null },
];

/**
 * **One entry per thing** (#1465): a dictionary or an object of its own is an entry of its own, and
 * the panels of one thing stay one entry with tabs inside it. The list and its order are #1469's.
 */
export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  {
    key: "general",
    group: "general",
    label: "Collection",
    hint: "What holds for the whole collection: its currency, its language and how its copy numbers are shown.",
  },
  {
    key: "storage",
    group: "general",
    label: "Photos & storage",
    hint: "How much space the collection's photos take, and how long generated images and finished scans are kept.",
  },

  {
    key: "catalogs",
    group: "catalog",
    label: "Catalogs",
    hint: "The catalogues your stamps are numbered in, and their editions.",
  },
  {
    key: "conditions",
    group: "catalog",
    label: "Conditions",
    hint: "The grades a copy is described with — the first axis of a catalogue price.",
  },
  {
    key: "certificates",
    group: "catalog",
    label: "Certificate statuses",
    hint: "Whether and how a copy has been certified — the second axis of a catalogue price.",
  },
  {
    key: "formats",
    group: "catalog",
    label: "Formats",
    hint: "What a copy is — a single stamp, a cover, a block — and how much of catalogue each format is worth.",
    parts: [
      { key: "formats", label: "Formats" },
      { key: "multipliers", label: "Multipliers" },
    ],
  },
  {
    key: "subtypes",
    group: "catalog",
    label: "Subtypes",
    hint: "The kinds of variant a catalogue distinguishes under one number.",
  },
  {
    key: "attributes",
    group: "catalog",
    label: "Attributes",
    hint: "The values a stamp's colour, watermark, paper and printing method are chosen from. Every list starts empty and none is required.",
    parts: STAMP_ATTRIBUTE_KINDS.map((kind) => ({
      key: kind,
      label: STAMP_ATTRIBUTE_LABELS[kind].heading,
    })),
  },
  {
    key: "size-presets",
    group: "catalog",
    label: "Size presets",
    hint: "Named stamp sizes, so a stamp can be given one without being measured.",
  },
  {
    key: "duplicates",
    group: "catalog",
    label: "Duplicate numbers",
    hint: "Whether a catalogue number used on two stamps warns or blocks the save, and where it happens today.",
  },

  {
    key: "scanning",
    group: "collection",
    label: "Scanners",
    hint: "The scanners your scans are made with, each with the calibration its measurements are taken from.",
  },
  {
    key: "tags",
    group: "collection",
    label: "Tags",
    hint: "Your own labels for copies and issues. Nothing is seeded.",
  },
  {
    key: "album-templates",
    group: "collection",
    label: "Album templates",
    hint: "How a printed album page looks. A template is copied onto an album, never read back from one.",
  },
  {
    key: "hawid-stock",
    group: "collection",
    label: "Hawid stock",
    hint: "The mount strips you own, which an album page's boxes are cut from.",
  },
  {
    key: "ornaments",
    group: "collection",
    label: "Corner ornaments",
    hint: "The corner ornaments an album template's frame can use.",
  },
  {
    key: "refcards",
    group: "collection",
    label: "Ref card templates",
    hint: "The sizes of the paper cards a box is filed onto.",
  },

  {
    key: "collages",
    group: "selling",
    label: "Collage templates",
    hint: "How the images a listing carries are laid out.",
  },
  {
    key: "shipping",
    group: "selling",
    label: "Carriers",
    hint: "Who moves your parcels, and the address a tracking number opens.",
  },
  {
    key: "allegro",
    group: "selling",
    label: "Allegro",
    hint: "Which platform is Allegro, the account this instance publishes with, and what its listings carry.",
  },
  {
    key: "delcampe",
    group: "selling",
    label: "Delcampe",
    hint: "Which platform is Delcampe, and what the rows of an upload file carry.",
  },
  {
    key: "philasearch",
    group: "selling",
    label: "Philasearch",
    hint: "Which platform is Philasearch, so a lot captured from its pages lands on it.",
  },

  {
    key: "acceptance",
    group: "buying",
    label: "Acceptance profiles",
    hint: "Named rules for which condition, certificate and format a want accepts.",
  },
  {
    key: "bids",
    group: "buying",
    label: "Bid recommendation",
    hint: "The percentages an auction lot's recommended bid is stated with.",
  },
  // The morning email of the watched auctions ending that day (#1373) — Intake's, where the
  // auctions are, rather than System's beside Email: it is set up for the bidding, and only sent
  // through the mail that System configures.
  {
    key: "auction-reminder",
    group: "buying",
    label: "Auction reminder",
    hint: "A morning email of the watched auction lots ending that day, at an hour you choose.",
  },

  {
    key: "colnect",
    group: "partners",
    label: "Colnect",
    hint: "Which platform is Colnect, and what your catalogues, grades, attributes and lists are called there.",
  },

  {
    key: "assistant",
    group: "system",
    label: "Assistant & API",
    hint: "Connect the browser extension, and the tokens the API and the MCP server accept.",
  },
  // Mail to the collector (#1372; ADR-0060). Read-only here: the provider is chosen at deployment.
  {
    key: "email",
    group: "system",
    label: "Email",
    hint: "The provider this instance sends you mail through, a test message, and mail that did not arrive.",
  },
];

/** The entry an address with no `?tab=` opens. */
export const DEFAULT_SETTINGS_ENTRY: SettingsEntryKey = "general";

/**
 * Keys of today's strip that no entry kept (#1469). A tab that was **split** lands on its first
 * entry; `conditions`, `attributes` and `general` needed no line here because their first entry
 * kept the key. `areas` is not here either: it left Settings for a screen of its own (#775), and
 * `settings/page.tsx` redirects it before anything renders.
 */
const RETIRED_KEYS: Readonly<Record<string, SettingsEntryKey>> = {
  albums: "album-templates",
};

export interface SettingsAddress {
  entry: SettingsEntry;
  /** The chosen tab's key, or null for an entry without tabs. */
  part: string | null;
}

function entryByKey(key: string): SettingsEntry | undefined {
  return SETTINGS_ENTRIES.find((e) => e.key === key);
}

/**
 * Where `?tab=…&part=…` lands. Anything unknown falls back rather than failing: an unknown entry
 * opens the default one, an unknown part the entry's first tab — a stale bookmark should still open
 * the screen it was saved on.
 */
export function resolveSettingsAddress(
  tab: string | null | undefined,
  part: string | null | undefined
): SettingsAddress {
  const key = tab ? (RETIRED_KEYS[tab] ?? tab) : DEFAULT_SETTINGS_ENTRY;
  const entry = entryByKey(key) ?? entryByKey(DEFAULT_SETTINGS_ENTRY)!;
  if (!entry.parts) return { entry, part: null };
  const chosen = entry.parts.find((p) => p.key === part) ?? entry.parts[0];
  return { entry, part: chosen.key };
}

/**
 * The selected row of a list-beside-detail page (#1471): `&row=<id>`, so a link or a reload opens
 * that condition or format. A row belongs to one page and one tab, so choosing either drops it.
 */
export const SETTINGS_ROW_PARAM = "row";

/**
 * The query an entry and its tab are written as. The defaults are left out — the default entry and
 * an entry's first tab — so the plainest address stays the plainest, and every other parameter on
 * the address (the Allegro callback's outcome, say) is kept. The selected row is not: it names a row
 * of the page being left.
 */
export function settingsSearch(
  current: URLSearchParams,
  entryKey: string,
  part: string | null
): string {
  const params = new URLSearchParams(current.toString());
  params.delete(SETTINGS_ROW_PARAM);
  const entry = entryByKey(entryKey);
  if (entryKey === DEFAULT_SETTINGS_ENTRY) params.delete("tab");
  else params.set("tab", entryKey);
  const firstPart = entry?.parts?.[0]?.key ?? null;
  if (part && part !== firstPart) params.set("part", part);
  else params.delete("part");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** The entries of one group, in the navigation's order. */
export function settingsEntriesOf(group: SettingsGroupKey): SettingsEntry[] {
  return SETTINGS_ENTRIES.filter((e) => e.group === group);
}

export function settingsGroupOf(entry: SettingsEntry): SettingsGroup {
  return SETTINGS_GROUPS.find((g) => g.key === entry.group)!;
}
