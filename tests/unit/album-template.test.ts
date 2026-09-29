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
  albumTemplateSummaryRows,
  parseAlbumBoxGaps,
  parseAlbumRenderPreset,
  parseAlbumTemplateInput,
  readAlbumPresetFields,
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

  it("refuses a fractional band ceiling", () => {
    assert.match(parseError({ blocksPerBand: "1.5" }), /whole number/);
  });

  it("refuses margins that leave no printable area", () => {
    assert.match(
      parseError({ pageWidthMm: "150", marginLeftMm: "90", marginRightMm: "90" }),
      /no printable area/
    );
  });

  it("reads each vertical placement and refuses a word it does not know (#1419)", () => {
    for (const placement of ["top", "center", "justify", "center-justify"] as const) {
      assert.equal(parsedOk({ verticalPlacement: placement }).verticalPlacement, placement);
    }
    assert.match(parseError({ verticalPlacement: "bottom" }), /Vertical placement is not a recognised/);
  });

  it("reads the gap between a box and its label, from nothing up to the other spacings' ceiling (#1420)", () => {
    assert.equal(parsedOk({ labelGapMm: "1,5" }).labelGapMm, 1.5);
    assert.equal(parsedOk({ labelGapMm: "0" }).labelGapMm, 0);
    assert.match(parseError({ labelGapMm: "-1" }), /Space between a box and its label/);
    assert.match(parseError({ labelGapMm: "100.5" }), /Space between a box and its label/);
    assert.match(parseError({ labelGapMm: "" }), /Space between a box and its label is required/);
  });

  it("reads the frame's gap, ornament and ornament size (#1427)", () => {
    assert.equal(parsedOk({ borderGapMm: "2,5" }).borderGapMm, 2.5);
    assert.match(parseError({ borderGapMm: "-1" }), /Gap between the rules/);
    for (const key of ["none", "rosette", "vine", "art-deco", "square", "cmg1x2y3z4a5b6c7d8e9f0g1h"]) {
      assert.equal(parsedOk({ frameOrnament: key }).frameOrnament, key);
    }
    // Blank is no ornament, the value a form that never rendered the field would send.
    assert.equal(parsedOk({ frameOrnament: "" }).frameOrnament, "none");
    assert.match(parseError({ frameOrnament: "Classic.png" }), /Corner ornament is not a recognised/);
    assert.equal(parsedOk({ frameOrnamentSizeMm: "12.5" }).frameOrnamentSizeMm, 12.5);
    assert.match(parseError({ frameOrnamentSizeMm: "0" }), /Ornament size/);
    assert.match(parseError({ frameOrnamentSizeMm: "101" }), /Ornament size/);
  });

  it("reads where the album title sits and the gap around it in the frame line (#1428)", () => {
    for (const placement of ["below-frame", "in-frame"] as const) {
      assert.equal(parsedOk({ titlePlacement: placement }).titlePlacement, placement);
    }
    assert.match(parseError({ titlePlacement: "above" }), /Album title placement is not a recognised/);
    assert.equal(parsedOk({ titleFrameGapMm: "2,5" }).titleFrameGapMm, 2.5);
    assert.equal(parsedOk({ titleFrameGapMm: "0" }).titleFrameGapMm, 0);
    assert.match(parseError({ titleFrameGapMm: "-1" }), /Gap around the title in the frame line/);
    assert.match(parseError({ titleFrameGapMm: "" }), /Gap around the title in the frame line/);
  });

  it("reads where the footer sits, its offset from the frame and the gap around it in the line (#1457)", () => {
    for (const placement of ["inside-frame", "in-frame", "below-frame"] as const) {
      assert.equal(parsedOk({ footerPlacement: placement }).footerPlacement, placement);
    }
    assert.match(parseError({ footerPlacement: "above" }), /Footer placement is not a recognised/);
    assert.equal(parsedOk({ footerOffsetMm: "1,5" }).footerOffsetMm, 1.5);
    assert.equal(parsedOk({ footerOffsetMm: "0" }).footerOffsetMm, 0);
    assert.match(parseError({ footerOffsetMm: "-1" }), /Footer offset from the frame/);
    assert.match(parseError({ footerOffsetMm: "" }), /Footer offset from the frame/);
    assert.equal(parsedOk({ footerFrameGapMm: "3" }).footerFrameGapMm, 3);
    assert.match(parseError({ footerFrameGapMm: "-1" }), /Gap around the footer in the frame line/);
  });

  it("starts a new template with his Classic frame's shape: a double rule and a 25 mm corner (#1427)", () => {
    assert.equal(DEFAULT_ALBUM_PRESET.borderStyle, "double");
    assert.equal(DEFAULT_ALBUM_PRESET.borderGapMm, 1.2);
    assert.equal(DEFAULT_ALBUM_PRESET.frameOrnament, "rosette");
    assert.equal(DEFAULT_ALBUM_PRESET.frameOrnamentSizeMm, 25);
  });

  it("reads the space around the album title and the chapter heading as ordinary spacing (#1426)", () => {
    const fields = [
      ["titleSpaceAboveMm", /Space above the album title/],
      ["titleSpaceBelowMm", /Space below the album title/],
      ["chapterSpaceAboveMm", /Space above a chapter heading/],
      ["chapterSpaceBelowMm", /Space below a chapter heading/],
    ] as const;
    for (const [key, name] of fields) {
      assert.equal(parsedOk({ [key]: "2,5" })[key], 2.5);
      assert.equal(parsedOk({ [key]: "0" })[key], 0);
      assert.match(parseError({ [key]: "-1" }), name);
      assert.match(parseError({ [key]: "100.5" }), name);
      assert.match(parseError({ [key]: "" }), name);
    }
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

// An album's own values (#1215) have no name and go through the template's rules, not a copy of them.
describe("parseAlbumRenderPreset", () => {
  it("parses the preset without asking for a name", () => {
    const { name: _name, ...raw } = rawDefaults({ name: "" });
    void _name;
    const result = parseAlbumRenderPreset(raw);
    assert.ok(result.ok, result.ok ? "" : result.message);
    assert.deepEqual(result.value, DEFAULT_ALBUM_PRESET);
    assert.equal("name" in result.value, false);
  });

  it("refuses exactly what a template refuses", () => {
    const result = parseAlbumRenderPreset(rawDefaults({ marginLeftMm: "150", marginRightMm: "150" }));
    assert.ok(!result.ok);
    assert.match(result.message, /between 0 and 100/);
  });
});

// The page editor's two gaps (#836) are the preset's own rule, not a second statement of it.
describe("parseAlbumBoxGaps", () => {
  it("reads a comma as a decimal point, the way every millimetre field here does", () => {
    const result = parseAlbumBoxGaps({ boxGapXMm: "2,5", boxGapYMm: "0" });
    assert.ok(result.ok, result.ok ? "" : result.message);
    assert.deepEqual(result.value, { boxGapXMm: 2.5, boxGapYMm: 0 });
  });

  it("refuses a blank, a negative gap and one past the bound, naming the field", () => {
    const blank = parseAlbumBoxGaps({ boxGapXMm: "", boxGapYMm: "6" });
    assert.ok(!blank.ok);
    assert.match(blank.message, /^Horizontal spacing is required/);
    const negative = parseAlbumBoxGaps({ boxGapXMm: "1", boxGapYMm: "-1" });
    assert.ok(!negative.ok);
    assert.match(negative.message, /^Vertical spacing/);
    const wide = parseAlbumBoxGaps({ boxGapXMm: "101", boxGapYMm: "6" });
    assert.ok(!wide.ok);
    assert.match(wide.message, /between 0 and 100/);
  });

  it("is what the whole preset parser refuses a gap with", () => {
    const alone = parseAlbumBoxGaps({ boxGapXMm: "1", boxGapYMm: "100.5" });
    const whole = parseAlbumRenderPreset(rawDefaults({ boxGapYMm: "100.5" }));
    assert.ok(!alone.ok && !whole.ok);
    assert.equal(whole.message, alone.message);
  });
});

describe("readAlbumPresetFields", () => {
  it("reads every preset field off a form, and nothing else", () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(rawDefaults({ name: "Polska A4" }))) {
      if (value !== "") form.set(key, value);
    }
    const raw = readAlbumPresetFields(form);
    assert.deepEqual(Object.keys(raw).sort(), Object.keys(DEFAULT_ALBUM_PRESET).sort());
    const parsed = parseAlbumRenderPreset(raw);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.message);
    assert.deepEqual(parsed.value, DEFAULT_ALBUM_PRESET);
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
    // 29 mm of strip, which the 25 mm packet supplies — 29 mm of hawid — and cuts 24 mm wide.
    const box = planHawidBox({ widthMm: 20, heightMm: 25 }, albumHawidMargins(DEFAULT_ALBUM_PRESET), [
      { heightMm: 25, totalHeightMm: 29, stockLengthMm: 210 },
    ]);
    assert.equal(box.widthMm, 24);
    assert.equal(box.heightMm, 29);
  });
});

describe("albumTemplateSummary", () => {
  it("says the page, the shape and the face that names it", () => {
    assert.equal(
      albumTemplateSummary(DEFAULT_ALBUM_PRESET),
      "210 × 297 mm · up to 2 blocks per band · Liberation Serif 26 pt"
    );
  });

  it("says so when a template never pairs two checklists in a band", () => {
    assert.match(
      albumTemplateSummary({ ...DEFAULT_ALBUM_PRESET, blocksPerBand: 1 }),
      /one block per band/
    );
  });
});

describe("albumTemplateSummaryRows (#1474)", () => {
  const value = (preset: typeof DEFAULT_ALBUM_PRESET, label: string) =>
    albumTemplateSummaryRows(preset).find((r) => r.label === label)?.value;

  it("states the main values beside the preview, a handful rather than thirty", () => {
    assert.deepEqual(
      albumTemplateSummaryRows(DEFAULT_ALBUM_PRESET).map((r) => r.label),
      ["Page", "Margins", "Frame", "Per band", "Album title", "Box labels", "Photos"]
    );
    assert.equal(value(DEFAULT_ALBUM_PRESET, "Page"), "210 × 297 mm");
  });

  it("gives equal margins once and unequal ones side by side", () => {
    const equal = { ...DEFAULT_ALBUM_PRESET, marginTopMm: 10, marginRightMm: 10, marginBottomMm: 10, marginLeftMm: 10 };
    assert.equal(value(equal, "Margins"), "10 mm");
    assert.equal(
      value({ ...equal, marginLeftMm: 20 }, "Margins"),
      "top 10 · right 10 · bottom 10 · left 20 mm"
    );
  });

  it("names the frame's rules and its ornaments, either of which may be absent", () => {
    const frame = (borderStyle: "none" | "single" | "double", frameOrnament: string) =>
      value({ ...DEFAULT_ALBUM_PRESET, borderStyle, frameOrnament, frameOrnamentSizeMm: 25 }, "Frame");
    assert.equal(frame("double", "none"), "Double rule");
    assert.equal(frame("single", "rosette"), "Single rule, corner ornaments");
    assert.equal(frame("none", "rosette"), "Corner ornaments");
    assert.equal(frame("none", "none"), "None");
  });

  it("says whether photos print, and how strongly", () => {
    assert.equal(value({ ...DEFAULT_ALBUM_PRESET, printPhotos: false }, "Photos"), "Not printed");
    assert.equal(
      value({ ...DEFAULT_ALBUM_PRESET, printPhotos: true, photoOpacityPercent: 30 }, "Photos"),
      "Printed at 30%"
    );
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
