import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isShareDismissed,
  parsePhoneProposalShow,
  phoneLotCountText,
  phoneProposalLotPicture,
  phoneProposalShareText,
  phoneProposalStatuses,
  phoneShareMarksSent,
} from "../../src/lib/phone-proposal-rules";
import { phoneProposalPath, phoneProposalsPath } from "../../src/lib/phone";

// Proposals on the phone (#2625): the list's narrowing, what one share carries, and when a share marks
// the proposal Sent — a share does, copying does not (settled with the collector on 2026-11-21).

describe("the phone's list of proposals", () => {
  it("shows the open proposals unless every one is asked for", () => {
    assert.equal(parsePhoneProposalShow(null), "open");
    assert.equal(parsePhoneProposalShow("bogus"), "open");
    assert.equal(parsePhoneProposalShow("all"), "all");
    assert.deepEqual(phoneProposalStatuses("open"), ["preparing", "sent"]);
    assert.deepEqual(phoneProposalStatuses("all"), []);
  });

  it("is addressed under the collection's phone start, a proposal by its number", () => {
    assert.equal(phoneProposalsPath("poland"), "/c/poland/phone/proposals");
    assert.equal(phoneProposalPath("poland", 12), "/c/poland/phone/proposals/12");
  });

  it("counts lots in words", () => {
    assert.equal(phoneLotCountText(1), "1 lot");
    assert.equal(phoneLotCountText(0), "0 lots");
    assert.equal(phoneLotCountText(4), "4 lots");
  });
});

describe("phoneProposalShareText", () => {
  it("puts the link under the message, after a blank line", () => {
    assert.equal(phoneProposalShareText("Hello Jan,\n1. Austria — 25 zł", "https://x/p/stmpd_a"), "Hello Jan,\n1. Austria — 25 zł\n\nhttps://x/p/stmpd_a");
  });

  it("sends the link alone when there is no message, never words made up for it", () => {
    assert.equal(phoneProposalShareText(null, "https://x/p/stmpd_a"), "https://x/p/stmpd_a");
  });
});

describe("phoneShareMarksSent", () => {
  it("marks a Preparing proposal with a lot sent", () => {
    assert.equal(phoneShareMarksSent("preparing", 3), true);
  });

  it("leaves a Sent proposal as it is — it is shared again", () => {
    assert.equal(phoneShareMarksSent("sent", 3), false);
  });

  it("does not mark a proposal with no lots sent, as Mark sent would refuse", () => {
    assert.equal(phoneShareMarksSent("preparing", 0), false);
  });

  it("never touches a closed proposal", () => {
    assert.equal(phoneShareMarksSent("sold", 2), false);
    assert.equal(phoneShareMarksSent("declined", 2), false);
  });
});

describe("isShareDismissed", () => {
  it("is the share menu closed by the collector", () => {
    assert.equal(isShareDismissed(Object.assign(new Error("x"), { name: "AbortError" })), true);
  });

  it("is not any other failure", () => {
    assert.equal(isShareDismissed(Object.assign(new Error("x"), { name: "NotAllowedError" })), false);
    assert.equal(isShareDismissed("AbortError"), false);
    assert.equal(isShareDismissed(null), false);
  });
});

describe("phoneProposalLotPicture", () => {
  it("is the first photo the buyer is sent", () => {
    assert.deepEqual(phoneProposalLotPicture([{ photoId: "p1" }, { photoId: "p2" }], "c1"), { photoId: "p1", copy: false });
  });

  it("falls back to the first copy's photo while the lot has none", () => {
    assert.deepEqual(phoneProposalLotPicture([], "c1"), { photoId: "c1", copy: true });
    assert.deepEqual(phoneProposalLotPicture(undefined, "c1"), { photoId: "c1", copy: true });
  });

  it("is none when neither exists", () => {
    assert.equal(phoneProposalLotPicture([], null), null);
  });
});
