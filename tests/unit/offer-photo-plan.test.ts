import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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

// Skipped sides (#314) -------------------------------------------------------

describe("planOfferPhotos skipped sides", () => {
  const skips = (plan: ReturnType<typeof planOfferPhotos>) =>
    plan.skipped.map((s) => `${s.groupKey}:${s.side}:${s.missingItemIds.join(",")}`);

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

  it("stays silent about a side of a group the photo limit dropped outright", () => {
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a"), copy("b")]),
        set("s2", 1, [copy("c"), copy("d", { back: false })]),
      ],
      photoSides: "both",
      collage,
      maxPhotos: 2,
    });

    // s2's group is the one truncated, so its missing back is not worth a second notice.
    assert.deepEqual(shape(plan.images), ["g0:front:a,b", "g0:back:a,b"]);
    assert.equal(plan.droppedGroups, 1);
    assert.deepEqual(plan.skipped, []);
  });

  it("keeps the notice when the incomplete group survives truncation", () => {
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a"), copy("b", { back: false })]),
        set("s2", 1, [copy("c"), copy("d")]),
      ],
      photoSides: "both",
      collage,
      maxPhotos: 1,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b"]);
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

// Truncation ----------------------------------------------------------------

describe("planOfferPhotos truncation", () => {
  const threeSets = [
    set("s1", 0, [copy("a"), copy("b")]),
    set("s2", 1, [copy("c"), copy("d")]),
    set("s3", 2, [copy("e"), copy("f")]),
  ];

  it("does not truncate when the platform states no photo limit", () => {
    const plan = planOfferPhotos({
      sets: threeSets,
      photoSides: "both",
      collage,
      maxPhotos: null,
    });

    assert.equal(plan.images.length, 6);
    assert.equal(plan.droppedGroups, 0);
    assert.equal(plan.exceedsLimit, false);
  });

  it("drops whole groups from the end, front and back together", () => {
    const plan = planOfferPhotos({
      sets: threeSets,
      photoSides: "both",
      collage,
      maxPhotos: 5,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b", "g0:back:a,b", "g1:front:c,d", "g1:back:c,d"]);
    assert.equal(plan.droppedGroups, 1);
    assert.equal(plan.exceedsLimit, false);
  });

  it("drops groups in order when only fronts are rendered", () => {
    const plan = planOfferPhotos({
      sets: threeSets,
      photoSides: "front",
      collage,
      maxPhotos: 2,
    });

    assert.deepEqual(shape(plan.images), ["g0:front:a,b", "g1:front:c,d"]);
    assert.equal(plan.droppedGroups, 1);
  });
});

// Attachments ---------------------------------------------------------------

describe("planOfferPhotos attachments", () => {
  const attachment = (id: string, position: number): PlanAttachment => ({
    id,
    position,
    photoId: `${id}-p`,
    itemId: null,
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

  it("protects attachments from truncation, dropping generated groups instead", () => {
    const plan = planOfferPhotos({
      sets: [
        set("s1", 0, [copy("a"), copy("b")]),
        set("s2", 1, [copy("c"), copy("d")]),
        set("s3", 2, [copy("e"), copy("f")]),
      ],
      photoSides: "front",
      collage,
      maxPhotos: 3,
      attachments: [attachment("m1", 0), attachment("m2", 1)],
    });

    assert.deepEqual(shape(plan.images), ["attachment:m1", "attachment:m2", "g0:front:a,b"]);
    assert.equal(plan.droppedGroups, 2);
    assert.equal(plan.exceedsLimit, false);
  });

  it("keeps every attachment and reports the overflow when they alone exceed the limit", () => {
    const plan = planOfferPhotos({
      sets: [set("s1", 0, [copy("a"), copy("b")])],
      photoSides: "front",
      collage,
      maxPhotos: 1,
      attachments: [attachment("m1", 0), attachment("m2", 1)],
    });

    assert.deepEqual(shape(plan.images), ["attachment:m1", "attachment:m2"]);
    assert.equal(plan.droppedGroups, 1);
    assert.equal(plan.exceedsLimit, true);
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
});
