import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeLastSaleNote,
  describeOutcome,
  earlierOffers,
  earlierOffersAxes,
  OTHER_CONDITION_AXIS,
  setConditionKey,
  setStampKey,
  type EarlierSetInput,
  type MatchCopyInput,
  type OwnSetInput,
} from "../../src/lib/earlier-offers-rules";
import { agentEarlierOffer } from "../../src/lib/agent-api/offer-reads";

const copy = (stampId: string, conditionId: string | null = "mnh", over: Partial<MatchCopyInput> = {}): MatchCopyInput => ({
  conditionId,
  conditionName: conditionId === null ? null : conditionId.toUpperCase(),
  stamps: [{ stampId, quantity: 1, formatId: null }],
  ...over,
});
const series = (conditionId: string | null = "mnh") => [copy("a", conditionId), copy("b", conditionId), copy("c", conditionId)];

const own = (copies: MatchCopyInput[] = series(), setId = "own-1", label = "Mi 1-3"): OwnSetInput => ({ setId, label, copies });

let next = 0;
const earlier = (over: Partial<EarlierSetInput> = {}): EarlierSetInput => {
  next++;
  return {
    setId: `set-${next}`,
    offerId: `offer-${next}`,
    offerNo: 100 + next,
    platformId: "colnect",
    platformName: "Colnect",
    state: "withdrawn",
    date: new Date("2026-06-01"),
    listed: "10.00",
    sale: null,
    setPosition: 1,
    setCount: 1,
    copies: series(),
    ...over,
  };
};
const sold = (amount: string | null, day: string) => ({ state: "sold" as const, sale: { amount, soldAt: new Date(day) } });

describe("the same stamps (#2521)", () => {
  it("is a set holding exactly the same stamps, in any order", () => {
    assert.equal(setStampKey([copy("b"), copy("a")]), setStampKey([copy("a"), copy("b")]));
    assert.notEqual(setStampKey([copy("a"), copy("b")]), setStampKey([copy("a")]));
    assert.notEqual(setStampKey([copy("a"), copy("b")]), setStampKey([copy("a"), copy("b"), copy("c")]));
  });

  it("tells a block from a single, and a piece by the stamps it carries", () => {
    const block = copy("a", "mnh", { stamps: [{ stampId: "a", quantity: 1, formatId: "block-4" }] });
    assert.notEqual(setStampKey([block]), setStampKey([copy("a")]));
    const piece = copy("a", null, {
      stamps: [
        { stampId: "b", quantity: 1, formatId: null },
        { stampId: "a", quantity: 2, formatId: null },
      ],
    });
    const same = copy("x", null, {
      stamps: [
        { stampId: "a", quantity: 2, formatId: null },
        { stampId: "b", quantity: 1, formatId: null },
      ],
    });
    assert.equal(setStampKey([piece]), setStampKey([same]));
  });

  it("is the same condition only with each copy's condition the same", () => {
    assert.equal(setConditionKey(series("mnh")), setConditionKey(series("mnh")));
    assert.notEqual(setConditionKey(series("mnh")), setConditionKey(series("used")));
    assert.equal(setStampKey(series("mnh")), setStampKey(series("used")));
  });
});

describe("earlierOffers (#2521)", () => {
  it("lists every earlier offer of the same stamps, newest first, leaving out part or more of them", () => {
    const older = earlier({ date: new Date("2026-01-01") });
    const newer = earlier({ date: new Date("2026-09-01") });
    const part = earlier({ copies: [copy("a"), copy("b")] });
    const more = earlier({ copies: [...series(), copy("d")] });
    const result = earlierOffers([own()], [older, part, newer, more], "colnect");
    assert.deepEqual(
      result.rows.map((r) => r.setId),
      [newer.setId, older.setId]
    );
  });

  it("lists another condition greyed, and never counts it as a last sale", () => {
    const used = earlier({ copies: series("used"), ...sold("40.00", "2026-10-01") });
    const result = earlierOffers([own()], [used], "colnect");
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].sameCondition, false);
    assert.equal(result.rows[0].conditionLabel, "USED");
    assert.equal(result.lastSale.platform, null);
    assert.equal(result.lastSale.any, null);
  });

  it("gives the last sale on this platform and on any platform — the Done-when case", () => {
    // A series sold earlier on Colnect and on Facebook in the same condition.
    const colnect = earlier({ offerNo: 7, ...sold("12.00", "2026-08-01"), listed: "15.00" });
    const colnectOlder = earlier({ offerNo: 5, ...sold("9.00", "2026-03-01") });
    const facebook = earlier({
      offerNo: 9,
      platformId: "facebook",
      platformName: "Facebook",
      ...sold("25.00", "2026-10-03"),
    });
    const withdrawn = earlier({ offerNo: 3 });
    const result = earlierOffers([own()], [colnect, colnectOlder, facebook, withdrawn], "colnect");
    assert.equal(result.lastSale.platform?.amount, "12.00");
    assert.equal(result.lastSale.platform?.sources[0].offerNo, 7);
    assert.equal(result.lastSale.any?.amount, "25.00");
    assert.equal(result.lastSale.any?.sources[0].platformName, "Facebook");
    assert.equal(describeLastSaleNote(result.lastSale.platform!, false), "#7, 2026-08-01");
    assert.equal(describeLastSaleNote(result.lastSale.any!, true), "Facebook, #9, 2026-10-03");
    // What it sold for, never the listed price.
    assert.equal(result.rows.find((r) => r.offerNo === 7)?.listed, "15.00");
  });

  it("has nothing for stamps never offered before", () => {
    const result = earlierOffers([own([copy("z")])], [earlier()], "colnect");
    assert.deepEqual(result.rows, []);
    assert.equal(result.lastSale.platform, null);
    assert.equal(result.lastSale.any, null);
    assert.deepEqual(result.lastSaleUnconvertible, { platform: false, any: false });
  });

  it("says why a last sale is missing when no rate converts its amount", () => {
    const result = earlierOffers([own()], [earlier(sold(null, "2026-08-01"))], "colnect");
    assert.equal(result.lastSale.platform, null);
    assert.deepEqual(result.lastSaleUnconvertible, { platform: true, any: true });
  });

  it("matches each of several different sets on its own and names the set a row is for", () => {
    const pair = [copy("x"), copy("y")];
    const result = earlierOffers(
      [own(series(), "own-1", "Mi 1-3"), own(pair, "own-2", "Mi 8-9")],
      [earlier({ copies: pair, ...sold("4.00", "2026-05-01") }), earlier(sold("10.00", "2026-05-02"))],
      "colnect"
    );
    assert.deepEqual(result.rows.map((r) => r.forSet).sort(), ["Mi 1-3", "Mi 8-9"]);
    // Averaged per set, as every figure of the price table is.
    assert.equal(result.lastSale.platform?.amount, "7.00");
    assert.equal(result.lastSale.platform?.sources.length, 2);
    assert.equal(describeLastSaleNote(result.lastSale.platform!, false), "2 sales");
  });

  it("names no set where this offer's sets are all alike, and names the earlier offer's set where it had several", () => {
    const result = earlierOffers(
      [own(series(), "own-1"), own(series(), "own-2")],
      [earlier({ setPosition: 2, setCount: 3 })],
      "colnect"
    );
    assert.equal(result.rows[0].forSet, null);
    assert.equal(result.rows[0].setLabel, "set 2 of 3");
  });

  it("states each outcome — sold with its amount, withdrawn, still open, or not this set", () => {
    const rows = earlierOffers(
      [own()],
      [
        earlier({ ...sold("12.00", "2026-08-01"), date: new Date("2026-08-01") }),
        earlier({ state: "withdrawn", date: new Date("2026-07-01") }),
        earlier({ state: "active", date: new Date("2026-06-01") }),
        earlier({ state: "sold", sale: null, date: new Date("2026-05-01") }),
      ],
      "colnect"
    ).rows;
    assert.deepEqual(rows.map((r) => describeOutcome(r.outcome)), ["Sold 12.00", "Withdrawn", "Active", "Not sold"]);
    assert.deepEqual(
      rows.map((r) => agentEarlierOffer(r).outcome),
      ["sold", "withdrawn", "active", "not_sold"]
    );
    assert.equal(agentEarlierOffer(rows[0]).soldFor, "12.00");
    assert.equal(agentEarlierOffer(rows[0]).soldOn, "2026-08-01");
  });
});

describe("earlierOffersAxes (#2521)", () => {
  const zones = [
    { key: "below" as const, from: 0, to: 5, label: "Below Cost" },
    { key: "costEstimated" as const, from: 5, to: 20, label: "Cost–Est." },
    { key: "aboveCatalogue" as const, from: 20, to: null, label: "Above Cat." },
  ];

  it("draws an axis per platform, this one first, and one greyed axis for the other conditions", () => {
    const rows = earlierOffers(
      [own()],
      [
        earlier({ platformId: "allegro", platformName: "Allegro", ...sold("8.00", "2026-01-01") }),
        earlier({ platformId: "facebook", platformName: "Facebook", ...sold("25.00", "2026-10-03") }),
        earlier({ ...sold("12.00", "2026-08-01") }),
        earlier({ listed: "15.00" }),
        earlier({ copies: series("used"), listed: "6.00" }),
      ],
      "colnect"
    ).rows;
    const view = earlierOffersAxes(rows, "colnect", zones, null)!;
    assert.deepEqual(
      view.axes.map((a) => [a.key, a.greyed]),
      [
        ["colnect", false],
        ["allegro", false],
        ["facebook", false],
        [OTHER_CONDITION_AXIS, true],
      ]
    );
    const colnect = view.axes[0];
    // Filled where it sold, at what it sold for; hollow where it was listed and did not.
    assert.deepEqual(
      colnect.dots.map((d) => [d.amount, d.sold]).sort(),
      [
        ["12.00", true],
        ["15.00", false],
      ]
    );
  });

  it("runs linear from 0 to a little past the dearest price, the offer's own included, and cuts the zones there", () => {
    const rows = earlierOffers([own()], [earlier({ listed: "10.00" })], "colnect").rows;
    const view = earlierOffersAxes(rows, "colnect", zones, "30.00")!;
    assert.ok(view.max >= 30 * 1.1);
    assert.equal(view.own?.amount, "30.00");
    assert.ok(Math.abs(view.own!.position - 30 / view.max) < 1e-9);
    assert.equal(view.axes[0].dots[0].position, 10 / view.max);
    assert.equal(view.ticks[0].label, "0");
    assert.equal(view.ticks[0].position, 0);
    assert.deepEqual(
      view.zones.map((z) => z.key),
      ["below", "costEstimated", "aboveCatalogue"]
    );
    assert.equal(view.zones.at(-1)!.end, 1);
    // A zone that starts past the right end is not drawn.
    const short = earlierOffersAxes(rows, "colnect", zones, "15.00")!;
    assert.deepEqual(
      short.zones.map((z) => z.key),
      ["below", "costEstimated"]
    );
  });

  it("is null with no price to place", () => {
    const rows = earlierOffers([own()], [earlier({ listed: null })], "colnect").rows;
    assert.equal(earlierOffersAxes(rows, "colnect", zones, null), null);
  });
});
