import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseAlbumPageSelection,
  albumPdfFileName,
  AlbumPageSelectionError,
  albumYearAloneName,
  albumYearSheetApart,
} from "../../src/lib/album-print-rules";

describe("parseAlbumPageSelection", () => {
  it("takes the whole album when nothing is asked for", () => {
    assert.deepEqual(parseAlbumPageSelection(null, 3), [0, 1, 2]);
    assert.deepEqual(parseAlbumPageSelection("  ", 2), [0, 1]);
    assert.deepEqual(parseAlbumPageSelection(undefined, 0), []);
  });

  it("reads one sheet, a range, and a list of both — one-based in, zero-based out", () => {
    assert.deepEqual(parseAlbumPageSelection("3", 5), [2]);
    assert.deepEqual(parseAlbumPageSelection("2-4", 5), [1, 2, 3]);
    assert.deepEqual(parseAlbumPageSelection("1, 4-5", 5), [0, 3, 4]);
  });

  it("normalises, so two ways of asking for the same sheets give the same file", () => {
    assert.deepEqual(parseAlbumPageSelection("5,3,3-4", 5), parseAlbumPageSelection("3-5", 5));
    assert.deepEqual(parseAlbumPageSelection("4-2", 5), [1, 2, 3], "a reversed range reads one way");
  });

  it("refuses a sheet the album does not have, saying what it does have", () => {
    assert.throws(() => parseAlbumPageSelection("9", 5), (err: Error) => {
      assert.ok(err instanceof AlbumPageSelectionError);
      assert.match(err.message, /sheets 1 to 5/);
      return true;
    });
    assert.throws(() => parseAlbumPageSelection("0", 5), AlbumPageSelectionError);
    assert.throws(() => parseAlbumPageSelection("1", 0), /no sheets to print/);
  });

  it("refuses text that is not a sheet number", () => {
    assert.throws(() => parseAlbumPageSelection("PL 303-309", 5), AlbumPageSelectionError);
    assert.throws(() => parseAlbumPageSelection("-2", 5), AlbumPageSelectionError);
  });
});

describe("albumPdfFileName", () => {
  it("names the album when the file is all of it", () => {
    assert.equal(albumPdfFileName("Polska", 4, [0, 1, 2, 3]), "Polska.pdf");
  });

  it("names the sheets when it is not, so two reprints do not collide", () => {
    assert.equal(albumPdfFileName("Polska", 4, [2]), "Polska sheet 3.pdf");
    assert.equal(albumPdfFileName("Polska", 4, [1, 2]), "Polska sheets 2-3.pdf");
  });

  it("keeps letters of any alphabet and drops what a filesystem would not", () => {
    assert.equal(albumPdfFileName("Deutschland 1949–1990", 1, [0]), "Deutschland 1949 1990.pdf");
    assert.equal(albumPdfFileName("Україна", 1, [0]), "Україна.pdf");
    assert.equal(albumPdfFileName("  /  ", 1, [0]), "Album.pdf");
  });
});

describe("a year alone on its sheet (#1498)", () => {
  const sheet = (chapterKey: string, yearAlone = false, live = true) => ({ chapterKey, live, yearAlone });

  it("is named by its year, having no range", () => {
    assert.equal(albumYearAloneName("1950"), "The 1950 heading, on its own");
    assert.equal(albumYearAloneName(""), "The chapter heading, on its own");
  });

  it("is said to be left behind when the run straight after it is marked", () => {
    const pages = [sheet("1950", true), sheet("1950"), sheet("1950")];
    assert.equal(albumYearSheetApart(pages, [2, 3]), 1);
  });

  it("is not said for a run it is not straight ahead of, or of another chapter", () => {
    assert.equal(albumYearSheetApart([sheet("1950", true), sheet("1950"), sheet("1950")], [3]), null);
    assert.equal(albumYearSheetApart([sheet("1949", true), sheet("1950")], [2]), null);
  });

  it("is not said once the year's sheet is itself a card", () => {
    assert.equal(albumYearSheetApart([sheet("1950", true, false), sheet("1950")], [2]), null);
  });

  it("is not said for the first sheet, or for a card's empty run", () => {
    assert.equal(albumYearSheetApart([sheet("1950")], [1]), null);
    assert.equal(albumYearSheetApart([sheet("1950", true), sheet("1950")], []), null);
  });
});
