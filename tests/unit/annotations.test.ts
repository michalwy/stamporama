import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_SNAPSHOT_TITLE,
  MAX_SNAPSHOT_MARKS,
  MIN_SNAPSHOT_EDGE,
  NO_MARKS,
  annotationFromDrag,
  changeMarks,
  markPrimitives,
  parseAnnotationStyle,
  parseSnapshotRequest,
  readStoredAnnotationStyle,
  rulerTicks,
  snapshotOutputSize,
  snapshotOverlaySvg,
  snapshotRegion,
  textMarkAt,
  undoMarks,
  type Annotation,
  type Primitive,
} from "../../src/lib/annotations";

// Marking a detail and keeping it as a photo (#674, #1300). The live marks and the burnt-in ones are
// drawn from the same primitives in the same frame, so the arithmetic that moves a shape from the
// picture into the snapshot — and sizes it as it looked on screen — is the one place a circle could
// land beside the flaw it was drawn around, or a line come out thinner than it was drawn.

const VALID = {
  photoId: "photo-1",
  region: { x: 10, y: 20, w: 100, h: 50 },
  marks: [
    { kind: "ellipse", a: { x: 20, y: 30 }, b: { x: 60, y: 50 } },
    { kind: "distance", a: { x: 10, y: 20 }, b: { x: 110, y: 20 }, label: "4.23 mm at 1200 dpi" },
    { kind: "rulerMark", a: { x: 10, y: 60 }, b: { x: 110, y: 60 }, dpi: 1200 },
    { kind: "text", at: { x: 30, y: 30 }, text: " Plate flaw " },
  ],
  title: "  Plate flaw  ",
  style: { colour: "yellow", thickness: 3, fontSize: 24 },
  viewScale: 2,
};

const PLACE_ON_SCREEN = { origin: { x: 0, y: 0 }, scale: 1, screen: 1 };

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
    assert.equal(parsed.marks.length, 4);
    assert.deepEqual(parsed.marks[3], { kind: "text", at: { x: 30, y: 30 }, text: "Plate flaw" });
    assert.deepEqual(parsed.style, VALID.style);
    assert.equal(parsed.viewScale, 2);
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
    // …and a ruler mark never without the scale it was drawn at (#1300).
    assert.equal(
      parseSnapshotRequest({ ...VALID, marks: [{ kind: "rulerMark", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }] }),
      null
    );
    assert.equal(
      parseSnapshotRequest({ ...VALID, marks: [{ kind: "rulerMark", a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, dpi: 12 }] }),
      null
    );
    // A note of nothing is not a note.
    assert.equal(parseSnapshotRequest({ ...VALID, marks: [{ kind: "text", at: { x: 0, y: 0 }, text: "  " }] }), null);
    assert.equal(
      parseSnapshotRequest({ ...VALID, marks: [{ kind: "line", a: { x: Number.NaN, y: 0 }, b: { x: 1, y: 1 } }] }),
      null
    );
    const many = Array.from({ length: MAX_SNAPSHOT_MARKS + 1 }, () => VALID.marks[0]);
    assert.equal(parseSnapshotRequest({ ...VALID, marks: many }), null);
    // The style is one the viewer could have drawn, and the zoom a zoom.
    assert.equal(parseSnapshotRequest({ ...VALID, style: undefined }), null);
    assert.equal(parseSnapshotRequest({ ...VALID, style: { ...VALID.style, colour: "#ff00ff" } }), null);
    assert.equal(parseSnapshotRequest({ ...VALID, style: { ...VALID.style, thickness: 4 } }), null);
    assert.equal(parseSnapshotRequest({ ...VALID, viewScale: 0 }), null);
    assert.equal(parseSnapshotRequest({ ...VALID, viewScale: "2" }), null);
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
      { width: 200, height: 100 },
      DEFAULT_ANNOTATION_STYLE,
      2
    );
    // The ring spans (20,30)–(60,50) on the picture, which is (10,10)–(50,30) in the region and
    // twice that in a snapshot drawn at double size: centre (60, 40), radii 40 and 20.
    assert.match(svg, /<ellipse cx="60" cy="40" rx="40" ry="20"/);
    // The line runs corner to corner of the region.
    assert.match(svg, /<line x1="0" y1="0" x2="200" y2="100"/);
    // A halo under the stroke, for paper and ink both.
    assert.equal((svg.match(/<ellipse /g) ?? []).length, 2);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="200" height="100">/);
  });

  it("sets a measurement's figure in the drawing, escaped and inside the picture", () => {
    const svg = snapshotOverlaySvg(
      [{ kind: "box", a: { x: 0, y: 0 }, b: { x: 100, y: 50 }, label: "21.5 × 25 mm at <1200> dpi" }],
      { x: 0, y: 0, w: 100, h: 50 },
      { width: 800, height: 400 },
      DEFAULT_ANNOTATION_STYLE,
      // Kept at the resolution it was shown at: 800 screen pixels across the region.
      8
    );
    assert.match(svg, /<rect x="0" y="0" width="800" height="400" fill="none"/);
    assert.match(svg, /21\.5 × 25 mm at &lt;1200&gt; dpi<\/text>/);
    const plate = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx=/.exec(svg);
    assert.ok(plate, "the figure has a plate behind it");
    const [x, y, w, h] = plate.slice(1).map(Number);
    assert.ok(x >= 0 && y >= 0 && x + w <= 800 && y + h <= 400, "the plate is not cut off");
  });
});

describe("annotation style (#1300)", () => {
  it("draws every stroke in the chosen colour over a halo, at the chosen thickness", () => {
    const style = { colour: "red" as const, thickness: 3, fontSize: 16 };
    const prims = markPrimitives({ kind: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, PLACE_ON_SCREEN, style);
    const lines = prims.filter((p): p is Extract<Primitive, { type: "line" }> => p.type === "line");
    assert.equal(lines.length, 2);
    // Halo first, wider; the colour on top.
    assert.equal(lines[0].width, 5);
    assert.equal(lines[1].stroke, "#ff3b30");
    assert.equal(lines[1].width, 3);
  });

  it("keeps a stroke's screen thickness in a snapshot taken at another resolution", () => {
    // Shown at zoom 0.5, kept at 1:1: every screen pixel covers two snapshot pixels.
    const svg = snapshotOverlaySvg(
      [{ kind: "line", a: { x: 0, y: 50 }, b: { x: 100, y: 50 } }],
      { x: 0, y: 0, w: 100, h: 100 },
      { width: 100, height: 100 },
      { colour: "black", thickness: 2, fontSize: 16 },
      0.5
    );
    assert.match(svg, /stroke="#111111" stroke-width="4"/);
    // Black is drawn over a light halo, not a dark one.
    assert.match(svg, /stroke="rgba\(255,255,255,0.8\)" stroke-width="8"/);
  });

  it("restyles marks already drawn, since a mark carries no style of its own", () => {
    const mark: Annotation = { kind: "ellipse", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } };
    const white = markPrimitives(mark, PLACE_ON_SCREEN, DEFAULT_ANNOTATION_STYLE);
    const green = markPrimitives(mark, PLACE_ON_SCREEN, { ...DEFAULT_ANNOTATION_STYLE, colour: "green" });
    const strokeOf = (prims: Primitive[]) => {
      const last = prims.at(-1);
      return last?.type === "ellipse" ? last.stroke : null;
    };
    assert.equal(strokeOf(white), "#ffffff");
    assert.equal(strokeOf(green), "#30d158");
  });

  it("sets a note in the chosen colour and size, from its top-left corner", () => {
    const style = { colour: "yellow" as const, thickness: 5, fontSize: 24 };
    const prims = markPrimitives({ kind: "text", at: { x: 10, y: 20 }, text: "Retouch" }, PLACE_ON_SCREEN, style);
    assert.equal(prims.length, 1);
    const [note] = prims;
    assert.ok(note.type === "text");
    assert.equal(note.text, "Retouch");
    assert.equal(note.fill, "#ffd60a");
    // Thickness is for lines; a note's size is its own.
    assert.equal(note.size, 24);
    assert.equal(note.x, 10);
    assert.ok(note.y > 20 && note.y < 20 + 24, "the baseline sits inside the first line below the corner");
  });

  it("reads a stored style forgivingly and a sent one strictly", () => {
    assert.deepEqual(readStoredAnnotationStyle(null), DEFAULT_ANNOTATION_STYLE);
    assert.deepEqual(readStoredAnnotationStyle("not json"), DEFAULT_ANNOTATION_STYLE);
    // A stale field costs that field, not the others.
    assert.deepEqual(readStoredAnnotationStyle(JSON.stringify({ colour: "blue", thickness: 7, fontSize: 32 })), {
      colour: "blue",
      thickness: DEFAULT_ANNOTATION_STYLE.thickness,
      fontSize: 32,
    });
    assert.equal(parseAnnotationStyle({ colour: "blue", thickness: 7, fontSize: 32 }), null);
    assert.deepEqual(parseAnnotationStyle({ colour: "blue", thickness: 5, fontSize: 32 }), {
      colour: "blue",
      thickness: 5,
      fontSize: 32,
    });
  });
});

describe("ruler mark (#1300)", () => {
  it("needs a stated scale to be drawn at all", () => {
    assert.equal(annotationFromDrag("rulerMark", { x: 0, y: 0 }, { x: 100, y: 0 }, null), null);
    assert.deepEqual(annotationFromDrag("rulerMark", { x: 0, y: 0 }, { x: 100, y: 0 }, 600), {
      kind: "rulerMark",
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      dpi: 600,
    });
  });

  it("chooses the finest graduation the zoom leaves room for", () => {
    // 50 screen px per mm: tenths are 5 px apart, too close; half millimetres are 25 px.
    const at50 = rulerTicks(3, 50);
    assert.equal(at50.minor, 0.5);
    assert.deepEqual(
      at50.ticks.map((t) => [t.mm, t.major]),
      [
        [0.5, false],
        [1, true],
        [1.5, false],
        [2, true],
        [2.5, false],
      ]
    );
    // 100 px per mm: tenths, long every half millimetre.
    const at100 = rulerTicks(1, 100);
    assert.equal(at100.minor, 0.1);
    assert.equal(at100.ticks.length, 9);
    assert.deepEqual(at100.ticks.filter((t) => t.major).map((t) => t.mm), [0.5]);
    // Zoomed right out: whole centimetres.
    assert.equal(rulerTicks(100, 0.8).minor, 10);
  });

  it("carries its length in millimetres with the scale it was drawn at", () => {
    // 600 px at 1200 dpi is 12.7 mm.
    const prims = markPrimitives(
      { kind: "rulerMark", a: { x: 0, y: 100 }, b: { x: 600, y: 100 }, dpi: 1200 },
      PLACE_ON_SCREEN,
      DEFAULT_ANNOTATION_STYLE
    );
    const label = prims.find((p) => p.type === "text");
    assert.ok(label && label.type === "text");
    assert.equal(label.text, "12.70 mm at 1200 dpi");
    // Above the line, centred on it.
    assert.equal(label.anchor, "middle");
    assert.ok(label.y < 100);
    // 47.2 screen px per mm at 1:1: half-millimetre graduations, 25 of them, plus the two end caps —
    // each a halo and a stroke, plus the line's own two.
    const lines = prims.filter((p) => p.type === "line");
    assert.equal(lines.length, 2 * (1 + 2 + 25));
  });
});

describe("marks history (#1300)", () => {
  const ring: Annotation = { kind: "ellipse", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } };
  const note: Annotation = { kind: "text", at: { x: 50, y: 50 }, text: "Flaw" };

  it("undoes every change in turn — a mark, an edit, a removal and Clear", () => {
    let h = changeMarks(NO_MARKS, [ring]);
    h = changeMarks(h, [ring, note]);
    h = changeMarks(h, [ring, { ...note, text: "Plate flaw" }]);
    h = changeMarks(h, [ring]);
    h = changeMarks(h, []);
    assert.deepEqual(h.marks, []);
    h = undoMarks(h);
    assert.deepEqual(h.marks, [ring]);
    h = undoMarks(h);
    assert.deepEqual(h.marks, [ring, { ...note, text: "Plate flaw" }]);
    h = undoMarks(h);
    assert.deepEqual(h.marks, [ring, note]);
    h = undoMarks(undoMarks(h));
    assert.deepEqual(h, NO_MARKS);
    assert.equal(undoMarks(h), h);
  });

  it("finds the note under a click, the topmost first", () => {
    const marks: Annotation[] = [ring, note, { kind: "text", at: { x: 52, y: 52 }, text: "Second" }];
    // At zoom 1 and 16 px type, a four-letter note spans ~48 × 20 picture px from its corner.
    assert.equal(textMarkAt(marks, { x: 60, y: 60 }, 16, 1), 2);
    assert.equal(textMarkAt(marks, { x: 51, y: 51 }, 16, 1), 1);
    assert.equal(textMarkAt(marks, { x: 5, y: 5 }, 16, 1), null);
    // Zoomed in 4×, the same note covers a quarter of the picture.
    assert.equal(textMarkAt([note], { x: 70, y: 55 }, 16, 4), null);
    assert.equal(textMarkAt([note], { x: 60, y: 54 }, 16, 4), 0);
  });
});
