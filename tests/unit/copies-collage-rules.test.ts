import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLLAGE_SET_ID,
  collageArchiveName,
  collageFileName,
  collagePlanSets,
  normalizeCollagePackaging,
  parseRememberedCollageSettings,
  serializeCollageSettings,
  type CollageCopy,
  type RememberedCollageSettings,
} from "../../src/lib/copies-collage-rules";
import { planOfferPhotos } from "../../src/lib/offer-photo-plan";

// The one-off collage of ticked copies (#2052): the copies composed into sets the way the *New offer*
// shortcuts compose them, then planned by the offer photo rules.

function copy(itemId: string, catalogSortKey: string | null, front = true): CollageCopy {
  return { itemId, catalogSortKey, frontPhotoId: front ? `${itemId}-f` : null, backPhotoId: null };
}

const COLLAGE = {
  collageGridMode: "fixed" as const,
  collageGridShape: "landscape" as const,
  collageRows: 2,
  collageColumns: 2,
  collageGapPercent: 5,
  collageBackground: "#ffffff",
  collageLabelPercent: 4,
};

const SETTINGS: RememberedCollageSettings = {
  platformId: "p1",
  packaging: "per-copy",
  config: {
    photoSides: "front",
    preferSingles: true,
    photoLabelLeftTemplate: "{ref}",
    photoLabelRightTemplate: null,
    collage: COLLAGE,
    coverSymbols: null,
    groupByChecklist: false,
    groupCollage: null,
  },
};

describe("collagePlanSets", () => {
  const copies = [copy("c", "0003"), copy("a", "0001"), copy("x", null), copy("b", "0002")];

  it("makes one set of every copy, in catalogue order, as one set", () => {
    const sets = collagePlanSets(copies, "one-set");
    assert.equal(sets.length, 1);
    assert.equal(sets[0].id, COLLAGE_SET_ID);
    assert.deepEqual(
      sets[0].items.map((c) => c.itemId),
      ["a", "b", "c", "x"]
    );
  });

  it("makes a single-copy set of each copy, in catalogue order, each on its own", () => {
    const sets = collagePlanSets(copies, "per-copy");
    assert.deepEqual(
      sets.map((s) => s.items.map((c) => c.itemId)),
      [["a"], ["b"], ["c"], ["x"]]
    );
    assert.deepEqual(
      sets.map((s) => s.sortOrder),
      [0, 1, 2, 3]
    );
  });

  it("makes no set of no copies", () => {
    assert.deepEqual(collagePlanSets([], "one-set"), []);
  });

  it("lets single photos act only when each copy is its own set", () => {
    // Four copies, a 2 × 2 collage, a platform taking ten photos: as singles each gets its own
    // image; as one set they are one collage — a set is one thing being sold.
    const plan = (packaging: "one-set" | "per-copy") =>
      planOfferPhotos({
        sets: collagePlanSets(copies, packaging),
        photoSides: "front",
        collage: COLLAGE,
        maxPhotos: 10,
        preferSingles: true,
      });
    assert.equal(plan("per-copy").images.length, 4);
    assert.equal(plan("one-set").images.length, 1);
  });
});

describe("collage file names", () => {
  const at = new Date(2026, 9, 18, 14, 30);

  it("names a lone image by the day alone", () => {
    assert.equal(collageFileName(at, 0, 1), "collage-2026-10-18.jpg");
  });

  it("numbers several so they sort", () => {
    assert.equal(collageFileName(at, 0, 3), "collage-2026-10-18-01.jpg");
    assert.equal(collageFileName(at, 11, 120), "collage-2026-10-18-012.jpg");
  });

  it("names the archive by the day", () => {
    assert.equal(collageArchiveName(at), "collage-2026-10-18.zip");
  });
});

describe("remembered collage settings", () => {
  it("round-trips what was last used", () => {
    assert.deepEqual(parseRememberedCollageSettings(serializeCollageSettings(SETTINGS)), SETTINGS);
  });

  it("forgets nothing remembered, or something that no longer parses", () => {
    assert.equal(parseRememberedCollageSettings(null), null);
    assert.equal(parseRememberedCollageSettings("not json"), null);
    assert.equal(parseRememberedCollageSettings(JSON.stringify({ packaging: "one-set" })), null);
    assert.equal(
      parseRememberedCollageSettings(
        serializeCollageSettings({ ...SETTINGS, config: { ...SETTINGS.config, collage: { ...COLLAGE, collageRows: 0 } } })
      ),
      null
    );
  });

  it("reads an unknown packaging as one set", () => {
    const raw = JSON.stringify({ ...SETTINGS, packaging: "lots" });
    assert.equal(parseRememberedCollageSettings(raw)?.packaging, "one-set");
    assert.equal(normalizeCollagePackaging("per-copy"), "per-copy");
  });
});
