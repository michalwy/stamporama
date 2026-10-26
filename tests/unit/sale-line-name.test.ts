import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { offerSetOrdinal, saleLineHeading, saleLineName } from "../../src/lib/sale-line-name";

// A sale line named by the offer it sold through (#2189) ---------------------------------------

const NUMBERS = "Fi·PL 377-78,380-85";
const TITLE = "🇵🇱 Polska: Zestaw znaczków kasowanych";

describe("saleLineName", () => {
  it("heads a line with its offer's number and title, the set's numbers under it", () => {
    const name = saleLineName({
      setLabel: NUMBERS,
      setNumbers: NUMBERS,
      offer: { offerNo: 2848, title: TITLE, set: null },
    });
    assert.deepEqual(name, { offerNo: 2848, title: TITLE, numbers: NUMBERS });
    assert.equal(saleLineHeading(name), `#2848 · ${TITLE}`);
  });

  it("says which set a partial sale of a multi-set offer took, with the set's own name", () => {
    const offer = { offerNo: 2848, title: TITLE };
    assert.equal(
      saleLineName({ setLabel: NUMBERS, setNumbers: NUMBERS, offer: { ...offer, set: { position: 2, count: 5, ownName: null } } }).title,
      `${TITLE} — set 2 of 5`
    );
    assert.equal(
      saleLineName({
        setLabel: "Chopin pair",
        setNumbers: NUMBERS,
        offer: { ...offer, set: { position: 2, count: 5, ownName: "Chopin pair" } },
      }).title,
      `${TITLE} — set 2 of 5 · Chopin pair`
    );
  });

  it("keeps the set's own label on a set sold off no offer, or from a deleted one", () => {
    const name = saleLineName({ setLabel: NUMBERS, setNumbers: NUMBERS, offer: null });
    assert.deepEqual(name, { offerNo: null, title: NUMBERS, numbers: null });
    assert.equal(saleLineHeading(name), NUMBERS);
  });

  it("still shows the numbers under a set whose own title heads the line", () => {
    const name = saleLineName({ setLabel: "Chopin pair", setNumbers: NUMBERS, offer: null });
    assert.deepEqual(name, { offerNo: null, title: "Chopin pair", numbers: NUMBERS });
  });

  it("prints no second line when there are no numbers", () => {
    assert.equal(
      saleLineName({ setLabel: "Copy", setNumbers: "", offer: { offerNo: 1, title: "Lot", set: null } }).numbers,
      null
    );
  });
});

describe("offerSetOrdinal", () => {
  const SETS = ["a", "b", "c"];

  it("numbers the set in the offer's own order when the sale took only some", () => {
    assert.deepEqual(offerSetOrdinal(SETS, "b", 1), { position: 2, count: 3 });
    assert.deepEqual(offerSetOrdinal(SETS, "c", 2), { position: 3, count: 3 });
  });

  it("says nothing on a single-set offer or when the sale took every set", () => {
    assert.equal(offerSetOrdinal(["a"], "a", 1), null);
    assert.equal(offerSetOrdinal(SETS, "a", 3), null);
  });

  it("says nothing for a set the offer no longer lists", () => {
    assert.equal(offerSetOrdinal(SETS, "z", 1), null);
  });
});
