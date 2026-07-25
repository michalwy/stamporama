import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fingerprintOfferPhotoInputs,
  type FingerprintCopy,
  type OfferPhotoFingerprintInput,
} from "../../src/lib/offer-photo-fingerprint";

// The staleness signal behind persisted offer images (#311): a hash of everything the generator read.
// What matters is not the digest itself but the two properties it needs — the same *effective* inputs
// always hash the same, and every input that changes an image changes the hash.

function copy(
  itemId: string,
  options: { front?: string | null; back?: string | null; sortOrder?: number | null; key?: number | null } = {}
): FingerprintCopy {
  const { front = `${itemId}-f`, back = `${itemId}-b`, sortOrder = null, key = null } = options;
  return { itemId, sortOrder, catalogSortKey: key, frontPhotoId: front, backPhotoId: back };
}

const base: OfferPhotoFingerprintInput = {
  sets: [
    { id: "s1", sortOrder: 0, items: [copy("a"), copy("b")] },
    { id: "s2", sortOrder: 1, items: [copy("c")] },
  ],
  photoSides: "both",
  photoLabelLeftTemplate: "{ref}",
  photoLabelRightTemplate: "{catalog}",
  tileLabels: [
    ["a", "A234", "Mi 1"],
    ["b", "A235", "Mi 2"],
    ["c", "B100", "Mi 3"],
  ],
  collage: {
    collageRows: 2,
    collageColumns: 2,
    collageGapPercent: 5,
    collageBackground: "#ffffff",
    collageLabelPercent: 14,
  },
  limits: { maxPhotos: 8, maxPhotoEdge: 1600, maxPhotoFileSizeMib: 4 },
};

const fp = (input: OfferPhotoFingerprintInput) => fingerprintOfferPhotoInputs(input);

/** The same input hashed twice, and a variant of it — for the "this changes the images" assertions. */
function differs(patch: Partial<OfferPhotoFingerprintInput>): boolean {
  return fp({ ...base, ...patch }) !== fp(base);
}

describe("fingerprintOfferPhotoInputs stability", () => {
  it("is deterministic", () => {
    assert.equal(fp(base), fp(base));
  });

  it("ignores the order the sets and copies were read in", () => {
    const shuffled: OfferPhotoFingerprintInput = {
      ...base,
      sets: [
        { id: "s2", sortOrder: 1, items: [copy("c")] },
        { id: "s1", sortOrder: 0, items: [copy("b"), copy("a")] },
      ],
    };
    assert.equal(fp(shuffled), fp(base));
  });

  it("ignores an explicit copy order that matches the derived one", () => {
    // Hand-confirming the order catalog order already produced is not a change to the images.
    const derived: OfferPhotoFingerprintInput = {
      ...base,
      sets: [
        { id: "s1", sortOrder: 0, items: [copy("a", { key: 1 }), copy("b", { key: 2 })] },
        { id: "s2", sortOrder: 1, items: [copy("c")] },
      ],
    };
    const explicit: OfferPhotoFingerprintInput = {
      ...base,
      sets: [
        { id: "s1", sortOrder: 0, items: [copy("a", { sortOrder: 0 }), copy("b", { sortOrder: 1 })] },
        { id: "s2", sortOrder: 1, items: [copy("c")] },
      ],
    };
    assert.equal(fp(explicit), fp(derived));
  });

  it("ignores the order the tile labels were read in", () => {
    assert.equal(
      fp({
        ...base,
        tileLabels: [["c", "B100", "Mi 3"], ["a", "A234", "Mi 1"], ["b", "A235", "Mi 2"]],
      }),
      fp(base)
    );
  });
});

describe("fingerprintOfferPhotoInputs sensitivity", () => {
  it("changes when a copy is added or removed", () => {
    assert.ok(
      differs({
        sets: [
          { id: "s1", sortOrder: 0, items: [copy("a"), copy("b"), copy("d")] },
          { id: "s2", sortOrder: 1, items: [copy("c")] },
        ],
      })
    );
  });

  it("changes when the sets are reordered", () => {
    assert.ok(
      differs({
        sets: [
          { id: "s1", sortOrder: 1, items: [copy("a"), copy("b")] },
          { id: "s2", sortOrder: 0, items: [copy("c")] },
        ],
      })
    );
  });

  it("changes when the copies inside a set are reordered", () => {
    assert.ok(
      differs({
        sets: [
          { id: "s1", sortOrder: 0, items: [copy("a", { sortOrder: 1 }), copy("b", { sortOrder: 0 })] },
          { id: "s2", sortOrder: 1, items: [copy("c")] },
        ],
      })
    );
  });

  it("changes when a source scan is replaced or removed", () => {
    const replaced = {
      sets: [
        { id: "s1", sortOrder: 0, items: [copy("a", { front: "a-f2" }), copy("b")] },
        { id: "s2", sortOrder: 1, items: [copy("c")] },
      ],
    };
    const removed = {
      sets: [
        { id: "s1", sortOrder: 0, items: [copy("a"), copy("b", { back: null })] },
        { id: "s2", sortOrder: 1, items: [copy("c")] },
      ],
    };
    assert.ok(differs(replaced));
    assert.ok(differs(removed));
  });

  it("changes with every part of the offer's photo configuration", () => {
    assert.ok(differs({ photoSides: "front" }));
    assert.ok(differs({ photoLabelLeftTemplate: null }));
    assert.ok(differs({ photoLabelRightTemplate: null }));
    assert.ok(differs({ collage: null }));
    assert.ok(differs({ collage: { ...base.collage!, collageGapPercent: 6 } }));
    assert.ok(differs({ collage: { ...base.collage!, collageBackground: "#eeeeee" } }));
    assert.ok(differs({ collage: { ...base.collage!, collageLabelPercent: 0 } }));
    assert.ok(differs({ collage: { ...base.collage!, collageColumns: 3 } }));
  });

  it("changes when a tile's label changes, because the label is drawn into the image", () => {
    // Editing a copy's location ref changes no scan and no setting — only the pixels of the strip.
    assert.ok(differs({ tileLabels: [["a", "A999", "Mi 1"], ["b", "A235", "Mi 2"], ["c", "B100", "Mi 3"]] }));
    // The right-hand annotation counts the same as the left one.
    assert.ok(differs({ tileLabels: [["a", "A234", "Mi 9"], ["b", "A235", "Mi 2"], ["c", "B100", "Mi 3"]] }));
    assert.ok(differs({ tileLabels: [["b", "A235", "Mi 2"], ["c", "B100", "Mi 3"]] }));
  });

  it("changes with the platform's output limits, which the renderer reads live", () => {
    assert.ok(differs({ limits: { ...base.limits, maxPhotos: 4 } }));
    assert.ok(differs({ limits: { ...base.limits, maxPhotoEdge: null } }));
    assert.ok(differs({ limits: { ...base.limits, maxPhotoFileSizeMib: 2 } }));
  });
});
