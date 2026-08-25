import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attachmentToken,
  collageToken,
  planOfferPhotos,
  type PlanAttachment,
  type PlanCopy,
  type PlanSet,
  type PlannedCollage,
  type PlannedImage,
} from "../../src/lib/offer-photo-plan";

// Helpers -------------------------------------------------------------------

/** A copy with both scans present unless told otherwise; catalog order follows the id suffix. */
function copy(
  itemId: string,
  options: { front?: boolean; back?: boolean; sortOrder?: number | null } = {}
): PlanCopy {
  const { front = true, back = true, sortOrder = null } = options;
  return {
    itemId,
    sortOrder,
    catalogSortKey: null,
    frontPhotoId: front ? `${itemId}-f` : null,
    backPhotoId: back ? `${itemId}-b` : null,
  };
}

function set(id: string, sortOrder: number, items: PlanCopy[]): PlanSet {
  return { id, sortOrder, items };
}

const collage = { collageRows: 2, collageColumns: 2 }; // capacity 4

const collages = (images: PlannedImage[]): PlannedCollage[] =>
  images.filter((i): i is PlannedCollage => i.kind === "collage");

const skips = (plan: ReturnType<typeof planOfferPhotos>) =>
  plan.skipped.map((s) => `${s.groupKey}:${s.side}:${s.missingItemIds.join(",")}`);

const shape = (images: PlannedImage[]) =>
  images.map((image) =>
    image.kind === "collage"
      ? `${image.groupKey}:${image.side}:${image.tiles.map((t) => t.itemId).join(",")}`
      : `attachment:${image.attachmentId}`
  );

// Grouping ------------------------------------------------------------------

describe("planOfferPhotos grouping", () => {
  it("gives every multi-copy set its own group, in set order", () => {
    const plan = planOfferPhotos({
      sets: [
        set("s2", 1, [copy("c"), copy("d")]),
        set("s1", 0, [copy("a"), copy("b")]),
      ],
      photoSides: "front",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b", "g1:front:c,d"]);
    assert.deepEqual(
      collages(plan.images).map((i) => i.setIds),
      [["s1"], ["s2"]]
    );
  });

  it("collects single-copy sets across set boundaries and chunks them to capacity", () => {
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a")]),
        set("s2", 1, [copy("b")]),
        set("s3", 2, [copy("c")]),
        set("s4", 3, [copy("d")]),
        set("s5", 4, [copy("e")]),
      ],
      photoSides: "front",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b,c,d", "g1:front:e"]);
    assert.deepEqual(
      collages(plan.images).map((i) => i.setIds),
      [["s1", "s2", "s3", "s4"], ["s5"]]
    );
  });

  it("splits a set larger than the collage's capacity into consecutive groups of its own", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b"), copy("c"), copy("d"), copy("e")])],
      photoSides: "front",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b,c,d", "g1:front:e"]);
  });

  it("flushes accumulated single-copy sets before a multi-copy set, so plan order follows set order", () => {
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a")]),
        set("s2", 1, [copy("b"), copy("c")]),
        set("s3", 2, [copy("d")]),
      ],
      photoSides: "front",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a", "g1:front:b,c", "g2:front:d"]);
  });

  it("orders tiles by copy order — hand-corrected positions first", () => {
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [
          copy("a", { sortOrder: 2 }),
          copy("b", { sortOrder: 0 }),
          copy("c", { sortOrder: 1 }),
        ]),
      ],
      photoSides: "front",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:b,c,a"]);
  });

  it("plans nothing from empty sets or from no sets at all", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [])],
      photoSides: "both",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(plan.images, []);
    assert.equal(plan.configured, true);
  });

  it("plans nothing while the offer carries no collage numbers", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")])],
      photoSides: "front",
      collage: null,
      maxPhotos: null,
    });

    assert.deepEqual(plan.images, []);
    assert.equal(plan.configured, false);
  });
});

// Front / back --------------------------------------------------------------

describe("planOfferPhotos sides", () => {
  it("emits front and back interleaved, with identical contents", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")]), set("s2", 1, [copy("c"), copy("d")])],
      photoSides: "both",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), [
      "g0:front:a,b",
      "g0:back:a,b",
      "g1:front:c,d",
      "g1:back:c,d",
    ]);
    assert.deepEqual(
      collages(plan.images)[1].tiles.map((t) => t.photoId),
      ["a-b", "b-b"]
    );
  });

  it("drops the back collage entirely when one copy in the group has no back scan", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b", { back: false })])],
      photoSides: "both",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b"]);
  });

  it("applies the same all-or-nothing rule to the front side", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b", { front: false })])],
      photoSides: "both",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g0:back:a,b"]);
  });

  it("yields no image for a group missing both sides", () => {
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a"), copy("b", { front: false, back: false })]),
        set("s2", 1, [copy("c"), copy("d")]),
      ],
      photoSides: "both",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g1:front:c,d", "g1:back:c,d"]);
  });

  it("renders back alone when the offer asks for backs only", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")])],
      photoSides: "back",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g0:back:a,b"]);
  });
});

// Paired cells (#694) --------------------------------------------------------

/** A group's cells as `item(front|back)`, so a paired cell and a single-scan one read apart. */
const cells = (image: PlannedCollage) =>
  image.tiles.map((t) => `${t.itemId}(${t.photoId}${t.pairedPhotoId ? `|${t.pairedPhotoId}` : ""})`);

describe("planOfferPhotos paired cells", () => {
  it("renders one image per group, each cell holding a copy's two scans", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")]), set("s2", 1, [copy("c"), copy("d")])],
      photoSides: "paired",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g0:paired:a,b", "g1:paired:c,d"]);
    assert.deepEqual(cells(collages(plan.images)[0]), ["a(a-f|a-b)", "b(b-f|b-b)"]);
  });

  it("keeps the image when a copy has only one scan, as a single-scan cell", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b", { back: false }), copy("c", { front: false })])],
      photoSides: "paired",
      collage: { collageRows: 3, collageColumns: 3 },
      maxPhotos: null,
    });

    assert.deepEqual(cells(collages(plan.images)[0]), ["a(a-f|a-b)", "b(b-f)", "c(c-b)"]);
    // Nothing to report: a half-scanned copy is on the image, and its gap is the picture's own.
    assert.deepEqual(skips(plan), []);
  });

  it("leaves out a copy with no scan at all, and names it", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b", { front: false, back: false })])],
      photoSides: "paired",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g0:paired:a"]);
    assert.deepEqual(skips(plan), ["g0:paired:b"]);
  });

  it("produces no image for a group where no copy has a scan, naming all of them", () => {
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a", { front: false, back: false }), copy("b", { front: false, back: false })]),
        set("s2", 1, [copy("c"), copy("d")]),
      ],
      photoSides: "paired",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g1:paired:c,d"]);
    assert.deepEqual(skips(plan), ["g0:paired:a,b"]);
  });

  it("costs one upload slot per group, where `both` costs two", () => {
    const sets = [set("s1", 0, [copy("a"), copy("b")]), set("s2", 1, [copy("c"), copy("d")])];
    const paired = planOfferPhotos({ sets, photoSides: "paired", collage, maxPhotos: 2 });
    const both = planOfferPhotos({ sets, photoSides: "both", collage, maxPhotos: 2 });

    assert.equal(paired.overLimitCount, 0);
    assert.equal(paired.uploaded.length, 2);
    // The same two groups as `both` fill the allowance with the first group's two sides alone.
    assert.deepEqual(shape(both.uploaded), ["g0:front:a,b", "g0:back:a,b"]);
  });

  it("spends the singles budget (#521) on a paired group's one image, not two", () => {
    const sets = [
      set("s1", 0, [copy("a")]),
      set("s2", 1, [copy("b")]),
      set("s3", 2, [copy("c"), copy("d")]),
    ];
    // Three slots: the multi-copy set costs one paired image, leaving two for the singles.
    const plan = planOfferPhotos({
      sets,
      photoSides: "paired",
      collage,
      maxPhotos: 3,
      preferSingles: true,
    });

    assert.deepEqual(shape(plan.images), ["g0:paired:a", "g1:paired:b", "g2:paired:c,d"]);
    assert.equal(plan.overLimitCount, 0);
  });

  it("takes its own token, so a paired image and a front one never collide", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")])],
      photoSides: "paired",
      collage,
      maxPhotos: null,
    });

    assert.equal(plan.images[0].token, collageToken("paired", ["a", "b"]));
    assert.notEqual(plan.images[0].token, collageToken("front", ["a", "b"]));
  });
});

// Skipped sides (#314) -------------------------------------------------------

describe("planOfferPhotos skipped sides", () => {
  it("reports nothing when every planned side is complete", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")])],
      photoSides: "both",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(plan.skipped, []);
  });

  it("names every copy whose back scan is missing, not just the first", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b", { back: false }), copy("c", { back: false })])],
      photoSides: "both",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b,c"]);
    assert.deepEqual(skips(plan), ["g0:back:b,c"]);
    assert.deepEqual(plan.skipped[0].itemIds, ["a", "b", "c"]);
    assert.deepEqual(plan.skipped[0].setIds, ["s1"]);
  });

  it("reports both sides for a group that has no scans at all", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a", { front: false, back: false }), copy("b")])],
      photoSides: "both",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(plan.images, []);
    assert.deepEqual(skips(plan), ["g0:front:a", "g0:back:a"]);
  });

  it("reports a missing side regardless of the platform's photo limit", () => {
    // Nothing is dropped for want of a slot any more, so a missing scan is always a real absence.
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a"), copy("b", { back: false })]),
        set("s2", 1, [copy("c"), copy("d")]),
      ],
      photoSides: "both",
      collage,
      maxPhotos: 1,
    });

    assert.deepEqual(shape(plan.uploaded), ["g0:front:a,b"]);
    assert.deepEqual(skips(plan), ["g0:back:b"]);
  });

  it("reports only the side the offer asked for", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b", { front: false, back: false })])],
      photoSides: "front",
      collage,
      maxPhotos: null,
    });

    assert.deepEqual(skips(plan), ["g0:front:b"]);
  });
});

// The platform's photo limit ------------------------------------------------

describe("planOfferPhotos over the platform's photo limit", () => {
  const threeSets = [
    set("s1", 0, [copy("a"), copy("b")]),
    set("s2", 1, [copy("c"), copy("d")]),
    set("s3", 2, [copy("e"), copy("f")]),
  ];

  it("marks nothing when the platform states no photo limit", () => {
    const plan = planOfferPhotos({
      sets: threeSets,
      photoSides: "both",
      collage,
      maxPhotos: null,
    });

    assert.equal(plan.images.length, 6);
    assert.equal(plan.uploaded.length, 6);
    assert.equal(plan.overLimitCount, 0);
  });

  it("keeps planning past the limit, marking the tail instead of dropping it", () => {
    // The limit falls in the middle of g2's front/back pair. Everything is still rendered; the
    // images past the allowance are simply not part of the upload set.
    const plan = planOfferPhotos({
      sets: threeSets,
      photoSides: "both",
      collage,
      maxPhotos: 5,
    });

    assert.equal(plan.images.length, 6, "nothing is dropped from the plan");
    assert.deepEqual(
      plan.images.map((i) => i.overLimit),
      [false, false, false, false, false, true]
    );
    assert.deepEqual(shape(plan.uploaded), [
      "g0:front:a,b",
      "g0:back:a,b",
      "g1:front:c,d",
      "g1:back:c,d",
      "g2:front:e,f",
    ]);
    assert.equal(plan.overLimitCount, 1);
  });

  it("fills the allowance from the front, in plan order", () => {
    const plan = planOfferPhotos({
      sets: threeSets,
      photoSides: "front",
      collage,
      maxPhotos: 2,
    });

    assert.deepEqual(shape(plan.uploaded), ["g0:front:a,b", "g1:front:c,d"]);
    assert.equal(plan.overLimitCount, 1);
  });

  it("uploads nothing, but still plans everything, when the platform allows no photos", () => {
    const plan = planOfferPhotos({
      sets: threeSets,
      photoSides: "front",
      collage,
      maxPhotos: 0,
    });

    assert.equal(plan.images.length, 3);
    assert.deepEqual(plan.uploaded, []);
    assert.equal(plan.overLimitCount, 3);
  });

  it("still reports a missing side of a group that is over the limit", () => {
    // The image is rendered and shown either way now, so its missing back is a real absence — the
    // old silence was only justified while the group was dropped outright.
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a"), copy("b")]),
        set("s2", 1, [copy("c"), copy("d", { back: false })]),
      ],
      photoSides: "both",
      collage,
      maxPhotos: 2,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b", "g0:back:a,b", "g1:front:c,d"]);
    assert.deepEqual(skips(plan), ["g1:back:d"]);
  });
});

// Attachments ---------------------------------------------------------------

describe("planOfferPhotos attachments", () => {
  const attachment = (id: string, position: number): PlanAttachment => ({
    id,
    position,
    tiles: [{ photoId: `${id}-p`, itemId: null }],
    columns: 1,
  });

  it("places attachments at their explicit positions", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")]), set("s2", 1, [copy("c"), copy("d")])],
      photoSides: "front",
      collage,
      maxPhotos: null,
      attachments: [attachment("m1", 0), attachment("m2", 2)],
    });

    assert.deepEqual(shape(plan.images), [
      "attachment:m1",
      "g0:front:a,b",
      "attachment:m2",
      "g1:front:c,d",
    ]);
  });

  it("appends an attachment whose position is past the end", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")])],
      photoSides: "front",
      collage,
      maxPhotos: null,
      attachments: [attachment("m1", 9)],
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b", "attachment:m1"]);
  });

  it("counts attachments against the limit by position — an early one is uploaded, a late one is not", () => {
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a"), copy("b")]),
        set("s2", 1, [copy("c"), copy("d")]),
        set("s3", 2, [copy("e"), copy("f")]),
      ],
      photoSides: "front",
      collage,
      maxPhotos: 3,
      // One attachment at the very front, one at the very back.
      attachments: [attachment("m1", 0), attachment("m2", 9)],
    });

    assert.deepEqual(shape(plan.images), [
      "attachment:m1",
      "g0:front:a,b",
      "g1:front:c,d",
      "g2:front:e,f",
      "attachment:m2",
    ]);
    assert.deepEqual(shape(plan.uploaded), ["attachment:m1", "g0:front:a,b", "g1:front:c,d"]);
    assert.equal(plan.overLimitCount, 2, "g2's front and the trailing attachment are both over");
  });

  it("lets attachments alone fill the limit, putting the collages behind them over it", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")])],
      photoSides: "front",
      collage,
      maxPhotos: 2,
      attachments: [attachment("m1", 0), attachment("m2", 1)],
    });

    assert.deepEqual(shape(plan.uploaded), ["attachment:m1", "attachment:m2"]);
    assert.equal(plan.overLimitCount, 1);
  });

  it("plans attachments even while the offer carries no collage numbers", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")])],
      photoSides: "front",
      collage: null,
      maxPhotos: null,
      attachments: [attachment("m1", 0)],
    });

    assert.deepEqual(shape(plan.images), ["attachment:m1"]);
    assert.equal(plan.configured, false);
  });

  it("carries a manual collage's tiles and width through unchanged (#331)", () => {
    const manual: PlanAttachment = {
      id: "m1",
      position: 0,
      tiles: [
        { photoId: "p1", itemId: "a" },
        { photoId: "p2", itemId: null },
        { photoId: "p3", itemId: "c" },
      ],
      columns: 2,
    };
    const plan = planOfferPhotos({
      sets: [],
      photoSides: "front",
      collage,
      maxPhotos: null,
      attachments: [manual],
    });

    const [image] = plan.images;
    assert.equal(image.kind, "attachment");
    assert.equal(image.kind === "attachment" && image.columns, 2);
    assert.deepEqual(
      image.kind === "attachment" ? image.tiles : [],
      [
        { photoId: "p1", itemId: "a" },
        { photoId: "p2", itemId: null },
        { photoId: "p3", itemId: "c" },
      ],
      "the collector chose these tiles in this order; the engine only places the image"
    );
  });

  it("clamps a nonsensical column count to one (#331)", () => {
    const plan = planOfferPhotos({
      sets: [],
      photoSides: "front",
      collage,
      maxPhotos: null,
      attachments: [{ id: "m1", position: 0, tiles: [{ photoId: "p1", itemId: null }], columns: 0 }],
    });

    const [image] = plan.images;
    assert.equal(image.kind === "attachment" && image.columns, 1);
  });
});

// Manual plan order (#313) --------------------------------------------------

describe("planOfferPhotos manual order", () => {
  const attachment = (id: string, position: number): PlanAttachment => ({
    id,
    position,
    tiles: [{ photoId: `${id}-p`, itemId: null }],
    columns: 1,
  });

  // Two multi-copy sets, front only → two collages g0:a,b and g1:c,d, plus two attachments.
  const baseInput = () => ({
    sets: [set("s1", 0, [copy("a"), copy("b")]), set("s2", 1, [copy("c"), copy("d")])],
    photoSides: "front" as const,
    collage,
    maxPhotos: null,
    attachments: [attachment("m1", 4), attachment("m2", 4)],
  });

  const tokens = { g0: collageToken("front", ["a", "b"]), g1: collageToken("front", ["c", "d"]) };

  it("leaves the derived order untouched when no order is given", () => {
    const plan = planOfferPhotos(baseInput());
    assert.deepEqual(shape(plan.images), [
      "g0:front:a,b",
      "g1:front:c,d",
      "attachment:m1",
      "attachment:m2",
    ]);
  });

  it("reorders collages and attachments alike by their tokens", () => {
    const plan = planOfferPhotos({
      ...baseInput(),
      order: [attachmentToken("m2"), tokens.g1, attachmentToken("m1"), tokens.g0],
    });
    assert.deepEqual(shape(plan.images), [
      "attachment:m2",
      "g1:front:c,d",
      "attachment:m1",
      "g0:front:a,b",
    ]);
  });

  it("ignores tokens the plan no longer contains", () => {
    // `m2` was removed and a stale collage token lingers; the order still applies to what is left.
    const plan = planOfferPhotos({
      ...baseInput(),
      attachments: [attachment("m1", 4)],
      order: [attachmentToken("m1"), "c:front:zzz", tokens.g1, tokens.g0],
    });
    assert.deepEqual(shape(plan.images), ["attachment:m1", "g1:front:c,d", "g0:front:a,b"]);
  });

  it("slots an image the order does not yet name after its natural predecessor", () => {
    // A realistic reorder names every image; then a new attachment (`m2`) is added. It was not in
    // the stored order, and its natural predecessor is the last image, so it lands at the end.
    const plan = planOfferPhotos({
      ...baseInput(),
      order: [tokens.g1, tokens.g0, attachmentToken("m1")],
    });
    assert.deepEqual(shape(plan.images), [
      "g1:front:c,d",
      "g0:front:a,b",
      "attachment:m1",
      "attachment:m2",
    ]);
  });

  it("orders the two sides of one group independently", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")])],
      photoSides: "both",
      collage,
      maxPhotos: null,
      order: [collageToken("back", ["a", "b"]), collageToken("front", ["a", "b"])],
    });
    assert.deepEqual(shape(plan.images), ["g0:back:a,b", "g0:front:a,b"]);
  });

  it("applies the order before truncation, so the order is the priority order", () => {
    // The collector put g2 first and g0 last; the limit therefore keeps g2 and drops g0 — the
    // opposite of what the derived order would have kept.
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a"), copy("b")]),
        set("s2", 1, [copy("c"), copy("d")]),
        set("s3", 2, [copy("e"), copy("f")]),
      ],
      photoSides: "front",
      collage,
      maxPhotos: 2,
      order: [
        collageToken("front", ["e", "f"]),
        collageToken("front", ["c", "d"]),
        collageToken("front", ["a", "b"]),
      ],
    });
    assert.deepEqual(shape(plan.uploaded), ["g2:front:e,f", "g1:front:c,d"]);
    assert.equal(plan.overLimitCount, 1, "g0, which the collector put last, is the one over");
  });
});

// Do not publish (#313) ------------------------------------------------------

describe("planOfferPhotos unpublished images", () => {
  const threeFronts = [
    set("s1", 0, [copy("a"), copy("b")]),
    set("s2", 1, [copy("c"), copy("d")]),
    set("s3", 2, [copy("e"), copy("f")]),
  ];
  const g0 = collageToken("front", ["a", "b"]);
  const g1 = collageToken("front", ["c", "d"]);

  it("keeps an unpublished image in the plan, marked, because it is still rendered", () => {
    const plan = planOfferPhotos({
      sets: threeFronts,
      photoSides: "front",
      collage,
      maxPhotos: null,
      unpublished: [g1],
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b", "g1:front:c,d", "g2:front:e,f"]);
    assert.deepEqual(
      plan.images.map((i) => i.publish),
      [true, false, true]
    );
  });

  it("does not count an unpublished image against the platform's limit", () => {
    // Two of three published fit a limit of 2 — the unpublished one is not being uploaded, so it
    // neither consumes the allowance nor can be over it.
    const plan = planOfferPhotos({
      sets: threeFronts,
      photoSides: "front",
      collage,
      maxPhotos: 2,
      unpublished: [g0],
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b", "g1:front:c,d", "g2:front:e,f"]);
    assert.deepEqual(shape(plan.uploaded), ["g1:front:c,d", "g2:front:e,f"]);
    assert.equal(plan.overLimitCount, 0, "hiding one let the third image under the limit");
  });

  it("marks an attachment unpublished by its own token", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")])],
      photoSides: "front",
      collage,
      maxPhotos: null,
      attachments: [
        { id: "m1", position: 9, tiles: [{ photoId: "m1-p", itemId: null }], columns: 1 },
      ],
      unpublished: [attachmentToken("m1")],
    });

    assert.deepEqual(
      plan.images.map((i) => i.publish),
      [true, false]
    );
  });

  it("ignores a token that matches no image", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")])],
      photoSides: "front",
      collage,
      maxPhotos: null,
      unpublished: ["c:front:long-gone"],
    });

    assert.deepEqual(
      plan.images.map((i) => i.publish),
      [true]
    );
  });
});

// Single photos before a collage (#521) ---------------------------------------

describe("planOfferPhotos single-first grouping (#521)", () => {
  /** N single-copy sets in set order, one stamp each, ids `a`, `b`, `c`… */
  const singleSets = (n: number): PlanSet[] =>
    Array.from({ length: n }, (_, i) =>
      set(`s${i}`, i, [copy(String.fromCharCode(97 + i))])
    );

  it("photographs every single-copy set on its own when the platform states no limit", () => {
    const plan = planOfferPhotos({
      sets: singleSets(5),
      photoSides: "front",
      collage, // capacity 4 — irrelevant, nothing is collaged
      maxPhotos: null,
      preferSingles: true,
    });

    assert.deepEqual(shape(plan.images), [
      "g0:front:a",
      "g1:front:b",
      "g2:front:c",
      "g3:front:d",
      "g4:front:e",
    ]);
  });

  it("keeps the pre-#521 chunking when the flag is off", () => {
    const plan = planOfferPhotos({
      sets: singleSets(5),
      photoSides: "front",
      collage,
      maxPhotos: 5,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b,c,d", "g1:front:e"]);
  });

  it("spends the limit on singles and collages only the tail", () => {
    // Ten stamps, five slots, a collage holding six: four singles and one collage of the rest.
    const plan = planOfferPhotos({
      sets: singleSets(10),
      photoSides: "front",
      collage: { collageRows: 2, collageColumns: 3 },
      maxPhotos: 5,
      preferSingles: true,
    });

    assert.deepEqual(shape(plan.images), [
      "g0:front:a",
      "g1:front:b",
      "g2:front:c",
      "g3:front:d",
      "g4:front:e,f,g,h,i,j",
    ]);
    assert.equal(plan.overLimitCount, 0);
  });

  it("gives the tail a second collage at the cost of a single when it does not fit in one", () => {
    // The same ten stamps at capacity four: k=4 would need 4 + ceil(6/4) = 6 slots, so k=3.
    const plan = planOfferPhotos({
      sets: singleSets(10),
      photoSides: "front",
      collage, // capacity 4
      maxPhotos: 5,
      preferSingles: true,
    });

    assert.deepEqual(shape(plan.images), [
      "g0:front:a",
      "g1:front:b",
      "g2:front:c",
      "g3:front:d,e,f,g",
      "g4:front:h,i,j",
    ]);
    assert.equal(plan.overLimitCount, 0);
  });

  it("counts the whole plan against the limit — a multi-copy set's collage included", () => {
    // Five slots, one of them the multi-copy set's own collage: four left, so three singles.
    const plan = planOfferPhotos({
      sets: [
        set("m", 0, [copy("x"), copy("y")]),
        ...singleSets(6).map((s, i) => ({ ...s, sortOrder: i + 1 })),
      ],
      photoSides: "front",
      collage,
      maxPhotos: 5,
      preferSingles: true,
    });

    assert.deepEqual(shape(plan.images), [
      "g0:front:x,y",
      "g1:front:a",
      "g2:front:b",
      "g3:front:c",
      "g4:front:d,e,f",
    ]);
    assert.equal(plan.overLimitCount, 0);
  });

  it("counts manual attachments against the limit too", () => {
    const plan = planOfferPhotos({
      sets: singleSets(6),
      photoSides: "front",
      collage,
      maxPhotos: 5,
      preferSingles: true,
      attachments: [
        { id: "m1", position: 0, tiles: [{ photoId: "m1-p", itemId: null }], columns: 1 },
        { id: "m2", position: 0, tiles: [{ photoId: "m2-p", itemId: null }], columns: 1 },
      ],
    });

    // Two slots are the attachments', so three are left: two singles and a collage of four.
    assert.deepEqual(shape(plan.images).filter((s) => s.startsWith("g")), [
      "g0:front:a",
      "g1:front:b",
      "g2:front:c,d,e,f",
    ]);
    assert.equal(plan.overLimitCount, 0);
  });

  it("counts a front and its back as two slots", () => {
    // Four stamps scanned both sides on a platform taking five photos: one single (two images) would
    // leave three slots for a tail of three, which costs two more images — 4 in all.
    const plan = planOfferPhotos({
      sets: singleSets(4),
      photoSides: "both",
      collage,
      maxPhotos: 5,
      preferSingles: true,
    });

    assert.deepEqual(shape(plan.images), [
      "g0:front:a",
      "g0:back:a",
      "g1:front:b,c,d",
      "g1:back:b,c,d",
    ]);
    assert.equal(plan.overLimitCount, 0);
  });

  it("always photographs one stamp alone, even with no room for it", () => {
    // One slot, taken by the multi-copy set: nothing is left, and the thumbnail rule spends it
    // anyway rather than opening the listing with a collage.
    const plan = planOfferPhotos({
      sets: [
        set("m", 0, [copy("x"), copy("y")]),
        ...singleSets(3).map((s, i) => ({ ...s, sortOrder: i + 1 })),
      ],
      photoSides: "front",
      collage,
      maxPhotos: 1,
      preferSingles: true,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:x,y", "g1:front:a", "g2:front:b,c"]);
    assert.equal(plan.overLimitCount, 2, "the images past the one allowed slot are reported");
  });

  it("seats the tail collage at the end of the last run of singles", () => {
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a")]),
        set("m", 1, [copy("x"), copy("y")]),
        set("s2", 2, [copy("b")]),
        set("s3", 3, [copy("c")]),
        set("s4", 4, [copy("d")]),
      ],
      photoSides: "front",
      collage,
      maxPhotos: 4,
      preferSingles: true,
    });

    // Four slots, one spent by the set: two singles and a collage of the two that are left, sitting
    // where the singles end rather than at the head of the plan.
    assert.deepEqual(shape(plan.images), [
      "g0:front:a",
      "g1:front:x,y",
      "g2:front:b",
      "g3:front:c,d",
    ]);
    assert.equal(plan.overLimitCount, 0);
  });

  it("frees a slot when an image is marked do not publish", () => {
    const hidden = collageToken("front", ["x", "y"]);
    const plan = planOfferPhotos({
      sets: [
        set("m", 0, [copy("x"), copy("y")]),
        ...singleSets(4).map((s, i) => ({ ...s, sortOrder: i + 1 })),
      ],
      photoSides: "front",
      collage,
      maxPhotos: 4,
      preferSingles: true,
      unpublished: [hidden],
    });

    // The hidden collage costs nothing, so all four slots go to the singles.
    assert.deepEqual(shape(plan.images), [
      "g0:front:x,y",
      "g1:front:a",
      "g2:front:b",
      "g3:front:c",
      "g4:front:d",
    ]);
    assert.equal(plan.overLimitCount, 0);
  });
});
