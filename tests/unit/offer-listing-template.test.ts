import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderListingTemplate,
  renderListingTemplateSegments,
  renderTitleTemplate,
  listingFallbackTokens,
  AVAILABLE_LISTING_TOKENS,
  AVAILABLE_LISTING_BLOCKS,
  type TemplateSet,
  type TitleTemplateCopy,
  type TitleCatalogNumber,
} from "../../src/lib/offer-title-template";

// The multi-line listing texts an offer carries (#266 description, #267 private note): the same
// token engine as the title, plus preserved line breaks, all-empty lines dropped and the repeating
// `{#set}` / `{#copy}` blocks.

function cn(vendorAbbr: string, number: string, isPrimary = true): TitleCatalogNumber {
  return { vendorId: vendorAbbr.toLowerCase(), vendorAbbr, number, areaPrefix: null, isPrimary };
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

const mercury = copy({ name: "Mercury", catalogNumbers: [cn("Mi", "12")], year: 1850, condition: "Mint" });
const venus = copy({ name: "Venus", catalogNumbers: [cn("Mi", "13")], year: 1851, condition: "Used" });

/** Two sets of one copy each — the shape a two-lot offer renders against. */
const twoSets: TemplateSet[] = [
  { title: "Lot A", copies: [mercury] },
  { title: null, copies: [venus] },
];

describe("renderListingTemplate — multi-line rendering", () => {
  it("keeps the collector's line breaks and blank paragraph separators", () => {
    const out = renderListingTemplate("{name} {year}\n\n{condition}", [{ title: null, copies: [mercury] }]);
    assert.equal(out, "Mercury 1850\n\nMint");
  });

  it("renders nothing for a blank template (no built-in default, unlike the title)", () => {
    assert.equal(renderListingTemplate("", twoSets), "");
    assert.equal(renderListingTemplate(null, twoSets), "");
    assert.equal(renderListingTemplate("   ", twoSets), "");
  });

  it("drops a line whose placeholders all resolved empty, with its literal scaffolding", () => {
    const bare = copy({ name: "Mercury" });
    const out = renderListingTemplate("Name: {name}\nCertificate: {certificate}\nYear: {year}", [
      { title: null, copies: [bare] },
    ]);
    assert.equal(out, "Name: Mercury");
  });

  it("keeps a line that has no placeholders at all", () => {
    const out = renderListingTemplate("Shipped within 3 days.\n{certificate}\nThanks!", [
      { title: null, copies: [copy()] },
    ]);
    assert.equal(out, "Shipped within 3 days.\nThanks!");
  });

  it("keeps leading indentation on a line that survives", () => {
    const out = renderListingTemplate("Items:\n  - {name}", [{ title: null, copies: [mercury] }]);
    assert.equal(out, "Items:\n  - Mercury");
  });

  it("still tidies separators around an empty token within a line", () => {
    const noCert = copy({ name: "Mercury", year: 1850 });
    const out = renderListingTemplate("{name} - {certificate} - {year}", [{ title: null, copies: [noCert] }]);
    assert.equal(out, "Mercury - 1850");
  });

  it("aggregates plain tokens across every copy of every set", () => {
    assert.equal(renderListingTemplate("{name}", twoSets), "Mercury / Venus");
    assert.equal(renderListingTemplate("{year}", twoSets), "1850–1851");
  });
});

describe("renderListingTemplate — repeating blocks", () => {
  it("renders a set block once per set, narrowed to that set's copies", () => {
    const out = renderListingTemplate("Lots:\n{#set}- {name} ({condition})\n{/set}", twoSets);
    assert.equal(out, "Lots:\n- Mercury (Mint)\n- Venus (Used)");
  });

  it("resolves {setTitle} inside a set block, and drops the line when the set has none", () => {
    const out = renderListingTemplate("{#set}{setTitle}: {name}\n{/set}", twoSets);
    assert.equal(out, "Lot A: Mercury\nVenus");
  });

  it("renders a copy block per copy of the enclosing set", () => {
    const pair: TemplateSet[] = [
      { title: "Series", copies: [mercury, venus] },
      { title: "Single", copies: [mercury] },
    ];
    const out = renderListingTemplate("{#set}{setTitle}\n{#copy}  · {catalog} {name}\n{/copy}{/set}", pair);
    assert.equal(out, "Series\n  · Mi 12 Mercury\n  · Mi 13 Venus\nSingle\n  · Mi 12 Mercury");
  });

  it("renders a top-level copy block over every copy in the offer", () => {
    assert.equal(renderListingTemplate("{#copy}{name}\n{/copy}", twoSets), "Mercury\nVenus");
  });

  it("skips an iteration whose body renders nothing at all", () => {
    const sets: TemplateSet[] = [
      { title: null, copies: [mercury] },
      { title: null, copies: [copy()] }, // nothing to say
    ];
    assert.equal(renderListingTemplate("{#set}- {name}\n{/set}", sets), "- Mercury");
  });

  it("leaves unbalanced or mismatched block tags literal, like an unknown token", () => {
    assert.equal(renderListingTemplate("{#set}{name}", twoSets), "{#set}Mercury / Venus");
    assert.equal(renderListingTemplate("{#set}{name}{/copy}", twoSets), "{#set}Mercury / Venus{/copy}");
    assert.equal(renderListingTemplate("{name}{/set}", twoSets), "Mercury / Venus{/set}");
  });

  it("renders a set block once when a one-line title template uses one", () => {
    // The title renders over a single anonymous set, so a set block is simply one iteration.
    assert.equal(renderTitleTemplate("{#set}{name}{/set}", [mercury, venus]), "Mercury / Venus");
  });
});

describe("renderListingTemplateSegments / listingFallbackTokens", () => {
  it("flags text that fell back to the default language, inside and outside a block", () => {
    const fallen = copy({ name: "Mercury", condition: "Mint", fallbacks: ["condition"] });
    const sets: TemplateSet[] = [{ title: null, copies: [fallen] }];
    assert.deepEqual(renderListingTemplateSegments("{name}\n{#set}{condition}{/set}", sets), [
      { text: "Mercury\n", fellBack: false },
      { text: "Mint", fellBack: true },
    ]);
    assert.deepEqual(listingFallbackTokens("{name}\n{#set}{condition}{/set}", sets), ["{condition}"]);
  });

  it("concatenated segments equal the plain render", () => {
    const fallen = copy({ name: "Merkury", condition: "Mint", year: 1850, fallbacks: ["condition"] });
    const sets: TemplateSet[] = [{ title: "Lot", copies: [fallen] }];
    const template = "{setTitle}\n{#set}{name} - {certificate} - {condition} ({year})\n{/set}";
    const segments = renderListingTemplateSegments(template, sets);
    assert.equal(segments.map((s) => s.text).join(""), renderListingTemplate(template, sets));
  });

  it("reports nothing for a blank template", () => {
    assert.deepEqual(listingFallbackTokens("", twoSets), []);
  });
});

describe("listing token legend", () => {
  it("offers the title tokens plus {setTitle}, and the two repeating blocks", () => {
    assert.ok(AVAILABLE_LISTING_TOKENS.some((t) => t.token === "{setTitle}"));
    assert.ok(AVAILABLE_LISTING_TOKENS.some((t) => t.token === "{catalog}"));
    assert.deepEqual(
      AVAILABLE_LISTING_BLOCKS.map((b) => `${b.open}${b.close}`),
      ["{#set}{/set}", "{#copy}{/copy}"]
    );
  });
});
