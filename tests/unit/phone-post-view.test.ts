import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FacebookKitLot } from "../../src/lib/facebook-auctions";
import type { FacebookPostPhotos } from "../../src/lib/facebook-lot-photos";
import { facebookBidding, recordBidLabel } from "../../src/lib/facebook-bidding-rules";
import { facebookPostAuctionsEnd } from "../../src/lib/facebook-post-list-figures";
import {
  parsePhonePostsShow,
  PHONE_POSTS_SHOW_OPTIONS,
  phonePostCanPropose,
  phonePostLotBidding,
  phonePostLotPhotoId,
  phonePostLots,
  phonePostsFilters,
} from "../../src/lib/phone-post-view";
import { phoneOfferPath, phonePostPath, phonePostsPath, phoneProposalPath } from "../../src/lib/phone";

// A Facebook post on the phone (#2626): the list's narrowing, each lot's number, picture and price,
// and when a post that is up closes. The read is `tests/integration/phone-posts.test.ts`.

const NOW = new Date("2026-11-21T12:00:00Z");

function kitLot(over: Partial<FacebookKitLot>): FacebookKitLot {
  return {
    offerId: "o1",
    offerNo: 101,
    lotNo: 1,
    listingType: "auction",
    title: "Mercury 1950",
    description: "",
    catalog: "",
    catalogSortKey: null,
    startingPrice: "3.00",
    bidIncrement: null,
    currency: "PLN",
    endsAt: null,
    state: "active",
    url: null,
    price: "0.00",
    priceCheckedAt: null,
    ownTemplate: null,
    frozen: null,
    ...over,
  };
}

describe("the phone's list of posts (#2626)", () => {
  it("shows the posts not over by default, and anything unknown is the default", () => {
    assert.equal(parsePhonePostsShow(null), "notOver");
    assert.equal(parsePhonePostsShow(""), "notOver");
    assert.equal(parsePhonePostsShow("bogus"), "notOver");
    assert.deepEqual(phonePostsFilters("notOver"), { notOver: true });
  });

  it("shows every post, or one stage", () => {
    assert.equal(parsePhonePostsShow("all"), "all");
    assert.deepEqual(phonePostsFilters("all"), {});
    assert.equal(parsePhonePostsShow("up"), "up");
    assert.deepEqual(phonePostsFilters("up"), { stage: "up" });
  });

  it("offers the default first, each stage, then every post", () => {
    assert.deepEqual(
      PHONE_POSTS_SHOW_OPTIONS.map((o) => o.value),
      ["", "preparing", "ready", "pending", "up", "over", "all"]
    );
    // Each option reads back as itself, so the select shows what the address says.
    for (const option of PHONE_POSTS_SHOW_OPTIONS) {
      const show = parsePhonePostsShow(option.value);
      assert.equal(show === "notOver" ? "" : show, option.value);
    }
  });

  it("addresses the list, a post by its number, a lot's offer and a proposal", () => {
    assert.equal(phonePostsPath("poland"), "/c/poland/phone/posts");
    assert.equal(phonePostPath("poland", 12), "/c/poland/phone/posts/12");
    assert.equal(phoneOfferPath("poland", "o1"), "/c/poland/phone/offers/o1");
    assert.equal(phoneProposalPath("poland", 3), "/c/poland/phone/proposals/3");
  });
});

describe("a lot on the post's phone screen (#2626)", () => {
  it("is priced as the desk's post screen prices it: start, then the bid, a quick buy its price", () => {
    const [start, bid, quick] = phonePostLots(
      [
        kitLot({ offerId: "a" }),
        kitLot({ offerId: "b", lotNo: 2, price: "12.50" }),
        kitLot({ offerId: "c", lotNo: 3, listingType: "fixed", price: "8.00", startingPrice: null }),
      ],
      { layout: "text", lots: [] },
      NOW
    );
    assert.deepEqual(start.price, { label: "Start", amount: "3.00", currency: "PLN" });
    assert.deepEqual(bid.price, { label: "Bid", amount: "12.50", currency: "PLN" });
    assert.deepEqual(quick.price, { label: "Price", amount: "8.00", currency: "PLN" });
  });

  it("numbers a post of one lot by its place, its lot carrying none", () => {
    assert.deepEqual(phonePostLots([kitLot({ lotNo: null })], { layout: "text", lots: [] }, NOW).map((l) => l.lotNo), [1]);
  });

  it("shows a text post's lot by the first of its upload set", () => {
    const photos = {
      layout: "text" as const,
      lots: [
        {
          offerId: "o1",
          status: "ready" as const,
          images: [
            { photoId: "p-front", fileName: "a.jpg" },
            { photoId: "p-back", fileName: "b.jpg" },
          ],
        },
        { offerId: "o2", status: "ready" as const, images: [] },
      ],
    };
    assert.equal(phonePostLotPhotoId(photos, "o1"), "p-front");
    assert.equal(phonePostLotPhotoId(photos, "o2"), null);
    assert.equal(phonePostLotPhotoId(photos, "o3"), null);
  });

  it("shows a captioned post's lot by its one photo, once it is drawn", () => {
    const photos = {
      layout: "captions" as const,
      lots: [
        { offerId: "o1", lotNo: 1, fileName: "lot-01.jpg", state: { status: "ready" as const, photoId: "p1" } },
        { offerId: "o2", lotNo: 2, fileName: "lot-02.jpg", state: { status: "generating" as const } },
      ],
    };
    assert.equal(phonePostLotPhotoId(photos, "o1"), "p1");
    assert.equal(phonePostLotPhotoId(photos, "o2"), null);
  });
});

describe("recording a lot's bid on the post's phone screen (#2630)", () => {
  const TEXT: FacebookPostPhotos = { layout: "text", lots: [] };

  it("follows an auction up in the group, active or paused, with when its bid was recorded", () => {
    const [noBid, bid, paused] = phonePostLots(
      [
        kitLot({ offerId: "a", endsAt: "2026-11-21T18:00:00Z" }),
        kitLot({ offerId: "b", lotNo: 2, price: "12.50", priceCheckedAt: "2026-11-21T11:30:00Z" }),
        kitLot({ offerId: "c", lotNo: 3, state: "paused" }),
      ],
      TEXT,
      NOW
    );
    assert.deepEqual(noBid.bidding, { closed: false, hasBid: false, priceCheckedAt: null });
    assert.deepEqual(bid.bidding, { closed: false, hasBid: true, priceCheckedAt: "2026-11-21T11:30:00Z" });
    assert.deepEqual(paused.bidding, { closed: false, hasBid: false, priceCheckedAt: null });
  });

  it("still takes the winning bid once the lot has closed, as the offer's screen does", () => {
    const [closed] = phonePostLots([kitLot({ endsAt: "2026-11-21T11:59:00Z", price: "20.00" })], TEXT, NOW);
    assert.deepEqual(closed.bidding, { closed: true, hasBid: true, priceCheckedAt: null });
    assert.equal(recordBidLabel(closed.bidding?.closed ?? false), "Record winning bid");
  });

  it("gives no field to a sold or withdrawn lot, a quick buy, or a lot not yet up", () => {
    const lots = phonePostLots(
      [
        kitLot({ offerId: "sold", state: "sold" }),
        kitLot({ offerId: "withdrawn", state: "withdrawn" }),
        kitLot({ offerId: "quick", listingType: "fixed", price: "8.00" }),
        kitLot({ offerId: "pending", state: "pending" }),
        kitLot({ offerId: "ready", state: "ready" }),
      ],
      TEXT,
      NOW
    );
    assert.deepEqual(
      lots.map((l) => l.bidding),
      [null, null, null, null, null]
    );
  });

  it("is the offer's own rule, lot by lot", () => {
    const lot = kitLot({ endsAt: "2026-11-21T13:00:00Z", price: "4.00", priceCheckedAt: "2026-11-21T10:00:00Z" });
    assert.deepEqual(phonePostLotBidding(lot, NOW), { ...facebookBidding(lot, NOW), priceCheckedAt: lot.priceCheckedAt });
  });
});

describe("when a post that is up closes (#2626)", () => {
  const at = (iso: string) => new Date(iso);

  it("is its running auctions' one end, or the earliest and the latest", () => {
    assert.deepEqual(
      facebookPostAuctionsEnd([
        { state: "active", auction: true, endsAt: at("2026-11-22T19:00:00.000Z") },
        { state: "paused", auction: true, endsAt: at("2026-11-22T19:00:00.000Z") },
      ]),
      { from: "2026-11-22T19:00:00.000Z", to: "2026-11-22T19:00:00.000Z" }
    );
    assert.deepEqual(
      facebookPostAuctionsEnd([
        { state: "active", auction: true, endsAt: at("2026-11-23T19:00:00.000Z") },
        { state: "active", auction: true, endsAt: at("2026-11-22T19:00:00.000Z") },
      ]),
      { from: "2026-11-22T19:00:00.000Z", to: "2026-11-23T19:00:00.000Z" }
    );
  });

  it("reads past lots closed and quick buys, and says nothing where an end is missing", () => {
    assert.deepEqual(
      facebookPostAuctionsEnd([
        { state: "active", auction: true, endsAt: at("2026-11-22T19:00:00.000Z") },
        { state: "sold", auction: true, endsAt: at("2026-11-21T19:00:00.000Z") },
        { state: "active", auction: false, endsAt: null },
      ]),
      { from: "2026-11-22T19:00:00.000Z", to: "2026-11-22T19:00:00.000Z" }
    );
    assert.equal(facebookPostAuctionsEnd([{ state: "active", auction: false, endsAt: null }]), null);
    assert.equal(
      facebookPostAuctionsEnd([
        { state: "active", auction: true, endsAt: at("2026-11-22T19:00:00.000Z") },
        { state: "active", auction: true, endsAt: null },
      ]),
      null
    );
  });
});

describe("Make a proposal on a post's phone screen (#2632)", () => {
  const ready = { state: "ready", facebookPostSnapshot: null };
  const up = { state: "active", facebookPostSnapshot: { title: "Mercury" } };
  const soldBefore = { state: "sold", facebookPostSnapshot: null };
  const proposal = (status: "preparing" | "sent" | "sold" | "declined") => ({ proposalNo: 4, contactName: "Anna", status });

  it("is offered before the post is up, with lots, and no proposal made from it", () => {
    assert.equal(phonePostCanPropose({ postNo: 7, kit: { lots: [ready, ready] }, proposal: null }), true);
    // A lot a buyer took before the post went up leaves it not up (#2560).
    assert.equal(phonePostCanPropose({ postNo: 7, kit: { lots: [soldBefore, ready] }, proposal: null }), true);
  });

  it("is not offered once the post is up, or with no lots", () => {
    assert.equal(phonePostCanPropose({ postNo: 7, kit: { lots: [up, ready] }, proposal: null }), false);
    assert.equal(phonePostCanPropose({ postNo: 7, kit: { lots: [] }, proposal: null }), false);
  });

  it("gives way to an open proposal, which the screen links, and comes back once it is closed", () => {
    assert.equal(phonePostCanPropose({ postNo: 7, kit: { lots: [ready] }, proposal: proposal("preparing") }), false);
    assert.equal(phonePostCanPropose({ postNo: 7, kit: { lots: [ready] }, proposal: proposal("sent") }), false);
    assert.equal(phonePostCanPropose({ postNo: 7, kit: { lots: [ready] }, proposal: proposal("declined") }), true);
  });
});
