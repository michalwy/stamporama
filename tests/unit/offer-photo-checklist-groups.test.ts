import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checklistGroupsOf,
  planOfferPhotos,
  type OfferPhotoPlanInput,
  type PlanChecklistSlot,
  type PlanCopy,
  type PlannedImage,
} from "../../src/lib/offer-photo-plan";
import { fingerprintOfferPhotoInputs } from "../../src/lib/offer-photo-fingerprint";
import { parseOfferPhotoConfigInput, type OfferCollageValues } from "../../src/lib/offer-photo-config";

// #1673: a set's copies grouped by checklist on photos of their own.

/** A copy at a set position, on the given checklist slots (`"X:3"` is slot 3 of checklist X). */
function copy(itemId: string, sortOrder: number, ...slots: string[]): PlanCopy {
  return {
    itemId,
    sortOrder,
    catalogSortKey: null,
    frontPhotoId: `${itemId}-f`,
    backPhotoId: `${itemId}-b`,
    checklists: slots.map((slot): PlanChecklistSlot => {
      const [checklistId, position] = slot.split(":");
      return { checklistId, position: Number(position) };
    }),
  };
}

const ids = (copies: readonly PlanCopy[]) => copies.map((c) => c.itemId).join(",");

const shape = (images: PlannedImage[]) =>
  images.map((image) =>
    image.kind === "collage"
      ? `${image.checklistId ?? "-"}:${image.tiles.map((t) => t.itemId).join(",")}`
      : `attachment:${image.attachmentId}`
  );

describe("checklistGroupsOf (#1673)", () => {
  it("groups every checklist holding two copies, in the checklist's order, the rest in set order", () => {
    const { groups, rest } = checklistGroupsOf([
      copy("s1", 0),
      copy("a2", 1, "A:2"),
      copy("b1", 2, "B:1"),
      copy("a1", 3, "A:1"),
      copy("s2", 4),
      copy("b2", 5, "B:2"),
      copy("a3", 6, "A:3"),
    ]);
    assert.deepEqual(
      groups.map((g) => `${g.checklistId}:${ids(g.copies)}`),
      ["A:a1,a2,a3", "B:b1,b2"]
    );
    assert.equal(ids(rest), "s1,s2");
  });

  it("leaves a copy that is the only one from its checklist among the singles", () => {
    const { groups, rest } = checklistGroupsOf([
      copy("a1", 0, "A:1"),
      copy("b1", 1, "B:1"),
      copy("b2", 2, "B:2"),
      copy("c1", 3, "C:1"),
    ]);
    assert.deepEqual(groups.map((g) => `${g.checklistId}:${ids(g.copies)}`), ["B:b1,b2"]);
    assert.equal(ids(rest), "a1,c1");
  });

  it("groups an incomplete checklist as readily as a complete one", () => {
    // Nothing here knows how long the checklist is: two of its slots are enough.
    const { groups } = checklistGroupsOf([copy("x", 0, "A:4"), copy("y", 1, "A:9")]);
    assert.deepEqual(groups.map((g) => ids(g.copies)), ["x,y"]);
  });

  it("puts a copy on several checklists in the one holding most of the set, once", () => {
    // `m` is on both: A holds three of the set's copies, B two, so `m` goes to A and B is left with
    // one copy — which is a single, not a group.
    const { groups, rest } = checklistGroupsOf([
      copy("m", 0, "A:2", "B:1"),
      copy("a1", 1, "A:1"),
      copy("a3", 2, "A:3"),
      copy("b2", 3, "B:2"),
    ]);
    assert.deepEqual(groups.map((g) => `${g.checklistId}:${ids(g.copies)}`), ["A:a1,m,a3"]);
    assert.equal(ids(rest), "b2");
  });

  it("breaks a tie by the checklist the set reaches first, whatever order the slots were read in", () => {
    const forward = checklistGroupsOf([
      copy("x", 0, "B:1", "A:1"),
      copy("y", 1, "A:2", "B:2"),
    ]);
    const backward = checklistGroupsOf([
      copy("x", 0, "A:1", "B:1"),
      copy("y", 1, "B:2", "A:2"),
    ]);
    assert.deepEqual(forward.groups.map((g) => g.checklistId), ["A"]);
    assert.deepEqual(backward.groups.map((g) => g.checklistId), ["A"]);
  });

  it("orders groups by where the set first reaches them", () => {
    const { groups } = checklistGroupsOf([
      copy("b1", 0, "B:1"),
      copy("a1", 1, "A:1"),
      copy("a2", 2, "A:2"),
      copy("a3", 3, "A:3"),
      copy("b2", 4, "B:2"),
    ]);
    // A is the larger and is formed first, but B starts earlier in the set.
    assert.deepEqual(groups.map((g) => g.checklistId), ["B", "A"]);
  });

  it("keeps two copies of one slot together, in set order", () => {
    const { groups } = checklistGroupsOf([
      copy("first", 0, "A:1"),
      copy("second", 1, "A:1"),
      copy("other", 2, "A:0"),
    ]);
    assert.deepEqual(groups.map((g) => ids(g.copies)), ["other,first,second"]);
  });
});

describe("planOfferPhotos with checklist groups (#1673)", () => {
  const lot = [
    copy("s1", 0),
    copy("a1", 1, "A:1"),
    copy("b1", 2, "B:1"),
    copy("s2", 3),
    copy("a2", 4, "A:2"),
    copy("b2", 5, "B:2"),
    copy("a3", 6, "A:3"),
    copy("s3", 7),
  ];
  const base: OfferPhotoPlanInput = {
    sets: [{ id: "lot", sortOrder: 0, items: lot }],
    photoSides: "front",
    collage: { collageRows: 1, collageColumns: 2 },
    maxPhotos: null,
  };

  it("photographs each group on images of its own, then the singles, each on its own template", () => {
    const plan = planOfferPhotos({
      ...base,
      checklistGroups: { collage: { collageRows: 3, collageColumns: 3 } },
    });
    assert.deepEqual(shape(plan.images), ["A:a1,a2,a3", "B:b1,b2", "-:s1,s2", "-:s3"]);
    assert.ok(plan.images.every((image) => image.kind !== "collage" || image.setIds[0] === "lot"));
  });

  it("continues a group too large for one image on the next, holding only that group", () => {
    const plan = planOfferPhotos({
      ...base,
      checklistGroups: { collage: { collageRows: 1, collageColumns: 2 } },
    });
    assert.deepEqual(shape(plan.images), ["A:a1,a2", "A:a3", "B:b1,b2", "-:s1,s2", "-:s3"]);
  });

  it("leaves the photos as today with grouping off", () => {
    const off = planOfferPhotos(base);
    assert.deepEqual(shape(off.images), [
      "-:s1,a1",
      "-:b1,s2",
      "-:a2,b2",
      "-:a3,s3",
    ]);
    assert.deepEqual(off, planOfferPhotos({ ...base, checklistGroups: null }));
  });

  it("does not regroup single-copy sets", () => {
    const plan = planOfferPhotos({
      ...base,
      sets: [
        { id: "one", sortOrder: 0, items: [copy("a1", 0, "A:1")] },
        { id: "two", sortOrder: 1, items: [copy("a2", 0, "A:2")] },
      ],
      checklistGroups: { collage: { collageRows: 3, collageColumns: 3 } },
    });
    assert.deepEqual(shape(plan.images), ["-:a1,a2"]);
  });

  it("draws both sides of a group as a pair, like any other group", () => {
    const plan = planOfferPhotos({
      ...base,
      sets: [{ id: "lot", sortOrder: 0, items: [copy("a1", 0, "A:1"), copy("a2", 1, "A:2")] }],
      photoSides: "both",
      checklistGroups: { collage: { collageRows: 3, collageColumns: 3 } },
    });
    assert.deepEqual(
      plan.images.map((image) => (image.kind === "collage" ? `${image.side}:${image.checklistId}` : "")),
      ["front:A", "back:A"]
    );
  });
});

describe("the photo fingerprint under checklist groups (#1673)", () => {
  const fingerprintInput = {
    sets: [{ id: "lot", sortOrder: 0, items: [copy("a1", 0), copy("a2", 1)] }],
    photoSides: "front" as const,
    photoLabelLeftTemplate: null,
    photoLabelRightTemplate: null,
    tileLabels: [],
    collage: null,
    limits: { maxPhotos: null, maxPhotoEdge: null, maxPhotoFileSizeMib: null },
  };

  it("hashes an offer that does not group exactly as before", () => {
    assert.equal(
      fingerprintOfferPhotoInputs(fingerprintInput),
      fingerprintOfferPhotoInputs({ ...fingerprintInput, checklistGroups: undefined })
    );
  });

  it("changes when grouping is turned on, when a copy joins a checklist and with the group template", () => {
    const on = (
      slots: [string, [string, number][]][],
      rows = 3,
      grid: Pick<OfferCollageValues, "collageGridMode" | "collageGridShape"> = {
        collageGridMode: "fixed",
        collageGridShape: "landscape",
      }
    ) =>
      fingerprintOfferPhotoInputs({
        ...fingerprintInput,
        checklistGroups: {
          collage: {
            ...grid,
            collageRows: rows,
            collageColumns: 3,
            collageGapPercent: 5,
            collageBackground: "#000000",
            collageLabelPercent: 1,
          },
          slots,
        },
      });
    const none = on([]);
    const joined = on([["a1", [["A", 1]]]]);
    assert.notEqual(fingerprintOfferPhotoInputs(fingerprintInput), none);
    assert.notEqual(none, joined);
    assert.notEqual(joined, on([["a1", [["A", 1]]]], 4));
    // The group template's shape (#1699) counts where it is read — under auto, away from landscape.
    const auto = (shape: "landscape" | "portrait") =>
      on([["a1", [["A", 1]]]], 3, { collageGridMode: "auto", collageGridShape: shape });
    assert.notEqual(auto("landscape"), auto("portrait"));
    assert.equal(
      joined,
      on([["a1", [["A", 1]]]], 3, { collageGridMode: "fixed", collageGridShape: "portrait" })
    );
    // Read order is not a change.
    assert.equal(
      on([
        ["a1", [["A", 1], ["B", 2]]],
        ["a2", [["A", 2]]],
      ]),
      on([
        ["a2", [["A", 2]]],
        ["a1", [["B", 2], ["A", 1]]],
      ])
    );
  });
});

describe("parseOfferPhotoConfigInput's group settings (#1673)", () => {
  const blankCollage = {
    collageGridMode: "fixed",
    collageRows: "",
    collageColumns: "",
    collageGapPercent: "",
    collageBackground: "",
    collageLabelPercent: "",
  };
  const raw = {
    photoSides: "front",
    photoLabelLeftTemplate: "",
    photoLabelRightTemplate: "",
    ...blankCollage,
  };

  it("reads the switch and the group template's numbers", () => {
    const result = parseOfferPhotoConfigInput({
      ...raw,
      groupByChecklist: "on",
      groupCollage: {
        collageGridMode: "auto",
        collageGridShape: "portrait",
        collageRows: "3",
        collageColumns: "4",
        collageGapPercent: "5",
        collageBackground: "#FFFFFF",
        collageLabelPercent: "1.5",
      },
    });
    assert.ok(result.ok);
    assert.equal(result.value.groupByChecklist, true);
    assert.deepEqual(result.value.groupCollage, {
      collageGridMode: "auto",
      collageGridShape: "portrait",
      collageRows: 3,
      collageColumns: 4,
      collageGapPercent: 5,
      collageBackground: "#ffffff",
      collageLabelPercent: 1.5,
    });
  });

  it("is off with no group template when nothing is posted", () => {
    const result = parseOfferPhotoConfigInput({ ...raw, groupCollage: blankCollage });
    assert.ok(result.ok);
    assert.equal(result.value.groupByChecklist, false);
    assert.equal(result.value.groupCollage, null);
  });

  it("rejects a half-filled group template, naming it", () => {
    const result = parseOfferPhotoConfigInput({
      ...raw,
      groupCollage: { ...blankCollage, collageRows: "3" },
    });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /^Group collage: /);
  });
});
