import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  listOffersPaginated,
  offerFilterCounts,
  offersWithEndedAuction,
  setOfferState,
} from "../../src/lib/offers";

// Auctions that ended with a bid on them and are waiting to be resolved (#490).
//
// The rule itself is pinned pure in `tests/unit/offer-rules.test.ts`; what needs a real database is
// that the **stored** statement of it agrees with the pure one — the list's flag is computed in
// memory, the filter and the count are a `where`, and a disagreement between them would flag a row
// the chip does not show. Plus the one case the whole flag is bounded by: a marketplace relisting an
// unsold auction by itself must never appear here.

describe("ended auctions with a bid (#490)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;

  const ended = new Date(Date.now() - 60 * 60 * 1000);
  const running = new Date(Date.now() + 60 * 60 * 1000);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-endedauction-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User endedauction-${ts}`,
        email: `test-endedauction-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-endedauction-${ts}`,
          name: `Collection endedauction-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp A" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
  });

  /** An auction, listed and live, with one copy in it — the shape all of these start from. */
  async function auction(opts: {
    price: string;
    endsAt: Date | null;
    name: string;
  }): Promise<string> {
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "auction",
      price: opts.price,
      startingPrice: "5.00",
      endsAt: opts.endsAt,
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await prisma.offer.update({ where: { id: offerId }, data: { name: opts.name } });
    await addOfferSet(userId, offerId, [item.id]);
    // Through `ready`: the lifecycle is a step-through graph, and a draft does not jump to live.
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    return offerId;
  }

  const flagged = async () =>
    (await listOffersPaginated(userId, collectionId, { endedAuction: true })).items
      .map((o) => o.name)
      .sort();

  it("flags an auction that closed with a standing bid, and lists it under the filter", async () => {
    const offerId = await auction({ price: "42.00", endsAt: ended, name: "Closed with a bid" });

    const all = await listOffersPaginated(userId, collectionId, {});
    const row = all.items.find((o) => o.id === offerId);
    assert.equal(row?.needsResolution, true, "the row carries the flag");
    // The `where` and the in-memory rule have to agree, or the chip would show a different set than
    // the badges beside it.
    assert.ok((await flagged()).includes("Closed with a bid"));
    assert.equal((await offerFilterCounts(userId, collectionId, {})).endedAuction, 1);
  });

  it("says nothing about an auction that ended unbid — which is what a relist is", async () => {
    // Allegro republishes an unsold auction by itself. Nobody bid, so there is nothing to resolve,
    // and the sweep moves the closing time forward on the next pass.
    const offerId = await auction({ price: "0.00", endsAt: ended, name: "Ended unsold" });
    const all = await listOffersPaginated(userId, collectionId, {});
    assert.equal(all.items.find((o) => o.id === offerId)?.needsResolution, false);
    assert.ok(!(await flagged()).includes("Ended unsold"));

    // …and once the relist has been observed, the new closing time takes it out of the question
    // entirely, exactly as the sync writes it.
    await prisma.offer.update({ where: { id: offerId }, data: { endsAt: running } });
    assert.ok(!(await flagged()).includes("Ended unsold"));
  });

  it("takes the sync's bidder count as a bid even where no figure could be written", async () => {
    // A listing quoted in another currency: the flag goes on, the price does not (#481).
    const offerId = await auction({ price: "0.00", endsAt: ended, name: "Bid in another currency" });
    await prisma.offer.update({
      where: { id: offerId },
      data: { inActiveBidding: true, bidderCount: 2 },
    });
    assert.ok((await flagged()).includes("Bid in another currency"));
  });

  it("leaves a running auction and a resolved listing alone", async () => {
    await auction({ price: "42.00", endsAt: running, name: "Still running" });
    const withdrawnId = await auction({
      price: "42.00",
      endsAt: ended,
      name: "Ended and withdrawn",
    });
    await setOfferState(userId, withdrawnId, "withdrawn");

    const set = await flagged();
    assert.ok(!set.includes("Still running"));
    assert.ok(!set.includes("Ended and withdrawn"), "a withdrawn listing has been resolved");
  });

  it("reports the same set to the notification centre, longest closed first", async () => {
    const older = await auction({
      price: "80.00",
      endsAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      name: "Closed two days ago",
    });

    const reported = await offersWithEndedAuction(userId, collectionId, 5);
    const counts = await offerFilterCounts(userId, collectionId, {});
    assert.equal(reported.total, counts.endedAuction, "the bell and the chip count one set");
    assert.equal(reported.offers[0].offerId, older, "the one waiting longest leads");
    assert.equal(reported.offers[0].price, "80.00");
  });

  it("drops the closing time when the listing stops being an auction", async () => {
    const offerId = await auction({ price: "42.00", endsAt: ended, name: "Turned quick buy" });
    const { updateOffer } = await import("../../src/lib/offers");
    await updateOffer(userId, offerId, {
      platformId,
      url: null,
      listingType: "fixed",
      price: "42.00",
      startingPrice: null,
      endsAt: ended,
      currency: "EUR",
      listingDate: null,
      state: "active",
    });
    const row = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { endsAt: true },
    });
    assert.equal(row.endsAt, null, "a quick buy has no ending of its own");
    assert.ok(!(await flagged()).includes("Turned quick buy"));
  });
});
