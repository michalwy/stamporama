import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderListingTemplate,
  renderListingTemplateSegments,
  renderTitleTemplate,
  listingFallbackTokens,
  listingFallbacks,
  templateUsesOfferContext,
  templateUsesListedAs,
  AVAILABLE_LISTING_TOKENS,
  AVAILABLE_LISTING_BLOCKS,
  type TemplateSet,
  type TitleTemplateCopy,
  type TitleCatalogNumber,
  type TitleFallback,
} from "../../src/lib/offer-title-template";

/** The condition of the test copies below, untranslated for the language in play (#298/#299). */
const conditionFallback: TitleFallback = {
  field: "condition",
  entityType: "condition",
  entityId: "cond-1",
  entityField: "name",
  defaultValue: "Mint",
};

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
    itemNo: null,
    itemNoPad: 5,
    subtype: null,
    format: null,
    formatAbbr: null,
    issueName: null,
    issueYear: null,
    unknownVariant: false,
    variants: null,
    listedAs: null,
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

// A legend of the abbreviations a description just printed (#318): the blocks iterate the *distinct*
// conditions / certificate statuses the copies use, and the collector formats the entry themselves.
describe("renderListingTemplate — legend blocks", () => {
  const mnh = copy({ name: "Mercury", catalogNumbers: [cn("Mi", "12")], condition: "Mint never hinged", conditionAbbr: "MNH" });
  const used = copy({ name: "Venus", catalogNumbers: [cn("Mi", "13")], condition: "Used", conditionAbbr: "U" });
  const mnhToo = copy({ name: "Mars", catalogNumbers: [cn("Mi", "14")], condition: "Mint never hinged", conditionAbbr: "MNH" });
  const legend = "{#conditionLegend}{conditionAbbr} = {condition}\n{/conditionLegend}";

  it("repeats once per distinct condition used, in first-seen order", () => {
    const sets: TemplateSet[] = [{ title: null, copies: [mnh, used, mnhToo] }];
    assert.equal(renderListingTemplate(legend, sets), "MNH = Mint never hinged\nU = Used");
  });

  it("collects the conditions of every set in the offer", () => {
    const sets: TemplateSet[] = [
      { title: "Lot A", copies: [mnh] },
      { title: "Lot B", copies: [used, mnhToo] },
    ];
    assert.equal(renderListingTemplate(legend, sets), "MNH = Mint never hinged\nU = Used");
  });

  it("leaves out a copy that records no condition at all", () => {
    const sets: TemplateSet[] = [{ title: null, copies: [mnh, copy({ name: "Ceres" })] }];
    assert.equal(renderListingTemplate(legend, sets), "MNH = Mint never hinged");
  });

  it("drops the '=' glue when the condition has no abbreviation", () => {
    const noAbbr = copy({ name: "Ceres", condition: "Used" });
    const sets: TemplateSet[] = [{ title: null, copies: [mnh, noAbbr] }];
    assert.equal(renderListingTemplate(legend, sets), "MNH = Mint never hinged\nUsed");
  });

  it("narrows every other token to the copies using that condition", () => {
    const sets: TemplateSet[] = [{ title: null, copies: [mnh, used, mnhToo] }];
    const out = renderListingTemplate("{#conditionLegend}{conditionAbbr}: {catalog}\n{/conditionLegend}", sets);
    assert.equal(out, "MNH: Mi 12,14\nU: Mi 13");
  });

  it("iterates the enclosing set's conditions when nested in a set block", () => {
    const sets: TemplateSet[] = [
      { title: "Lot A", copies: [mnh, used] },
      { title: "Lot B", copies: [mnhToo] },
    ];
    const out = renderListingTemplate("{#set}{setTitle}\n{#conditionLegend}- {conditionAbbr}\n{/conditionLegend}{/set}", sets);
    assert.equal(out, "Lot A\n- MNH\n- U\nLot B\n- MNH");
  });

  it("repeats once per distinct certificate status used", () => {
    const photo = copy({ name: "Mercury", certificate: "Photo certificate", certificateAbbr: "cert." });
    const photoToo = copy({ name: "Venus", certificate: "Photo certificate", certificateAbbr: "cert." });
    const full = copy({ name: "Mars", certificate: "Full certificate", certificateAbbr: "FC" });
    const sets: TemplateSet[] = [{ title: null, copies: [photo, copy({ name: "Ceres" }), photoToo, full] }];
    const out = renderListingTemplate("{#certificateLegend}{certificateAbbr} = {certificate}\n{/certificateLegend}", sets);
    assert.equal(out, "cert. = Photo certificate\nFC = Full certificate");
  });

  it("renders nothing when no copy in scope carries the dictionary entry", () => {
    const sets: TemplateSet[] = [{ title: null, copies: [copy({ name: "Ceres" })] }];
    assert.equal(renderListingTemplate(`Legend:\n${legend}`, sets), "Legend:");
  });

  // #345: the legend of formats a batch uses. Singles carry no format and simply do not appear —
  // the same rule that keeps a copy without a certificate out of the certificate legend.
  it("repeats once per distinct format used, leaving singles out", () => {
    const pair = copy({ name: "Mercury", format: "Horizontal pair", formatAbbr: "HPair" });
    const pairToo = copy({ name: "Venus", format: "Horizontal pair", formatAbbr: "HPair" });
    const block = copy({ name: "Mars", format: "Block of 4", formatAbbr: "Blk4" });
    const single = copy({ name: "Ceres" });
    const sets: TemplateSet[] = [{ title: null, copies: [pair, single, pairToo, block] }];
    const out = renderListingTemplate("{#formatLegend}{formatAbbr} = {format}\n{/formatLegend}", sets);
    assert.equal(out, "HPair = Horizontal pair\nBlk4 = Block of 4");
  });

  it("renders no format legend for a batch of singles", () => {
    const sets: TemplateSet[] = [{ title: null, copies: [copy({ name: "Ceres" })] }];
    const out = renderListingTemplate("Formats:\n{#formatLegend}{format}\n{/formatLegend}", sets);
    assert.equal(out, "Formats:");
  });

  it("leaves mismatched legend tags literal", () => {
    const sets: TemplateSet[] = [{ title: null, copies: [mnh] }];
    assert.equal(renderListingTemplate("{#conditionLegend}{conditionAbbr}{/certificateLegend}", sets), "{#conditionLegend}MNH{/certificateLegend}");
  });
});

describe("renderListingTemplateSegments / listingFallbackTokens", () => {
  it("flags text that fell back to the default language, inside and outside a block", () => {
    const fallen = copy({ name: "Mercury", condition: "Mint", fallbacks: [conditionFallback] });
    const sets: TemplateSet[] = [{ title: null, copies: [fallen] }];
    assert.deepEqual(renderListingTemplateSegments("{name}\n{#set}{condition}{/set}", sets), [
      { text: "Mercury\n", fellBack: false },
      { text: "Mint", fellBack: true, field: "condition" },
    ]);
    assert.deepEqual(listingFallbackTokens("{name}\n{#set}{condition}{/set}", sets), ["{condition}"]);
  });

  it("concatenated segments equal the plain render", () => {
    const fallen = copy({ name: "Merkury", condition: "Mint", year: 1850, fallbacks: [conditionFallback] });
    const sets: TemplateSet[] = [{ title: "Lot", copies: [fallen] }];
    const template = "{setTitle}\n{#set}{name} - {certificate} - {condition} ({year})\n{/set}";
    const segments = renderListingTemplateSegments(template, sets);
    assert.equal(segments.map((s) => s.text).join(""), renderListingTemplate(template, sets));
  });

  it("reports nothing for a blank template", () => {
    assert.deepEqual(listingFallbackTokens("", twoSets), []);
  });
});

// `{offerUrl}` (#415) is the one token that describes the offer rather than its copies, so it comes
// from the render context instead of a `TitleTemplateCopy`.
describe("{offerUrl} (#415)", () => {
  const url = "https://stamps.example/c/mine/offers/o-42";
  const sets: TemplateSet[] = [{ title: null, copies: [mercury] }];

  it("renders the offer's link from the context", () => {
    assert.equal(
      renderListingTemplate("See: {offerUrl}", sets, { offerUrl: url }),
      `See: ${url}`
    );
  });

  it("keeps the URL intact next to a token that came out empty", () => {
    assert.equal(
      renderListingTemplate("{offerUrl} / {certificate}", sets, { offerUrl: url }),
      url
    );
  });

  it("renders empty without a context, dropping the line it was the only token on", () => {
    assert.equal(renderListingTemplate("{name}\nSee: {offerUrl}", sets), "Mercury");
    assert.equal(renderListingTemplate("{name}\nSee: {offerUrl}", sets, {}), "Mercury");
    assert.equal(renderListingTemplate("{name}\nSee: {offerUrl}", sets, { offerUrl: null }), "Mercury");
  });

  it("resolves the same inside a repeating block, where the offer does not change", () => {
    assert.equal(
      renderListingTemplate("{#copy}{name}: {offerUrl}\n{/copy}", twoSets, { offerUrl: url }),
      `Mercury: ${url}\nVenus: ${url}`
    );
  });

  it("falls back to it in a group when the earlier alternative is empty", () => {
    assert.equal(
      renderListingTemplate("{certificate|offerUrl}", sets, { offerUrl: url }),
      url
    );
  });

  it("is not a title token — a title has no offer context and renders it empty", () => {
    assert.equal(renderTitleTemplate("{name} {offerUrl}", [mercury]), "Mercury");
  });
});

// A piece whose variant was never identified (#619): the listing stands under one specific variant
// and the buyer has to be told that, which variant it might be, and which one it is sold under.
describe("{#unknownVariant} and its tokens (#619)", () => {
  const umbrella = copy({
    name: "Mercury",
    catalogNumbers: [cn("Mi", "865")],
    unknownVariant: true,
    variants: "Mi 865a-c",
    listedAs: "Mi 865a",
  });
  const identified = copy({ name: "Venus", catalogNumbers: [cn("Mi", "13")] });

  it("renders once over the copies whose variant is unknown", () => {
    assert.equal(
      renderListingTemplate("{#unknownVariant}Sold as {listedAs}, one of {variants}.{/unknownVariant}", [
        { title: null, copies: [umbrella] },
      ]),
      "Sold as Mi 865a, one of Mi 865a-c."
    );
  });

  it("renders nothing at all when every copy is identified", () => {
    assert.equal(
      renderListingTemplate("{name}\n{#unknownVariant}Variant not identified.{/unknownVariant}", [
        { title: null, copies: [identified] },
      ]),
      "Venus"
    );
  });

  it("narrows to the unidentified copies, never the ones standing beside them", () => {
    assert.equal(
      renderListingTemplate("{#unknownVariant}{catalog}: one of {variants}{/unknownVariant}", [
        { title: null, copies: [identified, umbrella] },
      ]),
      "Mi 865: one of Mi 865a-c"
    );
  });

  it("renders once for the whole description, however many umbrellas it lists", () => {
    const other = copy({
      name: "Mars",
      catalogNumbers: [cn("Mi", "900")],
      unknownVariant: true,
      variants: "Mi 900I-II",
      listedAs: "Mi 900I",
    });
    assert.equal(
      renderListingTemplate("{#unknownVariant}Unidentified: {variants}{/unknownVariant}", [
        { title: null, copies: [umbrella] },
        { title: null, copies: [other] },
      ]),
      "Unidentified: Mi 865a-c / Mi 900I-II"
    );
  });

  it("becomes a per-copy caveat inside {#copy}, skipping the identified ones", () => {
    assert.equal(
      renderListingTemplate(
        "{#copy}{catalog} {name}{#unknownVariant} (sold as {listedAs}){/unknownVariant}\n{/copy}",
        [{ title: null, copies: [umbrella, identified] }]
      ),
      "Mi 865 Mercury (sold as Mi 865a)\nMi 13 Venus"
    );
  });

  it("drops a line whose only tokens were an unresolved listing's", () => {
    const unresolved = copy({ name: "Mars", unknownVariant: true, variants: "Mi 900a-b" });
    assert.equal(
      renderListingTemplate(
        "{#unknownVariant}Sold as: {listedAs}\nOne of: {variants}{/unknownVariant}",
        [{ title: null, copies: [unresolved] }]
      ),
      "One of: Mi 900a-b"
    );
  });

  it("keeps an unbalanced tag literal, like every other block", () => {
    assert.equal(
      renderListingTemplate("{#unknownVariant}{name}", [{ title: null, copies: [umbrella] }]),
      "{#unknownVariant}Mercury"
    );
  });

  it("says nothing in a title — empty tokens rather than literal braces, and no block", () => {
    assert.equal(renderTitleTemplate("{name} {listedAs} {variants}", [umbrella]), "Mercury");
    assert.equal(
      renderTitleTemplate("{name}{#unknownVariant} — variant unknown{/unknownVariant}", [umbrella]),
      "Mercury"
    );
  });
});

describe("templateUsesListedAs (#619)", () => {
  it("spots the token, in a fallback group too, and ignores everything else", () => {
    assert.equal(templateUsesListedAs("Sold as {listedAs}"), true);
    assert.equal(templateUsesListedAs("{listedAs|catalog}"), true);
    assert.equal(templateUsesListedAs("{LISTEDAS}"), true);
    assert.equal(templateUsesListedAs("{#unknownVariant}One of {variants}{/unknownVariant}"), false);
    assert.equal(templateUsesListedAs("listedAs without braces"), false);
    assert.equal(templateUsesListedAs(null), false);
  });
});

describe("templateUsesOfferContext (#415)", () => {
  it("spots the token, in a fallback group too, and ignores everything else", () => {
    assert.equal(templateUsesOfferContext("Link: {offerUrl}"), true);
    assert.equal(templateUsesOfferContext("{certificate|offerUrl}"), true);
    assert.equal(templateUsesOfferContext("{OFFERURL}"), true);
    assert.equal(templateUsesOfferContext("{name} {year}"), false);
    assert.equal(templateUsesOfferContext("offerUrl without braces"), false);
    assert.equal(templateUsesOfferContext(null), false);
  });
});

describe("listing token legend", () => {
  it("offers the title tokens plus the listing-only ones, and every block", () => {
    assert.ok(AVAILABLE_LISTING_TOKENS.some((t) => t.token === "{setTitle}"));
    assert.ok(AVAILABLE_LISTING_TOKENS.some((t) => t.token === "{offerUrl}"));
    assert.ok(AVAILABLE_LISTING_TOKENS.some((t) => t.token === "{catalog}"));
    assert.ok(AVAILABLE_LISTING_TOKENS.some((t) => t.token === "{listedAs}"));
    assert.ok(AVAILABLE_LISTING_TOKENS.some((t) => t.token === "{variants}"));
    assert.deepEqual(
      AVAILABLE_LISTING_BLOCKS.map((b) => `${b.open}${b.close}`),
      [
        "{#set}{/set}",
        "{#copy}{/copy}",
        "{#conditionLegend}{/conditionLegend}",
        "{#certificateLegend}{/certificateLegend}",
        "{#formatLegend}{/formatLegend}",
        "{#unknownVariant}{/unknownVariant}",
      ]
    );
  });
});

describe("listingFallbacks (#299)", () => {
  it("reports the entity behind a gap inside a repeating block", () => {
    const fallen = copy({ name: "Mercury", condition: "Mint", fallbacks: [conditionFallback] });
    const sets: TemplateSet[] = [{ title: null, copies: [fallen] }];
    assert.deepEqual(listingFallbacks("{#set}{name} — {condition}\n{/set}", sets), [
      conditionFallback,
    ]);
  });

  it("reports nothing for a template that renders none of the untranslated tokens", () => {
    const fallen = copy({ name: "Mercury", condition: "Mint", year: 1850, fallbacks: [conditionFallback] });
    assert.deepEqual(listingFallbacks("{name} {year}", [{ title: null, copies: [fallen] }]), []);
  });
});
