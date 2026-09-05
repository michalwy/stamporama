import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  albumTextMetrics,
  albumBaselineOffsetMm,
  MM_TO_PT,
  PT_TO_MM,
} from "../../src/lib/album-metrics";
import { loadAlbumFace } from "../../src/lib/album-font-bytes";
import { wrapAlbumText } from "../../src/lib/album-layout";
import { DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";

/** The content width of the collector's own page: A4 less his 10 mm margins. */
const CONTENT_MM =
  DEFAULT_ALBUM_PRESET.pageWidthMm -
  DEFAULT_ALBUM_PRESET.marginLeftMm -
  DEFAULT_ALBUM_PRESET.marginRightMm;

const HEADING = DEFAULT_ALBUM_PRESET.headingFace;
const HEADING_PT = DEFAULT_ALBUM_PRESET.headingSizePt;

describe("albumTextMetrics", () => {
  it("converts points to millimetres and leads lines at 1.2", () => {
    assert.equal(albumTextMetrics.lineHeightMm("liberation-sans", 12), 5.1);
    assert.ok(Math.abs(PT_TO_MM - 0.3528) < 0.0001);
    assert.ok(Math.abs(PT_TO_MM * MM_TO_PT - 1) < 1e-12);
  });

  it("measures a serif narrower than a sans, and bold wider than regular", () => {
    const text = "Wydanie obiegowe";
    const serif = albumTextMetrics.measureMm(text, "liberation-serif", 12);
    const sans = albumTextMetrics.measureMm(text, "liberation-sans", 12);
    const sansBold = albumTextMetrics.measureMm(text, "liberation-sans-bold", 12);
    assert.ok(serif < sans, `${serif} < ${sans}`);
    assert.ok(sans < sansBold, `${sans} < ${sansBold}`);
  });

  it("measures nothing for an empty string", () => {
    assert.equal(albumTextMetrics.measureMm("", HEADING, HEADING_PT), 0);
  });

  it("falls back rather than failing on a face this build does not ship", () => {
    // Measuring must not fail — a screen still has to render an album written against a dropped
    // face. Drawing is the opposite and `album-pdf.ts` refuses it by name.
    const width = albumTextMetrics.measureMm("303", "some-dropped-face", 8);
    assert.equal(width, albumTextMetrics.measureMm("303", "liberation-sans", 8));
  });

  /**
   * The advances are the embedded faces' own, so this can now be checked the way it could not be
   * while the table was an estimate: against pdf-lib's arithmetic, which is what a viewer and a
   * printer actually advance by.
   *
   * `CustomFontEmbedder.widthOfTextAtSize` lays the string out with fontkit, sums each glyph's
   * `advanceWidth` scaled by `1000 / unitsPerEm`, and multiplies by `size / 1000`. Reproduced here
   * from the font rather than from this module, so the two agreeing means something.
   */
  it("gives pdf-lib's own width for a string, to the micrometre", () => {
    for (const face of ["liberation-serif-bold", "noto-sans-condensed-italic"]) {
      const font = loadAlbumFace(face);
      const text = "1938, 17 III. Wystawa — Kraków ĄĘŁŚŻ";
      const scale = 1000 / font.unitsPerEm;
      let thousandths = 0;
      for (const glyph of font.layout(text).glyphs) thousandths += glyph.advanceWidth * scale;
      const pdfLibPt = thousandths * (12 / 1000);
      assert.ok(
        Math.abs(albumTextMetrics.measureMm(text, face, 12) - pdfLibPt * PT_TO_MM) < 1e-9,
        `${face} disagrees with pdf-lib`
      );
    }
  });

  /**
   * The check that survives from #767, now that it can be made against real glyphs.
   *
   * AlbumEasy does not wrap — a heading too long for the page carries a hand-typed `\n`. So every
   * heading the collector left on one line has to measure inside his content width, and the one he
   * broke has to measure outside it. These four are taken verbatim from `~/Documents/AlbumEasy/PL`.
   */
  it("agrees with the hand-written pages about what fits on one line", () => {
    const onOneLine = [
      "1938, 1 II. Wydanie obiegowe – prezydent RP Ignacy Mościcki.",
      "1938, 17 III. 150. rocznica uchwalenia konstytucji Stanów Zjednoczonych.",
      "1932, 19 VII – 1933, 23 IX. Wydanie obiegowe – godło państwa, tzw. małe doniczki.",
    ];
    for (const heading of onOneLine) {
      assert.deepEqual(
        wrapAlbumText(heading, CONTENT_MM, HEADING, HEADING_PT, albumTextMetrics),
        [heading],
        `he set this on one line: ${heading}`
      );
    }

    // The one he broke by hand, with his own `\n` removed. 211.5 mm against a 190 mm content width.
    const broken =
      "1950, 16 XII. Odbudowa Warszawy (do uiszczenia specjalnej opłaty za przesyłki w obrocie wewnętrznym).";
    assert.equal(
      wrapAlbumText(broken, CONTENT_MM, HEADING, HEADING_PT, albumTextMetrics).length,
      2,
      "he broke this one, so it must not fit"
    );
  });
});

describe("albumBaselineOffsetMm", () => {
  it("sits the baseline inside the line box, an ascent below the half-leading", () => {
    const font = loadAlbumFace(HEADING);
    const lineMm = albumTextMetrics.lineHeightMm(HEADING, HEADING_PT);
    const offset = albumBaselineOffsetMm(HEADING, HEADING_PT);
    assert.ok(offset > 0 && offset < lineMm, `${offset} inside 0..${lineMm}`);
    // fontkit reports descent as negative font units; a positive one would silently halve the
    // content box and lift every line.
    assert.ok(font.descent < 0);
    assert.ok(font.ascent > 0);
  });

  it("scales with the type size", () => {
    const small = albumBaselineOffsetMm(HEADING, 8);
    const large = albumBaselineOffsetMm(HEADING, 24);
    assert.ok(Math.abs(large / small - 3) < 0.05, `${large} ≈ 3 × ${small}`);
  });
});
