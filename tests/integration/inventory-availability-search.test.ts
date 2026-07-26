import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated } from "../../src/lib/items";
import { createLocation } from "../../src/lib/locations";
import { searchStampsForPicker } from "../../src/lib/stamps";
import {
  createOffer,
  addOfferSet,
  setOfferState,
  setOfferInActiveBidding,
} from "../../src/lib/offers";

// Two inventory-read behaviours that share `buildItemWhere`:
//
//   #334 — "not offered on X" is an *availability* worklist. A copy held by an offer that is in
//          active bidding (#215) is committed to a pending sale, so it must drop out of the
//          filter on every platform, not just the one it is being bid on.
//   #303 — free text also matches a copy's `locationRef`, on the inventory list and on the
//          stamp picker (where the ref reaches the stamp through the copies filed under it).

describe("inventory availability + location-ref search", () => {
  let userId: string;
  let collectionId: string;
  let delcampeId: string;
  let allegroId: string;
  let plain: string, bidHeld: string, refFiled: string;
  let stampAId: string;
  let stampBId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-avail-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User avail-${ts}`,
        email: `test-avail-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-avail-${ts}`,
        name: `Collection avail-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    const stampA = await prisma.stamp.create({ data: { collectionId, name: "Mercury" } });
    const stampB = await prisma.stamp.create({ data: { collectionId, name: "Zeppelin" } });
    stampAId = stampA.id;
    stampBId = stampB.id;
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    delcampeId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;
    allegroId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;

    const box = await createLocation(userId, collectionId, { name: "Box 1", assignable: true });

    // A plain for-sale copy, offered nowhere.
    plain = (
      await createItem(userId, collectionId, {
        stampId: stampB.id,
        conditionId: condition.id,
        forSale: true,
      })
    ).id;
    // The repro copy: listed on both platforms, bid on at Allegro, withdrawn from Delcampe.
    bidHeld = (
      await createItem(userId, collectionId, {
        stampId: stampA.id,
        conditionId: condition.id,
        forSale: true,
      })
    ).id;
    // A copy filed under a shelf reference — the search subject. `locationRef` is only kept
    // when the copy actually sits in a location.
    refFiled = (
      await createItem(userId, collectionId, {
        stampId: stampA.id,
        conditionId: condition.id,
        forSale: true,
        locationId: box.id,
        locationRef: "A234",
      })
    ).id;

    const allegro = await createOffer(userId, collectionId, {
      platformId: allegroId,
      url: null,
      price: "9.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, allegro, [bidHeld]);
    await setOfferState(userId, allegro, "ready");
    await setOfferState(userId, allegro, "active"); // only a live offer can take a bid
    await setOfferInActiveBidding(userId, allegro, true);

    const delcampe = await createOffer(userId, collectionId, {
      platformId: delcampeId,
      url: null,
      price: "9.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, delcampe, [bidHeld]);
    await setOfferState(userId, delcampe, "withdrawn"); // pulled after the bid landed elsewhere
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("keeps a copy held by an active-bidding offer out of 'not offered on X' (#334)", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, {
      notOfferedPlatformId: delcampeId,
    });
    const ids = items.map((i) => i.id);
    assert.ok(
      !ids.includes(bidHeld),
      "the withdrawn-from-Delcampe copy is still committed by the Allegro bid"
    );
    assert.ok(ids.includes(plain), "an uncommitted for-sale copy is still on the worklist");
    assert.ok(ids.includes(refFiled), "…as is every other unoffered copy");
  });

  it("still lists a copy offered elsewhere without a bid (#259 is unchanged)", async () => {
    const other = await createOffer(userId, collectionId, {
      platformId: allegroId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, other, [plain]);
    await setOfferState(userId, other, "ready");
    await setOfferState(userId, other, "active");

    const { items } = await listItemsPaginated(userId, collectionId, {
      notOfferedPlatformId: delcampeId,
    });
    assert.ok(
      items.map((i) => i.id).includes(plain),
      "multi-platform listing is expected — only a bid locks a copy"
    );
  });

  it("matches a copy by its location ref on the inventory list (#303)", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, { search: "a23" });
    assert.deepEqual(
      items.map((i) => i.id),
      [refFiled],
      "case-insensitive substring of the shelf reference"
    );
  });

  it("keeps stamp-identity search working alongside the ref (#303)", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, { search: "zepp" });
    assert.deepEqual(items.map((i) => i.id), [plain]);
  });

  it("composes the ref search with the other filters rather than clobbering them", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, {
      search: "A234",
      stampId: stampAId,
    });
    assert.deepEqual(items.map((i) => i.id), [refFiled]);

    const none = await listItemsPaginated(userId, collectionId, {
      search: "A234",
      stampId: stampBId, // the ref belongs to a copy of stamp A
    });
    assert.deepEqual(none.items, [], "the stamp filter narrows the ref hit, it is not OR-ed in");
  });

  it("finds a stamp through the location ref of a copy filed under it (#303)", async () => {
    const hits = await searchStampsForPicker(userId, collectionId, "A234");
    assert.deepEqual(
      hits.map((h) => h.stampId),
      [stampAId],
      "the ref reaches the stamp through its copies"
    );
  });
});
