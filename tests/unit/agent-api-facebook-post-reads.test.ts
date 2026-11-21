import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  facebookPostRecord,
  parseFacebookPostRef,
  type FacebookPostFacts,
  type FacebookPostLotFacts,
} from "../../src/lib/agent-api/facebook-post-reads";

// `get_facebook_post` (#2608): a post read so a proposal can be made of it (#2602).

const lot = (lotNo: number, overrides: Partial<FacebookPostLotFacts> = {}): FacebookPostLotFacts => ({
  offerId: `o${lotNo}`,
  offerNo: 100 + lotNo,
  facebookLotNo: lotNo,
  name: `Lot ${lotNo}`,
  state: "preparing",
  listingType: "buy_now",
  price: "5.00",
  startingPrice: null,
  currency: "PLN",
  facebookPostSnapshot: null,
  proposal: null,
  ...overrides,
});

const post = (overrides: Partial<FacebookPostFacts> = {}): FacebookPostFacts => ({
  postId: "fp1",
  postNo: 12,
  title: "Poland 1950s",
  groupName: "Stamps PL",
  platformName: "Facebook",
  lots: [lot(1), lot(2)],
  proposals: [],
  ...overrides,
});

describe("naming a Facebook post (#2608)", () => {
  it("takes its number, with or without #, or its id", () => {
    assert.deepEqual(parseFacebookPostRef("12"), { kind: "number", postNo: 12 });
    assert.deepEqual(parseFacebookPostRef(" #12 "), { kind: "number", postNo: 12 });
    assert.deepEqual(parseFacebookPostRef("cm1abc"), { kind: "id", id: "cm1abc" });
  });
});

describe("a Facebook post as get_facebook_post states it (#2608)", () => {
  it("states each lot by its number in the post, with the proposal it is in", () => {
    const record = facebookPostRecord(
      post({
        lots: [lot(1, { proposal: { proposalNo: 9, status: "preparing" } }), lot(2)],
        proposals: [{ proposalId: "p9", proposalNo: 9, status: "preparing", contactName: "Jan" }],
      }),
      "/c/x/offers/posts/12"
    );
    assert.deepEqual(record.lots[0], {
      lotNo: 1,
      offerId: "o1",
      offerNo: 101,
      title: "Lot 1",
      state: "preparing",
      listingType: "buy_now",
      price: "5.00",
      currency: "PLN",
      proposal: { proposalNo: 9, status: "preparing" },
    });
    assert.equal(record.lots[1]!.proposal, null);
    assert.deepEqual(record.proposal, { id: "p9", proposalNo: 9, contact: "Jan", status: "preparing" });
    assert.equal(record.stage, "preparing");
    assert.equal(record.group, "Stamps PL");
  });

  it("states an auction's opening as its price, and no price as null rather than nought", () => {
    const record = facebookPostRecord(
      post({
        lots: [
          lot(1, { listingType: "auction", price: "0.00", startingPrice: "3.00" }),
          lot(2, { price: "0.00" }),
        ],
      }),
      "/p"
    );
    assert.deepEqual(
      record.lots.map((l) => l.price),
      ["3.00", null]
    );
  });

  it("links the open proposal, else the latest, as the post's screen does", () => {
    const proposals = [
      { proposalId: "p3", proposalNo: 3, status: "declined", contactName: "Ewa" },
      { proposalId: "p5", proposalNo: 5, status: "sent", contactName: "Jan" },
      { proposalId: "p7", proposalNo: 7, status: "declined", contactName: "Adam" },
    ];
    assert.equal(facebookPostRecord(post({ proposals }), "/p").proposal?.proposalNo, 5);
    const closed = proposals.map((p) => ({ ...p, status: "declined" }));
    assert.equal(facebookPostRecord(post({ proposals: closed }), "/p").proposal?.proposalNo, 7);
    assert.equal(facebookPostRecord(post(), "/p").proposal, null);
  });

  it("says why a proposal would be refused, in the app's words", () => {
    assert.equal(facebookPostRecord(post(), "/p").proposalRefusal, null);
    const open = facebookPostRecord(
      post({ proposals: [{ proposalId: "p5", proposalNo: 5, status: "sent", contactName: "Jan" }] }),
      "/p"
    );
    assert.match(open.proposalRefusal ?? "", /Proposal #5 for Jan is still open/);
    const up = facebookPostRecord(
      post({ lots: [lot(1, { state: "active", facebookPostSnapshot: { text: "…" } })] }),
      "/p"
    );
    assert.equal(up.stage, "up");
    assert.match(up.proposalRefusal ?? "", /Post #12 is up/);
    assert.match(facebookPostRecord(post({ lots: [] }), "/p").proposalRefusal ?? "", /no lots/);
  });
});
