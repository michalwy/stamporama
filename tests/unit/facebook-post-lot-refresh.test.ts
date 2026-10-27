import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lotPhotosDrawing,
  withFacebookPostLot,
  withLotPhotos,
  withPrepareRow,
} from "../../src/lib/facebook-post-lot-refresh";
import type { FacebookKitLot } from "../../src/lib/facebook-auctions";
import type { FacebookPostLotUpdate, FacebookPostScreen } from "../../src/lib/facebook-posts";
import type { FacebookPostLotPhoto } from "../../src/lib/facebook-lot-photos";
import type { OfferTextStatus, PrepareOffer } from "../../src/lib/offers";
import type { TitleFallback } from "../../src/lib/offer-title-template";

// One lot of a post's screen refreshed in place (#2221): what a saved price, title or state writes
// into the screen the browser already holds, instead of reading every lot of the post again.

function kitLot(offerId: string, over: Partial<FacebookKitLot> = {}): FacebookKitLot {
  return {
    offerId,
    offerNo: 1,
    lotNo: 1,
    listingType: "auction",
    title: `Lot ${offerId}`,
    description: "",
    catalog: "",
    catalogSortKey: null,
    startingPrice: null,
    bidIncrement: null,
    currency: "PLN",
    endsAt: null,
    state: "preparing",
    url: null,
    price: "0.00",
    priceCheckedAt: null,
    ownTemplate: null,
    frozen: null,
    ...over,
  };
}

const status = (outOfDate: boolean): OfferTextStatus => ({ outOfDate, handWritten: false }) as OfferTextStatus;
const gap = (entityId: string): TitleFallback =>
  ({ entityType: "stamp", entityId, entityField: "name", text: entityId }) as unknown as TitleFallback;

function screen(): FacebookPostScreen {
  return {
    postId: "p",
    postNo: 7,
    title: "Seven",
    collectionId: "c",
    kit: { lots: [kitLot("a"), kitLot("b", { lotNo: 2 })] } as FacebookPostScreen["kit"],
    platform: { id: "fb", name: "Facebook" },
    sales: {},
    translations: {
      language: "en",
      gaps: [gap("x"), gap("y")],
      byLot: { a: ["stamp:x:name"], b: ["stamp:y:name"] },
    },
    lotTexts: { a: status(false), b: status(false) },
    lotTitles: { template: "{title}", handWritten: ["b"] },
    hasPreviewLink: false,
  };
}

function update(over: Partial<FacebookPostLotUpdate> = {}): FacebookPostLotUpdate {
  return {
    title: "Seven",
    lot: kitLot("a", { startingPrice: "5.00" }),
    prepare: null,
    text: status(false),
    translations: { language: "en", gaps: [gap("x")], byLot: { a: ["stamp:x:name"] } },
    handWritten: false,
    ...over,
  };
}

describe("withFacebookPostLot", () => {
  it("puts the lot read again in its place in the kit, the other lots as they were", () => {
    const before = screen();
    const after = withFacebookPostLot(before, update());
    assert.equal(after.kit.lots[0].startingPrice, "5.00", "the post's text reads the new figure");
    assert.equal(after.kit.lots[1], before.kit.lots[1]);
    assert.deepEqual(
      after.kit.lots.map((l) => l.offerId),
      ["a", "b"]
    );
  });

  it("takes the lot's text status and the post's title from the update", () => {
    const after = withFacebookPostLot(screen(), update({ text: status(true), title: "Renamed" }));
    assert.equal(after.lotTexts?.a.outOfDate, true);
    assert.equal(after.lotTexts?.b.outOfDate, false);
    assert.equal(after.title, "Renamed");
  });

  it("replaces the lot's untranslated names, keeping the others' and dropping one no lot prints", () => {
    const none = withFacebookPostLot(screen(), update({ translations: { language: "en", gaps: [], byLot: {} } }));
    assert.deepEqual(none.translations?.byLot, { b: ["stamp:y:name"] });
    assert.deepEqual(
      none.translations?.gaps.map((g) => g.entityId),
      ["y"]
    );

    const added = withFacebookPostLot(
      screen(),
      update({ translations: { language: "en", gaps: [gap("x"), gap("z")], byLot: { a: ["stamp:x:name", "stamp:z:name"] } } })
    );
    assert.deepEqual(added.translations?.byLot.a, ["stamp:x:name", "stamp:z:name"]);
    assert.deepEqual(
      added.translations?.gaps.map((g) => g.entityId),
      ["x", "y", "z"]
    );
  });

  it("keeps the hand-written titles in lot order as the lot's title is written or cleared", () => {
    const written = withFacebookPostLot(screen(), update({ handWritten: true }));
    assert.deepEqual(written.lotTitles?.handWritten, ["a", "b"]);
    const cleared = withFacebookPostLot(
      screen(),
      update({ lot: kitLot("b", { lotNo: 2 }), handWritten: false, translations: null })
    );
    assert.deepEqual(cleared.lotTitles?.handWritten, []);
  });

  it("leaves the screen as it was for a lot no longer in the post", () => {
    const before = screen();
    assert.equal(withFacebookPostLot(before, update({ lot: kitLot("gone") })), before);
  });

  it("leaves the parts a post that is up does not have", () => {
    const up = { ...screen(), translations: null, lotTexts: null, lotTitles: null };
    const after = withFacebookPostLot(up, update({ text: null, translations: null }));
    assert.equal(after.translations, null);
    assert.equal(after.lotTexts, null);
    assert.equal(after.lotTitles, null);
  });
});

describe("withPrepareRow", () => {
  const row = (id: string, price: string) => ({ id, price }) as PrepareOffer;

  it("writes the lot's row in, the others untouched", () => {
    const rows = { a: row("a", "1.00"), b: row("b", "2.00") };
    const after = withPrepareRow(rows, "a", row("a", "9.00"));
    assert.equal(after?.a.price, "9.00");
    assert.equal(after?.b, rows.b);
  });

  it("takes out a lot that has no row any more, and leaves a screen with no rows alone", () => {
    assert.deepEqual(Object.keys(withPrepareRow({ a: row("a", "1.00") }, "a", null) ?? {}), []);
    assert.equal(withPrepareRow(null, "a", row("a", "1.00")), null);
  });
});

describe("the lots' photos", () => {
  const photo = (offerId: string, status: "generating" | "ready"): FacebookPostLotPhoto => ({
    offerId,
    lotNo: 1,
    fileName: `${offerId}.jpg`,
    state: (status === "ready" ? { status, photoId: `ph-${offerId}` } : { status }) as FacebookPostLotPhoto["state"],
  });

  it("asks after the lots still being drawn, and only them", () => {
    assert.deepEqual(lotPhotosDrawing([photo("a", "ready"), photo("b", "generating"), photo("c", "generating")]), [
      "b",
      "c",
    ]);
    assert.deepEqual(lotPhotosDrawing(undefined), []);
  });

  it("writes each answer in its lot's place, in lot order", () => {
    const all = [photo("a", "ready"), photo("b", "generating")];
    const after = withLotPhotos(all, [photo("b", "ready")]);
    assert.deepEqual(
      after.map((p) => [p.offerId, p.state.status]),
      [
        ["a", "ready"],
        ["b", "ready"],
      ]
    );
    assert.equal(after[0], all[0]);
  });
});
