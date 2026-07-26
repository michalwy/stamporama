import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  addOfferSet,
  setOfferState,
  setOfferInActiveBidding,
  offerFilterCounts,
  listOffersPaginated,
} from "../../src/lib/offers";

// Faceted counts for the offer list's filter controls (#332), plus the SQL-side "needs action"
// derivation they share with the list (ADR-0013 §4). Covers:
//   - state counts within the selected platform, and platform counts within the selected state;
//   - the needs-action facet, including its per-platform grouping;
//   - the bidding source of needs-action (#215) — untested before it moved into SQL — for both the
//     one-sided and the mutual case;
//   - a bid flagging a twin that is not on the same list page.

describe("offer filter counts + needs-action facet", () => {
  let userId: string;
  let collectionId: string;
  let delcampeId: string;
  let allegroId: string;
  let shared: string;
  let offerD: string;
  let offerA: string;
  let offerPreparing: string;
  let offerWithdrawn: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-counts-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User counts-${ts}`,
        email: `test-counts-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-counts-${ts}`, name: `Collection counts-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;

    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp C" } });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    delcampeId = (await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })).id;
    allegroId = (await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })).id;

    const mk = async () =>
      (await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id, forSale: true })).id;
    shared = await mk();
    const own = await mk();
    const spare = await mk();

    const newOffer = (platformId: string, price: string) =>
      createOffer(userId, collectionId, {
        platformId, url: null, price, currency: "EUR", listingDate: null, state: "preparing",
      });

    // The same copy listed on both platforms — the collision the needs-action facet keys off.
    offerD = await newOffer(delcampeId, "5.00");
    await addOfferSet(userId, offerD, [shared]);
    offerA = await newOffer(allegroId, "6.00");
    await addOfferSet(userId, offerA, [shared]);
    // A live offer with no overlap, so "active" is never the same count as "needs action".
    const offerClean = await newOffer(delcampeId, "7.00");
    await addOfferSet(userId, offerClean, [own]);
    // One offer per remaining state we assert on.
    offerPreparing = await newOffer(allegroId, "8.00");
    await addOfferSet(userId, offerPreparing, [spare]);
    offerWithdrawn = await newOffer(delcampeId, "9.00");
    await addOfferSet(userId, offerWithdrawn, [spare]);

    for (const id of [offerD, offerA, offerClean, offerWithdrawn]) {
      await setOfferState(userId, id, "ready");
      await setOfferState(userId, id, "active");
    }
    await setOfferState(userId, offerWithdrawn, "withdrawn");
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("counts states across platforms, and within the selected platform", async () => {
    const all = await offerFilterCounts(userId, collectionId, {});
    assert.equal(all.states.active, 3, "three offers reached active");
    assert.equal(all.states.preparing, 1);
    assert.equal(all.states.withdrawn, 1);
    assert.equal(all.states.sold, undefined, "a state with no offers is absent");

    // The state facet ignores itself but respects the platform: Delcampe holds two of the three
    // active offers and the withdrawn one.
    const onDelcampe = await offerFilterCounts(userId, collectionId, { platformId: delcampeId });
    assert.equal(onDelcampe.states.active, 2);
    assert.equal(onDelcampe.states.withdrawn, 1);
    assert.equal(onDelcampe.states.preparing, undefined, "the preparing offer is on Allegro");
  });

  it("counts platforms under the selected state, hiding closed offers unless opted in", async () => {
    // No state selected: closed offers are out (#245), so Delcampe's withdrawn one is not counted.
    const open = await offerFilterCounts(userId, collectionId, {});
    assert.equal(open.platforms[delcampeId], 2);
    assert.equal(open.platforms[allegroId], 2, "active + preparing");
    assert.equal(open.total, 4);

    const withClosed = await offerFilterCounts(userId, collectionId, { includeClosed: true });
    assert.equal(withClosed.platforms[delcampeId], 3);
    assert.equal(withClosed.total, 5);

    const active = await offerFilterCounts(userId, collectionId, { state: "active" });
    assert.equal(active.platforms[delcampeId], 2);
    assert.equal(active.platforms[allegroId], 1);
    assert.equal(active.total, 3);

    // The platform facet ignores the platform selection itself.
    const activeOnAllegro = await offerFilterCounts(userId, collectionId, {
      state: "active",
      platformId: allegroId,
    });
    assert.deepEqual(activeOnAllegro.platforms, active.platforms);
  });

  it("counts nothing as needing action while no copy has sold and no bid is live", async () => {
    const counts = await offerFilterCounts(userId, collectionId, {});
    assert.equal(counts.needsAction, 0);
  });

  it("flags the other offer holding a copy under an active bid, and counts it per platform", async () => {
    await setOfferInActiveBidding(userId, offerD, true);
    try {
      const counts = await offerFilterCounts(userId, collectionId, {});
      assert.equal(counts.needsAction, 1, "only the twin needs action, not the offer being bid on");

      // Under a needs-action selection the platform facet counts the flagged offers themselves.
      const facet = await offerFilterCounts(userId, collectionId, { needsAction: true });
      assert.equal(facet.platforms[allegroId], 1, "the flagged twin is Allegro's");
      assert.equal(facet.platforms[delcampeId], undefined, "the offer holding the bid is not flagged");
      assert.equal(facet.total, 1);

      // The chip's own count respects the platform selection.
      const onAllegro = await offerFilterCounts(userId, collectionId, { platformId: allegroId });
      assert.equal(onAllegro.needsAction, 1);
      const onDelcampe = await offerFilterCounts(userId, collectionId, { platformId: delcampeId });
      assert.equal(onDelcampe.needsAction, 0);

      const flagged = await listOffersPaginated(userId, collectionId, { needsAction: true });
      assert.deepEqual(flagged.items.map((o) => o.id), [offerA]);
      assert.equal(flagged.items[0].soldCopyCount, 1);
    } finally {
      await setOfferInActiveBidding(userId, offerD, false);
    }
  });

  it("flags both offers when each is in active bidding on the same copy", async () => {
    await setOfferInActiveBidding(userId, offerD, true);
    await setOfferInActiveBidding(userId, offerA, true);
    try {
      const counts = await offerFilterCounts(userId, collectionId, {});
      assert.equal(counts.needsAction, 2, "each offer has a bid live on a copy the other also holds");
      const flagged = await listOffersPaginated(userId, collectionId, { needsAction: true });
      assert.deepEqual(new Set(flagged.items.map((o) => o.id)), new Set([offerD, offerA]));
    } finally {
      await setOfferInActiveBidding(userId, offerD, false);
      await setOfferInActiveBidding(userId, offerA, false);
    }
  });

  it("flags a twin that is not on the same list page as the offer holding the bid", async () => {
    await setOfferInActiveBidding(userId, offerD, true);
    try {
      // One offer per page: the row's badge must come from the whole collection, not from the rows
      // that happen to share its page.
      let found: boolean | undefined;
      for (let offset = 0; offset < 10 && found === undefined; offset++) {
        const page = await listOffersPaginated(userId, collectionId, { pageSize: 1, offset });
        const row = page.items.find((o) => o.id === offerA);
        if (row) found = row.needsAction;
        if (!page.nextCursor) break;
      }
      assert.equal(found, true, "the twin is flagged even alone on its page");
    } finally {
      await setOfferInActiveBidding(userId, offerD, false);
    }
  });

  it("clears the needs-action count once the bid is reverted", async () => {
    const counts = await offerFilterCounts(userId, collectionId, {});
    assert.equal(counts.needsAction, 0);
    assert.equal(counts.states.active, 3, "reverting a bid never changes an offer's state");
    assert.ok(offerPreparing && offerWithdrawn);
  });
});
