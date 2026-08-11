import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { getActionItems } from "../../src/lib/action-items";
import {
  addItemsToOfferSet,
  addOfferSet,
  createOffer,
  getOfferDetail,
  listOffersPaginated,
  markOfferListingSynced,
  offerFilterCounts,
  patchOffer,
  removeOfferSet,
  setOfferState,
  updateOffer,
} from "../../src/lib/offers";

// Offers modified after they were listed (#542).
//
// The rule under test is narrow and the exceptions are the point: a change to something that is not
// up raises nothing, an auction's *current* price is an observation rather than a change, and a
// publication is the two sides agreeing by definition. The rest is plumbing — the flag has to reach
// the list row, the filter and the facet count, because those are what the collector actually reads.

describe("changed-since-listed flag (#542)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-drift-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User drift-${ts}`,
        email: `test-drift-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-drift-${ts}`,
        name: `Collection drift-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp D" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Colnect", platform: true } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newCopy(): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  /** An offer with one set, taken all the way live — which is the only state the flag exists in. */
  async function liveOffer(
    overrides: { listingType?: "fixed" | "auction"; startingPrice?: string } = {}
  ): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
      listingType: overrides.listingType ?? "fixed",
      startingPrice: overrides.startingPrice ?? null,
    });
    await addOfferSet(userId, offerId, [await newCopy()]);
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    return offerId;
  }

  const flag = async (offerId: string): Promise<Date | null> =>
    (
      await prisma.offer.findUniqueOrThrow({
        where: { id: offerId },
        select: { listingContentChangedAt: true },
      })
    ).listingContentChangedAt;

  it("raises the flag when a set joins an offer that is already up — #513's own case", async () => {
    const offerId = await liveOffer();
    assert.equal(await flag(offerId), null);

    await addOfferSet(userId, offerId, [await newCopy()]);
    assert.notEqual(await flag(offerId), null);
  });

  it("raises it when copies join an existing set, and when a set leaves", async () => {
    const joined = await liveOffer();
    const setId = (
      await prisma.offerSet.findFirstOrThrow({ where: { offerId: joined }, select: { id: true } })
    ).id;
    await addItemsToOfferSet(userId, setId, [await newCopy()]);
    assert.notEqual(await flag(joined), null);

    const shrunk = await liveOffer();
    const doomed = await addOfferSet(userId, shrunk, [await newCopy()]);
    await markOfferListingSynced(userId, shrunk); // back in step, so the removal is what is measured
    await removeOfferSet(userId, doomed);
    assert.notEqual(await flag(shrunk), null);
  });

  it("dates the first change and leaves it there — the flag reads 'diverging since'", async () => {
    const offerId = await liveOffer();
    await addOfferSet(userId, offerId, [await newCopy()]);
    const first = await flag(offerId);
    assert.notEqual(first, null);

    await addOfferSet(userId, offerId, [await newCopy()]);
    assert.deepEqual(await flag(offerId), first);
  });

  it("raises nothing on an offer that has never been posted", async () => {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [await newCopy()]);
    await setOfferState(userId, offerId, "ready");
    // Everything above happened while the offer was preparing or ready: nothing to be out of step with.
    assert.equal(await flag(offerId), null);
  });

  it("keeps the flag across a pause and a resume — neither is a re-post", async () => {
    const offerId = await liveOffer();
    await addOfferSet(userId, offerId, [await newCopy()]);
    const raised = await flag(offerId);

    await setOfferState(userId, offerId, "paused");
    assert.deepEqual(await flag(offerId), raised);
    await setOfferState(userId, offerId, "active");
    assert.deepEqual(await flag(offerId), raised);
  });

  it("raises it for a change made while paused — a paused listing is still on the platform", async () => {
    const offerId = await liveOffer();
    await setOfferState(userId, offerId, "paused");
    await addOfferSet(userId, offerId, [await newCopy()]);
    assert.notEqual(await flag(offerId), null);
  });

  it("clears on publication, and on being marked up to date by hand", async () => {
    const offerId = await liveOffer();
    await addOfferSet(userId, offerId, [await newCopy()]);
    assert.notEqual(await flag(offerId), null);

    await markOfferListingSynced(userId, offerId);
    assert.equal(await flag(offerId), null);
  });

  it("counts a quick buy's asking price and one of the listing's texts", async () => {
    const priced = await liveOffer();
    await patchOffer(userId, priced, { price: "9.00" });
    assert.notEqual(await flag(priced), null);

    const retitled = await liveOffer();
    await patchOffer(userId, retitled, { name: "A different title" });
    assert.notEqual(await flag(retitled), null);
  });

  it("ignores a price retyped as it was, and a URL corrected", async () => {
    const offerId = await liveOffer();
    await patchOffer(userId, offerId, { price: "5.00" });
    await patchOffer(userId, offerId, { url: "https://colnect.com/en/market/sale/abc" });
    assert.equal(await flag(offerId), null);
  });

  it("ignores an auction's current price — that is the bidding, not the listing", async () => {
    const offerId = await liveOffer({ listingType: "auction", startingPrice: "2.00" });
    await patchOffer(userId, offerId, { price: "7.50" });
    assert.equal(await flag(offerId), null);

    // …but the figure the *seller* states is a change to the listing.
    await patchOffer(userId, offerId, { startingPrice: "3.00" });
    assert.notEqual(await flag(offerId), null);
  });

  it("counts a price moved on the header form too", async () => {
    const offerId = await liveOffer();
    await updateOffer(userId, offerId, {
      platformId,
      url: null,
      price: "12.00",
      currency: "EUR",
      listingDate: null,
      state: "active",
    });
    assert.notEqual(await flag(offerId), null);
  });

  it("reaches the list row, the filter and the facet count", async () => {
    const offerId = await liveOffer();
    await addOfferSet(userId, offerId, [await newCopy()]);

    const rows = await listOffersPaginated(userId, collectionId, { listingOutOfDate: true });
    const row = rows.items.find((o) => o.id === offerId);
    assert.ok(row, "the flagged offer is in the filtered list");
    assert.notEqual(row.listingOutOfDate, null);

    // *Needs action* selects both problems (#542), so the facet counts this offer under it.
    const counts = await offerFilterCounts(userId, collectionId, {});
    assert.ok(counts.needsAction > 0);
    const needing = await listOffersPaginated(userId, collectionId, { needsAction: true });
    assert.ok(needing.items.some((o) => o.id === offerId));

    const detail = await getOfferDetail(userId, offerId);
    assert.notEqual(detail?.listingOutOfDate, null);
  });

  it("is one of the two things *Needs action* selects, counted once when it is both", async () => {
    const offerId = await liveOffer();
    await addOfferSet(userId, offerId, [await newCopy()]);

    const counts = await offerFilterCounts(userId, collectionId, {});
    const selected = await listOffersPaginated(userId, collectionId, { needsAction: true });
    // The facet and the list it opens must agree — the union is deduplicated by offer.
    assert.equal(counts.needsAction, selected.items.length);
    assert.ok(selected.items.some((o) => o.id === offerId));
  });

  it("reaches the notification centre as its own group", async () => {
    // The panel shows the head of the list, oldest divergence first, so the tests above would push
    // a freshly flagged offer off it. Cleared here so the group is about exactly one offer.
    await prisma.offer.updateMany({
      where: { collectionId },
      data: { listingContentChangedAt: null },
    });
    const offerId = await liveOffer();
    await addOfferSet(userId, offerId, [await newCopy()]);

    const items = await getActionItems(userId, collectionId);
    const group = items.groups.find((g) => g.id === "offer-listing-changed");
    assert.ok(group, "the changed-since-listed group is present");
    assert.equal(group.severity, "warning");
    assert.ok(group.items.some((i) => i.key === offerId));
    // "See all" has to land on exactly the rows the group counted, not on the wider chip.
    assert.equal(group.href, "offers?listingOutOfDate=1");
  });

  it("stops reporting once the listing is closed — what a sold listing said is history", async () => {
    const offerId = await liveOffer();
    await addOfferSet(userId, offerId, [await newCopy()]);
    await setOfferState(userId, offerId, "withdrawn");

    // The column still carries the instant; the derivation is what reads the state beside it.
    assert.notEqual(await flag(offerId), null);
    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.listingOutOfDate, null);

    const rows = await listOffersPaginated(userId, collectionId, {
      listingOutOfDate: true,
      includeClosed: true,
    });
    assert.equal(
      rows.items.some((o) => o.id === offerId),
      false
    );
  });
});
