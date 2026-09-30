import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  COLLAGE_PREVIEW_SCAN,
  collagePreviewCapacity,
  planCollagePreview,
  type CollagePreviewValues,
} from "../../src/lib/collage-preview";
import { collageColumnsFor, type CollagePlannedTileSize } from "../../src/lib/collage-layout";
import { renderCollage, type CollageTileSource } from "../../src/lib/photos/collage";
import {
  collageTemplateSummary,
  collageTemplateSummaryRows,
} from "../../src/lib/collage-template-rules";

// The collage template preview (#1477) promises that it never shows a layout the rendered collage
// would not have. The first half pins what it draws; the second renders real collages from the same
// templates and holds the preview to them, tile by tile and scan by scan.

const base: CollagePreviewValues = {
  gridMode: "fixed",
  pairSides: false,
  rows: 3,
  columns: 3,
  gapPercent: 5,
  labelPercent: 1.5,
};

describe("planCollagePreview", () => {
  it("draws a full image when no count is given", () => {
    const plan = planCollagePreview({ ...base, rows: 2, columns: 4 });
    assert.equal(plan.cells.length, 8);
    assert.equal(plan.columns, 4);
    assert.equal(plan.rowCount, 2);
    assert.deepEqual(
      plan.cells.map((c) => c.number),
      [1, 2, 3, 4, 5, 6, 7, 8]
    );
  });

  it("holds a count to one image's capacity, and to at least one stamp", () => {
    assert.equal(planCollagePreview(base, 50).cells.length, 9);
    assert.equal(planCollagePreview(base, 0).cells.length, 1);
    assert.equal(collagePreviewCapacity({ rows: 3, columns: 4 }), 12);
  });

  it("shows the grid choice below capacity: four stamps under 3 × 3", () => {
    // The user guide's own example: the fixed grid is a row of three and one trailing, the automatic
    // one a 2 × 2. At a full image the two would be the same picture.
    const fixed = planCollagePreview(base, 4);
    const auto = planCollagePreview({ ...base, gridMode: "auto" }, 4);
    assert.equal(fixed.columns, 3);
    assert.equal(fixed.rowCount, 2);
    assert.equal(auto.columns, 2);
    assert.equal(auto.rowCount, 2);
    assert.deepEqual(planCollagePreview({ ...base, gridMode: "auto" }).columns, 3);
  });

  it("draws a front and a back in every cell of a paired template, half a gap apart", () => {
    const plan = planCollagePreview({ ...base, pairSides: true }, 2);
    for (const cell of plan.cells) {
      assert.deepEqual(
        cell.scans.map((s) => s.side),
        ["front", "back"]
      );
      const [front, back] = cell.scans;
      // Gap 5% of a 600-tall scan is 30; a pair is spaced by half of it.
      assert.equal(back.x - (front.x + front.width), 15);
      assert.equal(cell.label.width, front.width + 15 + back.width);
    }
  });

  it("gives an unpaired scan no side, and a template with no strip no label", () => {
    const plan = planCollagePreview({ ...base, labelPercent: 0 }, 1);
    assert.equal(plan.cells[0].scans[0].side, null);
    assert.equal(plan.cells[0].label.height, 0);
  });
});

describe("collage template summaries", () => {
  const template = { ...base, gridMode: "auto", pairSides: true, background: "#000000" };

  it("tells two templates apart in one line", () => {
    assert.equal(
      collageTemplateSummary(template),
      "auto, up to 3 × 3 · front+back cells · gap 5% · strip 1.5%"
    );
    assert.equal(
      collageTemplateSummary({ ...template, gridMode: "fixed", pairSides: false, labelPercent: 0 }),
      "3 × 3 · gap 5% · no strip"
    );
  });

  it("names every value beside the drawing", () => {
    assert.deepEqual(collageTemplateSummaryRows(template), [
      { label: "Grid", value: "Automatic, up to 3 × 3" },
      { label: "Per image", value: "Up to 9 stamps" },
      { label: "Cells", value: "Front and back" },
      { label: "Gap", value: "5% of stamp" },
      { label: "Label strip", value: "1.5% of image" },
      { label: "Background", value: "#000000" },
    ]);
  });
});

// ── Against a real render ─────────────────────────────────────────────────────

const FRONT = { r: 220, g: 30, b: 30 };
const BACK = { r: 30, g: 30, b: 220 };

async function flat(colour: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: {
      width: COLLAGE_PREVIEW_SCAN.width,
      height: COLLAGE_PREVIEW_SCAN.height,
      channels: 3,
      background: colour,
    },
  })
    .png()
    .toBuffer();
}

/** The collage generation would render for these values and this many copies: the width asked the
 *  way generation asks it (`offer-photo-generation.ts`), and the renderer itself for the rest. */
async function render(values: CollagePreviewValues, count: number) {
  const front = await flat(FRONT);
  const back = await flat(BACK);
  const sources: CollageTileSource[] = Array.from({ length: count }, () => ({
    buffer: front,
    pair: values.pairSides ? { buffer: back } : null,
  }));
  const size = { stored: COLLAGE_PREVIEW_SCAN, original: null };
  const planned: CollagePlannedTileSize[] = sources.map((s) => ({
    main: size,
    pair: s.pair ? size : null,
  }));
  const columns = collageColumnsFor(planned, {
    gridMode: values.gridMode === "auto" ? "auto" : "fixed",
    rows: values.rows,
    columns: values.columns,
  });
  return renderCollage(
    sources,
    {
      columns,
      gapPercent: values.gapPercent,
      labelPercent: values.labelPercent,
      background: "#ffffff",
    },
    { maxEdge: null, maxBytes: null }
  );
}

/** Which scan colour the rendered image has at a point: the dominant channel, which survives JPEG. */
async function colourAt(image: Buffer, x: number, y: number): Promise<"front" | "back" | "other"> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const at = (Math.round(y) * info.width + Math.round(x)) * info.channels;
  const [r, g, b] = [data[at], data[at + 1], data[at + 2]];
  if (r > 150 && b < 100 && g < 100) return "front";
  if (b > 150 && r < 100 && g < 100) return "back";
  return "other";
}

const SAMPLES: { name: string; values: CollagePreviewValues; count: number }[] = [
  { name: "a full fixed 3 × 3", values: base, count: 9 },
  { name: "a short last row on a fixed grid", values: { ...base, rows: 2, columns: 4 }, count: 6 },
  { name: "an automatic grid below capacity", values: { ...base, gridMode: "auto" }, count: 4 },
  {
    name: "paired cells on an automatic grid",
    values: { ...base, gridMode: "auto", pairSides: true, rows: 2, columns: 3, gapPercent: 12 },
    count: 5,
  },
  {
    name: "no gap and no strip",
    values: { ...base, gapPercent: 0, labelPercent: 0, columns: 2 },
    count: 3,
  },
  {
    name: "a deep strip on a tall page",
    values: { ...base, rows: 4, columns: 1, labelPercent: 6, pairSides: true },
    count: 4,
  },
];

describe("the preview against a rendered collage", () => {
  for (const sample of SAMPLES) {
    it(`matches for ${sample.name}`, async () => {
      const preview = planCollagePreview(sample.values, sample.count);
      const rendered = await render(sample.values, sample.count);

      assert.equal(preview.width, rendered.width);
      assert.equal(preview.height, rendered.height);
      assert.equal(preview.rowCount, rendered.layout.rowCount);
      assert.equal(preview.cells.length, rendered.layout.tiles.length);
      preview.cells.forEach((cell, i) => {
        const tile = rendered.layout.tiles[i];
        const left = Math.min(...cell.scans.map((s) => s.x));
        const top = Math.min(...cell.scans.map((s) => s.y));
        assert.deepEqual({ x: left, y: top }, { x: tile.x, y: tile.y }, `cell ${cell.number}`);
        assert.deepEqual(cell.label, tile.label, `label of cell ${cell.number}`);
      });

      // Every scan the preview draws is the scan the render put there — a back where a back is —
      // read just inside each of its four edges, so a scan drawn a few pixels off would read the
      // gap or its neighbour on one side. Ten pixels in, clear of JPEG's colour bleed.
      const INSET = 10;
      for (const cell of preview.cells) {
        for (const scan of cell.scans) {
          const want = scan.side === "back" ? "back" : "front";
          const midX = scan.x + scan.width / 2;
          const midY = scan.y + scan.height / 2;
          for (const [x, y] of [
            [scan.x + INSET, midY],
            [scan.x + scan.width - 1 - INSET, midY],
            [midX, scan.y + INSET],
            [midX, scan.y + scan.height - 1 - INSET],
          ]) {
            assert.equal(await colourAt(rendered.buffer, x, y), want, `cell ${cell.number} at ${x},${y}`);
          }
        }
      }
    });
  }
});
