import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layOutCollage } from "../../src/lib/collage-layout";
import {
  collageLabelSvg,
  fitCollageLabel,
  fitTileLabels,
  labelInkColor,
} from "../../src/lib/collage-label";

// The tile annotation of a collage (#312): every tile carries up to two labels — an identifier and
// something descriptive — so a buyer can name one copy out of eight. Sizes are fractions of the
// strip, which is itself a fraction of the stamp, so nothing here depends on a scan resolution.

describe("fitCollageLabel", () => {
  it("scales a short label to the strip's height", () => {
    const fitted = fitCollageLabel("A234", 200, 30);
    assert.ok(fitted);
    // Height-capped, not width-capped: four glyphs have room to spare in 200 px.
    assert.ok(fitted.fontSize > 15 && fitted.fontSize <= 30, `font size was ${fitted.fontSize}`);
    assert.equal(fitted.text, "A234");
  });

  it("shrinks a long label to the tile's width rather than overflowing it", () => {
    const short = fitCollageLabel("A2", 120, 40)!;
    const long = fitCollageLabel("Mi·PL 200 Merc", 120, 40)!;
    assert.ok(long.fontSize < short.fontSize);
    assert.ok(long.text.length * long.fontSize * 0.62 <= 120);
  });

  it("truncates with an ellipsis instead of shrinking past legibility", () => {
    const fitted = fitCollageLabel("Mi·PL 200 Mercury 1850 mint never hinged", 90, 24);
    assert.ok(fitted);
    assert.ok(fitted.text.endsWith("…"));
    assert.ok(fitted.text.length < 40);
  });

  it("keeps the same result at any scan resolution", () => {
    // Twice the pixels, twice the size, same text: the label is sized against the stamp, not the file.
    const small = fitCollageLabel("A234", 200, 30)!;
    const large = fitCollageLabel("A234", 400, 60)!;
    assert.equal(large.text, small.text);
    assert.equal(large.fontSize, small.fontSize * 2);

    const cutSmall = fitCollageLabel("Mi·PL 200 Mercury 1850", 90, 24)!;
    const cutLarge = fitCollageLabel("Mi·PL 200 Mercury 1850", 900, 240)!;
    assert.equal(cutLarge.text, cutSmall.text);
  });

  it("draws nothing for a blank label, a strip with no height, or an impossible box", () => {
    assert.equal(fitCollageLabel("", 100, 20), null);
    assert.equal(fitCollageLabel("   ", 100, 20), null);
    assert.equal(fitCollageLabel("A234", 100, 0), null);
    assert.equal(fitCollageLabel("A234", 2, 200), null);
  });

  it("collapses a rendered template's whitespace into one line", () => {
    assert.equal(fitCollageLabel("  A234\n B12 ", 300, 30)!.text, "A234 B12");
  });
});

const box = { x: 100, y: 500, width: 300, height: 40 };

describe("fitTileLabels", () => {
  it("puts the two annotations flush left and flush right, at one shared size", () => {
    const [left, right] = fitTileLabels({ left: "A234", right: "Mi 200" }, box);

    assert.equal(left.anchor, "start");
    assert.equal(right.anchor, "end");
    assert.equal(left.fontSize, right.fontSize, "the strip reads as one line, not two sizes");
    assert.equal(left.y, right.y);
    assert.ok(left.x >= box.x && left.x < box.x + box.width / 2);
    assert.ok(right.x <= box.x + box.width && right.x > box.x + box.width / 2);
  });

  it("centres a lone annotation rather than leaving it hanging off an edge", () => {
    for (const labels of [{ left: "A234" }, { right: "A234" }, { left: "A234", right: "  " }]) {
      const placed = fitTileLabels(labels, box);
      assert.equal(placed.length, 1);
      assert.equal(placed[0].anchor, "middle");
      assert.equal(placed[0].x, box.x + box.width / 2);
    }
  });

  it("splits the strip in proportion to the two labels, not down the middle", () => {
    const [left, right] = fitTileLabels({ left: "Mint never hinged 1850", right: "A234" }, box);
    assert.equal(left.anchor, "start");
    assert.equal(right.anchor, "end");
    // The long side gets the room it needs: at the shared size it takes well over half the strip,
    // which a fixed half-and-half split would have made impossible.
    const width = (placed: typeof left) => placed.text.length * placed.fontSize * 0.62;
    assert.ok(width(left) > box.width / 2, `left took only ${width(left)} of ${box.width}`);
    assert.ok(width(left) + width(right) <= box.width);
    // A wider strip fits the same pair whole — the split follows the text rather than the middle.
    const wide = fitTileLabels({ left: "Mint never hinged 1850", right: "A234" }, {
      ...box,
      width: 900,
    });
    assert.deepEqual(
      wide.map((p) => p.text),
      ["Mint never hinged 1850", "A234"]
    );
  });

  it("draws the baseline inside the strip", () => {
    for (const placed of fitTileLabels({ left: "A234", right: "Mi 200" }, box)) {
      assert.ok(placed.y > box.y && placed.y <= box.y + box.height);
    }
  });

  it("draws nothing when the strip has no height or neither side says anything", () => {
    assert.deepEqual(fitTileLabels({ left: "A234" }, { ...box, height: 0 }), []);
    assert.deepEqual(fitTileLabels({}, box), []);
    assert.deepEqual(fitTileLabels({ left: "", right: null }, box), []);
  });
});

const layoutStyle = { columns: 2, gapPercent: 8, labelPercent: 18 };
const sizes = [
  { width: 100, height: 140 },
  { width: 100, height: 140 },
];

describe("collageLabelSvg", () => {
  it("places the annotations of every labelled tile inside its own strip", () => {
    const layout = layOutCollage(sizes, layoutStyle);
    const svg = collageLabelSvg(
      layout,
      [{ left: "A234", right: "Mi 200" }, { left: "A235" }],
      "#ffffff"
    )!;

    assert.ok(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}"`));
    const texts = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)];
    assert.deepEqual(
      texts.map((t) => t[3]),
      ["A234", "Mi 200", "A235"]
    );
    const strips = [layout.tiles[0].label, layout.tiles[0].label, layout.tiles[1].label];
    for (const [index, match] of texts.entries()) {
      const strip = strips[index];
      const x = Number(match[1]);
      const y = Number(match[2]);
      assert.ok(x >= strip.x && x <= strip.x + strip.width, `${x} outside its strip`);
      assert.ok(y > strip.y && y <= strip.y + strip.height, `baseline ${y} outside its strip`);
    }
  });

  it("leaves a copy with no labels unlabelled rather than inventing one", () => {
    const layout = layOutCollage(sizes, layoutStyle);
    const svg = collageLabelSvg(layout, [null, { left: "A235" }], "#ffffff")!;

    const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)];
    assert.equal(texts.length, 1);
    assert.equal(texts[0][1], "A235");
  });

  it("returns null when nothing is labelled, so the renderer can skip the overlay", () => {
    const layout = layOutCollage(sizes, layoutStyle);
    assert.equal(collageLabelSvg(layout, [null, undefined], "#ffffff"), null);
    assert.equal(collageLabelSvg(layout, [{ left: "A234" }], "#ffffff") === null, false);
    // A strip percentage of 0 reserves nothing, so there is nowhere to draw.
    const flat = layOutCollage(sizes, { ...layoutStyle, labelPercent: 0 });
    assert.equal(collageLabelSvg(flat, [{ left: "A234" }, { left: "A235" }], "#ffffff"), null);
  });

  it("escapes label text so a stamp name can carry markup characters", () => {
    const layout = layOutCollage(sizes, layoutStyle);
    const svg = collageLabelSvg(layout, [{ left: 'A&B <"1>' }], "#ffffff")!;
    assert.ok(svg.includes("A&amp;B &lt;&quot;1&gt;"));
  });

  it("takes its ink colour from the collage background", () => {
    const layout = layOutCollage(sizes, layoutStyle);
    assert.ok(collageLabelSvg(layout, [{ left: "A234" }], "#111111")!.includes('fill="#ffffff"'));
    assert.ok(collageLabelSvg(layout, [{ left: "A234" }], "#ffffff")!.includes('fill="#000000"'));
  });
});

describe("labelInkColor", () => {
  it("writes dark on a light collage and light on a dark one", () => {
    assert.equal(labelInkColor("#ffffff"), "#000000");
    assert.equal(labelInkColor("#eeeeee"), "#000000");
    assert.equal(labelInkColor("#101010"), "#ffffff");
    assert.equal(labelInkColor("#003366"), "#ffffff");
  });

  it("treats an unparseable background as light", () => {
    assert.equal(labelInkColor("not a colour"), "#000000");
  });
});

describe("collageLabelSvg — one size for the whole collage", () => {
  it("draws every tile's labels at the smallest size any of them needed", () => {
    // A narrow stamp beside a wide one: a per-tile size would give the narrow one a visibly smaller
    // label, which reads as a mistake rather than as fitting.
    const layout = layOutCollage(
      [
        { width: 200, height: 300 },
        { width: 900, height: 300 },
      ],
      { columns: 2, gapPercent: 5, labelPercent: 14 }
    );
    const svg = collageLabelSvg(
      layout,
      [
        { left: "B12", right: "Mi 202-204" },
        { left: "C7", right: "Mi 300" },
      ],
      "#ffffff"
    )!;

    const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
    assert.equal(sizes.length, 4);
    assert.equal(new Set(sizes).size, 1, `sizes differed: ${sizes.join()}`);

    // And with one size, one baseline: every strip sits its text at the same offset.
    const ys = [...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1]));
    assert.equal(new Set(ys).size, 1, `baselines differed: ${ys.join()}`);
  });
});
