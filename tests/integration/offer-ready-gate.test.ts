import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, getOfferDetail, setOfferState } from "../../src/lib/offers";
import { setColnectConditionMapping } from "../../src/lib/colnect";

// The listing preconditions gating `preparing → ready` (#418). The rules themselves are unit-tested
// (`listing-preconditions.test.ts`) and their resolution is covered by the kit's own suite (#405);
// what needs a database here is the gate: which offers the transition refuses, which it lets through,
// and that the offer's own screen states the same reasons before the button is ever pressed.

describe("marking an offer ready (#418)", () => {
  let userId: string;
  let collectionId: string;
  /** The platform named as Colnect — the only one whose offers are checked. */
  let platformId: string;
  /** A platform with no Assistant module: listed by hand, so nothing is asked of its offers. */
  let handListedId: string;
  let mnhId: string;
  let usedId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-gate-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User gate-${ts}`,
        email: `test-gate-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-gate-${ts}`,
          name: `Collection gate-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Colnect",
          platform: true,
          platformModule: "colnect",
          platformCurrency: "EUR",
        },
      })
    ).id;
    handListedId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    // Only MNH is mapped: the Used case is what the unmapped-condition refusal rides on.
    await setColnectConditionMapping(userId, mnhId, "1");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  let seq = 0;

  async function stamp(name: string, colnectId: string | null): Promise<string> {
    seq += 1;
    return (
      await prisma.stamp.create({ data: { collectionId, name: `${name} ${seq}`, colnectId } })
    ).id;
  }

  async function copy(stampId: string, conditionId = mnhId): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  /** A `preparing` offer over the given sets. */
  async function preparingOffer(sets: string[][], platform = platformId): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId: platform,
      url: null,
      price: "12.50",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    for (const itemIds of sets) await addOfferSet(userId, offerId, itemIds);
    return offerId;
  }

  const stateOf = async (offerId: string) =>
    (await prisma.offer.findUnique({ where: { id: offerId }, select: { state: true } }))?.state;

  it("lets a listable offer through", async () => {
    const offerId = await preparingOffer([[await copy(await stamp("PL ok", "2001"))]]);
    await setOfferState(userId, offerId, "ready");
    assert.equal(await stateOf(offerId), "ready");
  });

  it("refuses a stamp with no Colnect item-ID, and leaves the offer preparing", async () => {
    const offerId = await preparingOffer([[await copy(await stamp("PL unmatched", null))]]);
    await assert.rejects(
      () => setOfferState(userId, offerId, "ready"),
      /no catalog item-ID/
    );
    assert.equal(await stateOf(offerId), "preparing");
  });

  it("refuses a condition with no Colnect grade mapped", async () => {
    const offerId = await preparingOffer([
      [await copy(await stamp("PL ungraded", "2002"), usedId)],
    ]);
    await assert.rejects(
      () => setOfferState(userId, offerId, "ready"),
      /no grade mapped for this platform: Used/
    );
    assert.equal(await stateOf(offerId), "preparing");
  });

  it("refuses sets that are not interchangeable", async () => {
    const a = await stamp("PL mixed a", "2003");
    const b = await stamp("PL mixed b", "2004");
    const offerId = await preparingOffer([[await copy(a)], [await copy(a), await copy(b)]]);
    await assert.rejects(() => setOfferState(userId, offerId, "ready"), /not interchangeable/);
    assert.equal(await stateOf(offerId), "preparing");
  });

  it("asks nothing of a platform the Assistant has no module for", async () => {
    const offerId = await preparingOffer(
      [[await copy(await stamp("PL by hand", null), usedId)]],
      handListedId
    );
    await setOfferState(userId, offerId, "ready");
    assert.equal(await stateOf(offerId), "ready");
  });

  it("states the reasons on the offer's own screen while it is still preparing", async () => {
    const offerId = await preparingOffer([[await copy(await stamp("PL shown", null), usedId)]]);
    const detail = await getOfferDetail(userId, offerId);
    assert.deepEqual(
      detail?.readyBlockers.map((b) => b.code),
      ["missing-catalog-id", "unmapped-condition"]
    );
    // The Assistant's own blockers stay judged at the state the offer is *in* (#414).
    assert.deepEqual(detail?.listingBlockers.map((b) => b.code), ["not-ready"]);
  });

  it("says nothing about readiness once the offer is past that step", async () => {
    const offerId = await preparingOffer([[await copy(await stamp("PL live", "2005"))]]);
    await setOfferState(userId, offerId, "ready");
    const detail = await getOfferDetail(userId, offerId);
    assert.deepEqual(detail?.readyBlockers, []);
  });

  it("never blocks stepping an offer back, or taking it out of the shop", async () => {
    const offerId = await preparingOffer([[await copy(await stamp("PL back", "2006"))]]);
    await setOfferState(userId, offerId, "ready");
    // The stamp loses its item-ID after the fact — the offer must still be movable.
    await prisma.stamp.updateMany({
      where: { name: { startsWith: "PL back" }, collectionId },
      data: { colnectId: null },
    });
    await setOfferState(userId, offerId, "preparing");
    assert.equal(await stateOf(offerId), "preparing");
    await setOfferState(userId, offerId, "withdrawn");
    assert.equal(await stateOf(offerId), "withdrawn");
  });
});
