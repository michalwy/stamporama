import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  listReadyOffersForListing,
  publishOffer,
  setOfferState,
} from "../../src/lib/offers";
import { offerGroupKey } from "../../src/lib/listing-groups";
import { setColnectConditionMapping } from "../../src/lib/colnect";

// The bulk listing workspace's read model (#322). The grouping rules themselves are unit-tested
// (`listing-groups.test.ts`); what needs a real database is the part that produces its inputs — the
// scope (`ready`, one platform) and the derivation of each copy's **area** from its stamp's primary
// area link and its **year** from `stamp.issuedYear`. A stamp linked to two areas is the case that
// would quietly send every such offer to Mixed if the primary link were ignored.

describe("bulk listing workspace read model (#322)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let otherPlatformId: string;
  let conditionId: string;
  let plId: string;
  let plModernId: string;
  let deId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-listws-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User listws-${ts}`,
        email: `test-listws-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-listws-${ts}`,
        name: `Collection listws-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    // The batch's platform names the Colnect Assistant module (#406) — without one the listing
    // preconditions are not asked at all, which is what `otherPlatformId` below covers.
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformModule: "colnect" },
      })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
    plId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland", sortOrder: 0 } })
    ).id;
    plModernId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland modern", parentId: plId, sortOrder: 1 },
      })
    ).id;
    deId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Germany", sortOrder: 2 } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** A stamp with its area links, the first of which is the primary one. `colnectId` is what the
   * listing preconditions (#406) read: a stamp without one cannot be pointed at by a listing form. */
  async function stamp(
    name: string,
    issuedYear: number | null,
    areaIds: string[],
    colnectId: string | null = null
  ): Promise<string> {
    const created = await prisma.stamp.create({
      data: { collectionId, name, issuedYear, colnectId },
    });
    await prisma.stampCollectionArea.createMany({
      data: areaIds.map((collectionAreaId, i) => ({
        stampId: created.id,
        collectionAreaId,
        isPrimary: i === 0,
      })),
    });
    return created.id;
  }

  /** A `ready` offer holding one set of the given stamps, one copy each. */
  async function readyOffer(
    stampIds: string[],
    over: { platformId?: string; price?: string } = {}
  ): Promise<string> {
    const itemIds = await Promise.all(
      stampIds.map(async (stampId) =>
        (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id
      )
    );
    const offerId = await createOffer(userId, collectionId, {
      platformId: over.platformId ?? platformId,
      url: null,
      price: over.price ?? "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, itemIds);
    // Written directly, not through `setOfferState`: this batch is deliberately full of offers that
    // *cannot* be listed — that is what the blockers under test are — and marking one ready is now
    // gated on exactly those preconditions (#418), which is covered on its own in
    // `offer-ready-gate.test.ts`.
    await prisma.offer.update({ where: { id: offerId }, data: { state: "ready" } });
    return offerId;
  }

  const rowFor = async (offerId: string) => {
    const rows = await listReadyOffersForListing(userId, collectionId, platformId);
    return rows.find((r) => r.id === offerId);
  };

  it("reports one area/year pair for an offer whose copies agree", async () => {
    const offerId = await readyOffer([
      await stamp("PL 1960 a", 1960, [plId]),
      await stamp("PL 1960 b", 1960, [plId]),
    ]);

    const row = await rowFor(offerId);
    assert.ok(row);
    assert.deepEqual(row.areaYears, [{ areaId: plId, year: 1960 }]);
    assert.equal(offerGroupKey(row).mixed, false);
    assert.equal(row.itemCount, 2);
    assert.equal(row.setCount, 1);
    assert.equal(row.photoCount, 0);
    assert.equal(row.photoStatus, "none");
  });

  it("takes a multi-area stamp's primary link, so it is not mistaken for spanning areas", async () => {
    // Linked to Poland modern *and* Germany, primary Poland modern: one pair, not two.
    const offerId = await readyOffer([await stamp("PL/DE 1972", 1972, [plModernId, deId])]);

    const row = await rowFor(offerId);
    assert.ok(row);
    assert.deepEqual(row.areaYears, [{ areaId: plModernId, year: 1972 }]);
    assert.equal(offerGroupKey(row).mixed, false);
  });

  it("reports both pairs for an offer whose copies disagree, which groups as Mixed", async () => {
    const offerId = await readyOffer([
      await stamp("PL 1960 c", 1960, [plId]),
      await stamp("DE 1972", 1972, [deId]),
    ]);

    const row = await rowFor(offerId);
    assert.ok(row);
    assert.equal(row.areaYears.length, 2);
    assert.equal(offerGroupKey(row).mixed, true);
  });

  it("puts a stamp with no year in the no-year bucket rather than dropping it", async () => {
    const offerId = await readyOffer([await stamp("PL undated", null, [plId])]);

    const row = await rowFor(offerId);
    assert.ok(row);
    assert.deepEqual(row.areaYears, [{ areaId: plId, year: null }]);
  });

  it("lists only ready offers, and only on the asked-for platform", async () => {
    const preparing = await readyOffer([await stamp("PL prep", 1960, [plId])]);
    await setOfferState(userId, preparing, "preparing");
    const elsewhere = await readyOffer([await stamp("PL other", 1960, [plId])], {
      platformId: otherPlatformId,
    });

    const ids = (await listReadyOffersForListing(userId, collectionId, platformId)).map((r) => r.id);
    assert.equal(ids.includes(preparing), false, "a preparing offer is not ready to post");
    assert.equal(ids.includes(elsewhere), false, "another platform's batch is a different session");

    const otherIds = (
      await listReadyOffersForListing(userId, collectionId, otherPlatformId)
    ).map((r) => r.id);
    assert.deepEqual(otherIds, [elsewhere]);
  });

  // ── Listing preconditions (#406) ───────────────────────────────────────────
  //
  // The rules themselves are unit-tested (`listing-preconditions.test.ts`); what the batch read has
  // to get right is that it resolves their inputs — the stamp's Colnect item-ID and the condition
  // mapping — and reports them per row, so the card can say which of a session's offers are postable
  // without expanding any of them.

  it("names an unmapped condition and an unmatched stamp on the row", async () => {
    const offerId = await readyOffer([await stamp("PL unmatched", 1960, [plId])]);

    const row = await rowFor(offerId);
    assert.deepEqual(
      row?.blockers.map((b) => b.code).sort(),
      ["missing-catalog-id", "unmapped-condition"]
    );
  });

  it("says nothing at all on a platform with no Assistant module", async () => {
    // Same offer, same gaps — but nothing here posts that platform's form, so reporting them would
    // put a "can't list" chip on every card of every batch that is listed by hand.
    const offerId = await readyOffer([await stamp("PL hand-listed", 1960, [plId])], {
      platformId: otherPlatformId,
    });

    const rows = await listReadyOffersForListing(userId, collectionId, otherPlatformId);
    assert.deepEqual(rows.find((r) => r.id === offerId)?.blockers, []);
  });

  it("clears once the stamp is matched and the condition is mapped", async () => {
    const offerId = await readyOffer([await stamp("PL listable", 1960, [plId], "90001")]);
    await setColnectConditionMapping(userId, conditionId, "4");
    try {
      assert.deepEqual((await rowFor(offerId))?.blockers, []);
    } finally {
      await setColnectConditionMapping(userId, conditionId, null);
    }
  });

  it("refuses another owner's collection", async () => {
    await assert.rejects(() => listReadyOffersForListing("someone-else", collectionId, platformId));
  });

  it("publishes with the listing URL and today's listing date, and drops out of the batch", async () => {
    const offerId = await readyOffer([await stamp("PL publish", 1960, [plId])]);

    // The domain function stores what it is given; adding a missing scheme is the action's job
    // (`normalizeUrl`), exactly as for an in-place URL edit.
    await publishOffer(userId, offerId, "https://example.com/listing/1");

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { state: true, url: true, listingDate: true },
    });
    assert.equal(offer.state, "active");
    assert.equal(offer.url, "https://example.com/listing/1");
    assert.deepEqual(
      offer.listingDate,
      new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
    );
    assert.equal(await rowFor(offerId), undefined, "a published offer has left the batch");
  });

  it("publishes without a URL — a platform may not have minted one yet", async () => {
    const offerId = await readyOffer([await stamp("PL no url", 1960, [plId])]);

    await publishOffer(userId, offerId, null);

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { state: true, url: true },
    });
    assert.equal(offer.state, "active");
    assert.equal(offer.url, null);
  });

  it("leaves no URL behind when the publication itself is refused", async () => {
    // An offer that lost its only set cannot go live (#188), and must not end up carrying the URL of
    // a listing that never existed.
    const offerId = await readyOffer([await stamp("PL empty", 1960, [plId])]);
    const set = await prisma.offerSet.findFirstOrThrow({ where: { offerId } });
    await prisma.offerSet.delete({ where: { id: set.id } });

    await assert.rejects(() => publishOffer(userId, offerId, "https://example.com/never"));

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { state: true, url: true },
    });
    assert.equal(offer.state, "ready");
    assert.equal(offer.url, null);
  });
});
