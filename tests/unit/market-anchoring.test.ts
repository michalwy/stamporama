import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  anchoringResolver,
  countByMarket,
  effectiveMarket,
  formatMarketCounts,
  normalizeMarketCode,
  normalizeMarketList,
  resolveAnchoringMarkets,
  resultMarket,
  type AnchoringArea,
} from "../../src/lib/market-anchoring";
import {
  partitionByAnchoring,
  valuateMarket,
  valuateMarketWithHints,
  type MarketLotInput,
  type MarketObservationInput,
} from "../../src/lib/market-value";

// Markets on auction results, and the markets that anchor each area's valuations (#1634; ADR-0064).
// Which results count is a rule over fields the caller has read, so it is held here.

const NOW = new Date("2026-06-01T00:00:00Z");
const DAY = new Date("2026-01-15T00:00:00Z");

// Europe › Germany › Danzig, and Poland beside Germany. Germany names its markets; Danzig inherits.
const AREAS: AnchoringArea[] = [
  { id: "europe", parentId: null, anchorMarkets: [] },
  { id: "germany", parentId: "europe", anchorMarkets: ["DE", "AT", "CH"] },
  { id: "danzig", parentId: "germany", anchorMarkets: [] },
  { id: "poland", parentId: "europe", anchorMarkets: [] },
  { id: "gg", parentId: "poland", anchorMarkets: ["pl", " de "] },
];

describe("market codes", () => {
  it("normalizes a typed code and refuses anything that is not two letters", () => {
    assert.equal(normalizeMarketCode(" de "), "DE");
    assert.equal(normalizeMarketCode("DEU"), null);
    assert.equal(normalizeMarketCode(""), null);
    assert.equal(normalizeMarketCode(null), null);
  });

  it("stores a list deduplicated and sorted, so two lists naming the same markets are equal", () => {
    assert.deepEqual(normalizeMarketList(["de", "AT", "DE", "x", ""]), ["AT", "DE"]);
  });
});

describe("resultMarket — where a result was sold", () => {
  it("takes the first contact that names a market: the house before the platform", () => {
    assert.equal(resultMarket({ market: "DE" }, { market: "PL" }), "DE");
    assert.equal(resultMarket({ market: null }, { market: "PL" }), "PL");
    assert.equal(resultMarket(null, { market: "PL" }), "PL");
  });

  it("is not known when no contact names one, and then counts as the home market", () => {
    assert.equal(resultMarket({ market: null }, { market: null }), null);
    assert.equal(effectiveMarket(null, "PL"), "PL");
    assert.equal(effectiveMarket("DE", "PL"), "DE");
  });
});

describe("resolveAnchoringMarkets — the whole list inherits down the tree", () => {
  const resolved = resolveAnchoringMarkets(AREAS, "PL");

  it("gives an area its own markets when it names any", () => {
    assert.deepEqual(resolved.get("germany"), ["AT", "CH", "DE"]);
  });

  it("gives a sub-area that names none its nearest ancestor's", () => {
    assert.deepEqual(resolved.get("danzig"), ["AT", "CH", "DE"]);
  });

  it("states an area's markets completely: naming PL and DE does not keep any parent's", () => {
    assert.deepEqual(resolved.get("gg"), ["DE", "PL"]);
  });

  it("anchors a tree that names nothing on the home market", () => {
    assert.deepEqual(resolved.get("europe"), ["PL"]);
    assert.deepEqual(resolved.get("poland"), ["PL"]);
  });
});

describe("anchoringResolver — whether a result counts for a stamp", () => {
  const anchoring = anchoringResolver(
    "PL",
    new Map<string, string | null>([
      ["danzig-stamp", "danzig"],
      ["polish-stamp", "poland"],
    ]),
    resolveAnchoringMarkets(AREAS, "PL")
  );

  it("counts a foreign result for German material and not for Polish", () => {
    assert.equal(anchoring.anchors("danzig-stamp", "DE"), true);
    assert.equal(anchoring.anchors("polish-stamp", "DE"), false);
  });

  it("counts a result with no market as the home market", () => {
    assert.equal(anchoring.anchors("polish-stamp", null), true);
    assert.equal(anchoring.anchors("danzig-stamp", null), false);
  });

  it("anchors a stamp in no area on the home market", () => {
    assert.deepEqual(anchoring.anchorsOf("loose-stamp"), ["PL"]);
    assert.equal(anchoring.anchors("loose-stamp", "PL"), true);
    assert.equal(anchoring.anchors("loose-stamp", "DE"), false);
  });
});

describe("countByMarket — what a figure says it stands on", () => {
  it("counts the most first, then by code, with not known last", () => {
    const counts = countByMarket(["DE", null, "PL", "PL", "AT", "DE", "PL"]);
    assert.deepEqual(counts, [
      { market: "PL", count: 3 },
      { market: "DE", count: 2 },
      { market: "AT", count: 1 },
      { market: null, count: 1 },
    ]);
    assert.equal(formatMarketCounts(counts), "3 PL · 2 DE · 1 AT · 1 not known");
    assert.equal(formatMarketCounts([]), "");
  });
});

describe("valuateMarket — only anchoring-market results enter a figure", () => {
  const anchoring = anchoringResolver(
    "PL",
    new Map<string, string | null>([
      ["danzig-stamp", "danzig"],
      ["polish-stamp", "poland"],
    ]),
    resolveAnchoringMarkets(AREAS, "PL")
  );

  function lot(market: string | null, finalPrice: string, lines: MarketLotInput["lines"]): MarketLotInput {
    return {
      lotId: `lot-${finalPrice}-${market}`,
      status: "closed",
      endsAt: DAY,
      finalPrice,
      fxRateToBase: null,
      inBaseCurrency: true,
      market,
      lines,
    };
  }

  function observation(market: string | null, hammer: string): MarketObservationInput {
    return {
      observationId: `obs-${hammer}-${market}`,
      stampId: "polish-stamp",
      conditionId: "mnh",
      certificateStatusId: null,
      formatId: null,
      exact: true,
      soldOn: DAY,
      hammer,
      fxRateToBase: null,
      inBaseCurrency: true,
      market,
    };
  }

  const line = (stampId: string, unitCatalogueValue: number | null = null) => ({
    lineId: `${stampId}-line`,
    stampId,
    conditionId: "mnh",
    certificateStatusId: null,
    formatId: null,
    quantity: 1,
    unitCatalogueValue,
  });

  it("leaves a foreign result out of a Polish stamp's median and keeps it as a hint", () => {
    const { valuations, hints } = valuateMarketWithHints(
      [lot("PL", "10.00", [line("polish-stamp")]), lot(null, "20.00", [line("polish-stamp")])],
      NOW,
      [observation("DE", "500.00")],
      anchoring
    );
    assert.equal(valuations.length, 1);
    assert.equal(valuations[0].n, 2);
    assert.equal(valuations[0].median, 15);
    assert.deepEqual(valuations[0].markets, [
      { market: "PL", count: 1 },
      { market: null, count: 1 },
    ]);
    assert.equal(hints.length, 1);
    assert.equal(hints[0].market, "DE");
    assert.equal(hints[0].source.kind, "observation");
  });

  it("judges each line of a mixed lot by its own stamp, without touching the split", () => {
    const mixed = lot("DE", "100.00", [line("danzig-stamp", 30), line("polish-stamp", 10)]);
    const { anchored, hints } = partitionByAnchoring(
      valuateMarketWithHints([mixed], NOW, [], undefined).valuations.flatMap((v) => v.datapoints),
      anchoring
    );
    assert.deepEqual(
      anchored.map((p) => [p.key.stampId, p.amount]),
      [["danzig-stamp", 75]]
    );
    assert.deepEqual(
      hints.map((p) => [p.key.stampId, p.amount]),
      [["polish-stamp", 25]]
    );
  });

  it("gives a key with only hints no market value at all", () => {
    assert.deepEqual(valuateMarket([], NOW, [observation("DE", "40.00")], anchoring), []);
  });

  it("counts everything when no resolver is given — the rule before markets", () => {
    const [value] = valuateMarket([], NOW, [observation("DE", "40.00")]);
    assert.equal(value.n, 1);
  });
});
