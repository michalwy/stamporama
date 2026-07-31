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
    collageGridMode: "fixed",
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
    assert.ok(differs({ collage: { ...base.collage!, collageGridMode: "auto" } }));
  });

  it("hashes the grid mode only when it is auto (#413)", () => {
    // Fixed is what every offer rendered as before the mode existed, so an offer that never leaves
    // it has to keep the digest it already stored — otherwise the whole collection would report
    // itself out of date over images unchanged by a pixel.
    const withoutMode: Partial<NonNullable<typeof base.collage>> = { ...base.collage! };
    delete withoutMode.collageGridMode;
    assert.equal(
      fp({ ...base, collage: withoutMode as typeof base.collage }),
      fp(base),
      "an offer with no stored mode hashes exactly as a fixed one"
    );
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

describe("fingerprintOfferPhotoInputs manual attachments (#313)", () => {
  const attached = (patch: Partial<OfferPhotoFingerprintInput> = {}) =>
    fp({
      ...base,
      attachments: [{ id: "m1", position: 0, photoId: "p1", itemId: "a" }],
      ...patch,
    });

  it("leaves an offer with no attachments hashing exactly as before", () => {
    // Widening the inputs must not declare every already-generated plan stale for images that did
    // not change by a pixel — so an empty attachment list is not part of the payload at all.
    assert.equal(fp({ ...base, attachments: [] }), fp(base));
    assert.equal(fp({ ...base, uploadTileLabel: ["Detail", ""] }), fp(base));
  });

  it("changes as soon as the offer carries one", () => {
    assert.notEqual(attached(), fp(base));
  });

  it("changes when an attachment moves, or shows something else", () => {
    assert.notEqual(
      attached({ attachments: [{ id: "m1", position: 3, photoId: "p1", itemId: "a" }] }),
      attached()
    );
    assert.notEqual(
      attached({ attachments: [{ id: "m1", position: 0, photoId: "p2", itemId: "a" }] }),
      attached()
    );
    // The copy is what the tile's label resolves from, so it is part of the image.
    assert.notEqual(
      attached({ attachments: [{ id: "m1", position: 0, photoId: "p1", itemId: null }] }),
      attached()
    );
  });

  it("ignores the order the attachments were read in", () => {
    const two = [
      { id: "m1", position: 0, photoId: "p1", itemId: "a" },
      { id: "m2", position: 4, photoId: "p2", itemId: null },
    ];
    assert.equal(attached({ attachments: two }), attached({ attachments: [...two].reverse() }));
  });

  it("hashes a manual collage's tiles and width, leaving single-image attachments alone (#331)", () => {
    const collageAttachment = (patch: { columns?: number; tiles?: [string, string | null][] } = {}) =>
      attached({
        attachments: [
          {
            id: "m1",
            position: 0,
            photoId: null,
            itemId: null,
            collage: {
              columns: patch.columns ?? 2,
              tiles: patch.tiles ?? [
                ["p1", "a"],
                ["p2", null],
              ],
            },
          },
        ],
      });

    // A collage is not the same image as a single attachment, and neither of its two knobs is free.
    assert.notEqual(collageAttachment(), attached());
    assert.notEqual(collageAttachment({ columns: 3 }), collageAttachment());
    assert.notEqual(
      collageAttachment({ tiles: [["p2", null], ["p1", "a"]] }),
      collageAttachment(),
      "tile order is the layout order, so swapping two tiles is a different image"
    );
    assert.notEqual(collageAttachment({ tiles: [["p1", "a"]] }), collageAttachment());
  });

  it("changes with the label an attachment with no copy is drawn with", () => {
    const upload = [{ id: "m2", position: 1, photoId: "p2", itemId: null }];
    assert.notEqual(
      attached({ attachments: upload, uploadTileLabel: ["Detail", ""] }),
      attached({ attachments: upload })
    );
  });
});

describe("fingerprintOfferPhotoInputs rendered set (#313)", () => {
  it("leaves an offer that renders the derived set hashing exactly as before", () => {
    // Like attachments, the rendered set joins the payload only when the offer uses a manual order
    // or a do-not-publish mark — so introducing it does not mark every generated plan out of date.
    assert.equal(fp({ ...base, renderedTokens: [] }), fp(base));
  });

  it("changes with which images the plan renders", () => {
    const two = fp({ ...base, renderedTokens: ["c:front:x", "a:m1"] });
    assert.notEqual(two, fp(base));
    assert.notEqual(two, fp({ ...base, renderedTokens: ["c:front:x"] }));
  });

  it("ignores the order of the set — the upload order is not a property of the images", () => {
    // A reorder is applied to the stored images themselves (their entries are renumbered), so it
    // cannot leave them stale and must not read as a change.
    assert.equal(
      fp({ ...base, renderedTokens: ["c:front:x", "a:m1"] }),
      fp({ ...base, renderedTokens: ["a:m1", "c:front:x"] })
    );
  });

  it("does not disturb an offer that has attachments but renders the derived set", () => {
    const withAttachments: OfferPhotoFingerprintInput = {
      ...base,
      attachments: [{ id: "m1", position: 0, photoId: "p1", itemId: "a" }],
    };
    assert.equal(fp(withAttachments), fp({ ...withAttachments, renderedTokens: [] }));
    assert.notEqual(fp(withAttachments), fp({ ...withAttachments, renderedTokens: ["a:m1"] }));
  });
});
