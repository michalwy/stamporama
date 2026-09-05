import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { ALBUM_FACES, ALBUM_FONT_FAMILIES, ALBUM_FONT_STYLES } from "../../src/lib/album-fonts";
import {
  ALBUM_FONT_DIR,
  loadAlbumFace,
  loadAlbumFontBytes,
  AlbumFontError,
} from "../../src/lib/album-font-bytes";

// The shipped faces, checked against the bytes on disk (#768).
//
// These are the tests the coverage question in #766 was left open for. It was recorded as an
// assumption rather than reasoned past — *Liberation's Latin Extended-A is safe, its Greek and
// Cyrillic are unverified* — and this is where the bytes land, so this is where it is settled.
//
// The set to check against is the **collection's whole language set** (#777), not its platform
// languages: an album carries its own language, and an album in a language nothing is sold in is
// exactly how a script nobody planned for reaches a printed card.

/**
 * One sample per language `COMMON_LANGUAGES` offers, written out as the letters that actually
 * distinguish that alphabet rather than as a sentence — a sentence tests whatever letters it
 * happens to contain.
 *
 * Greek is here although the picker does not list it: a language code is free text (`normalizeLanguage`
 * accepts any ISO 639-1), so `el` is reachable, and Greek is the script the #766 note named.
 */
const SAMPLES: Record<string, string> = {
  cs: "ČĎĚŇŘŠŤŮŽ čďěňřšťůž",
  da: "ÆØÅ æøå",
  de: "ÄÖÜẞ äöüß",
  en: "AZaz",
  es: "ÁÉÍÑÓÚÜ¿¡ áéíóúüñ",
  fi: "ÅÄÖ åäö",
  fr: "ÀÂÇÉÈÊËÎÏÔÙÛŸŒÆ àâçéèêëîïôùûÿœæ",
  hu: "ÁÉÍÓÖŐÚÜŰ áéíóöőúüű",
  it: "ÀÈÉÌÒÙ àèéìòù",
  nl: "ÉËÏÖÜ ĲĳÉëïöü",
  no: "ÆØÅ æøå",
  pl: "ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż",
  pt: "ÃÁÀÂÇÉÊÍÓÔÕÚ ãáàâçéêíóôõú",
  ro: "ĂÂÎȘȚ ăâîșț",
  ru: "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
  sk: "ĹĽŔŠŤŽÔ ĺľŕšťžô",
  sv: "ÅÄÖ åäö",
  uk: "ҐЄІЇ ґєії",
  el: "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ αβγδεζηθικλμνξοπρστυφχψως άέήίόύώϊϋΐΰ",
};

/** Marks an album page prints whatever the language: the en dash and the hyphen a page range can
 *  carry, the quotes a checklist name can, and the currency and multiplication signs a label can. */
const PUNCTUATION = "–—…«»„“”‘’·×€§";

function missing(faceId: string, sample: string): string[] {
  const font = loadAlbumFace(faceId);
  return [...sample].filter(
    (ch) => ch !== " " && !font.hasGlyphForCodePoint(ch.codePointAt(0)!)
  );
}

describe("the shipped album faces", () => {
  it("ships one file per face, and no file that is not a face", () => {
    const onDisk = readdirSync(ALBUM_FONT_DIR)
      .filter((f) => f.endsWith(".ttf"))
      .map((f) => f.replace(/\.ttf$/, ""))
      .sort();
    assert.deepEqual(onDisk, ALBUM_FACES.map((f) => f.id).sort());
    assert.equal(ALBUM_FACES.length, ALBUM_FONT_FAMILIES.length * ALBUM_FONT_STYLES.length);
  });

  it("opens every one of them", () => {
    for (const face of ALBUM_FACES) {
      const font = loadAlbumFace(face.id);
      assert.ok(font.unitsPerEm > 0, face.id);
      assert.ok(loadAlbumFontBytes(face.id).byteLength > 0, face.id);
    }
  });

  it("refuses a face this build does not ship rather than substituting one", () => {
    assert.throws(() => loadAlbumFontBytes("helvetica-neue"), AlbumFontError);
  });

  /**
   * #766's open question, answered from the bytes.
   *
   * Liberation Serif and Liberation Sans 2.1.5 descend from the croscore fonts and carry Greek and
   * Cyrillic in full — the gap the module recorded is closed, not worked around.
   */
  it("carries every language of the collection's set, in every family", () => {
    const gaps: string[] = [];
    for (const face of ALBUM_FACES) {
      for (const [code, sample] of Object.entries({ ...SAMPLES, punctuation: PUNCTUATION })) {
        const gone = missing(face.id, sample);
        if (gone.length) gaps.push(`${face.id} ${code}: ${gone.join("")}`);
      }
    }
    assert.deepEqual(gaps, KNOWN_GAPS);
  });
});

/**
 * The one gap in the shipped set, pinned rather than tolerated silently.
 *
 * Liberation Sans Narrow is not the 2.x line — it exists only as 1.07.5, which predates the
 * croscore merge and has no `ẞ` (U+1E9E, capital sharp s). Lowercase `ß` is there, so ordinary
 * German is fine and only an all-caps setting can reach it. It is listed here so that the day a
 * face is replaced, the diff says which coverage changed instead of the test simply staying green.
 */
const KNOWN_GAPS = [
  "liberation-sans-narrow de: ẞ",
  "liberation-sans-narrow-bold de: ẞ",
  "liberation-sans-narrow-italic de: ẞ",
  "liberation-sans-narrow-bold-italic de: ẞ",
];
