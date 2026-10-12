import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { getActionItems } from "../../src/lib/action-items";
import {
  addOfferSet,
  createOffer,
  getOfferDetail,
  listOffersPaginated,
  OfferActionBlockedError,
  offersNeedingAction,
  removeOfferSetsSoldElsewhere,
  setOfferState,
} from "../../src/lib/offers";
import { addSaleLines, createSale } from "../../src/lib/sales";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { createFacebookPost, publishOfferOrPost } from "../../src/lib/facebook-posts";

// An offer still being prepared — Preparing or Ready — that holds a copy sold through another offer
// (#1876), against a real database: it is flagged *Needs action* and reported in the bell's amber
// group, not the red one a live listing is; it may not be marked Ready, submitted or published until
// the set is removed, whatever the surface; and the flag goes with the set, or with the offer.

describe("a prepared offer holding a copy sold elsewhere (#1876)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let facebookId: string;
  let groupId: string;
  let stampId: string;
  let conditionId: string;
  let saleId: string;

  const newItem = async () =>
    (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  const newOffer = async (platform = platformId) =>
    createOffer(userId, collectionId, {
      platformId: platform,
      url: null,
      listingType: "fixed",
      price: "10.00",
      currency: "PLN",
      listingDate: null,
      state: "preparing",
      ...(platform === facebookId ? { facebookGroupId: groupId } : {}),
    });
  const stateOf = async (offerId: string) =>
    (await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { state: true } })).state;
  const refusedOverSoldElsewhere = (e: unknown) =>
    e instanceof OfferActionBlockedError &&
    e.reason === "sold-elsewhere" &&
    /sold through another offer/.test(e.message);

  /** Sell `itemId` through a fresh active offer of its own, so every other offer holding it has had
   *  it sold elsewhere. */
  async function sellElsewhere(itemId: string) {
    const other = await newOffer();
    const otherSet = await addOfferSet(userId, other, [itemId]);
    await setOfferState(userId, other, "ready");
    await setOfferState(userId, other, "active");
    await addSaleLines(userId, saleId, [
      { offerId: other, offerSetId: otherSet, price: "10.00", itemIds: [itemId] },
    ]);
  }

  /** An offer in `state` of two sets, one of whose copies then sells through another offer. */
  async function scenario(state: "preparing" | "ready" | "pending", platform = platformId) {
    const [kept, gone] = [await newItem(), await newItem()];
    const offerId = await newOffer(platform);
    const keptSet = await addOfferSet(userId, offerId, [kept]);
    const goneSet = await addOfferSet(userId, offerId, [gone]);
    if (state !== "preparing") await setOfferState(userId, offerId, "ready");
    if (state === "pending") await setOfferState(userId, offerId, "pending");
    await sellElsewhere(gone);
    return { offerId, keptSet, goneSet };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-preparedsold-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User preparedsold-${ts}`,
        email: `test-preparedsold-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-preparedsold-${ts}`, name: `Collection preparedsold-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    platformId = (await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })).id;
    facebookId = (
      await prisma.contact.create({
        data: { collectionId, name: "Facebook", platform: true, platformCurrency: "PLN" },
      })
    ).id;
    await setFacebookPlatform(userId, collectionId, facebookId);
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki",
        url: `https://www.facebook.com/groups/1876${ts % 100000}`,
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Copernicus", issuedYear: 1973 } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint never hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.facebookPost.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  for (const state of ["preparing", "ready"] as const) {
    it(`flags a ${state} offer Needs action, on its screen and on the list`, async () => {
      const { offerId, keptSet, goneSet } = await scenario(state);
      const detail = await getOfferDetail(userId, offerId);
      assert.ok(detail);
      assert.equal(detail.needsAction, true);
      const byId = new Map(detail.sets.map((s) => [s.id, s]));
      assert.equal(byId.get(goneSet)!.soldElsewhere, true);
      assert.equal(byId.get(keptSet)!.soldElsewhere, false);

      const flagged = await listOffersPaginated(userId, collectionId, { needsAction: true });
      const row = flagged.items.find((o) => o.id === offerId);
      assert.ok(row, "the Needs action filter lists it");
      assert.equal(row.needsAction, true);
      assert.equal(row.soldCopyCount, 1);
    });

    it(`reports a ${state} offer in the bell's amber group, not the red one`, async () => {
      const { offerId } = await scenario(state);
      const byReason = await offersNeedingAction(userId, collectionId, 50);
      assert.ok(byReason["prepared-sold-elsewhere"].offers.some((o) => o.offerId === offerId));
      assert.ok(!byReason["sold-elsewhere"].offers.some((o) => o.offerId === offerId));

      const { groups } = await getActionItems(userId, collectionId, 50);
      const amber = groups.find((g) => g.id === "offer-prepared-sold-elsewhere");
      assert.ok(amber);
      assert.equal(amber.severity, "warning");
      assert.equal(amber.title, "Preparing an offer with a copy sold elsewhere");
      assert.ok(amber.items.some((i) => i.key === offerId));
      const red = groups.find((g) => g.id === "offer-sold-elsewhere");
      assert.ok(!red?.items.some((i) => i.key === offerId));
    });
  }

  it("keeps a pending offer in the red group, as an active one", async () => {
    const { offerId } = await scenario("pending");
    const byReason = await offersNeedingAction(userId, collectionId, 50);
    assert.ok(byReason["sold-elsewhere"].offers.some((o) => o.offerId === offerId));
    assert.ok(!byReason["prepared-sold-elsewhere"].offers.some((o) => o.offerId === offerId));
  });

  it("refuses Mark ready with the reason, and says so on the screen before it is pressed", async () => {
    const { offerId } = await scenario("preparing");
    const detail = await getOfferDetail(userId, offerId);
    assert.ok(detail?.readyBlockers.some((b) => b.code === "sets-sold-elsewhere"));
    await assert.rejects(setOfferState(userId, offerId, "ready"), refusedOverSoldElsewhere);
    assert.equal(await stateOf(offerId), "preparing");
  });

  it("refuses publishing a Ready offer, live or for approval", async () => {
    const { offerId } = await scenario("ready");
    await assert.rejects(setOfferState(userId, offerId, "active"), refusedOverSoldElsewhere);
    await assert.rejects(setOfferState(userId, offerId, "pending"), refusedOverSoldElsewhere);
    assert.equal(await stateOf(offerId), "ready");
  });

  it("still lets it go back to Preparing", async () => {
    const back = await scenario("ready");
    await setOfferState(userId, back.offerId, "preparing");
    assert.equal(await stateOf(back.offerId), "preparing");
  });

  it("lets it move on once the sets sold elsewhere are removed, and clears the flag", async () => {
    const { offerId, keptSet, goneSet } = await scenario("preparing");
    const result = await removeOfferSetsSoldElsewhere(userId, offerId, [goneSet]);
    assert.equal(result.removed, 1);
    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.needsAction, false);
    assert.deepEqual(
      detail?.sets.map((s) => s.id),
      [keptSet]
    );
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    assert.equal(await stateOf(offerId), "active");
  });

  it("clears the flag when the offer is withdrawn", async () => {
    const { offerId } = await scenario("ready");
    await setOfferState(userId, offerId, "withdrawn");
    const byReason = await offersNeedingAction(userId, collectionId, 50);
    assert.ok(!byReason["prepared-sold-elsewhere"].offers.some((o) => o.offerId === offerId));
    const flagged = await listOffersPaginated(userId, collectionId, { needsAction: true });
    assert.ok(!flagged.items.some((o) => o.id === offerId));
  });

  it("does not flag a prepared offer over a copy merely in bidding elsewhere", async () => {
    const copy = await newItem();
    const offerId = await newOffer();
    await addOfferSet(userId, offerId, [copy]);
    const bidding = await newOffer();
    await addOfferSet(userId, bidding, [copy]);
    await setOfferState(userId, bidding, "ready");
    await setOfferState(userId, bidding, "active");
    await prisma.offer.update({ where: { id: bidding }, data: { inActiveBidding: true } });

    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.needsAction, false);
    const flagged = await listOffersPaginated(userId, collectionId, { needsAction: true });
    assert.ok(!flagged.items.some((o) => o.id === offerId));
    await setOfferState(userId, offerId, "ready");
    assert.equal(await stateOf(offerId), "ready", "a bid elsewhere does not hold it back");
    await prisma.offer.update({ where: { id: bidding }, data: { inActiveBidding: false } });
  });

  it("refuses a Facebook post before any of its lots goes up", async () => {
    const fine = await scenario("preparing", facebookId);
    await removeOfferSetsSoldElsewhere(userId, fine.offerId, [fine.goneSet]);
    await setOfferState(userId, fine.offerId, "ready");
    const flagged = await scenario("ready", facebookId);
    await createFacebookPost(userId, collectionId, [fine.offerId, flagged.offerId], "Copernicus");

    await assert.rejects(
      publishOfferOrPost(userId, fine.offerId, "https://www.facebook.com/groups/1/posts/2"),
      refusedOverSoldElsewhere
    );
    assert.equal(await stateOf(fine.offerId), "ready", "the lot ahead of it did not go up alone");
    assert.equal(await stateOf(flagged.offerId), "ready");
  });
});
