import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SNAPSHOT_TITLE,
  MAX_SNAPSHOT_MARKS,
  MIN_SNAPSHOT_EDGE,
  annotationFromDrag,
  parseSnapshotRequest,
  snapshotOutputSize,
  snapshotOverlaySvg,
  snapshotRegion,
} from "../../src/lib/annotations";

// Marking a detail and keeping it as a photo (#674). The live marks and the burnt-in ones are drawn
// from the same shapes in the same frame, so the arithmetic that moves a shape from the picture into
// the snapshot is the one place a circle could land beside the flaw it was drawn around.

const VALID = {
  photoId: "photo-1",
  region: { x: 10, y: 20, w: 100, h: 50 },
  marks: [
    { kind: "ellipse", a: { x: 20, y: 30 }, b: { x: 60, y: 50 } },
    { kind: "distance", a: { x: 10, y: 20 }, b: { x: 110, y: 20 }, label: "4.23 mm at 1200 dpi" },
  ],
  title: "  Plate flaw  ",
};

describe("annotations (#674)", () => {
  it("makes a mark only from a drag that drew something", () => {
    assert.equal(annotationFromDrag("ellipse", { x: 5, y: 5 }, { x: 5, y: 5 }), null);
    // A ring needs both a width and a height — a flat drag is a line, not a circle of nothing.
    assert.equal(annotationFromDrag("ellipse", { x: 5, y: 5 }, { x: 30, y: 5 }), null);
    assert.deepEqual(annotationFromDrag("line", { x: 5, y: 5 }, { x: 30, y: 5 }), {
      kind: "line",
      a: { x: 5, y: 5 },
      b: { x: 30, y: 5 },
    });
  });

  it("keeps the part of the picture on screen, clamped to the picture", () => {
    // Scale 2, the picture's top-left at (−40, −20) on screen: the viewport's corner is (20, 10) on
    // the picture and its far corner, 400 × 300 later, is (220, 160).
    const view = { scale: 2, offsetX: -40, offsetY: -20 };
    assert.deepEqual(
      snapshotRegion(view, { width: 1000, height: 1000 }, { width: 400, height: 300 }),
      { x: 20, y: 10, w: 200, h: 150 }
    );
    // Panned past the edge: the empty panel is not part of the picture.
    assert.deepEqual(
      snapshotRegion({ scale: 1, offsetX: 100, offsetY: 0 }, { width: 200, height: 200 }, { width: 400, height: 300 }),
      { x: 0, y: 0, w: 200, h: 200 }
    );
    // Nothing of the picture visible at all.
    assert.equal(
      snapshotRegion({ scale: 1, offsetX: 500, offsetY: 0 }, { width: 200, height: 200 }, { width: 400, height: 300 }),
      null
    );
  });

  it("reads a request field by field and names an untitled snapshot", () => {
    const parsed = parseSnapshotRequest(VALID);
    assert.ok(parsed);
    assert.equal(parsed.title, "Plate flaw");
    assert.equal(parsed.marks.length, 2);
    assert.equal(parseSnapshotRequest({ ...VALID, title: "   " })?.title, DEFAULT_SNAPSHOT_TITLE);
    assert.equal(parseSnapshotRequest({ ...VALID, title: undefined })?.title, DEFAULT_SNAPSHOT_TITLE);
  });

  it("refuses anything that is not a request", () => {
    assert.equal(parseSnapshotRequest(null), null);
    assert.equal(parseSnapshotRequest({ ...VALID, photoId: "" }), null);
    assert.equal(parseSnapshotRequest({ ...VALID, region: { x: 1.5, y: 0, w: 10, h: 10 } }), null);
    assert.equal(parseSnapshotRequest({ ...VALID, region: { x: -1, y: 0, w: 10, h: 10 } }), null);
    assert.equal(parseSnapshotRequest({ ...VALID, region: { x: 0, y: 0, w: 2, h: 10 } }), null);
    assert.equal(parseSnapshotRequest({ ...VALID, marks: [{ kind: "star", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }] }), null);
    // A measurement never travels without its figure, and so never without its scale.
    assert.equal(
      parseSnapshotRequest({ ...VALID, marks: [{ kind: "distance", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }] }),
      null
    );
    assert.equal(
      parseSnapshotRequest({ ...VALID, marks: [{ kind: "line", a: { x: Number.NaN, y: 0 }, b: { x: 1, y: 1 } }] }),
      null
    );
    const many = Array.from({ length: MAX_SNAPSHOT_MARKS + 1 }, () => VALID.marks[0]);
    assert.equal(parseSnapshotRequest({ ...VALID, marks: many }), null);
  });

  it("renders at the source's size, enlarged to a legible minimum and capped", () => {
    // 1200 source pixels across a 1200 × 600 region: kept as it is.
    assert.deepEqual(snapshotOutputSize({ w: 1200, h: 600 }, { width: 1200, height: 600 }, 2500), {
      width: 1200,
      height: 600,
    });
    // A deep zoom, 80 × 40 source pixels: enlarged to the minimum, aspect kept.
    assert.deepEqual(snapshotOutputSize({ w: 80, h: 40 }, { width: 80, height: 40 }, 2500), {
      width: MIN_SNAPSHOT_EDGE,
      height: MIN_SNAPSHOT_EDGE / 2,
    });
    // A whole card: capped.
    assert.deepEqual(snapshotOutputSize({ w: 9000, h: 3000 }, { width: 9000, height: 3000 }, 2500), {
      width: 2500,
      height: 833,
    });
  });

  it("draws each mark where it was placed, relative to the region kept", () => {
    const svg = snapshotOverlaySvg(
      [
        { kind: "ellipse", a: { x: 20, y: 30 }, b: { x: 60, y: 50 } },
        { kind: "line", a: { x: 10, y: 20 }, b: { x: 110, y: 70 } },
      ],
      { x: 10, y: 20, w: 100, h: 50 },
      { width: 200, height: 100 }
    );
    // The ring spans (20,30)–(60,50) on the picture, which is (10,10)–(50,30) in the region and
    // twice that in a snapshot drawn at double size: centre (60, 40), radii 40 and 20.
    assert.match(svg, /<ellipse cx="60" cy="40" rx="40" ry="20"/);
    // The line runs corner to corner of the region.
    assert.match(svg, /<line x1="0" y1="0" x2="200" y2="100"/);
    // Dark under light, for paper and ink both.
    assert.equal((svg.match(/<ellipse /g) ?? []).length, 2);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="200" height="100">/);
  });

  it("sets a measurement's figure in the drawing, escaped and inside the picture", () => {
    const svg = snapshotOverlaySvg(
      [{ kind: "box", a: { x: 0, y: 0 }, b: { x: 100, y: 50 }, label: "21.5 × 25 mm at <1200> dpi" }],
      { x: 0, y: 0, w: 100, h: 50 },
      { width: 800, height: 400 }
    );
    assert.match(svg, /<rect x="0" y="0" width="800" height="400" fill="none"/);
    assert.match(svg, /21\.5 × 25 mm at &lt;1200&gt; dpi<\/text>/);
    const plate = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx=/.exec(svg);
    assert.ok(plate, "the figure has a plate behind it");
    const [x, y, w, h] = plate.slice(1).map(Number);
    assert.ok(x >= 0 && y >= 0 && x + w <= 800 && y + h <= 400, "the plate is not cut off");
  });
});
