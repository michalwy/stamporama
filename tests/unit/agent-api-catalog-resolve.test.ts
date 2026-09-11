import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  catalogVerdict,
  couldMatchForeignCatalogNumber,
  leadingCatalogueWord,
  matchesForeignCatalogNumber,
  parseForeignCatalogNumber,
  stampCatalogKeys,
} from "../../src/lib/agent-api/catalog-resolve";
import { parseCatalogSearch, stripCatalogVendor } from "../../src/lib/catalog-number";
import type { CatalogVerdict } from "../../src/lib/agent-api/catalog-resolve";

// **#1037's whole decision, and it is pure, so all of it is here.**
//
// What a foreign catalog string parses to, which keys a stamp answers to, and which of the four
// verdicts follows are functions of strings and a vendor list — no Prisma, no request, no
// collection. Only the *lookup* of candidate rows needs a database, and that lives in
// `operations/catalog.ts` (`agent-api.md`, *The module layout is the Prisma-free split*).
//
// **This suite may not import `registry.ts`**, which carries handlers and so reaches Prisma;
// `unit-suite-purity.test.ts` walks the graph and would name the chain. Nothing here needs it.

const VENDORS = [
  { id: "v_mi", name: "Michel", abbreviation: "Mi" },
  { id: "v_sc", name: "Scott", abbreviation: "Sc" },
];

/** The prefixes this fixture collection uses — the area tree's and the issues' alike (#66/#377). */
const PREFIXES = new Set(["pl", "sp"]);

interface FixtureStamp {
  readonly id: string;
  readonly vendorId: string;
  readonly abbreviation: string;
  readonly prefix: string | null;
  readonly number: string;
}

const STAMPS: readonly FixtureStamp[] = [
  { id: "s_mi_pl_123a", vendorId: "v_mi", abbreviation: "Mi", prefix: "PL", number: "123a" },
  { id: "s_sc_123a", vendorId: "v_sc", abbreviation: "Sc", prefix: null, number: "123a" },
  { id: "s_mi_pl_200", vendorId: "v_mi", abbreviation: "Mi", prefix: "PL", number: "200" },
  { id: "s_mi_sp_1", vendorId: "v_mi", abbreviation: "Mi", prefix: "SP", number: "1" },
  { id: "s_mi_pl_1", vendorId: "v_mi", abbreviation: "Mi", prefix: "PL", number: "1" },
  { id: "s_mi_pl_block", vendorId: "v_mi", abbreviation: "Mi", prefix: "PL", number: "BL30 B4" },
  { id: "s_mi_roman", vendorId: "v_mi", abbreviation: "Mi", prefix: null, number: "VIII" },
  { id: "s_mi_pl_sheet", vendorId: "v_mi", abbreviation: "Mi", prefix: "PL", number: "Ark. 103" },
];

interface Answer {
  readonly verdict: CatalogVerdict;
  readonly stampIds: readonly string[];
  readonly vendorToken: string | null;
  readonly number: string | null;
}

/**
 * What the operation does, minus the database: parse, narrow by whichever vendor is in play, compare
 * the keys, count. `operations/catalog.ts` runs exactly these calls in exactly this order — the two
 * cannot drift without one of them failing to compile.
 */
function resolve(input: string, statedVendorId: string | null = null): Answer {
  const parsed = parseForeignCatalogNumber(input, VENDORS, PREFIXES);
  const vendorId = parsed.vendorId ?? statedVendorId;
  const stampIds =
    parsed.unknownVendorToken !== null
      ? []
      : STAMPS.filter((stamp) => {
          if (vendorId !== null && stamp.vendorId !== vendorId) return false;
          const keys = stampCatalogKeys(stamp.abbreviation, stamp.prefix, stamp.number);
          const matched = matchesForeignCatalogNumber(parsed, keys);
          if (matched) {
            // The cheap pre-filter the operation narrows candidates with before their prefixes are
            // known must never drop a row the exact comparison would have kept — a false `no_match`
            // is the one failure this operation exists to prevent.
            assert.ok(
              couldMatchForeignCatalogNumber(parsed, stamp.number),
              `the candidate filter dropped ${stamp.id}, which "${input}" matches`
            );
          }
          return matched;
        }).map((stamp) => stamp.id);
  return {
    verdict: catalogVerdict(parsed, stampIds.length),
    stampIds,
    vendorToken: parsed.unknownVendorToken,
    number: parsed.number,
  };
}

describe("#1037's Done when: four spellings reach one stamp", () => {
  // The issue states this as its second criterion, naming these four inputs. The bare number is the
  // one that needs the caller to say which catalogue it is reading.
  const cases: [string, string | null][] = [
    ["Mi 123a", null],
    ["Michel 123a", null],
    ["mi123a", null],
    ["123a", "v_mi"],
  ];

  for (const [input, vendor] of cases) {
    it(`resolves "${input}"${vendor ? " against a stated Michel" : ""}`, () => {
      const answer = resolve(input, vendor);
      assert.equal(answer.verdict, "resolved");
      assert.deepEqual(answer.stampIds, ["s_mi_pl_123a"]);
    });
  }

  it("states the bare number it read, whichever spelling carried it", () => {
    for (const [input, vendor] of cases) {
      assert.equal(resolve(input, vendor).number, "123a", input);
    }
  });

  it("takes the spacing and the area code in the middle", () => {
    for (const input of ["Mi PL 123a", "MiPL123a", "Mi·PL 123a"]) {
      assert.deepEqual(resolve(input).stampIds, ["s_mi_pl_123a"], input);
    }
  });
});

describe("an ambiguous input says so rather than picking", () => {
  it("refuses to choose between two catalogues carrying the same number", () => {
    const answer = resolve("123a");
    assert.equal(answer.verdict, "ambiguous");
    assert.deepEqual([...answer.stampIds].sort(), ["s_mi_pl_123a", "s_sc_123a"]);
  });

  it("is resolved again once the caller says which catalogue", () => {
    assert.equal(resolve("123a", "v_sc").verdict, "resolved");
    assert.deepEqual(resolve("123a", "v_sc").stampIds, ["s_sc_123a"]);
  });

  it("is ambiguous within one catalogue too, where two prefixes share a number", () => {
    // `Mi·SP 1` and `Mi·PL 1` are two stamps (#66/#377). A bare `Mi 1` names neither.
    const answer = resolve("Mi 1");
    assert.equal(answer.verdict, "ambiguous");
    assert.deepEqual([...answer.stampIds].sort(), ["s_mi_pl_1", "s_mi_sp_1"]);
  });
});

describe("a stated prefix is part of the identity and is never dropped", () => {
  it("keeps Mi·SP 1 and Mi·PL 1 apart", () => {
    assert.deepEqual(resolve("Mi·SP 1").stampIds, ["s_mi_sp_1"]);
    assert.deepEqual(resolve("Mi·PL 1").stampIds, ["s_mi_pl_1"]);
  });

  it("does not fall back past a prefix the collection uses", () => {
    // `Mi·SP 200` is a number this collection does not hold. Falling back to the bare `200` would
    // answer about `Mi·PL 200`, which is a different stamp.
    assert.equal(resolve("Mi·SP 200").verdict, "no_match");
  });

  it("does fall back past letters the collection uses for nothing", () => {
    // `chel` is what `Michel` leaves behind after its abbreviation is taken off, and it is exactly
    // the case the fallback exists for.
    assert.deepEqual(resolve("Michel 200").stampIds, ["s_mi_pl_200"]);
  });
});

describe("unknown vendor is a different answer from no match", () => {
  it("names the catalogue it could not place", () => {
    const answer = resolve("Fi 456");
    assert.equal(answer.verdict, "unknown_vendor");
    assert.equal(answer.vendorToken, "Fi");
  });

  it("is unknown_vendor even where the number itself is held under another catalogue", () => {
    // The decisive case. `Fi 123a` says *Fischer*, and `Mi·PL 123a` exists — answering with it
    // would look exactly like a right answer, which is the invisible, expensive mistake.
    const answer = resolve("Fi 123a");
    assert.equal(answer.verdict, "unknown_vendor");
    assert.deepEqual(answer.stampIds, []);
  });

  it("is no_match, not unknown_vendor, for a number with no catalogue in it", () => {
    const answer = resolve("456");
    assert.equal(answer.verdict, "no_match");
    assert.equal(answer.vendorToken, null);
  });

  it("is no_match for a catalogue that is known and simply does not hold the number", () => {
    assert.equal(resolve("Mi 999").verdict, "no_match");
  });
});

describe("what is deliberately not read as a catalogue's name", () => {
  it("an area prefix the collection uses", () => {
    const answer = resolve("PL 200");
    assert.equal(answer.verdict, "resolved");
    assert.deepEqual(answer.stampIds, ["s_mi_pl_200"]);
  });

  it("a number that is a Roman numeral and nothing else (#383)", () => {
    const answer = resolve("VIII");
    assert.equal(answer.verdict, "resolved");
    assert.deepEqual(answer.stampIds, ["s_mi_roman"]);
  });

  it("a stored number's own lettered prefix", () => {
    assert.deepEqual(resolve("Ark. 103").stampIds, ["s_mi_pl_sheet"]);
    assert.deepEqual(resolve("BL30 B4").stampIds, ["s_mi_pl_block"]);
  });

  it("the word test refuses punctuation, digits, length and a trailing word", () => {
    assert.equal(leadingCatalogueWord("Ark. 103", PREFIXES), null);
    assert.equal(leadingCatalogueWord("BL30 B4", PREFIXES), null);
    assert.equal(leadingCatalogueWord("Yt 200", PREFIXES), "Yt");
    assert.equal(leadingCatalogueWord("Fi·PL 456", PREFIXES), "Fi");
    assert.equal(leadingCatalogueWord("VIII", PREFIXES), null);
    assert.equal(leadingCatalogueWord("Extraordinarily 1", PREFIXES), null);
    assert.equal(leadingCatalogueWord("PL 200", PREFIXES), null);
  });
});

describe("the keys are catalog-number.ts's, and the comparison is equality", () => {
  it("a stamp answers to its full identity, its prefixed number and its bare number", () => {
    assert.deepEqual(stampCatalogKeys("Mi", "PL", "200"), ["mipl200", "pl200", "200"]);
  });

  it("collapses to what there is when the area declares no prefix", () => {
    assert.deepEqual(stampCatalogKeys("Mi", null, "200"), ["mi200", "200"]);
  });

  it("does not match a longer number that merely contains the query", () => {
    // `catalogKeyMatches` matches `"200"` inside `"mipl2000"` on purpose, for a person reading a
    // result list. A resolver built on containment would call nearly every input ambiguous.
    const keys = stampCatalogKeys("Mi", "PL", "2000");
    const parsed = parseForeignCatalogNumber("200", VENDORS, PREFIXES);
    assert.equal(matchesForeignCatalogNumber(parsed, keys), false);
  });

  it("the candidate pre-filter agrees with it on the same near miss", () => {
    const parsed = parseForeignCatalogNumber("200", VENDORS, PREFIXES);
    assert.equal(couldMatchForeignCatalogNumber(parsed, "2000"), false);
  });
});

describe("stripCatalogVendor, lifted out of parseCatalogSearch", () => {
  it("keeps the area code parseCatalogSearch drops", () => {
    assert.deepEqual(stripCatalogVendor("Mi·PL 200", VENDORS), { vendorId: "v_mi", rest: "pl200" });
    assert.deepEqual(parseCatalogSearch("Mi·PL 200", VENDORS), { vendorId: "v_mi", number: "200" });
  });

  it("leaves a bare number and an unknown head whole", () => {
    assert.deepEqual(stripCatalogVendor("200", VENDORS), { vendorId: null, rest: "200" });
    assert.deepEqual(stripCatalogVendor("Fi 456", VENDORS), { vendorId: null, rest: "fi456" });
  });

  it("takes the longest abbreviation and never consumes the input to empty", () => {
    const vendors = [
      { id: "v_s", abbreviation: "S" },
      { id: "v_sc", abbreviation: "Sc" },
    ];
    assert.equal(stripCatalogVendor("Sc 200", vendors).vendorId, "v_sc");
    assert.deepEqual(stripCatalogVendor("Mi", VENDORS), { vendorId: null, rest: "mi" });
  });

  it("still answers parseCatalogSearch's own documented examples", () => {
    for (const input of ["Mi PL 200", "MiPL200", "Mi 200"]) {
      assert.deepEqual(parseCatalogSearch(input, VENDORS), { vendorId: "v_mi", number: "200" }, input);
    }
    for (const input of ["PL200", "200"]) {
      assert.deepEqual(parseCatalogSearch(input, VENDORS), { vendorId: null, number: "200" }, input);
    }
    assert.deepEqual(parseCatalogSearch("   ", VENDORS), { vendorId: null, number: "" });
  });
});
