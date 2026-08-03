import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buyerIdentityFor,
  mapLineToSets,
  matchShippingMethod,
  saleDateOf,
  type MappableSet,
  type MatchableShippingMethod,
} from "../../src/lib/allegro-sale-rules";

const METHODS: MatchableShippingMethod[] = [
  { id: "m1", name: "List polecony ekonomiczny", cost: "8.50", currency: "PLN" },
  { id: "m2", name: "Kurier InPost", cost: "14.99", currency: "PLN" },
];

describe("matchShippingMethod", () => {
  it("matches the platform's own method by name, and carries its cost", () => {
    const prefill = matchShippingMethod(METHODS, "Kurier InPost");
    assert.deepEqual(prefill, {
      methodId: "m2",
      methodName: "Kurier InPost",
      cost: "14.99",
      currency: "PLN",
    });
  });

  it("ignores case and runs of whitespace — the two lists are written by different hands", () => {
    const prefill = matchShippingMethod(METHODS, "  kurier   inpost ");
    assert.equal(prefill?.methodId, "m2");
    // The dictionary's own wording wins for the name, not Allegro's.
    assert.equal(prefill?.methodName, "Kurier InPost");
  });

  it("falls back to a one-off carrying Allegro's wording, with no cost", () => {
    const prefill = matchShippingMethod(METHODS, "Paczkomat 24/7");
    assert.deepEqual(prefill, {
      methodId: null,
      methodName: "Paczkomat 24/7",
      // Blank on purpose: Allegro's delivery figure is what the *buyer* paid, and the shipping cost
      // column is what posting it costs the collector.
      cost: "",
      currency: "",
    });
  });

  it("says nothing at all when the order carries no method", () => {
    assert.equal(matchShippingMethod(METHODS, null), null);
    assert.equal(matchShippingMethod(METHODS, "   "), null);
  });
});

const set = (id: string): MappableSet => ({ offerSetId: id, label: id, itemIds: [`${id}-item`] });

describe("mapLineToSets", () => {
  it("takes the offer's only set when one was bought", () => {
    const mapping = mapLineToSets(1, [set("s1")]);
    assert.equal(mapping.skipped, null);
    assert.deepEqual(
      mapping.sets.map((s) => s.offerSetId),
      ["s1"]
    );
  });

  it("takes every set when the quantity sold the offer out", () => {
    const mapping = mapLineToSets(3, [set("s1"), set("s2"), set("s3")]);
    assert.equal(mapping.skipped, null);
    assert.equal(mapping.sets.length, 3);
  });

  it("refuses when fewer were bought than are left — which one sold is a guess", () => {
    const mapping = mapLineToSets(1, [set("s1"), set("s2")]);
    assert.deepEqual(mapping, { sets: [], skipped: "ambiguous" });
  });

  it("refuses when more were bought than this collection has left", () => {
    const mapping = mapLineToSets(4, [set("s1"), set("s2")]);
    assert.deepEqual(mapping, { sets: [], skipped: "ambiguous" });
  });

  it("reports an offer with nothing left to sell as sold out, not as ambiguous", () => {
    assert.deepEqual(mapLineToSets(1, []), { sets: [], skipped: "sold-out" });
  });
});

describe("saleDateOf", () => {
  it("dates the sale by the day the collector's own clock showed", () => {
    const boughtAt = new Date(2026, 6, 4, 22, 15);
    assert.equal(saleDateOf(boughtAt), "2026-07-04");
  });

  it("pads month and day so the date input takes it", () => {
    assert.equal(saleDateOf(new Date(2026, 0, 9, 8, 0)), "2026-01-09");
  });
});

describe("buyerIdentityFor", () => {
  it("files the buyer under their login, keeping the legal name beside it", () => {
    // The login leads because that is how buyers are already named in the address book — filing
    // them under the legal name would create a second contact for somebody already there.
    assert.deepEqual(buyerIdentityFor({ buyerName: "Jan Kowalski", buyerLogin: "jkowalski" }), {
      name: "jkowalski",
      fullName: "Jan Kowalski",
    });
  });

  it("keeps nothing beside a login the order states no name for", () => {
    assert.deepEqual(buyerIdentityFor({ buyerName: null, buyerLogin: "jkowalski" }), {
      name: "jkowalski",
      fullName: null,
    });
    assert.deepEqual(buyerIdentityFor({ buyerName: "  ", buyerLogin: "jkowalski" }), {
      name: "jkowalski",
      fullName: null,
    });
  });

  it("does not record one name twice", () => {
    assert.deepEqual(buyerIdentityFor({ buyerName: "jkowalski", buyerLogin: "jkowalski" }), {
      name: "jkowalski",
      fullName: null,
    });
  });

  it("uses the stated name as the identity when there is no login", () => {
    assert.deepEqual(buyerIdentityFor({ buyerName: "Jan Kowalski", buyerLogin: null }), {
      name: "Jan Kowalski",
      fullName: null,
    });
  });

  it("leaves the sale anonymous rather than inventing a buyer", () => {
    assert.deepEqual(buyerIdentityFor({ buyerName: null, buyerLogin: null }), {
      name: null,
      fullName: null,
    });
  });
});
