import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderTitleTemplate,
  DEFAULT_TITLE_TEMPLATE,
  AVAILABLE_TITLE_TOKENS,
  type TitleTemplateCopy,
  type TitleCatalogNumber,
} from "../../src/lib/offer-title-template";

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
      "Fi BL31-33 / Mi 1294-1295CKB,1296KB / Yt BF28-30"
    );
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

  it("resolves the location tokens", () => {
    const c = copy({ location: "Stockbook A", ref: "A234" });
    assert.equal(renderTitleTemplate("{location} {ref}", [c]), "Stockbook A A234");
    assert.equal(renderTitleTemplate("{location}/{ref}", [c]), "Stockbook A/A234");
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
    });
    for (const { token } of AVAILABLE_TITLE_TOKENS) {
      assert.notEqual(renderTitleTemplate(token, [c]), token, `${token} should resolve`);
    }
  });
});
