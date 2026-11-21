import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FacebookKitLot } from "../../src/lib/facebook-auctions";
import { facebookPostAuctionsEnd } from "../../src/lib/facebook-post-list-figures";
import {
  parsePhonePostsShow,
  PHONE_POSTS_SHOW_OPTIONS,
  phonePostLotPhotoId,
  phonePostLots,
  phonePostsFilters,
} from "../../src/lib/phone-post-view";
import { phoneOfferPath, phonePostPath, phonePostsPath, phoneProposalPath } from "../../src/lib/phone";

// A Facebook post on the phone (#2626): the list's narrowing, each lot's number, picture and price,
// and when a post that is up closes. The read is `tests/integration/phone-posts.test.ts`.

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
      { layout: "text", lots: [] }
    );
    assert.deepEqual(start.price, { label: "Start", amount: "3.00", currency: "PLN" });
    assert.deepEqual(bid.price, { label: "Bid", amount: "12.50", currency: "PLN" });
    assert.deepEqual(quick.price, { label: "Price", amount: "8.00", currency: "PLN" });
  });

  it("numbers a post of one lot by its place, its lot carrying none", () => {
    assert.deepEqual(phonePostLots([kitLot({ lotNo: null })], { layout: "text", lots: [] }).map((l) => l.lotNo), [1]);
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
