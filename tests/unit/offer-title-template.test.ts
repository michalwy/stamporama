import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderTitleTemplate,
  renderTitleTemplateSegments,
  titleFallbackTokens,
  titleFallbacks,
  DEFAULT_TITLE_TEMPLATE,
  AVAILABLE_TITLE_TOKENS,
  type TitleTemplateCopy,
  type TitleCatalogNumber,
  type TitleFallback,
} from "../../src/lib/offer-title-template";
import type { TranslatableEntity } from "../../src/lib/translations";

/** A fallen-back field of a test copy (#298/#299). The entity behind it defaults to a row named
 * after the field, which is all most assertions care about; `over` names a specific one where the
 * test is about *which* entity a gap points at. */
function fb(field: string, over: Partial<TitleFallback> = {}): TitleFallback {
  const entityByField: Record<string, { type: TranslatableEntity; field: string }> = {
    name: { type: "stamp", field: "name" },
    condition: { type: "condition", field: "name" },
    conditionAbbr: { type: "condition", field: "abbreviation" },
    certificate: { type: "certificateStatus", field: "name" },
    certificateAbbr: { type: "certificateStatus", field: "abbreviation" },
    area: { type: "area", field: "titleName" },
    issueName: { type: "issue", field: "name" },
    subtype: { type: "subtype", field: "name" },
  };
  const entity = entityByField[field];
  return {
    field,
    entityType: entity.type,
    entityId: `${entity.type}-1`,
    entityField: entity.field,
    defaultValue: field,
    ...over,
  };
}

/** Build one catalog number for a test copy. */
function cn(
  vendorAbbr: string,
  number: string,
  opts: { areaPrefix?: string | null; isPrimary?: boolean } = {}
): TitleCatalogNumber {
  return {
    vendorId: vendorAbbr.toLowerCase(),
    vendorAbbr,
    number,
    areaPrefix: opts.areaPrefix ?? null,
    isPrimary: opts.isPrimary ?? false,
  };
}

function copy(over: Partial<TitleTemplateCopy> = {}): TitleTemplateCopy {
  return {
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
    subtype: null,
    format: null,
    formatAbbr: null,
    issueName: null,
    issueYear: null,
    ...over,
  };
}

/** A copy carrying a primary Michel (with a PL area prefix) and a secondary Scott (no prefix). */
function michelScott(over: Partial<TitleTemplateCopy> = {}): TitleTemplateCopy {
  return copy({
    catalogNumbers: [
      cn("Mi", "200", { areaPrefix: "PL", isPrimary: true }),
      cn("Sc", "150"),
    ],
    ...over,
  });
}

describe("renderTitleTemplate — single copy", () => {
  it("resolves every token", () => {
    const c = copy({
      name: "Mercury",
      catalogNumbers: [cn("Mi", "200", { areaPrefix: "PL", isPrimary: true })],
      year: 1850,
      condition: "MNH",
      certificate: "Photo cert.",
      area: "Austria",
    });
    assert.equal(
      renderTitleTemplate("{catalog} {name} {year} {condition} {certificate} {area}", [c]),
      "Mi·PL 200 Mercury 1850 MNH Photo cert. Austria"
    );
  });

  it("keeps literal text between tokens", () => {
    const c = copy({ name: "Mercury", condition: "MNH", year: 1850 });
    assert.equal(renderTitleTemplate("{name} — {condition} ({year})", [c]), "Mercury — MNH (1850)");
  });

  it("is case-insensitive on token names", () => {
    assert.equal(renderTitleTemplate("{NAME}", [copy({ name: "Mercury" })]), "Mercury");
  });
});

describe("renderTitleTemplate — {catalog} options", () => {
  it("defaults to the primary vendor with both prefixes", () => {
    assert.equal(renderTitleTemplate("{catalog}", [michelScott()]), "Mi·PL 200");
  });

  it("selects a specific vendor by abbreviation (case-insensitive)", () => {
    assert.equal(renderTitleTemplate("{catalog:Sc}", [michelScott()]), "Sc 150");
    assert.equal(renderTitleTemplate("{catalog:mi:vendor}", [michelScott()]), "Mi 200");
  });

  it("shows the requested prefixes via the flags segment", () => {
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", [michelScott()]), "Mi 200");
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor,area}", [michelScott()]), "Mi·PL 200");
    assert.equal(renderTitleTemplate("{catalog:Mi:area}", [michelScott()]), "PL 200");
  });

  it("accepts short flag forms v and a", () => {
    assert.equal(renderTitleTemplate("{catalog:Mi:v}", [michelScott()]), "Mi 200");
    assert.equal(renderTitleTemplate("{catalog:Mi:v,a}", [michelScott()]), "Mi·PL 200");
    assert.equal(renderTitleTemplate("{catalog:Mi:a}", [michelScott()]), "PL 200");
  });

  it("an empty flags segment means the bare number", () => {
    assert.equal(renderTitleTemplate("{catalog:Mi:}", [michelScott()]), "200");
    assert.equal(renderTitleTemplate("{catalog::}", [michelScott()]), "200"); // primary, bare
  });

  it("drops the area part when the vendor has no area prefix", () => {
    assert.equal(renderTitleTemplate("{catalog:Sc:vendor,area}", [michelScott()]), "Sc 150");
  });

  it("shows all vendors with *", () => {
    assert.equal(renderTitleTemplate("{catalog:*:vendor}", [michelScott()]), "Mi 200 / Sc 150");
    assert.equal(renderTitleTemplate("{catalog:*}", [michelScott()]), "Mi·PL 200 / Sc 150");
  });

  it("picks several named vendors in the requested order", () => {
    assert.equal(renderTitleTemplate("{catalog:Sc,Mi:vendor}", [michelScott()]), "Sc 150 / Mi 200");
  });

  it("renders empty for an unknown vendor", () => {
    assert.equal(renderTitleTemplate("{catalog:XX}", [michelScott()]), "");
  });

  it("compacts consecutive numbers of the same vendor into a range", () => {
    const a = copy({ catalogNumbers: [cn("Mi", "1", { areaPrefix: "DR", isPrimary: true })] });
    const b = copy({ catalogNumbers: [cn("Mi", "2", { areaPrefix: "DR", isPrimary: true })] });
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor,area}", [a, b]), "Mi·DR 1-2");
  });

  it("compacts non-consecutive numbers into ranges + singles", () => {
    const nums = [1, 2, 4, 6, 7, 8, 9, 10].map((n) =>
      copy({ catalogNumbers: [cn("Mi", String(n), { areaPrefix: "DR", isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor,area}", nums), "Mi·DR 1-2,4,6-10");
  });

  it("sorts and dedupes before compacting", () => {
    const nums = [3, 1, 2, 2].map((n) => copy({ catalogNumbers: [cn("Mi", String(n), { isPrimary: true })] }));
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi 1-3");
  });

  it("keeps a differently-suffixed number out of the plain-integer range", () => {
    const nums = [
      copy({ catalogNumbers: [cn("Mi", "1", { isPrimary: true })] }),
      copy({ catalogNumbers: [cn("Mi", "2", { isPrimary: true })] }),
      copy({ catalogNumbers: [cn("Mi", "5a", { isPrimary: true })] }),
    ];
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi 1-2,5a");
  });

  it("collapses a prefixed family, writing the shared prefix once (#286)", () => {
    const nums = ["BL31", "BL32", "BL33"].map((n) =>
      copy({ catalogNumbers: [cn("Fi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Fi:vendor}", nums), "Fi BL31-33");
  });

  it("writes a shared suffix once around the collapsed span", () => {
    const nums = ["40A", "41A", "42A"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi 40-42A");
  });

  it("collapses each vendor independently when another vendor cannot fold (#286)", () => {
    const rows: [string, string, string][] = [
      ["BL31", "1294CKB", "BF28"],
      ["BL32", "1295CKB", "BF29"],
      ["BL33", "1296KB", "BF30"],
    ];
    const copies = rows.map(([fi, mi, yt]) =>
      copy({
        catalogNumbers: [cn("Fi", fi, { isPrimary: true }), cn("Mi", mi), cn("Yt", yt)],
      })
    );
    assert.equal(
      renderTitleTemplate("{catalog:*:vendor}", copies),
      // The Michel span's end drops the digits it shares with its start (#400).
      "Fi BL31-33 / Mi 1294-95CKB,1296KB / Yt BF28-30"
    );
  });

  it("shortens a collapsed span's end to the digits that differ (#400)", () => {
    const nums = ["1298", "1299", "1300", "1301", "1302"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi 1298-302");
  });

  it("collapses a same-base letter-suffix run, writing the suffix twice (#364)", () => {
    const nums = ["BL92a", "BL92b"].map((n) =>
      copy({ catalogNumbers: [cn("Fi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Fi:vendor}", nums), "Fi BL92a-b");
  });

  it("collapses a Roman-numeral suffix run (#364)", () => {
    const nums = ["12I", "12II", "12III"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi 12I-III");
  });

  it("keeps a gap in a suffix run apart (#364)", () => {
    const nums = ["92a", "92c"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi 92a,92c");
  });

  it("does not fold suffixes across different bases (#364)", () => {
    const nums = ["92a", "93b"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi 92a,93b");
  });

  it("does not fold suffixes over an already collapsed base span (#364)", () => {
    const nums = ["31a", "32a", "31b", "32b"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi 31-32a,31-32b");
  });

  it("collapses both axes in one group, each vendor its own way (#364)", () => {
    const rows: [string, string][] = [
      ["BL92a", "BL57"],
      ["BL92b", "BL58"],
    ];
    const copies = rows.map(([fi, mi]) =>
      copy({ catalogNumbers: [cn("Fi", fi, { isPrimary: true }), cn("Mi", mi)] })
    );
    assert.equal(renderTitleTemplate("{catalog:*:vendor}", copies), "Fi BL92a-b / Mi BL57-58");
  });

  it("collapses a bare Roman-numeral run (#384)", () => {
    const nums = ["I", "II", "III"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi I-III");
  });

  it("keeps a gap in a bare Roman run apart (#384)", () => {
    const nums = ["I", "II", "V"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi I-II,V");
  });

  it("collapses a Roman-numeral run under a constant letter suffix (#426)", () => {
    const nums = ["IA", "IIA", "IIIA", "IVA", "VA", "VIA", "VIIA", "VIIIA"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi IA-VIIIA");
  });

  it("keeps two letter suffixes over one numeral run apart (#426)", () => {
    const nums = ["IA", "IIA", "IB", "IIB"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi IA-IIA,IB-IIB");
  });

  it("folds the suffix on one numeral when the numeral stayed single (#426)", () => {
    const nums = ["Ia", "Ib", "Ic"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi Ia-c");
  });

  it("never folds a bare numeral into a digit-bearing number (#384)", () => {
    const nums = ["1", "2", "I", "II"].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi 1-2,I-II");
  });

  it("keeps each vendor's bare numerals to itself (#384)", () => {
    const a = copy({ catalogNumbers: [cn("Mi", "I", { isPrimary: true }), cn("Sc", "III")] });
    const b = copy({ catalogNumbers: [cn("Mi", "II", { isPrimary: true }), cn("Sc", "IV")] });
    assert.equal(renderTitleTemplate("{catalog:*:vendor}", [a, b]), "Mi I-II / Sc III-IV");
  });

  it("keeps a number with no digits verbatim after the ranges", () => {
    const nums = ["1", "2", "Ark."].map((n) =>
      copy({ catalogNumbers: [cn("Mi", n, { isPrimary: true })] })
    );
    assert.equal(renderTitleTemplate("{catalog:Mi:vendor}", nums), "Mi 1-2,Ark.");
  });

  it("groups each vendor separately when showing all", () => {
    const a = copy({ catalogNumbers: [cn("Mi", "1", { isPrimary: true }), cn("Sc", "10")] });
    const b = copy({ catalogNumbers: [cn("Mi", "2", { isPrimary: true }), cn("Sc", "11")] });
    assert.equal(renderTitleTemplate("{catalog:*:vendor}", [a, b]), "Mi 1-2 / Sc 10-11");
  });
});

describe("renderTitleTemplate — empty tokens are tidied", () => {
  it("drops empty parens and collapses whitespace", () => {
    const c = copy({ catalogNumbers: [cn("Mi", "200", { areaPrefix: "PL", isPrimary: true })], name: "Mercury" }); // no year
    assert.equal(renderTitleTemplate("{catalog} {name} ({year})", [c]), "Mi·PL 200 Mercury");
  });

  it("strips a stray dash around a gap", () => {
    const c = copy({ name: "Mercury" }); // no catalog
    assert.equal(renderTitleTemplate("{catalog} - {name}", [c]), "Mercury");
  });

  it("keeps a literal dash between two present values", () => {
    const c = copy({ name: "Mercury", condition: "MNH" });
    assert.equal(renderTitleTemplate("{name} - {condition}", [c]), "Mercury - MNH");
  });

  it("keeps other literal separators between present values", () => {
    const c = copy({ name: "Mercury", condition: "MNH" });
    assert.equal(renderTitleTemplate("{name} · {condition}", [c]), "Mercury · MNH");
    assert.equal(renderTitleTemplate("{name}, {condition}", [c]), "Mercury, MNH");
  });

  it("returns empty when nothing resolves", () => {
    assert.equal(renderTitleTemplate("{catalog} {name}", [copy()]), "");
    assert.equal(renderTitleTemplate("{catalog}", []), "");
  });
});

describe("renderTitleTemplate — multiple copies", () => {
  it("joins distinct values in first-seen order", () => {
    const copies = [copy({ name: "Mercury" }), copy({ name: "Ceres" })];
    assert.equal(renderTitleTemplate("{name}", copies), "Mercury / Ceres");
  });

  it("dedupes repeated values", () => {
    const copies = [copy({ condition: "MNH" }), copy({ condition: "MNH" })];
    assert.equal(renderTitleTemplate("{condition}", copies), "MNH");
  });

  it("collapses years to a min–max span", () => {
    const copies = [copy({ year: 1867 }), copy({ year: 1850 }), copy({ year: 1860 })];
    assert.equal(renderTitleTemplate("{year}", copies), "1850–1867");
  });

  it("shows a single year when all copies share it", () => {
    const copies = [copy({ year: 1850 }), copy({ year: 1850 })];
    assert.equal(renderTitleTemplate("{year}", copies), "1850");
  });
});

describe("renderTitleTemplate — fallbacks & unknown tokens", () => {
  it("uses the default template when none given", () => {
    const c = copy({
      catalogNumbers: [cn("Mi", "200", { areaPrefix: "PL", isPrimary: true })],
      name: "Mercury",
      year: 1850,
      condition: "MNH",
    });
    assert.equal(renderTitleTemplate("", [c]), renderTitleTemplate(DEFAULT_TITLE_TEMPLATE, [c]));
    assert.equal(renderTitleTemplate(null, [c]), "Mi·PL 200 Mercury 1850 MNH");
  });

  it("leaves an unknown token literal so the typo is visible", () => {
    assert.equal(renderTitleTemplate("{name} {bogus}", [copy({ name: "Mercury" })]), "Mercury {bogus}");
  });
});

describe("renderTitleTemplate — fallback groups {a|b|c}", () => {
  it("renders the first non-empty token", () => {
    const c = copy({ name: "Mercury" }); // no issueName
    assert.equal(renderTitleTemplate("{issueName|name|year}", [c]), "Mercury");
  });

  it("falls through to a later alternative when earlier ones are empty", () => {
    const c = copy({ year: 1850 }); // no issueName, no name
    assert.equal(renderTitleTemplate("{issueName|name|year}", [c]), "1850");
  });

  it("works with a parameterised catalog alternative", () => {
    const c = copy({ catalogNumbers: [cn("Mi", "200", { isPrimary: true })] }); // no name
    assert.equal(renderTitleTemplate("{name|catalog:Mi:vendor}", [c]), "Mi 200");
  });

  it("renders empty (and tidies) when every alternative is empty", () => {
    const c = copy({ year: 1850 });
    assert.equal(renderTitleTemplate("{issueName|name} {year}", [c]), "1850");
  });

  it("skips unknown alternatives", () => {
    const c = copy({ name: "Mercury" });
    assert.equal(renderTitleTemplate("{bogus|name}", [c]), "Mercury");
  });

  it("tolerates spaces around the pipe", () => {
    const c = copy({ year: 1850 });
    assert.equal(renderTitleTemplate("{ name | year }", [c]), "1850");
  });
});

describe("renderTitleTemplate — issue & abbreviation tokens", () => {
  it("resolves the issue tokens", () => {
    const c = copy({ issueName: "First Issue", issueYear: 1850 });
    assert.equal(renderTitleTemplate("{issueName} ({issueYear})", [c]), "First Issue (1850)");
  });

  // `{subtype}` (#339). The engine only ever sees a *resolved* subtype: `toTitleCopy` already
  // dropped the collection default and the base stamp's absent one to null, so from here the
  // token behaves like any other — which is exactly what these assert.
  it("resolves the subtype token", () => {
    const c = copy({ name: "Mercury", subtype: "Overprint" });
    assert.equal(renderTitleTemplate("{name} {subtype}", [c]), "Mercury Overprint");
  });

  it("renders nothing for a copy with no subtype, taking its separator with it", () => {
    const c = copy({ name: "Mercury", condition: "Used" });
    assert.equal(renderTitleTemplate("{name} - {subtype} - {condition}", [c]), "Mercury - Used");
  });

  it("joins distinct subtypes across copies and skips the ones without", () => {
    const copies = [
      copy({ subtype: "Overprint" }),
      copy({ subtype: null }),
      copy({ subtype: "Plate flaw" }),
      copy({ subtype: "Overprint" }),
    ];
    assert.equal(renderTitleTemplate("{subtype}", copies), "Overprint / Plate flaw");
  });

  it("lets a fallback group fall past an absent subtype", () => {
    const c = copy({ subtype: null, condition: "Used" });
    assert.equal(renderTitleTemplate("{subtype|condition}", [c]), "Used");
  });

  // `{format}` / `{formatAbbr}` (#345). A **single** has no format at all (ADR-0020: a null
  // `Item.formatId` *is* the single), so the empty resolution is the common case rather than the
  // exception — which is why the tidy pass carrying the separator away is what makes the token
  // usable in a template at all.
  it("resolves the format tokens", () => {
    const c = copy({ name: "Mercury", format: "Block of 4", formatAbbr: "Blk4" });
    assert.equal(renderTitleTemplate("{name} {format}", [c]), "Mercury Block of 4");
    assert.equal(renderTitleTemplate("{name} {formatAbbr}", [c]), "Mercury Blk4");
  });

  it("renders nothing for a single, taking its separator with it", () => {
    const c = copy({ name: "Mercury", condition: "Used" });
    assert.equal(renderTitleTemplate("{name} - {format} - {condition}", [c]), "Mercury - Used");
  });

  // A batch mixing formats behaves like every other per-copy token: distinct values joined, the
  // singles' nulls simply skipped. No "Mixed" of its own.
  it("joins distinct formats across copies and skips the singles", () => {
    const copies = [
      copy({ format: "Horizontal pair" }),
      copy({ format: null }),
      copy({ format: "Block of 4" }),
      copy({ format: "Horizontal pair" }),
    ];
    assert.equal(renderTitleTemplate("{format}", copies), "Horizontal pair / Block of 4");
  });

  it("lets a fallback group fall past a single's absent format", () => {
    const c = copy({ format: null, condition: "Used" });
    assert.equal(renderTitleTemplate("{format|condition}", [c]), "Used");
  });

  it("resolves the location tokens", () => {
    const c = copy({ location: "Stockbook A", ref: "A234" });
    assert.equal(renderTitleTemplate("{location} {ref}", [c]), "Stockbook A A234");
    assert.equal(renderTitleTemplate("{location}/{ref}", [c]), "Stockbook A/A234");
  });

  // Internal copy number (#268). Padded to the collection's configured width by default, to an
  // explicit one with `{itemNo:N}`, and never prefixed with `#` — a template writes its own.
  it("resolves {itemNo} at the collection's configured width", () => {
    assert.equal(renderTitleTemplate("{itemNo}", [copy({ itemNo: 42, itemNoPad: 5 })]), "00042");
    assert.equal(renderTitleTemplate("{itemNo}", [copy({ itemNo: 42, itemNoPad: 2 })]), "42");
    assert.equal(renderTitleTemplate("no. {itemNo}", [copy({ itemNo: 7, itemNoPad: 3 })]), "no. 007");
  });

  it("lets {itemNo:N} override the width, ignoring an unusable one", () => {
    const c = copy({ itemNo: 42, itemNoPad: 5 });
    assert.equal(renderTitleTemplate("{itemNo:3}", [c]), "042");
    assert.equal(renderTitleTemplate("{itemNo:1}", [c]), "42");
    // Out of range / not a number → the collection's width, rather than an empty token.
    assert.equal(renderTitleTemplate("{itemNo:0}", [c]), "00042");
    assert.equal(renderTitleTemplate("{itemNo:abc}", [c]), "00042");
    // Padding sets a minimum width; it never truncates an identifier.
    assert.equal(renderTitleTemplate("{itemNo:2}", [copy({ itemNo: 123456, itemNoPad: 5 })]), "123456");
  });

  it("lists the numbers of several copies, and renders empty without one", () => {
    const a = copy({ itemNo: 1, itemNoPad: 4 });
    const b = copy({ itemNo: 2, itemNoPad: 4 });
    assert.equal(renderTitleTemplate("{itemNo}", [a, b]), "0001 / 0002");
    assert.equal(renderTitleTemplate("x{itemNo}", [copy({ itemNo: null })]), "x");
  });

  it("resolves the abbreviation tokens", () => {
    const c = copy({
      condition: "Mint never hinged",
      conditionAbbr: "MNH",
      certificate: "Photo certificate",
      certificateAbbr: "cert.",
    });
    assert.equal(renderTitleTemplate("{conditionAbbr} {certificateAbbr}", [c]), "MNH cert.");
    assert.equal(renderTitleTemplate("{condition}", [c]), "Mint never hinged");
  });

  it("collapses issue years to a span across copies", () => {
    const copies = [copy({ issueYear: 1860 }), copy({ issueYear: 1850 })];
    assert.equal(renderTitleTemplate("{issueYear}", copies), "1850–1860");
  });

  it("every advertised token resolves (no token is left literal)", () => {
    const c = copy({
      name: "N",
      catalogNumbers: [cn("C", "1", { areaPrefix: "P", isPrimary: true })],
      year: 1900,
      condition: "Cond",
      conditionAbbr: "Cnd",
      certificate: "Cert",
      certificateAbbr: "Crt",
      area: "Area",
      location: "Loc",
      ref: "Ref",
      issueName: "Issue",
      issueYear: 1901,
      subtype: "Sub",
    });
    for (const { token } of AVAILABLE_TITLE_TOKENS) {
      assert.notEqual(renderTitleTemplate(token, [c]), token, `${token} should resolve`);
    }
  });
});

describe("renderTitleTemplateSegments / titleFallbackTokens (#298)", () => {
  const c = copy({
    name: "Merkury",
    condition: "Mint never hinged",
    area: "Polska",
    catalogNumbers: [cn("Mi", "12", { isPrimary: true })],
    fallbacks: [fb("condition", { defaultValue: "Mint never hinged" })],
  });

  it("concatenates to exactly what renderTitleTemplate returns", () => {
    const tpl = "{catalog} {name} - {condition} ({area})";
    assert.equal(
      renderTitleTemplateSegments(tpl, [c]).map((s) => s.text).join(""),
      renderTitleTemplate(tpl, [c])
    );
  });

  it("marks only the fallen-back token's text", () => {
    assert.deepEqual(renderTitleTemplateSegments("{name} {condition} {area}", [c]), [
      { text: "Merkury ", fellBack: false },
      { text: "Mint never hinged", fellBack: true, field: "condition" },
      { text: " Polska", fellBack: false },
    ]);
  });

  it("returns one unmarked segment when nothing fell back", () => {
    assert.deepEqual(renderTitleTemplateSegments("{name}", [copy({ name: "Merkury" })]), [
      { text: "Merkury", fellBack: false },
    ]);
  });

  it("still trims the glue separator of an empty token next to a marked one", () => {
    assert.deepEqual(renderTitleTemplateSegments("{year} - {condition}", [c]), [
      { text: "Mint never hinged", fellBack: true, field: "condition" },
    ]);
    assert.deepEqual(renderTitleTemplateSegments("{condition} - {year}", [c]), [
      { text: "Mint never hinged", fellBack: true, field: "condition" },
    ]);
  });

  it("never marks an untranslatable token", () => {
    const numbers = copy({
      catalogNumbers: [cn("Mi", "12", { isPrimary: true })],
      year: 1950,
      fallbacks: [fb("condition", { defaultValue: "Mint never hinged" })],
    });
    assert.deepEqual(renderTitleTemplateSegments("{catalog} {year}", [numbers]), [
      { text: "Mi 12 1950", fellBack: false },
    ]);
    assert.deepEqual(titleFallbackTokens("{catalog} {year}", [numbers]), []);
  });

  it("marks a token that fell back on any one of the copies in scope", () => {
    const translated = copy({ condition: "Czyste" });
    assert.deepEqual(titleFallbackTokens("{condition}", [translated, c]), ["{condition}"]);
    assert.deepEqual(titleFallbackTokens("{condition}", [translated]), []);
  });

  it("reports the winning alternative of a fallback group, in legend spelling", () => {
    const grouped = copy({ issueName: null, name: "Merkury", fallbacks: [fb("name", { defaultValue: "Merkury" })] });
    assert.deepEqual(titleFallbackTokens("{issuename|name}", [grouped]), ["{name}"]);
    // The group's first alternative wins when it resolves, and it is translated here.
    const withIssue = copy({ issueName: "Wydanie", name: "Merkury", fallbacks: [fb("name", { defaultValue: "Merkury" })] });
    assert.deepEqual(titleFallbackTokens("{issueName|name}", [withIssue]), []);
  });

  it("lists each fallen-back token once, in template order", () => {
    const both = copy({ condition: "Mint", area: "Poland", fallbacks: [fb("condition", { defaultValue: "Mint" }), fb("area", { defaultValue: "Poland" })] });
    assert.deepEqual(titleFallbackTokens("{area} {condition} {condition}", [both]), [
      "{area}",
      "{condition}",
    ]);
  });
});

describe("titleFallbacks — the entity gaps a template surfaces (#299)", () => {
  const condition = fb("condition", { entityId: "cond-1", defaultValue: "Mint never hinged" });
  const stampName = fb("name", { entityId: "stamp-1", defaultValue: "Merkury" });
  const c = copy({
    name: "Merkury",
    condition: "Mint never hinged",
    area: "Polska",
    catalogNumbers: [cn("Mi", "12", { isPrimary: true })],
    fallbacks: [stampName, condition],
  });

  it("reports the entity row behind each token the template renders", () => {
    assert.deepEqual(titleFallbacks("{name} - {condition}", [c]), [stampName, condition]);
  });

  it("ignores a gap no token in the template renders", () => {
    assert.deepEqual(titleFallbacks("{condition}", [c]), [condition]);
    assert.deepEqual(titleFallbacks("{catalog} {year}", [c]), []);
  });

  it("lists an entity shared by several copies once", () => {
    const other = copy({ condition: "Mint never hinged", fallbacks: [condition] });
    assert.deepEqual(titleFallbacks("{condition}", [c, other]), [condition]);
  });

  it("lists the same entity's two fields separately", () => {
    const abbr = fb("conditionAbbr", { entityId: "cond-1", defaultValue: "MNH" });
    const both = copy({
      condition: "Mint never hinged",
      conditionAbbr: "MNH",
      fallbacks: [condition, abbr],
    });
    assert.deepEqual(titleFallbacks("{condition} ({conditionAbbr})", [both]), [condition, abbr]);
  });

  it("reports nothing when nothing fell back", () => {
    assert.deepEqual(titleFallbacks("{name} {condition}", [copy({ name: "Merkury" })]), []);
  });

  it("names the field on the segment it flagged, so the run can be fixed in place (#300)", () => {
    assert.deepEqual(renderTitleTemplateSegments("{name} {condition}", [c]), [
      { text: "Merkury", fellBack: true, field: "name" },
      { text: " ", fellBack: false },
      { text: "Mint never hinged", fellBack: true, field: "condition" },
    ]);
  });
});
