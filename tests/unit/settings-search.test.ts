import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SETTINGS_FIELDS,
  normalizeSettingsText,
  searchSettings,
} from "../../src/app/c/[collectionSlug]/settings/settings-search";
import {
  SETTINGS_ENTRIES,
  type SettingsEntryKey,
} from "../../src/app/c/[collectionSlug]/settings/settings-nav";

/**
 * Finding a setting by typing its name (#1470). The index beside the entry list names each page's
 * fields in the page's own words, so the second half of this file is what keeps it honest: every
 * label must still be in the source of the page that shows it.
 */

const SETTINGS_DIR = join(process.cwd(), "src/app/c/[collectionSlug]/settings");

/** Where each entry's fields are written — the panels `SettingsEntryBody` renders for it, and the
 *  screen itself for the section headings it puts between them. */
const SOURCES: Partial<Record<SettingsEntryKey, readonly string[]>> = {
  general: ["settings-panel.tsx"],
  storage: ["settings-panel.tsx"],
  bids: ["settings-panel.tsx"],
  duplicates: ["duplicates-panel.tsx"],
  allegro: [
    "settings-screen.tsx",
    "allegro-platform-panel.tsx",
    "allegro-connection-panel.tsx",
    "allegro-profiles-panel.tsx",
    "allegro-categories-panel.tsx",
  ],
  delcampe: [
    "settings-screen.tsx",
    "delcampe-platform-panel.tsx",
    "delcampe-profiles-panel.tsx",
    "delcampe-categories-panel.tsx",
  ],
  philasearch: ["philasearch-platform-panel.tsx"],
  "auction-reminder": ["auction-reminder-panel.tsx"],
  colnect: [
    "settings-screen.tsx",
    "colnect-platform-panel.tsx",
    "colnect-panel.tsx",
    "colnect-conditions-panel.tsx",
    "colnect-attributes-panel.tsx",
    "colnect-lists-panel.tsx",
  ],
  assistant: ["assistant-panel.tsx"],
  email: ["email-panel.tsx"],
};

/** JSX writes a typographic apostrophe as an entity; the screen shows the character. */
function asShown(source: string): string {
  return source
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&amp;/g, "&");
}

function shape(query: string) {
  return searchSettings(query)?.map((m) => [m.entry.key, m.fields.map((f) => f.label)]);
}

describe("settings search (#1470)", () => {
  it("finds a setting on a page whose name does not say so", () => {
    assert.deepEqual(shape("currency"), [["general", ["Base currency"]]]);
    assert.deepEqual(shape("retention"), [
      ["storage", ["Keep closed listings' images", "Keep card scans of finished batches"]],
    ]);
  });

  it("names the field it matched and where the page opens", () => {
    const [match] = searchSettings("walk-away")!;
    assert.equal(match.entry.key, "bids");
    assert.deepEqual(match.fields, [{ label: "Walk-away ceiling", part: null, kind: "field" }]);
  });

  it("finds an entry's tab and opens the entry on it", () => {
    const [match] = searchSettings("multipliers")!;
    assert.equal(match.entry.key, "formats");
    assert.deepEqual(match.fields, [{ label: "Multipliers", part: "multipliers", kind: "part" }]);
    assert.deepEqual(shape("watermarks"), [["attributes", ["Watermarks"]]]);
  });

  it("finds an entry by its own name, with no field under it", () => {
    assert.deepEqual(shape("hawid"), [["hawid-stock", []]]);
  });

  it("counts the entry's name towards a field, but not alone", () => {
    assert.deepEqual(shape("allegro profiles"), [["allegro", ["Listing profiles"]]]);
    assert.deepEqual(shape("colnect"), [
      [
        "colnect",
        [
          "Colnect platform",
          "Colnect catalog mapping",
          "Colnect condition mapping",
          "Colnect attribute mapping",
          "Colnect list sync",
        ],
      ],
    ]);
  });

  it("keeps the navigation's order across entries", () => {
    const keys = searchSettings("platform")!.map((m) => m.entry.key);
    const order = SETTINGS_ENTRIES.map((e) => e.key).filter((k) => keys.includes(k));
    assert.deepEqual(keys, order);
    assert.deepEqual(keys, ["allegro", "delcampe", "philasearch", "colnect"]);
  });

  it("ignores case, accents, spacing and the kind of apostrophe", () => {
    assert.deepEqual(shape("  BASE   Currency "), shape("base currency"));
    assert.deepEqual(shape("cúrrency"), shape("currency"));
    assert.deepEqual(shape("delcampe's own"), [["delcampe", ["Delcampe’s own category list"]]]);
  });

  it("is the whole navigation while nothing is typed, and empty when nothing matches", () => {
    assert.equal(searchSettings(""), null);
    assert.equal(searchSettings("   "), null);
    assert.deepEqual(searchSettings("zzzz"), []);
  });

  it("indexes each field once per entry, on a tab the entry has", () => {
    for (const entry of SETTINGS_ENTRIES) {
      const fields = SETTINGS_FIELDS[entry.key];
      const keys = fields.map((f) => `${f.part ?? ""}:${normalizeSettingsText(f.label)}`);
      assert.equal(new Set(keys).size, keys.length, `${entry.key} lists a field twice`);
      for (const f of fields) {
        if (f.part === undefined) continue;
        assert.ok(
          entry.parts?.some((p) => p.key === f.part),
          `${entry.key}: "${f.label}" is on a tab the entry does not have (${f.part})`
        );
      }
    }
  });

  // The pin: a field renamed on its page fails here, rather than leaving the search finding a name
  // the page no longer shows and the screen unable to find the field it opened.
  it("names every field in the words its page shows", () => {
    for (const entry of SETTINGS_ENTRIES) {
      const fields = SETTINGS_FIELDS[entry.key];
      if (fields.length === 0) continue;
      const files = SOURCES[entry.key];
      assert.ok(files, `${entry.key} has indexed fields but no source to check them against`);
      const source = asShown(
        files.map((f) => readFileSync(join(SETTINGS_DIR, f), "utf8")).join("\n")
      );
      for (const f of fields) {
        assert.ok(
          source.includes(f.label),
          `${entry.key}: "${f.label}" is not in ${files.join(", ")} — renamed on the page?`
        );
      }
    }
  });
});
