import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCALE_CHOICE_NONE,
  SCALE_CHOICE_TYPED,
  defaultPhotoScale,
  defaultProfileIdOf,
  draftFromScale,
  lacksPhotoScale,
  resolvePhotoScale,
  parsePhotoScaleInput,
  photoScaleColumns,
  photoScaleLabel,
  photoScaleOf,
  sameScale,
  scaleFromDraft,
  storedPhotoDpi,
  uploadDpi,
} from "../../src/lib/photo-scale";
import type { ScanningSetup } from "../../src/lib/scanning-profile";
import {
  derivePhotoChangeSet,
  type ChangeSetEntry,
} from "../../src/app/c/[collectionSlug]/inventory/photo-change-set";

// A copy photo's scale (#2061): what it was scanned with, and the resolution that makes of the
// stored, possibly downscaled, picture — and a photo never given one taking the collection's default,
// apart from one marked *No scale* (#2066).

const setup: ScanningSetup = {
  profiles: [
    { id: "p1", name: "Epson V600", nominalDpi: 1200, calibration: { x: 1196, y: 1200 } },
    { id: "p2", name: "Canon", nominalDpi: 600, calibration: null },
  ],
  defaultProfileId: "p2",
};

describe("photo scale columns", () => {
  it("round-trips the four kinds through the three columns, at most one set", () => {
    for (const scale of [
      { kind: "profile", profileId: "p1" },
      { kind: "typed", dpi: 800 },
      { kind: "none" },
      { kind: "default" },
    ] as const) {
      const columns = photoScaleColumns(scale);
      const set = [columns.scanningProfileId !== null, columns.scanDpi !== null, columns.noScale];
      assert.ok(set.filter(Boolean).length <= 1);
      assert.deepEqual(photoScaleOf(columns), scale);
    }
  });

  it("reads all three empty as never given a scale, not as No scale (#2066)", () => {
    assert.deepEqual(photoScaleOf({ scanningProfileId: null, scanDpi: null, noScale: false }), { kind: "default" });
    assert.deepEqual(photoScaleOf({ scanningProfileId: null, scanDpi: null, noScale: true }), { kind: "none" });
  });
});

describe("resolvePhotoScale (#2066)", () => {
  it("gives a photo never given a scale the default profile, and says so", () => {
    assert.deepEqual(resolvePhotoScale({ kind: "default" }, "p2"), {
      scale: { kind: "profile", profileId: "p2" },
      fromDefault: true,
    });
    assert.deepEqual(resolvePhotoScale({ kind: "profile", profileId: "p2" }, "p2"), {
      scale: { kind: "profile", profileId: "p2" },
      fromDefault: false,
    });
  });

  it("leaves No scale without one, and the default without one where there is no default", () => {
    assert.equal(lacksPhotoScale({ kind: "none" }, "p2"), true);
    assert.equal(lacksPhotoScale({ kind: "default" }, "p2"), false);
    assert.equal(lacksPhotoScale({ kind: "default" }, null), true);
    assert.equal(lacksPhotoScale({ kind: "typed", dpi: 600 }, null), false);
  });

  it("reads the setup's default only while it is one of its profiles", () => {
    assert.equal(defaultProfileIdOf(setup), "p2");
    assert.equal(defaultProfileIdOf({ ...setup, defaultProfileId: "gone" }), null);
  });
});

describe("parsePhotoScaleInput", () => {
  it("takes a profile, a typed whole resolution in range, or none", () => {
    assert.deepEqual(parsePhotoScaleInput({ kind: "profile", profileId: "p1" }), {
      kind: "profile",
      profileId: "p1",
    });
    assert.deepEqual(parsePhotoScaleInput({ kind: "typed", dpi: 600 }), { kind: "typed", dpi: 600 });
    assert.deepEqual(parsePhotoScaleInput({ kind: "none" }), { kind: "none" });
    assert.deepEqual(parsePhotoScaleInput({ kind: "default" }), { kind: "default" });
  });

  it("refuses anything else", () => {
    for (const bad of [
      null,
      "p1",
      { kind: "profile", profileId: "" },
      { kind: "typed", dpi: 600.5 },
      { kind: "typed", dpi: 10 },
      { kind: "typed", dpi: 100000 },
      { kind: "typed", dpi: "600" },
      { kind: "exif" },
    ]) {
      assert.equal(parsePhotoScaleInput(bad), null, JSON.stringify(bad));
    }
  });
});

describe("defaultPhotoScale", () => {
  it("is the collection's default profile, else its first, else none", () => {
    assert.deepEqual(defaultPhotoScale(setup), { kind: "profile", profileId: "p2" });
    assert.deepEqual(defaultPhotoScale({ ...setup, defaultProfileId: "gone" }), {
      kind: "profile",
      profileId: "p1",
    });
    assert.deepEqual(defaultPhotoScale({ profiles: [], defaultProfileId: null }), { kind: "none" });
  });
});

describe("photoScaleLabel", () => {
  it("names the profile, a typed resolution, or no scale", () => {
    assert.equal(photoScaleLabel({ kind: "profile", profileId: "p2" }, setup), "Canon, 600 dpi (uncalibrated)");
    assert.equal(photoScaleLabel({ kind: "typed", dpi: 800 }, setup), "800 dpi (typed)");
    assert.equal(photoScaleLabel({ kind: "none" }, setup), "No scale");
  });

  it("names a default as the default, never as a choice (#2066)", () => {
    assert.equal(photoScaleLabel({ kind: "default" }, setup), "Canon, 600 dpi (uncalibrated) (default)");
    assert.equal(photoScaleLabel({ kind: "default" }, { ...setup, defaultProfileId: null }), "No scale");
  });
});

describe("the picker's draft", () => {
  it("reads back what it was made from", () => {
    for (const scale of [
      { kind: "profile", profileId: "p1" },
      { kind: "typed", dpi: 800 },
      { kind: "none" },
      { kind: "default" },
    ] as const) {
      assert.deepEqual(scaleFromDraft(draftFromScale(scale)), scale);
    }
  });

  it("means nothing while a typed resolution is not one", () => {
    assert.equal(scaleFromDraft({ choice: SCALE_CHOICE_TYPED, dpiText: "12a" }), null);
    assert.equal(scaleFromDraft({ choice: SCALE_CHOICE_TYPED, dpiText: "" }), null);
    assert.deepEqual(scaleFromDraft({ choice: SCALE_CHOICE_NONE, dpiText: "12a" }), { kind: "none" });
  });

  it("compares scales by what they say", () => {
    assert.ok(sameScale({ kind: "typed", dpi: 600 }, { kind: "typed", dpi: 600 }));
    assert.ok(!sameScale({ kind: "typed", dpi: 600 }, { kind: "profile", profileId: "p2" }));
    assert.ok(sameScale({ kind: "none" }, { kind: "none" }));
  });
});

describe("uploadDpi", () => {
  it("is a calibrated profile's mean, a nominal one's figure, or the typed one", () => {
    assert.equal(uploadDpi({ profile: setup.profiles[0], scanDpi: null }), 1198);
    assert.equal(uploadDpi({ profile: setup.profiles[1], scanDpi: null }), 600);
    assert.equal(uploadDpi({ profile: null, scanDpi: 800 }), 800);
    assert.equal(uploadDpi({ profile: null, scanDpi: null }), null);
  });
});

describe("storedPhotoDpi", () => {
  const CAP = 2500;

  it("is the upload's resolution for a picture stored at its own size", () => {
    assert.equal(storedPhotoDpi({ width: 1000, height: 800, originalWidth: 1000, originalHeight: 800 }, 600, CAP), 600);
  });

  it("falls with the downscale for storage", () => {
    // A 5000 px upload at 1200 dpi stored at 2500 px: the stored pixels measure 600 dpi.
    assert.equal(
      storedPhotoDpi({ width: 2500, height: 2000, originalWidth: 5000, originalHeight: 4000 }, 1200, CAP),
      600
    );
  });

  it("knows none without a scale, or without a frame to reckon it in", () => {
    assert.equal(storedPhotoDpi({ width: 1000, height: 800, originalWidth: 1000, originalHeight: 800 }, null, CAP), null);
    // At the cap and no recorded upload size: it may have been shrunk by a factor nothing records.
    assert.equal(storedPhotoDpi({ width: 2500, height: 2000, originalWidth: null, originalHeight: null }, 1200, CAP), null);
    // Under the cap with no recorded size: it cannot have been shrunk.
    assert.equal(storedPhotoDpi({ width: 1200, height: 900, originalWidth: null, originalHeight: null }, 1200, CAP), 1200);
  });
});

describe("what the copy editor's Save sends (#2061)", () => {
  const staged = (uploadId: string, status: "done" | "uploading" = "done"): ChangeSetEntry => ({
    source: "staged",
    uploadId,
    status,
    role: null,
    title: "",
    sourceUrl: "",
    turn: 0,
  });

  it("gives every photo being added the scale chosen for them", () => {
    const cs = derivePhotoChangeSet([staged("u1"), staged("u2")], [], ["front", "back"], false, {
      kind: "typed",
      dpi: 600,
    });
    assert.deepEqual(
      cs.add.map((a) => a.scale),
      [
        { kind: "typed", dpi: 600 },
        { kind: "typed", dpi: 600 },
      ]
    );
  });

  it("sends no scale when the editor records none", () => {
    const cs = derivePhotoChangeSet([staged("u1")], [], ["main"], true);
    assert.equal("scale" in cs.add[0], false);
  });
});
