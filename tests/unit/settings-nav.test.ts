import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_ENTRIES,
  SETTINGS_GROUPS,
  resolveSettingsAddress,
  settingsEntriesOf,
  settingsSearch,
} from "../../src/app/c/[collectionSlug]/settings/settings-nav";
import { SECTION_LABELS, SECTION_TINTS } from "../../src/app/c/[collectionSlug]/nav-sections";

/**
 * The Settings navigation (#1469; ADR-0059): which entries exist, under which group, and where an
 * address lands. The addresses are the part with a population outside this tree — the collector's
 * bookmarks, the user guide's links, the Allegro sign-in callback — so every key the old tab strip
 * had is pinned here to the content it used to open.
 */
describe("settings navigation (#1469)", () => {
  it("has exactly the entries the design settled, in its groups and order", () => {
    const shape = SETTINGS_GROUPS.map((g) => [g.label, settingsEntriesOf(g.key).map((e) => e.label)]);
    assert.deepEqual(shape, [
      ["General", ["Collection", "Photos & storage"]],
      [
        "Catalog",
        [
          "Catalogs",
          "Conditions",
          "Certificate statuses",
          "Formats",
          "Subtypes",
          "Attributes",
          "Size presets",
          "Duplicate numbers",
        ],
      ],
      [
        "Collection",
        ["Scanners", "Tags", "Album templates", "Hawid stock", "Corner ornaments", "Ref card templates"],
      ],
      ["Selling", ["Collage templates", "Carriers", "Allegro", "Delcampe", "Philasearch"]],
      ["Intake", ["Acceptance profiles", "Bid recommendation", "Auction reminder"]],
      ["Partners", ["Colnect"]],
      ["System", ["Assistant & API", "Email"]],
    ]);
  });

  it("puts every entry in a group, once, under a key of its own", () => {
    const grouped = SETTINGS_GROUPS.flatMap((g) => settingsEntriesOf(g.key));
    assert.equal(grouped.length, SETTINGS_ENTRIES.length);
    assert.equal(new Set(SETTINGS_ENTRIES.map((e) => e.key)).size, SETTINGS_ENTRIES.length);
  });

  it("names and tints the section groups exactly as the sidebar does", () => {
    for (const group of SETTINGS_GROUPS) {
      if (group.key === "general" || group.key === "system") {
        assert.equal(group.tint, null, group.key);
      } else {
        assert.equal(group.label, SECTION_LABELS[group.key]);
        assert.equal(group.tint, SECTION_TINTS[group.key]);
      }
    }
  });

  it("gives Formats, Attributes, Allegro and Delcampe their parts as tabs, and nothing else any", () => {
    const withParts = SETTINGS_ENTRIES.filter((e) => e.parts).map((e) => [
      e.key,
      e.parts!.map((p) => p.label),
    ]);
    assert.deepEqual(withParts, [
      ["formats", ["Formats", "Multipliers"]],
      ["attributes", ["Colours", "Watermarks", "Papers", "Printing methods"]],
      ["allegro", ["Account", "Listing profiles", "Categories"]],
      ["delcampe", ["Listing profiles", "Categories"]],
    ]);
  });

  it("gives every entry a one-line hint", () => {
    for (const entry of SETTINGS_ENTRIES) {
      assert.ok(entry.hint.length > 0, entry.key);
      assert.ok(!entry.hint.includes("\n"), entry.key);
    }
  });

  describe("addresses", () => {
    const lands = (tab: string | null, part: string | null = null) => {
      const { entry, part: chosen } = resolveSettingsAddress(tab, part);
      return chosen ? `${entry.label} / ${chosen}` : entry.label;
    };

    it("lands every key of the old tab strip on the content it opened", () => {
      const old: Record<string, string> = {
        general: "Collection",
        scanning: "Scanners",
        catalogs: "Catalogs",
        // Split tabs land on their first entry.
        conditions: "Conditions",
        subtypes: "Subtypes",
        attributes: "Attributes / color",
        tags: "Tags",
        collages: "Collage templates",
        refcards: "Ref card templates",
        albums: "Album templates",
        shipping: "Carriers",
        duplicates: "Duplicate numbers",
        colnect: "Colnect",
        allegro: "Allegro / account",
        delcampe: "Delcampe / profiles",
        philasearch: "Philasearch",
        assistant: "Assistant & API",
      };
      for (const [key, label] of Object.entries(old)) assert.equal(lands(key), label, key);
    });

    it("opens the default entry for no key or an unknown one", () => {
      assert.equal(lands(null), "Collection");
      assert.equal(lands(""), "Collection");
      assert.equal(lands("no-such-entry"), "Collection");
    });

    it("carries the tab inside an entry, and falls back to the first for an unknown one", () => {
      assert.equal(lands("formats"), "Formats / formats");
      assert.equal(lands("formats", "multipliers"), "Formats / multipliers");
      assert.equal(lands("attributes", "paper"), "Attributes / paper");
      assert.equal(lands("attributes", "nonsense"), "Attributes / color");
      assert.equal(lands("tags", "multipliers"), "Tags");
    });

    it("writes the plainest address for the defaults and keeps what else the address carries", () => {
      const none = new URLSearchParams();
      assert.equal(settingsSearch(none, "general", null), "");
      assert.equal(settingsSearch(none, "tags", null), "?tab=tags");
      assert.equal(settingsSearch(none, "formats", "formats"), "?tab=formats");
      assert.equal(settingsSearch(none, "formats", "multipliers"), "?tab=formats&part=multipliers");

      // The Allegro callback's outcome survives choosing a tab; a stale part does not.
      const callback = new URLSearchParams("tab=allegro&allegro=connected&part=x");
      assert.equal(settingsSearch(callback, "allegro", null), "?tab=allegro&allegro=connected");
      assert.equal(
        settingsSearch(callback, "allegro", "profiles"),
        "?tab=allegro&allegro=connected&part=profiles"
      );
    });

    // The sign-in callback redirects to `?tab=allegro` and nothing more (#1475): the outcome it
    // carries is rendered by the Account tab, so that tab has to be the one a bare address opens.
    it("lands the Allegro sign-in callback on the Account tab", () => {
      assert.equal(lands("allegro"), "Allegro / account");
      assert.equal(lands("allegro", "categories"), "Allegro / categories");
      assert.equal(lands("allegro", "nonsense"), "Allegro / account");
    });

    it("opens Delcampe on its listing profiles", () => {
      assert.equal(lands("delcampe"), "Delcampe / profiles");
      assert.equal(lands("delcampe", "categories"), "Delcampe / categories");
      assert.equal(lands("delcampe", "account"), "Delcampe / profiles");
    });

    it("round-trips every entry and part through its own address", () => {
      for (const entry of SETTINGS_ENTRIES) {
        for (const part of entry.parts?.map((p) => p.key) ?? [null]) {
          const qs = new URLSearchParams(settingsSearch(new URLSearchParams(), entry.key, part));
          const back = resolveSettingsAddress(qs.get("tab"), qs.get("part"));
          assert.equal(back.entry.key, entry.key);
          assert.equal(back.part, part);
        }
      }
    });
  });
});
