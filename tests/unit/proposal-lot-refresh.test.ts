import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withProposalLot, withProposalLotPhotos } from "../../src/lib/proposal-lot-refresh";
import { lotGroupName, parseLotGroup } from "../../src/lib/offer-lot-group-rules";
import type { ProposalLot, ProposalLotUpdate, ProposalScreen } from "../../src/lib/proposals";
import type { ProposalLotPhotos } from "../../src/lib/proposal-handout";
import type { OfferTextStatus } from "../../src/lib/offers";

// One lot of a proposal's screen refreshed in place (#2313): what a saved price, title or state writes
// into the screen the browser already holds, instead of reading every lot again — and the group a lot
// tool is told to work on, as the browser hands it over.

function lot(offerId: string, over: Partial<ProposalLot> = {}): ProposalLot {
  return {
    offerId,
    offerNo: 1,
    lotNo: 1,
    title: `Lot ${offerId}`,
    state: "preparing",
    listingType: "fixed",
    price: null,
    currency: "EUR",
    setCount: 1,
    catalogSortKey: null,
    copyPhotoId: null,
    ...over,
  };
}

const text = (outOfDate: boolean, handWritten = false): OfferTextStatus =>
  ({ outOfDate, handWritten }) as OfferTextStatus;

function screen(over: Partial<ProposalScreen> = {}): ProposalScreen {
  return {
    proposalId: "p1",
    proposalNo: 3,
    collectionId: "c1",
    status: "preparing",
    contact: { id: "k1", name: "Anna" },
    createdOn: "2026-11-01",
    sentOn: null,
    closedOn: null,
    platform: { id: "d1", name: "Direct", enabled: true },
    sale: null,
    lots: [lot("a", { lotNo: 1 }), lot("b", { lotNo: 2 })],
    total: "0.00",
    unpriced: 2,
    currency: "EUR",
    sales: {},
    lotTexts: { a: text(false), b: text(true) },
    lotTitles: { template: "{name}", handWritten: ["a"] },
    ...over,
  };
}

function update(over: Partial<ProposalLotUpdate> = {}): ProposalLotUpdate {
  return {
    lot: lot("b", { lotNo: 2, price: "4.00" }),
    prepare: null,
    text: text(false, true),
    handWritten: true,
    total: "4.00",
    unpriced: 1,
    ...over,
  };
}

describe("withProposalLot (#2313)", () => {
  it("writes the lot, its text, its hand-written mark and the total in, leaving the other lots", () => {
    const before = screen();
    const after = withProposalLot(before, update());
    assert.equal(after.lots[0], before.lots[0]);
    assert.equal(after.lots[1].price, "4.00");
    assert.equal(after.total, "4.00");
    assert.equal(after.unpriced, 1);
    assert.deepEqual(after.lotTexts?.b, text(false, true));
    assert.deepEqual(after.lotTitles?.handWritten, ["a", "b"], "in lot order");
  });

  it("drops the hand-written mark when the title follows its template again", () => {
    const after = withProposalLot(screen({ lotTitles: { template: "", handWritten: ["a", "b"] } }), update({ handWritten: false }));
    assert.deepEqual(after.lotTitles?.handWritten, ["a"]);
  });

  it("leaves the texts as they were once the proposal is no longer being prepared", () => {
    const after = withProposalLot(screen({ lotTexts: null, lotTitles: null }), update({ text: null }));
    assert.equal(after.lotTexts, null);
    assert.equal(after.lotTitles, null);
  });

  it("leaves the screen alone for a lot no longer in the proposal", () => {
    const before = screen();
    assert.equal(withProposalLot(before, update({ lot: lot("gone") })), before);
  });
});

describe("withProposalLotPhotos (#2313)", () => {
  const photos = (offerId: string, n: number): ProposalLotPhotos => ({
    offerId,
    lotNo: 1,
    status: null,
    images: Array.from({ length: n }, (_, i) => ({ photoId: `${offerId}${i}`, fileName: `lot-01-${i}.jpg` })),
  });

  it("puts the lot's fresh photos in its place", () => {
    const after = withProposalLotPhotos([photos("a", 0), photos("b", 1)], photos("a", 2));
    assert.deepEqual(
      after?.map((p) => p.images.length),
      [2, 1]
    );
  });

  it("keeps what it had when nothing was read", () => {
    assert.equal(withProposalLotPhotos(undefined, photos("a", 1)), undefined);
    assert.deepEqual(withProposalLotPhotos([photos("a", 1)], null), [photos("a", 1)]);
  });
});

describe("parseLotGroup (#2313)", () => {
  it("takes a post or a proposal by id, and nothing else", () => {
    assert.deepEqual(parseLotGroup({ kind: "post", id: "x" }), { kind: "post", id: "x" });
    assert.deepEqual(parseLotGroup({ kind: "proposal", id: "y", extra: 1 }), { kind: "proposal", id: "y" });
    for (const raw of [null, "post", { kind: "sale", id: "x" }, { kind: "post", id: "" }, { kind: "post" }]) {
      assert.equal(parseLotGroup(raw), null);
    }
  });

  it("names the group as a sentence does", () => {
    assert.equal(lotGroupName("proposal", 2), "proposal #2");
    assert.equal(lotGroupName("post", 14), "post #14");
  });
});
