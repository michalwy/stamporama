import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appliedScaleFigure,
  fittedPlacement,
  formatAppliedScale,
  landmarkAt,
  mapReferencePoint,
  placementFromLandmarks,
  referenceCentre,
  referenceMatrix,
  resolveAlignment,
  rotatePlacementAbout,
  scalePlacementAbout,
  translatePlacement,
  unmapStagePoint,
  withLandmark,
  type Placement,
  type Point,
} from "../../src/lib/reference-align";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);
const closePoint = (a: Point, b: Point, eps = 1e-9) => {
  close(a.x, b.x, eps);
  close(a.y, b.y, eps);
};

// A 1200 dpi tile of about 25 × 30 mm, and an auction screenshot of the same design at its own size.
const STAMP = { width: 1180, height: 1420 };
const REFERENCE = { width: 640, height: 760 };

describe("placementFromLandmarks", () => {
  it("lands each reference landmark on its stamp landmark", () => {
    const stamp = [
      { x: 210, y: 305 },
      { x: 960, y: 1180 },
    ];
    const reference = [
      { x: 100, y: 140 },
      { x: 520, y: 610 },
    ];
    const pl = placementFromLandmarks(stamp, reference);
    assert.ok(pl);
    closePoint(mapReferencePoint(pl, reference[0]), stamp[0], 1e-6);
    closePoint(mapReferencePoint(pl, reference[1]), stamp[1], 1e-6);
  });

  it("recovers a known scale, rotation and translation exactly", () => {
    // A forgery printed 3% large, laid 1.5° crooked, somewhere else in its screenshot.
    const truth: Placement = { scale: 1.03 * 1.84, rotation: -1.5, x: 37.5, y: -12.25 };
    const reference = [
      { x: 80, y: 90 },
      { x: 560, y: 700 },
    ];
    const stamp = reference.map((p) => mapReferencePoint(truth, p));
    const pl = placementFromLandmarks(stamp, reference);
    assert.ok(pl);
    close(pl.scale, truth.scale, 1e-9);
    close(pl.rotation, truth.rotation, 1e-9);
    close(pl.x, truth.x, 1e-6);
    close(pl.y, truth.y, 1e-6);
  });

  it("measures the scale from the landmarks, not from the picture sizes", () => {
    // The same two pictures, different landmarks: the figure follows the design, which is the point.
    const reference = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const near = placementFromLandmarks(
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      reference
    );
    const far = placementFromLandmarks(
      [
        { x: 0, y: 0 },
        { x: 206, y: 0 },
      ],
      reference
    );
    assert.ok(near && far);
    close(near.scale, 2);
    close(far.scale, 2.06);
  });

  it("normalises a rotation across the half turn", () => {
    const pl = placementFromLandmarks(
      [
        { x: 0, y: 0 },
        { x: -10, y: -1 },
      ],
      [
        { x: 0, y: 0 },
        { x: 10, y: -1 },
      ]
    );
    assert.ok(pl);
    assert.ok(pl.rotation > -180 && pl.rotation <= 180);
  });

  it("has no answer until both pictures carry two landmarks", () => {
    assert.equal(placementFromLandmarks([{ x: 1, y: 1 }], [{ x: 1, y: 1 }, { x: 50, y: 50 }]), null);
    assert.equal(placementFromLandmarks([], []), null);
  });

  it("has no answer for two landmarks on top of each other", () => {
    assert.equal(
      placementFromLandmarks(
        [
          { x: 100, y: 100 },
          { x: 101, y: 101 },
        ],
        [
          { x: 10, y: 10 },
          { x: 300, y: 300 },
        ]
      ),
      null
    );
  });
});

describe("unmapStagePoint", () => {
  it("inverts mapReferencePoint", () => {
    const pl: Placement = { scale: 0.73, rotation: 12.5, x: -40, y: 88 };
    const p = { x: 312.25, y: 47.5 };
    closePoint(unmapStagePoint(pl, mapReferencePoint(pl, p)), p, 1e-9);
  });
});

describe("fittedPlacement", () => {
  it("centres the reference inside the stamp without turning it", () => {
    const pl = fittedPlacement(STAMP, REFERENCE);
    assert.equal(pl.rotation, 0);
    assert.ok(REFERENCE.width * pl.scale <= STAMP.width + 1e-9);
    assert.ok(REFERENCE.height * pl.scale <= STAMP.height + 1e-9);
    closePoint(referenceCentre(pl, REFERENCE), { x: STAMP.width / 2, y: STAMP.height / 2 });
  });

  it("does not divide by an unmeasured picture", () => {
    assert.deepEqual(fittedPlacement(STAMP, { width: 0, height: 0 }), {
      scale: 1,
      rotation: 0,
      x: 0,
      y: 0,
    });
  });
});

describe("steps by hand", () => {
  const pl: Placement = { scale: 1.7, rotation: 3, x: 20, y: 30 };

  it("turns about the pivot, which stays put", () => {
    const pivot = referenceCentre(pl, REFERENCE);
    const turned = rotatePlacementAbout(pl, 0.25, pivot);
    close(turned.rotation, 3.25);
    closePoint(referenceCentre(turned, REFERENCE), pivot, 1e-9);
  });

  it("scales about the pivot, which stays put", () => {
    const pivot = referenceCentre(pl, REFERENCE);
    const scaled = scalePlacementAbout(pl, 1.005, pivot);
    close(scaled.scale, 1.7 * 1.005);
    closePoint(referenceCentre(scaled, REFERENCE), pivot, 1e-9);
  });

  it("ignores a scale step that is not a positive factor", () => {
    assert.equal(scalePlacementAbout(pl, 0, { x: 0, y: 0 }), pl);
  });

  it("moves by a stage delta", () => {
    assert.deepEqual(translatePlacement(pl, 5, -7), { ...pl, x: 25, y: 23 });
  });
});

describe("referenceMatrix", () => {
  it("draws a reference pixel where the view puts its stage pixel", () => {
    const view = { scale: 0.4, offsetX: 16, offsetY: -120 };
    const pl: Placement = { scale: 1.84, rotation: -1.5, x: 37.5, y: -12.25 };
    const [a, b, c, d, e, f] = referenceMatrix(view, pl);
    const p = { x: 412, y: 97 };
    const onScreen = { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
    const stage = mapReferencePoint(pl, p);
    closePoint(onScreen, {
      x: view.offsetX + view.scale * stage.x,
      y: view.offsetY + view.scale * stage.y,
    }, 1e-9);
  });
});

describe("resolveAlignment", () => {
  const stampLandmarks = [
    { x: 210, y: 305 },
    { x: 960, y: 1180 },
  ];
  const referenceLandmarks = [
    { x: 100, y: 140 },
    { x: 520, y: 610 },
  ];

  it("is merely fitted until both pictures have their landmarks", () => {
    const al = resolveAlignment({
      stamp: STAMP,
      reference: REFERENCE,
      stampLandmarks,
      referenceLandmarks: referenceLandmarks.slice(0, 1),
      manual: null,
    });
    assert.equal(al.method, "unaligned");
    assert.deepEqual(al.placement, fittedPlacement(STAMP, REFERENCE));
  });

  it("aligns on landmarks once both pairs are down", () => {
    const al = resolveAlignment({
      stamp: STAMP,
      reference: REFERENCE,
      stampLandmarks,
      referenceLandmarks,
      manual: null,
    });
    assert.equal(al.method, "landmarks");
  });

  it("keeps a placement made by hand over the landmarks it was made after", () => {
    const manual: Placement = { scale: 2, rotation: 0, x: 0, y: 0 };
    const al = resolveAlignment({
      stamp: STAMP,
      reference: REFERENCE,
      stampLandmarks,
      referenceLandmarks,
      manual,
    });
    assert.equal(al.method, "manual");
    assert.equal(al.placement, manual);
  });
});

describe("appliedScaleFigure", () => {
  const placement: Placement = { scale: 1.0344, rotation: 0.4, x: 0, y: 0 };

  it("prints the scale of an alignment on landmarks", () => {
    assert.equal(appliedScaleFigure({ method: "landmarks", placement }), "×1.034");
  });

  it("prints nothing for an alignment by hand", () => {
    assert.equal(appliedScaleFigure({ method: "manual", placement }), null);
  });

  it("prints nothing for a picture merely fitted", () => {
    assert.equal(appliedScaleFigure({ method: "unaligned", placement }), null);
  });

  it("keeps a difference of a few tenths of a percent visible", () => {
    assert.notEqual(formatAppliedScale(1.03), formatAppliedScale(1.034));
  });
});

describe("landmarks", () => {
  it("places the first two and then moves the nearer one", () => {
    const one = withLandmark([], { x: 10, y: 10 });
    const two = withLandmark(one, { x: 200, y: 200 });
    assert.equal(two.length, 2);
    const moved = withLandmark(two, { x: 190, y: 205 });
    assert.deepEqual(moved, [
      { x: 10, y: 10 },
      { x: 190, y: 205 },
    ]);
  });

  it("finds the landmark a press lands on, nearest first, within the radius only", () => {
    const marks = [
      { x: 10, y: 10 },
      { x: 16, y: 10 },
    ];
    assert.equal(landmarkAt(marks, { x: 15, y: 10 }, 8), 1);
    assert.equal(landmarkAt(marks, { x: 100, y: 100 }, 8), null);
  });
});
