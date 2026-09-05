import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALBUM_BOX_LABEL_TOKENS,
  ALBUM_CHAPTER_TOKENS,
  ALBUM_CHECKLIST_TOKENS,
  ALBUM_FOOTER_TOKENS,
  ALBUM_PREVIEW_CONTEXT,
  AVAILABLE_TITLE_TOKENS,
  renderTitleTemplate,
  type TitleTemplateCopy,
} from "../../src/lib/offer-title-template";
import {
  DEFAULT_ALBUM_PRESET,
  albumHawidMargins,
  albumTemplateSummary,
  parseAlbumTemplateInput,
  type AlbumTemplateInput,
  type AlbumTemplateRawInput,
} from "../../src/lib/album-template-rules";
import { ALBUM_FACES, findAlbumFace, isAlbumFaceId } from "../../src/lib/album-fonts";
import { planHawidBox } from "../../src/lib/hawid";

// The album template (#766): the preset's parsing rules, the faces it may name, and the tokens its
// four texts are written over. All pure — no Prisma, no rendering.

// ── The shipped faces ────────────────────────────────────────────────────────

describe("album faces", () => {
  it("ships both families in all four styles, with unique ids", () => {
    const ids = ALBUM_FACES.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ALBUM_FACES.length, 24);
  });

  it("names a regular face by its family alone", () => {
    assert.equal(findAlbumFace("liberation-serif")?.label, "Liberation Serif");
    assert.equal(findAlbumFace("liberation-sans-bold-italic")?.label, "Liberation Sans Bold Italic");
  });

  it("ships the five faces the collector's existing pages are set in", () => {
    // Times New Roman / Times New Roman Bold / Arial / Arial Bold Italic / Arial Italic, as
    // Liberation's metric equivalents — the whole reason that family is in the set.
    for (const id of [
      "liberation-serif",
      "liberation-serif-bold",
      "liberation-sans",
      "liberation-sans-bold-italic",
      "liberation-sans-italic",
    ]) {
      assert.ok(isAlbumFaceId(id), `${id} should be shipped`);
    }
  });

  it("does not ship a monospaced face", () => {
    assert.ok(!ALBUM_FACES.some((f) => /mono/i.test(f.id)));
  });

  it("refuses a face this build does not have", () => {
    assert.equal(findAlbumFace("times-new-roman"), null);
    assert.equal(isAlbumFaceId("times-new-roman"), false);
  });
});

// ── Parsing ──────────────────────────────────────────────────────────────────

/** The default preset as the form submits it — every value a string. */
function rawDefaults(overrides: Partial<AlbumTemplateRawInput> = {}): AlbumTemplateRawInput {
  const raw = { name: "Polska A4" } as Record<string, string>;
  for (const [key, value] of Object.entries(DEFAULT_ALBUM_PRESET)) {
    // A checkbox submits "on" or nothing, never "false".
    raw[key] = typeof value === "boolean" ? (value ? "on" : "") : String(value);
  }
  return { ...(raw as AlbumTemplateRawInput), ...overrides };
}

function parsedOk(overrides: Partial<AlbumTemplateRawInput> = {}): AlbumTemplateInput {
  const result = parseAlbumTemplateInput(rawDefaults(overrides));
  assert.ok(result.ok, result.ok ? "" : result.message);
  return result.value;
}

function parseError(overrides: Partial<AlbumTemplateRawInput>): string {
  const result = parseAlbumTemplateInput(rawDefaults(overrides));
  assert.ok(!result.ok, "expected the parse to fail");
  return result.message;
}

describe("parseAlbumTemplateInput", () => {
  it("round-trips the defaults through the form", () => {
    const { name, ...preset } = parsedOk();
    assert.equal(name, "Polska A4");
    assert.deepEqual(preset, DEFAULT_ALBUM_PRESET);
  });

  it("requires a name", () => {
    assert.match(parseError({ name: "  " }), /Name is required/);
  });

  it("takes either decimal separator on a millimetre", () => {
    assert.equal(parsedOk({ verticalClearanceMm: "3,5" }).verticalClearanceMm, 3.5);
    assert.equal(parsedOk({ verticalClearanceMm: "3.5" }).verticalClearanceMm, 3.5);
  });

  it("refuses more precision than a tenth of a millimetre", () => {
    // The clearance is added to a stamp's height before a strip is chosen, and `hawid.ts` rounds to
    // a tenth: a hundredth here would be a figure the box rule cannot honour.
    assert.match(parseError({ horizontalMarginMm: "4.25" }), /at most one decimal place/);
  });

  it("refuses a font this build does not ship", () => {
    // The failure the fixed set exists to prevent: a face we cannot embed prints as something else.
    assert.match(parseError({ headingFace: "Arial Bold Italic" }), /not one this version ships/);
  });

  it("refuses fractional columns", () => {
    assert.match(parseError({ columns: "1.5" }), /whole number/);
  });

  it("refuses margins that leave no printable area", () => {
    assert.match(
      parseError({ pageWidthMm: "150", marginLeftMm: "90", marginRightMm: "90" }),
      /no printable area/
    );
  });

  it("reads an absent checkbox as off", () => {
    assert.equal(parsedOk({ printPhotos: "" }).printPhotos, false);
    assert.equal(parsedOk({ printPhotos: "on" }).printPhotos, true);
  });

  it("keeps an unrecognised token in a text rather than failing the save", () => {
    // A template has to be able to outlive a vocabulary change: an unknown token renders empty.
    assert.equal(parsedOk({ footerTemplate: "{notAToken}" }).footerTemplate, "{notAToken}");
  });

  it("accepts an empty text — a page with no footer is an ordinary thing to want", () => {
    assert.equal(parsedOk({ footerTemplate: "" }).footerTemplate, "");
  });
});

describe("the preset's defaults", () => {
  it("starts from the collector's own album geometry", () => {
    // `ALBUM_PAGES_SIZE (210.0 297.0)`, `ALBUM_PAGES_MARGINS (10.0 …)`,
    // `ALBUM_PAGES_SPACING (1.0 6.0)` and `STAMP_BOXES_SIZE_ADJUST(4)` on both axes.
    assert.equal(DEFAULT_ALBUM_PRESET.pageWidthMm, 210);
    assert.equal(DEFAULT_ALBUM_PRESET.pageHeightMm, 297);
    assert.equal(DEFAULT_ALBUM_PRESET.marginTopMm, 10);
    assert.equal(DEFAULT_ALBUM_PRESET.boxGapXMm, 1);
    assert.equal(DEFAULT_ALBUM_PRESET.boxGapYMm, 6);
    assert.equal(DEFAULT_ALBUM_PRESET.verticalClearanceMm, 4);
    assert.equal(DEFAULT_ALBUM_PRESET.horizontalMarginMm, 4);
  });

  it("names only faces it ships", () => {
    for (const face of [
      DEFAULT_ALBUM_PRESET.titleFace,
      DEFAULT_ALBUM_PRESET.chapterFace,
      DEFAULT_ALBUM_PRESET.headingFace,
      DEFAULT_ALBUM_PRESET.labelFace,
      DEFAULT_ALBUM_PRESET.footerFace,
    ]) {
      assert.ok(isAlbumFaceId(face), `${face} should be shipped`);
    }
  });

  it("hands the box rule its two clearances the right way round", () => {
    // The one place the template and #765 meet. A 20 × 25 mm stamp with 4 mm on both axes needs
    // 29 mm of strip height and cuts 24 mm wide.
    const box = planHawidBox({ widthMm: 20, heightMm: 25 }, albumHawidMargins(DEFAULT_ALBUM_PRESET), [
      { heightMm: 29, stockLengthMm: 210 },
    ]);
    assert.equal(box.widthMm, 24);
    assert.equal(box.heightMm, 29);
  });
});

describe("albumTemplateSummary", () => {
  it("says the page, the shape and the face that names it", () => {
    assert.equal(
      albumTemplateSummary(DEFAULT_ALBUM_PRESET),
      "210 × 297 mm · 1 column · Liberation Serif 26 pt"
    );
  });

  it("pluralises the columns", () => {
    assert.match(albumTemplateSummary({ ...DEFAULT_ALBUM_PRESET, columns: 2 }), /2 columns/);
  });
});

// ── The four text roles' vocabularies ────────────────────────────────────────

const tokensOf = (list: readonly { token: string }[]) => list.map((t) => t.token);

describe("album text vocabularies", () => {
  it("offers each role only what its own scope can answer", () => {
    // The reason these are four lists and not one: on an offer an unresolvable token is a puzzled
    // collector, here it is a printed gap on a card that is already in a binder.
    assert.ok(!tokensOf(ALBUM_CHAPTER_TOKENS).includes("{pageRange}"));
    assert.ok(!tokensOf(ALBUM_CHAPTER_TOKENS).includes("{checklistName}"));
    assert.ok(!tokensOf(ALBUM_FOOTER_TOKENS).includes("{checklistName}"));
    assert.ok(!tokensOf(ALBUM_CHECKLIST_TOKENS).includes("{pageRange}"));
    assert.ok(!tokensOf(ALBUM_BOX_LABEL_TOKENS).includes("{pageRange}"));
  });

  it("keeps a chapter heading to the year group it actually is", () => {
    // Not the issue: a year group holding one issue would then print a differently shaped heading
    // from one holding three, and nobody reading the finished run could tell why.
    assert.deepEqual(tokensOf(ALBUM_CHAPTER_TOKENS), ["{year}", "{area}"]);
  });

  it("keeps copy-level facts off a box label", () => {
    // A box is a place for a stamp, not a record of one that is owned.
    for (const token of ["{condition}", "{location}", "{ref}", "{itemNo}"]) {
      assert.ok(!tokensOf(ALBUM_BOX_LABEL_TOKENS).includes(token), `${token} should be absent`);
    }
  });

  it("draws the shared tokens from the shared vocabulary, not a copy of it", () => {
    const shared = AVAILABLE_TITLE_TOKENS.find((t) => t.token === "{year}");
    assert.ok(ALBUM_CHAPTER_TOKENS.includes(shared!));
  });
});

// ── {issueDate} ──────────────────────────────────────────────────────────────

const baseCopy: TitleTemplateCopy = {
  name: null,
  catalogNumbers: [],
  year: null,
  condition: null,
  conditionAbbr: null,
  certificate: null,
  certificateAbbr: null,
  area: null,
  location: null,
  ref: null,
  itemNo: null,
  itemNoPad: 5,
  issuedDate: null,
  subtype: null,
  denomination: null,
  perforation: null,
  color: null,
  watermark: null,
  paper: null,
  printing: null,
  issueName: null,
  issueYear: null,
  unknownVariant: false,
  variants: null,
  listedAs: null,
  format: null,
  formatAbbr: null,
};

const dated = (year: number, month: number | null = null, day: number | null = null) => ({
  ...baseCopy,
  year,
  issuedDate: { year, month, day },
});

describe("{issueDate}", () => {
  it("prints a Roman month by default, as the collector's own headings do", () => {
    assert.equal(renderTitleTemplate("{issueDate}", [dated(1952, 7, 22)]), "22 VII");
  });

  it("reproduces a whole checklist heading", () => {
    const copy = { ...dated(1952, 7, 22) };
    assert.equal(
      renderTitleTemplate("{year}, {issueDate}. {checklistName}", [copy], {
        checklistName: "Uchwalenie Konstytucji PRL",
      }),
      "1952, 22 VII. Uchwalenie Konstytucji PRL"
    );
  });

  it("takes a format argument", () => {
    const copy = dated(1952, 7, 22);
    assert.equal(renderTitleTemplate("{issueDate:roman}", [copy]), "22 VII");
    assert.equal(renderTitleTemplate("{issueDate:numeric}", [copy]), "22.07");
    assert.equal(renderTitleTemplate("{issueDate:iso}", [copy]), "1952-07-22");
  });

  it("shortens as precision runs out", () => {
    assert.equal(renderTitleTemplate("{issueDate}", [dated(1952, 7)]), "VII");
    assert.equal(renderTitleTemplate("{issueDate:numeric}", [dated(1952, 7)]), "07");
    assert.equal(renderTitleTemplate("{issueDate:iso}", [dated(1952, 7)]), "1952-07");
    assert.equal(renderTitleTemplate("{issueDate:iso}", [dated(1952)]), "1952");
    // Roman and numeric carry no year at all, so a year-only stamp has nothing to print.
    assert.equal(renderTitleTemplate("{issueDate}", [dated(1952)]), "");
  });

  it("takes the earliest date in scope", () => {
    const copies = [dated(1952, 8, 18), dated(1952, 7, 22), dated(1952, 10, 25)];
    assert.equal(renderTitleTemplate("{issueDate}", copies), "22 VII");
  });

  it("does not read a vaguer date as an earlier one", () => {
    // A stamp stating only its year is less precisely dated than one stating a day in that year,
    // not dated before it.
    assert.equal(renderTitleTemplate("{issueDate}", [dated(1952), dated(1952, 7, 22)]), "22 VII");
    assert.equal(renderTitleTemplate("{issueDate}", [dated(1952, 7), dated(1952, 7, 22)]), "22 VII");
  });

  it("renders empty when nothing in scope is dated, taking its glue with it", () => {
    assert.equal(renderTitleTemplate("{issueDate}", [baseCopy]), "");
    assert.equal(
      renderTitleTemplate("{year}, {issueDate}. {checklistName}", [{ ...baseCopy, year: 1952 }], {
        checklistName: "Wydanie obiegowe",
      }),
      "1952. Wydanie obiegowe"
    );
  });
});

// ── The album's container tokens ─────────────────────────────────────────────

describe("the album's container tokens", () => {
  it("resolve from the context, like {offerUrl} does", () => {
    assert.equal(
      renderTitleTemplate("{pageRange}", [baseCopy], ALBUM_PREVIEW_CONTEXT),
      "PL 303-309"
    );
    assert.equal(
      renderTitleTemplate("{albumName}", [baseCopy], ALBUM_PREVIEW_CONTEXT),
      "Polska Ludowa"
    );
  });

  it("render empty rather than as literal braces where there is no album", () => {
    assert.equal(renderTitleTemplate("{pageRange}", [baseCopy]), "");
    assert.equal(renderTitleTemplate("{checklistName}", [baseCopy]), "");
  });

  it("uses the same examples in the legend as in a preview", () => {
    // A collector reading the chip and a collector reading the preview must see one string.
    const pageRange = ALBUM_FOOTER_TOKENS.find((t) => t.token === "{pageRange}");
    assert.equal(pageRange?.example, ALBUM_PREVIEW_CONTEXT.pageRange);
  });
});

// ── The bare catalog number a box label defaults to ──────────────────────────

describe("the default box label", () => {
  it("is the bare catalogue number", () => {
    // `{catalog::}` — empty vendor list means the area's primary catalogue, empty flags mean no
    // prefixes. An album page is already one area and one catalogue.
    const copy: TitleTemplateCopy = {
      ...baseCopy,
      catalogNumbers: [
        { vendorId: "v1", vendorAbbr: "Mi", areaPrefix: "PL", number: "303", isPrimary: true },
      ],
    };
    assert.equal(renderTitleTemplate(DEFAULT_ALBUM_PRESET.boxLabelTemplate, [copy]), "303");
    // And the prefixed form is still one token away, for an album that wants it.
    assert.equal(renderTitleTemplate("{catalog}", [copy]), "Mi·PL 303");
  });
});
