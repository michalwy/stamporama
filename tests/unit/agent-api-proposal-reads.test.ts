import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseLotNo,
  parseLotPrice,
  parseOfferRef,
  parseProposalRef,
  parseProposalSaleLots,
  proposalRecord,
  proposalRow,
  proposalSaleOptions,
} from "../../src/lib/agent-api/proposal-reads";
import { ApiError } from "../../src/lib/agent-api/errors";

// The proposal operations' projections and grammar (#2303), held without a database.

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError, `expected an ApiError, got ${String(error)}`);
    return error.message;
  }
  assert.fail("expected a refusal");
}

describe("naming a proposal, an offer and a lot (#2303)", () => {
  it("reads a proposal by its number as the collector writes it, or by id", () => {
    assert.deepEqual(parseProposalRef("4"), { kind: "number", proposalNo: 4 });
    assert.deepEqual(parseProposalRef(" p4 "), { kind: "number", proposalNo: 4 });
    assert.deepEqual(parseProposalRef("#4"), { kind: "number", proposalNo: 4 });
    assert.deepEqual(parseProposalRef("cm3abc"), { kind: "id", id: "cm3abc" });
  });

  it("reads an offer by its number or id", () => {
    assert.deepEqual(parseOfferRef("#2680"), { kind: "number", offerNo: 2680 });
    assert.deepEqual(parseOfferRef("2680"), { kind: "number", offerNo: 2680 });
    assert.deepEqual(parseOfferRef("cm3offer"), { kind: "id", id: "cm3offer" });
  });

  it("reads a lot number and refuses anything else", () => {
    assert.equal(parseLotNo("2", "lot"), 2);
    assert.equal(parseLotNo("#7", "lot"), 7);
    assert.match(refusal(() => parseLotNo("0", "lot")), /not a lot number/);
    assert.match(refusal(() => parseLotNo("two", "lot")), /`get_proposal` lists them/);
  });

  it("reads a price to the cent, refusing a third decimal or a comma", () => {
    assert.equal(parseLotPrice("15", "price"), "15.00");
    assert.equal(parseLotPrice("15.5", "price"), "15.50");
    assert.match(refusal(() => parseLotPrice("15.555", "price")), /at most two decimal places/);
    assert.match(refusal(() => parseLotPrice("15,50", "price")), /period as the separator/);
  });
});

describe("the lots the buyer took (#2303)", () => {
  it("sells a lot named alone at its own price, and one with a figure at that figure", () => {
    assert.deepEqual(parseProposalSaleLots(["2", "5=35", " 7 = 12.50 "], "lots"), [
      { lotNo: 2, price: null },
      { lotNo: 5, price: "35.00" },
      { lotNo: 7, price: "12.50" },
    ]);
  });

  it("refuses a lot named twice, a bad figure and a word", () => {
    assert.match(refusal(() => parseProposalSaleLots(["2", "2=10"], "lots")), /Lot 2 is named twice/);
    assert.match(refusal(() => parseProposalSaleLots(["2=ten"], "lots")), /not a price for lot 2/);
    assert.match(refusal(() => parseProposalSaleLots(["lot two"], "lots")), /not a lot for "lots"/);
  });
});

describe("what a proposal is told as (#2303)", () => {
  const contact = { id: "c1", name: "Jan Kowalski", email: "jan@example.com", phone: "+48 500" };

  it("states a row with the contact's name and id only", () => {
    const row = proposalRow(
      {
        proposalId: "p1",
        proposalNo: 4,
        contact,
        status: "sent",
        lotCount: 3,
        openLotCount: 2,
        total: "80.00",
        unpriced: 1,
        currency: "PLN",
        createdOn: "2026-11-01",
        sentOn: "2026-11-01",
      },
      "/c/x/offers/proposals/4"
    );
    assert.deepEqual(row.contact, { id: "c1", name: "Jan Kowalski" });
    assert.equal(row.lots, 3);
    assert.equal(row.openLots, 2);
    assert.ok(!JSON.stringify(row).includes("example.com"));
  });

  it("states each lot with its number, offer, copies and price, and the message", () => {
    const record = proposalRecord(
      {
        proposalId: "p1",
        proposalNo: 4,
        status: "preparing",
        contact,
        createdOn: "2026-11-01",
        sentOn: null,
        closedOn: null,
        platform: { id: "d1", name: "Direct" },
        sale: null,
        lots: [
          {
            offerId: "o1",
            offerNo: 2680,
            lotNo: 1,
            title: "Mercury #2680",
            state: "preparing",
            listingType: "buy_now",
            price: null,
            currency: "PLN",
            setCount: 1,
          },
        ],
        total: "0.00",
        unpriced: 1,
        currency: "PLN",
      },
      new Map([["o1", ["#12", "#15"]]]),
      "Lot 1 …",
      "/c/x/offers/proposals/4"
    );
    assert.deepEqual(record.lots[0], {
      lotNo: 1,
      offerId: "o1",
      offerNo: 2680,
      title: "Mercury #2680",
      state: "preparing",
      listingType: "buy_now",
      price: null,
      currency: "PLN",
      sets: 1,
      copies: ["#12", "#15"],
    });
    assert.equal(record.message, "Lot 1 …");
    assert.equal(record.sale, null);
    assert.ok(!JSON.stringify(record).includes("example.com"));
  });
});

describe("what a proposal can be sold as (#2303, #2336)", () => {
  it("lists only the open lots, though the convert window lists every one", () => {
    const lot = (lotNo: number, state: string) => ({
      offerId: `o${lotNo}`,
      offerNo: 100 + lotNo,
      lotNo,
      title: `Lot ${lotNo}`,
      state,
      price: "5.00",
      currency: "PLN",
      setsToSell: state === "sold" ? 0 : 1,
    });
    const options = proposalSaleOptions({
      lots: [lot(1, "ready"), lot(2, "sold"), lot(3, "withdrawn"), lot(4, "preparing")],
      sales: [],
      platformName: "Direct",
    });
    assert.deepEqual(
      options.lots.map((l) => [l.lotNo, l.state]),
      [
        [1, "ready"],
        [4, "preparing"],
      ]
    );
  });
});
