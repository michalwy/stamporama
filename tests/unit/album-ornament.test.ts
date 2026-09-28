import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AlbumOrnamentSvgError,
  albumOrnamentPathData,
  parseSvgPathData,
  readOrnamentSvg,
  type AlbumOrnamentDrawing,
  type AlbumPathCommand,
} from "../../src/lib/album-ornament-svg";
import {
  ALBUM_BUILTIN_ORNAMENTS,
  albumBuiltinOrnament,
  albumOrnamentName,
  isAlbumBuiltinOrnament,
  isAlbumUploadedOrnamentId,
} from "../../src/lib/album-ornaments";
import { albumFrame, albumFrameCentreMm, type AlbumFramePreset } from "../../src/lib/album-frame";

// Ornamental page frames (#1427): the SVG reader an upload and the built-in set both go through, the
// built-in set itself, and the frame geometry the PDF and the canvas both draw. All pure.

const svg = (body: string, attrs = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

/** Every end point of a drawing's outlines, in drawing units. */
function points(d: AlbumOrnamentDrawing): [number, number][] {
  return d.paths.flatMap((p) =>
    p.commands.flatMap((c): [number, number][] =>
      c[0] === "Z" ? [] : c[0] === "C" ? [[c[5], c[6]]] : [[c[1], c[2]]]
    )
  );
}

function close(a: number, b: number, eps = 1e-3) {
  assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
}

function refuses(source: string, pattern: RegExp) {
  assert.throws(() => readOrnamentSvg(source), (err: unknown) => {
    assert.ok(err instanceof AlbumOrnamentSvgError, String(err));
    assert.match((err as Error).message, pattern);
    return true;
  });
}

// ── Reading ──────────────────────────────────────────────────────────────────

describe("reading an SVG into an ornament", () => {
  it("takes the viewBox as the drawing's frame, and paints black fill by default", () => {
    const d = readOrnamentSvg(svg('<rect x="10" y="20" width="30" height="40"/>', 'viewBox="-5 -6 110 120"'));
    assert.deepEqual(d.viewBox, { x: -5, y: -6, width: 110, height: 120 });
    assert.equal(d.paths.length, 1);
    assert.equal(d.paths[0].fill, "#000000");
    assert.equal(d.paths[0].stroke, null);
    assert.deepEqual(d.paths[0].commands, [
      ["M", 10, 20],
      ["L", 40, 20],
      ["L", 40, 60],
      ["L", 10, 60],
      ["Z"],
    ]);
  });

  it("stands in the root's width and height for a missing viewBox", () => {
    const d = readOrnamentSvg(svg('<circle cx="5" cy="5" r="5"/>', 'width="20mm" height="10mm"'));
    close(d.viewBox.width, (20 * 96) / 25.4);
    close(d.viewBox.height, (10 * 96) / 25.4);
    refuses(svg('<circle r="5"/>', ""), /no viewBox/);
  });

  it("writes every outline with move, line, cubic and close alone", () => {
    const d = readOrnamentSvg(
      svg(`<path d="m10 10 h20 v20 H10 z M50 50 q10 -10 20 0 t20 0 s10 10 20 0 a10 10 0 0 1 20 0"/>
           <circle cx="50" cy="50" r="10"/><ellipse cx="5" cy="5" rx="4" ry="2"/>
           <polygon points="0,0 10,0 10,10"/><polyline points="0 0 5 5 10 0" fill="none" stroke="red"/>
           <line x1="0" y1="0" x2="9" y2="9" stroke="#123"/>`)
    );
    for (const p of d.paths) {
      for (const c of p.commands) assert.ok(["M", "L", "C", "Z"].includes(c[0]), c[0]);
    }
  });

  it("reads relative, horizontal and vertical steps into absolute points", () => {
    const cmds = parseSvgPathData("m10 10 h20 v20 h-20 z l5 5");
    assert.deepEqual(cmds, [
      ["M", 10, 10],
      ["L", 30, 10],
      ["L", 30, 30],
      ["L", 10, 30],
      ["Z"],
      // After a close, the pen is back at the subpath's start.
      ["L", 15, 15],
    ]);
  });

  it("reads further pairs after a move as lines, relative if the move was", () => {
    assert.deepEqual(parseSvgPathData("m1 1 2 2 3 3"), [
      ["M", 1, 1],
      ["L", 3, 3],
      ["L", 6, 6],
    ]);
  });

  it("reflects the last control point for a smooth curve, and only after a curve", () => {
    const [, first, smooth] = parseSvgPathData("M0 0 C0 10 10 10 10 0 S20 -10 20 0");
    assert.deepEqual(first, ["C", 0, 10, 10, 10, 10, 0]);
    assert.deepEqual(smooth, ["C", 10, -10, 20, -10, 20, 0]);
    const [, afterLine] = parseSvgPathData("M0 0 L5 5 S10 10 20 0").slice(1);
    assert.deepEqual(afterLine, ["C", 5, 5, 10, 10, 20, 0]);
  });

  it("turns a quadratic into the cubic that is the same curve", () => {
    const [, c] = parseSvgPathData("M0 0 Q30 30 60 0");
    assert.deepEqual(c, ["C", 20, 20, 40, 20, 60, 0]);
  });

  it("turns an arc into cubics that end exactly on its end and stay on its circle", () => {
    // A half circle of radius 10 from (0,0) to (20,0), bulging upwards (sweep 1 from the left).
    const cmds = parseSvgPathData("M0 0 A10 10 0 0 1 20 0");
    assert.equal(cmds.length, 3); // move + two quarters
    const last = cmds[cmds.length - 1] as Extract<AlbumPathCommand, { 0: "C" }>;
    assert.deepEqual([last[5], last[6]], [20, 0]);
    const mid = cmds[1] as Extract<AlbumPathCommand, { 0: "C" }>;
    close(Math.hypot(mid[5] - 10, mid[6]), 10);
    close(mid[6], -10);
  });

  it("reads arc flags written without separators", () => {
    const cmds = parseSvgPathData("M0 0a10 10 0 0120 0");
    const last = cmds[cmds.length - 1];
    assert.deepEqual([last[5], last[6]], [20, 0]);
  });

  it("applies group and element transforms to the points, and scales the line weight with them", () => {
    const d = readOrnamentSvg(
      svg(
        '<g transform="translate(10 20)"><path d="M0 0L10 0" stroke="#000" stroke-width="2" fill="none" transform="scale(3)"/></g>'
      )
    );
    assert.deepEqual(d.paths[0].commands, [
      ["M", 10, 20],
      ["L", 40, 20],
    ]);
    assert.equal(d.paths[0].strokeWidth, 6);
  });

  it("reads a matrix transform that swaps the axes", () => {
    const d = readOrnamentSvg(svg('<g transform="matrix(0 1 1 0 0 0)"><rect x="5" y="1" width="2" height="3"/></g>'));
    assert.deepEqual(d.paths[0].commands[0], ["M", 1, 5]);
  });

  it("paints by attribute, then class rule, then inline style — and inherits from groups", () => {
    const d = readOrnamentSvg(
      svg(`<style><![CDATA[ .a { fill: #ff0000 } .b, .c { stroke: blue; stroke-width: 3 } ]]></style>
           <g fill="#00ff00" stroke-linecap="round">
             <rect class="a" fill="#000" width="1" height="1"/>
             <rect class="a" style="fill: rgb(0, 0, 255)" width="1" height="1"/>
             <rect width="1" height="1"/>
             <rect class="c" width="1" height="1"/>
           </g>`)
    );
    assert.deepEqual(
      d.paths.map((p) => p.fill),
      ["#ff0000", "#0000ff", "#00ff00", "#00ff00"]
    );
    assert.equal(d.paths[3].stroke, "#0000ff");
    assert.equal(d.paths[3].strokeWidth, 3);
    assert.equal(d.paths[3].lineCap, "round");
  });

  it("resolves currentColor through color, and shortens three-digit hex", () => {
    const d = readOrnamentSvg(svg('<g color="#abc"><rect fill="currentColor" width="1" height="1"/></g>'));
    assert.equal(d.paths[0].fill, "#aabbcc");
  });

  it("keeps the even-odd fill rule, which the PDF needs to be told", () => {
    const d = readOrnamentSvg(svg('<path fill-rule="evenodd" d="M0 0H10V10H0Z M2 2H8V8H2Z"/>'));
    assert.equal(d.paths[0].fillRule, "evenodd");
  });

  it("passes over what draws nothing: metadata, defs, an editor's own elements, hidden shapes", () => {
    const d = readOrnamentSvg(
      `<?xml version="1.0"?>
       <!DOCTYPE svg [ <!ENTITY boom "not expanded"> ]>
       <!-- a comment -->
       <svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="x" viewBox="0 0 10 10">
         <title>Corner</title><metadata><rdf/></metadata>
         <sodipodi:namedview pagecolor="#fff"/>
         <defs><linearGradient id="g"/><path id="unused" d="M0 0L1 1"/></defs>
         <rect width="1" height="1" display="none"/>
         <g style="display:none"><rect width="2" height="2"/></g>
         <rect width="3" height="3" fill="none"/>
         <svg:rect width="4" height="4"/>
       </svg>`
    );
    assert.equal(d.paths.length, 1);
    assert.deepEqual(d.paths[0].commands[2], ["L", 4, 4]);
  });

  it("reads entities in attributes, and expands none a DOCTYPE declares", () => {
    const d = readOrnamentSvg(svg('<rect width="1" height="1" fill="&#x23;ff0000"/>'));
    assert.equal(d.paths[0].fill, "#ff0000");
    refuses(svg('<rect width="1" height="1" fill="&boom;"/>'), /colour "&boom;"/);
  });
});

describe("what the reader refuses, by name", () => {
  it("refuses what it would have to guess at", () => {
    refuses(svg("<text>PL</text>"), /contains text/);
    refuses(svg('<image href="x.png" width="1" height="1"/>'), /embedded picture/);
    refuses(svg('<use href="#a"/>'), /<use>/);
    refuses(svg('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), /inside the drawing/);
    refuses(svg('<rect width="1" height="1" fill="url(#g)"/>'), /gradient or a pattern/);
    refuses(svg('<rect width="1" height="1" opacity="0.5"/>'), /transparent/);
    refuses(svg('<rect width="1" height="1" style="fill-opacity:.9"/>'), /transparent/);
    refuses(svg('<rect width="1" height="1" clip-path="url(#c)"/>'), /clipped/);
    refuses(svg('<rect width="1" height="1" stroke="#000" stroke-dasharray="2 1"/>'), /dashed/);
    refuses(svg('<rect width="1" height="1" filter="url(#f)"/>'), /filter/);
    refuses(svg('<rect width="1" height="1" fill="rebeccapurple"/>'), /colour "rebeccapurple"/);
    refuses(svg('<style>rect { fill: red }</style><rect width="1" height="1"/>'), /only class rules/);
    refuses(svg('<rect width="10%" height="1"/>'), /only plain numbers/);
  });

  it("accepts the values that say nothing is there", () => {
    const d = readOrnamentSvg(
      svg('<rect width="1" height="1" opacity="1" clip-path="none" stroke-dasharray="none" filter="none"/>')
    );
    assert.equal(d.paths.length, 1);
  });

  it("refuses what is not a drawing at all", () => {
    refuses("not xml", /not a readable SVG/);
    refuses("<html><body/></html>", /not <svg>/);
    refuses(svg("<g>"), /unclosed|closes nothing/);
    refuses(svg('<path d="M0 0 L"/>'), /malformed path data/);
    refuses(svg('<path d="L0 0"/>'), /start with a move/);
    refuses(svg(""), /draws nothing/);
    refuses(svg('<rect width="1" height="1" fill="none"/>'), /draws nothing/);
    refuses(`${svg("")}${" ".repeat(1024 * 1024)}`, /too large/);
  });
});

describe("a drawing as SVG path data, for the canvas", () => {
  it("writes the four commands with no separators beyond spaces", () => {
    assert.equal(
      albumOrnamentPathData([["M", 1, 2], ["L", 3, 4], ["C", 5, 6, 7, 8, 9, 10], ["Z"]]),
      "M1 2L3 4C5 6 7 8 9 10Z"
    );
  });
});

// ── The built-in set ─────────────────────────────────────────────────────────

describe("the built-in ornaments", () => {
  it("each reads through the same reader an upload goes through", () => {
    for (const o of ALBUM_BUILTIN_ORNAMENTS) {
      const d = albumBuiltinOrnament(o.key);
      assert.ok(d, o.key);
      assert.ok(d.paths.length > 0, o.key);
    }
  });

  it("each runs an arm along both axes out to the far edge of its frame, where the rule takes over", () => {
    // The convention `album-frame.ts` places them by: the rule stops at the viewBox's far edge, so
    // a design whose arm fell short of it would print a gap between ornament and rule.
    for (const o of ALBUM_BUILTIN_ORNAMENTS) {
      const d = albumBuiltinOrnament(o.key)!;
      const right = d.viewBox.x + d.viewBox.width;
      const bottom = d.viewBox.y + d.viewBox.height;
      const pts = points(d);
      assert.ok(
        pts.some(([x, y]) => Math.abs(x - right) < 0.6 && Math.abs(y) <= 4),
        `${o.key} reaches the right edge on the axis`
      );
      assert.ok(
        pts.some(([x, y]) => Math.abs(y - bottom) < 0.6 && Math.abs(x) <= 4),
        `${o.key} reaches the bottom edge on the axis`
      );
      // And nothing spills outside its own frame, or the rule would run under it.
      for (const [x, y] of pts) {
        assert.ok(x >= d.viewBox.x - 1e-6 && x <= right + 1e-6, `${o.key} x ${x}`);
        assert.ok(y >= d.viewBox.y - 1e-6 && y <= bottom + 1e-6, `${o.key} y ${y}`);
      }
    }
  });

  it("is symmetric about the corner's diagonal, so the two arms meet the two rules alike", () => {
    for (const o of ALBUM_BUILTIN_ORNAMENTS) {
      const d = albumBuiltinOrnament(o.key)!;
      assert.equal(d.viewBox.x, d.viewBox.y, o.key);
      assert.equal(d.viewBox.width, d.viewBox.height, o.key);
      const key = ([x, y]: [number, number]) => `${x.toFixed(2)},${y.toFixed(2)}`;
      const all = new Set(points(d).map(key));
      for (const [x, y] of points(d)) assert.ok(all.has(key([y, x])), `${o.key}: (${y}, ${x}) mirrors (${x}, ${y})`);
    }
  });

  it("names a built-in by key and nothing else", () => {
    assert.ok(isAlbumBuiltinOrnament("rosette"));
    assert.ok(!isAlbumBuiltinOrnament("none"));
    assert.equal(albumBuiltinOrnament("cabc123"), null);
  });

  it("tells an uploaded ornament's id apart from a key", () => {
    assert.ok(isAlbumUploadedOrnamentId("cmg1x2y3z4a5b6c7d8e9f0g1h"));
    assert.ok(!isAlbumUploadedOrnamentId("rosette"));
    assert.ok(!isAlbumUploadedOrnamentId("none"));
    assert.ok(!isAlbumUploadedOrnamentId("CMG1X2Y3Z4A5B6C7D8E9F0G1H"));
  });
});

describe("an uploaded ornament's name", () => {
  it("is the file's own, without its extension, numbered when taken", () => {
    assert.equal(albumOrnamentName("Corner_flourish.SVG", new Set()), "Corner flourish");
    assert.equal(albumOrnamentName("corner.svg", new Set(["corner"])), "corner (2)");
    assert.equal(albumOrnamentName("corner.svg", new Set(["corner", "corner (2)"])), "corner (3)");
    assert.equal(albumOrnamentName(".svg", new Set()), "Ornament");
  });
});

// ── The frame ────────────────────────────────────────────────────────────────

const A4: AlbumFramePreset = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  borderStyle: "double",
  borderWidthMm: 0.4,
  borderInsetMm: 5,
  borderGapMm: 1.2,
  frameOrnamentSizeMm: 20,
};

/** A plain square ornament whose frame starts at 0 0: 10 units, so 2 mm a unit at 20 mm. */
const SQUARE = readOrnamentSvg(svg('<rect width="10" height="10"/>', 'viewBox="0 0 10 10"'));

function applyMatrix(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

describe("the page frame", () => {
  it("is closed rectangles without an ornament, the pair's white gap edge to edge", () => {
    const f = albumFrame(A4, null);
    assert.equal(f.lines.length, 0);
    assert.equal(f.ornaments.length, 0);
    assert.equal(f.rects.length, 2);
    assert.equal(f.rects[0].xMm, 5);
    // Centres a weight and a gap apart, so 1.2 mm of white between the rules' edges.
    close(f.rects[1].xMm - f.rects[0].xMm - A4.borderWidthMm, 1.2);
    assert.equal(f.rects[1].widthMm, 210 - 2 * f.rects[1].xMm);
  });

  it("moves the inner rule with the gap, which is what the preview used to disagree with the PDF about", () => {
    const f = albumFrame({ ...A4, borderGapMm: 3 }, null);
    close(f.rects[1].xMm, 5 + 0.4 + 3);
  });

  it("draws one rule for single, none for none or no weight", () => {
    assert.equal(albumFrame({ ...A4, borderStyle: "single" }, null).rects.length, 1);
    assert.equal(albumFrame({ ...A4, borderStyle: "none" }, null).rects.length, 0);
    assert.equal(albumFrame({ ...A4, borderWidthMm: 0 }, null).rects.length, 0);
  });

  it("lays the ornament's 0,0 on the frame's centre line, at every corner, mirrored into the page", () => {
    const f = albumFrame(A4, SQUARE);
    const c = albumFrameCentreMm(A4);
    close(c, 5 + (0.4 + 1.2) / 2);
    const at = Object.fromEntries(f.ornaments.map((o) => [o.corner, o.matrix]));
    assert.deepEqual(applyMatrix(at["top-left"], 0, 0), [c, c]);
    assert.deepEqual(applyMatrix(at["top-right"], 0, 0), [210 - c, c]);
    assert.deepEqual(applyMatrix(at["bottom-left"], 0, 0), [c, 297 - c]);
    assert.deepEqual(applyMatrix(at["bottom-right"], 0, 0), [210 - c, 297 - c]);
    // The far corner of the drawing lands inward from each corner: mirrored, never rotated.
    assert.deepEqual(applyMatrix(at["top-left"], 10, 10), [c + 20, c + 20]);
    assert.deepEqual(applyMatrix(at["top-right"], 10, 10), [210 - c - 20, c + 20]);
    assert.deepEqual(applyMatrix(at["bottom-left"], 10, 10), [c + 20, 297 - c - 20]);
    assert.deepEqual(applyMatrix(at["bottom-right"], 10, 10), [210 - c - 20, 297 - c - 20]);
    // Mirroring keeps an arm drawn along the top along the top at the top-right, running inwards.
    const [ax, ay] = applyMatrix(at["top-right"], 10, 0);
    assert.deepEqual([ax, ay], [210 - c - 20, c]);
  });

  it("stops every rule at the ornament's far edge, both rules of a pair alike", () => {
    const f = albumFrame(A4, SQUARE);
    const reach = albumFrameCentreMm(A4) + 20;
    assert.equal(f.rects.length, 0);
    assert.equal(f.lines.length, 8);
    for (const l of f.lines) {
      if (l.y1Mm === l.y2Mm) {
        close(l.x1Mm, reach);
        close(l.x2Mm, 210 - reach);
      } else {
        close(l.y1Mm, reach);
        close(l.y2Mm, 297 - reach);
      }
    }
  });

  it("scales by the frame's longer side, and a frame reaching outwards moves where the rules stop", () => {
    const wide = readOrnamentSvg(svg('<rect x="-5" y="-5" width="25" height="10"/>', 'viewBox="-5 -5 25 10"'));
    const f = albumFrame({ ...A4, borderStyle: "single" }, wide);
    // 25 units across is 20 mm: 0.8 mm a unit. The top rule stops at x = 5 + 0.8·20, the left one
    // at y = 5 + 0.8·5.
    const top = f.lines.find((l) => l.y1Mm === 5 && l.y2Mm === 5)!;
    close(top.x1Mm, 5 + 16);
    const left = f.lines.find((l) => l.x1Mm === 5 && l.x2Mm === 5)!;
    close(left.y1Mm, 5 + 4);
  });

  it("draws the rules closed when the ornament has no size", () => {
    const f = albumFrame({ ...A4, frameOrnamentSizeMm: 0 }, SQUARE);
    assert.equal(f.rects.length, 2);
    assert.equal(f.ornaments.length, 0);
  });

  it("draws ornaments alone on a frame with no rules, laid on the inset", () => {
    const f = albumFrame({ ...A4, borderStyle: "none" }, SQUARE);
    assert.equal(f.lines.length, 0);
    assert.equal(f.ornaments.length, 4);
    assert.deepEqual(applyMatrix(f.ornaments[0].matrix, 0, 0), [5, 5]);
  });

  it("leaves out a rule the ornaments have eaten entirely", () => {
    const f = albumFrame({ ...A4, pageWidthMm: 40, frameOrnamentSizeMm: 30 }, SQUARE);
    assert.ok(f.lines.every((l) => l.x1Mm === l.x2Mm), "only the vertical rules are left");
  });
});
