import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { albumTextMetrics, PT_TO_MM } from "../../src/lib/album-metrics";
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
  });

  it("measures a serif narrower than a sans, and bold wider than regular", () => {
    const text = "Wydanie obiegowe";
    const serif = albumTextMetrics.measureMm(text, "liberation-serif", 12);
    const sans = albumTextMetrics.measureMm(text, "liberation-sans", 12);
    const sansBold = albumTextMetrics.measureMm(text, "liberation-sans-bold", 12);
    assert.ok(serif < sans);
    assert.ok(sans < sansBold);
  });

  it("falls back rather than failing on a face this build does not ship", () => {
    const width = albumTextMetrics.measureMm("303", "some-dropped-face", 8);
    assert.ok(width > 0);
  });

  /**
   * The estimate is provisional (#768 replaces it with the embedded faces' real advances), so this
   * checks the only thing that can be checked without them: that it agrees with the collector's own
   * ~140 printed pages about which headings need a second line.
   *
   * AlbumEasy does not wrap — a heading too long for the page carries a hand-typed `\n`. So every
   * heading he left on one line has to measure inside the content width, and the one he broke has to
   * measure outside it. These four are taken verbatim from `~/Documents/AlbumEasy/PL`.
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

    // The one he broke by hand, with his own `\n` removed.
    const broken =
      "1950, 16 XII. Odbudowa Warszawy (do uiszczenia specjalnej opłaty za przesyłki w obrocie wewnętrznym).";
    assert.equal(
      wrapAlbumText(broken, CONTENT_MM, HEADING, HEADING_PT, albumTextMetrics).length,
      2,
      "he broke this one, so it must not fit"
    );
  });
});
