import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseLotNo,
  parseLotPrice,
  parseOfferRef,
  parseProposalRef,
  parseProposalSaleLots,
  proposalDeletionRecord,
  proposalRecord,
  proposalRow,
  proposalSaleLotsWithPicks,
  proposalSaleOptions,
} from "../../src/lib/agent-api/proposal-reads";
import { ApiError } from "../../src/lib/agent-api/errors";
import { proposalDeletionText, type ProposalDeletion } from "../../src/lib/proposal-rules";

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
        pickedLotCount: 1,
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
    assert.equal(row.pickedLots, 1);
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
        post: null,
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
            pick: null,
          },
        ],
        total: "0.00",
        unpriced: 1,
        currency: "PLN",
        buyerPicks: null,
      },
      new Map([["o1", ["#12", "#15"]]]),
      { text: "Lot 1 …", language: "de", languages: ["pl", "de"] },
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
      pick: null,
    });
    assert.equal(record.buyerPicks, null);
    assert.equal(record.message, "Lot 1 …");
    assert.equal(record.language, "de");
    assert.deepEqual(record.languages, ["pl", "de"]);
    assert.equal(record.sale, null);
    assert.equal(record.post, null);
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
      picked: lotNo === 4,
    });
    const options = proposalSaleOptions({
      lots: [lot(1, "ready"), lot(2, "sold"), lot(3, "withdrawn"), lot(4, "preparing")],
      sales: [],
      platformName: "Direct",
      post: null,
    });
    assert.deepEqual(
      options.lots.map((l) => [l.lotNo, l.state]),
      [
        [1, "ready"],
        [4, "preparing"],
      ]
    );
    assert.deepEqual(
      options.lots.map((l) => [l.lotNo, l.picked]),
      [
        [1, false],
        [4, true],
      ]
    );
  });
});

describe("the buyer's picks (#2607)", () => {
  const contact = { id: "c1", name: "Jan Kowalski" };
  const lot = (lotNo: number, state: string, pick: string | null) => ({
    offerId: `o${lotNo}`,
    offerNo: 100 + lotNo,
    lotNo,
    title: `Lot ${lotNo}`,
    state,
    listingType: "buy_now",
    price: "5.00",
    currency: "PLN",
    setCount: 1,
    pick,
  });

  it("states which lots the buyer picked and when they last changed them, the unavailable ones marked", () => {
    const record = proposalRecord(
      {
        proposalId: "p1",
        proposalNo: 4,
        status: "sent",
        contact,
        createdOn: "2026-11-01",
        sentOn: "2026-11-02",
        closedOn: null,
        platform: { id: "d1", name: "Direct" },
        post: null,
        sale: null,
        lots: [lot(1, "ready", null), lot(2, "ready", "picked"), lot(5, "sold", "unavailable"), lot(7, "ready", "picked")],
        total: "20.00",
        unpriced: 0,
        currency: "PLN",
        buyerPicks: { count: 3, changedAt: "2026-11-21T10:00:00.000Z" },
      },
      new Map(),
      { text: null, language: null, languages: [] },
      "/c/x/offers/proposals/4"
    );
    assert.deepEqual(record.buyerPicks, { lots: [2, 5, 7], changedAt: "2026-11-21T10:00:00.000Z" });
    assert.deepEqual(
      record.lots.map((l) => [l.lotNo, l.pick]),
      [
        [1, null],
        [2, "picked"],
        [5, "unavailable"],
        [7, "picked"],
      ]
    );
  });

  const lots = [
    { lotNo: 1, pick: null },
    { lotNo: 2, pick: "picked" },
    { lotNo: 4, pick: "unavailable" },
    { lotNo: 5, pick: "picked" },
    { lotNo: 7, pick: "picked" },
  ];

  it("sells the picks still for sale at their own prices, passing over one no longer available", () => {
    assert.deepEqual(proposalSaleLotsWithPicks([" Picked "], lots, "lots", 4), [
      { lotNo: 2, price: null },
      { lotNo: 5, price: null },
      { lotNo: 7, price: null },
    ]);
  });

  it("adds a lot named beside the picks, and takes a price agreed for a picked one", () => {
    assert.deepEqual(proposalSaleLotsWithPicks(["5=30", "picked", "1"], lots, "lots", 4), [
      { lotNo: 1, price: null },
      { lotNo: 2, price: null },
      { lotNo: 5, price: "30.00" },
      { lotNo: 7, price: null },
    ]);
  });

  it("is the plain grammar without the word", () => {
    assert.deepEqual(proposalSaleLotsWithPicks(["7", "2=10"], lots, "lots", 4), [
      { lotNo: 7, price: null },
      { lotNo: 2, price: "10.00" },
    ]);
  });

  it("refuses the picks when none is left to sell, and the word named twice", () => {
    assert.match(
      refusal(() => proposalSaleLotsWithPicks(["picked"], [{ lotNo: 1, pick: null }], "lots", 4)),
      /The buyer has picked no lot of proposal #4/
    );
    assert.match(
      refusal(() => proposalSaleLotsWithPicks(["picked", "1"], [{ lotNo: 1, pick: null }, { lotNo: 3, pick: "unavailable" }], "lots", 4)),
      /— 3 — are no longer available/
    );
    assert.match(refusal(() => proposalSaleLotsWithPicks(["picked", "PICKED"], lots, "lots", 4)), /named twice/);
  });
});

describe("a proposal made from a Facebook post (#2608)", () => {
  it("names its post — by number, title and group", () => {
    const record = proposalRecord(
      {
        proposalId: "p1",
        proposalNo: 9,
        status: "preparing",
        contact: { id: "c1", name: "Jan Kowalski" },
        createdOn: "2026-11-21",
        sentOn: null,
        closedOn: null,
        platform: { id: "d1", name: "Direct" },
        post: { postId: "fp1", postNo: 12, title: "Poland 1950s", groupName: "Stamps PL" },
        sale: null,
        lots: [],
        total: "0.00",
        unpriced: 0,
        currency: "PLN",
        buyerPicks: null,
      },
      new Map(),
      { text: null, language: null, languages: [] },
      "/c/x/offers/proposals/9"
    );
    assert.deepEqual(record.post, { id: "fp1", postNo: 12, title: "Poland 1950s", group: "Stamps PL" });
  });

  it("says in the sale options that the lots not taken stay in the post", () => {
    const options = proposalSaleOptions({
      lots: [],
      sales: [],
      platformName: "Facebook",
      post: { postNo: 12, groupName: "Stamps PL" },
    });
    assert.equal(options.newSalePlatform, "Facebook");
    assert.deepEqual(options.post, { postNo: 12, group: "Stamps PL" });
  });
});

describe("what deleting a proposal would do (#2642)", () => {
  const preparing: ProposalDeletion = {
    proposalNo: 7,
    contactName: "Jan Kowalski",
    status: "preparing",
    lotCount: 5,
    soldLotCount: 0,
    post: null,
    hasLink: false,
  };

  it("counts the lots going and says it in the dialog's own words", () => {
    const record = proposalDeletionRecord("p-7", preparing);
    assert.deepEqual(record, {
      id: "p-7",
      proposalNo: 7,
      contactName: "Jan Kowalski",
      status: "preparing",
      deletable: true,
      refusal: null,
      lotsDeleted: 5,
      soldLotsKept: 0,
      post: null,
      linkStopsWorking: false,
      confirmation: proposalDeletionText(preparing),
    });
    assert.match(record.confirmation[0], /all 5 of its lots/);
    assert.equal(record.confirmation.at(-1), "This cannot be undone.");
  });

  it("refuses a sold proposal with the app's sentence and no confirmation", () => {
    const record = proposalDeletionRecord("p-7", { ...preparing, status: "sold" });
    assert.equal(record.deletable, false);
    assert.equal(record.refusal, "A sold proposal cannot be deleted — it is the record of how its sale came about.");
    assert.deepEqual(record.confirmation, []);
  });

  it("says the buyer's link stops working for a sent proposal, or any with a link", () => {
    assert.equal(proposalDeletionRecord("p", { ...preparing, status: "sent" }).linkStopsWorking, true);
    assert.equal(proposalDeletionRecord("p", { ...preparing, hasLink: true }).linkStopsWorking, true);
    assert.equal(proposalDeletionRecord("p", { ...preparing, status: "declined" }).linkStopsWorking, false);
  });

  it("keeps a post's lots in the post, deleting none", () => {
    const record = proposalDeletionRecord("p", { ...preparing, lotCount: 0, post: { postNo: 12, lotCount: 3 } });
    assert.deepEqual(record.post, { postNo: 12, lotsKept: 3 });
    assert.equal(record.lotsDeleted, 0);
    assert.match(record.confirmation[0], /Its 3 lots stay in post #12/);
  });

  it("keeps a sold lot with its sale", () => {
    const record = proposalDeletionRecord("p", { ...preparing, status: "declined", lotCount: 2, soldLotCount: 1 });
    assert.equal(record.lotsDeleted, 2);
    assert.equal(record.soldLotsKept, 1);
    assert.equal(record.confirmation[1], "Its sold lot is kept with its sale, no longer in a proposal.");
  });
});
