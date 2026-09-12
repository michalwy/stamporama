import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer } from "../../src/lib/offers";
import { createTrade } from "../../src/lib/trades";
import { findSeriesRecombinations } from "../../src/lib/series-recombination";
import type { OfferState } from "../../src/lib/offer-rules";

// The series-recombination screen's read (#1210): which series one platform's single offers plus its
// available copies could complete.
//
// What is pinned here is what the pure rules cannot see: that *available* is the bulk-lot builder's
// own reading of the database, that the singles are read off the platform's real offer sets, that a
// bid anywhere and a composed set disqualify a copy, and that the names come back. Each case builds
// a series of its own, so the cases never see each other's copies.

const ts = Date.now();

describe("series from singles (#1210)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let platformId: string;
  let otherPlatformId: string;
  let partnerId: string;
  let mnhId: string;
  let variantSubtypeId: string;
  let nextIssueNo = 9800;
  let nextStamp = 0;

  async function stamp(opts: { parentId?: string; subtypeId?: string } = {}): Promise<string> {
    nextStamp += 1;
    return (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${nextStamp}`,
          issuedYear: 1960,
          parentId: opts.parentId,
          subtypeId: opts.subtypeId,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
  }

  async function stamps(count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) ids.push(await stamp());
    return ids;
  }

  /** A for-sale copy in hand, unless told otherwise. */
  async function copy(stampId: string, opts: { deliveryState?: string } = {}): Promise<string> {
    return (
      await createItem(userId, collectionId, {
        stampId,
        conditionId: mnhId,
        forSale: true,
        deliveryState: opts.deliveryState ?? "delivered",
      })
    ).id;
  }

  /** An offer holding the given sets, put straight into its state — the read is under test, not the
   *  lifecycle's gates. */
  async function offer(
    sets: string[][],
    opts: { platformId?: string; state?: OfferState; inActiveBidding?: boolean } = {}
  ): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId: opts.platformId ?? platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    for (const itemIds of sets) await addOfferSet(userId, offerId, itemIds);
    await prisma.offer.update({
      where: { id: offerId },
      data: { state: opts.state ?? "active", inActiveBidding: opts.inActiveBidding ?? false },
    });
    return offerId;
  }

  async function checklist(stampIds: string[]): Promise<string> {
    const issue = await prisma.issue.create({
      data: { collectionId, issueNo: ++nextIssueNo, collectionAreaId: areaId, name: `Issue ${nextIssueNo}`, year: 1960 },
    });
    return (
      await prisma.checklist.create({
        data: {
          collectionId,
          issueId: issue.id,
          name: "Complete set",
          stamps: { create: stampIds.map((stampId, sortOrder) => ({ stampId, sortOrder })) },
        },
      })
    ).id;
  }

  async function listed(checklistId: string, onPlatform = platformId) {
    const result = await findSeriesRecombinations(userId, collectionId, onPlatform);
    return result.series.find((series) => series.checklistId === checklistId) ?? null;
  }

  before(async () => {
    userId = `test-user-recombine-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User recombine-${ts}`,
        email: `test-recombine-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-recombine-${ts}`, name: "Recombine", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Gum variety", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Colnect", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    partnerId = (
      await prisma.contact.create({ data: { collectionId, name: "Anna", seller: false } })
    ).id;
  });

  after(async () => {
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("lists #754's use case on its platform, naming the three singles — and on no other platform", async () => {
    const ids = await stamps(5);
    const setId = await checklist(ids);
    const singles = [
      await offer([[await copy(ids[0])]], { state: "active" }),
      await offer([[await copy(ids[1])]], { state: "paused" }),
      await offer([[await copy(ids[2])]], { state: "preparing" }),
    ];
    await copy(ids[3]);
    await copy(ids[4]);

    const series = await listed(setId);
    assert.ok(series, "listed on the platform the singles are on");
    assert.equal(series.checklistName, "Complete set");
    assert.equal(series.slots.length, 5);
    assert.deepEqual(
      series.slots.map((slot) => slot.stamp.stampId),
      ids,
      "the slots read in the checklist's order"
    );
    assert.deepEqual(
      series.slots.slice(0, 3).map((slot) => slot.fillers[0].offers.map((o) => o.offerId)),
      singles.map((id) => [id]),
      "each single names the offer holding it"
    );
    assert.deepEqual(
      series.slots.slice(0, 3).map((slot) => slot.fillers[0].offers[0].state),
      ["active", "paused", "preparing"]
    );
    assert.deepEqual(
      series.slots.slice(3).map((slot) => slot.fillers[0].offers),
      [[], []],
      "the two late arrivals are available"
    );
    assert.equal(series.offersToChange, 3);
    assert.equal(series.liveOffersToChange, 2, "active and paused are live; preparing is not");

    assert.equal(
      await listed(setId, otherPlatformId),
      null,
      "on another platform every copy is available, so the series needs no recombining there"
    );
  });

  it("does not list a series the available copies complete on their own", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    await copy(ids[0]);
    await copy(ids[1]);
    await offer([[await copy(ids[0])]]);
    assert.equal(await listed(setId), null);
  });

  it("does not list a series still missing a slot after the singles are counted", async () => {
    const ids = await stamps(3);
    const setId = await checklist(ids);
    await offer([[await copy(ids[0])]]);
    await copy(ids[1]);
    assert.equal(await listed(setId), null);
  });

  it("does not fill a slot with a copy in an offer in active bidding — here or on another platform (#334)", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    await copy(ids[0]);
    await offer([[await copy(ids[1])]], { inActiveBidding: true });
    assert.equal(await listed(setId), null, "under bid on this platform");

    const others = await stamps(2);
    const otherSetId = await checklist(others);
    await copy(others[0]);
    const both = await copy(others[1]);
    await offer([[both]]);
    await offer([[both]], { platformId: otherPlatformId, inActiveBidding: true });
    assert.equal(await listed(otherSetId), null, "under bid elsewhere");
  });

  it("does not fill a slot with a copy in a multi-copy set", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    await copy(ids[0]);
    const composed = await copy(ids[1]);
    await offer([[composed, await copy(await stamp())]]);
    assert.equal(await listed(setId), null);
  });

  it("does not fill a slot with a copy in a sold or withdrawn offer, though an open one would", async () => {
    // In transit, so the copy is not *available* either — the only way it could fill the slot is as a
    // single, which is exactly the question.
    for (const state of ["withdrawn", "sold"] as const) {
      const ids = await stamps(2);
      const setId = await checklist(ids);
      await copy(ids[0]);
      await offer([[await copy(ids[1], { deliveryState: "in_transit" })]], { state });
      assert.equal(await listed(setId), null, state);
    }

    const ids = await stamps(2);
    const setId = await checklist(ids);
    await copy(ids[0]);
    await offer([[await copy(ids[1], { deliveryState: "in_transit" })]], { state: "preparing" });
    assert.ok(await listed(setId), "the same copy alone in a Preparing offer does fill it");
  });

  it("lets a variant copy fill its parent's slot (#661)", async () => {
    const [parent, other] = await stamps(2);
    const variant = await stamp({ parentId: parent, subtypeId: variantSubtypeId });
    const setId = await checklist([parent, other]);
    const variantCopy = await copy(variant);
    await offer([[await copy(other)]]);

    const series = await listed(setId);
    assert.ok(series);
    assert.equal(series.slots[0].fillers[0].itemId, variantCopy);
    assert.equal(series.slots[0].fillers[0].variant?.stampId, variant, "named as the variant it is");
  });

  it("fills a slot with a copy promised in an agreed trade, and names the trade (#639)", async () => {
    const ids = await stamps(2);
    const setId = await checklist(ids);
    const promised = await copy(ids[0]);
    await offer([[promised]]);
    await copy(ids[1]);
    const trade = await createTrade(userId, collectionId, { partnerId, currency: "EUR" });
    await prisma.tradeLine.create({
      data: { tradeId: trade.id, sectionId: trade.sections[0].id, side: "give", itemId: promised },
    });
    await prisma.trade.update({ where: { id: trade.id }, data: { status: "agreed" } });

    const series = await listed(setId);
    assert.ok(series, "a promise does not take the copy out");
    assert.equal(series.slots[0].fillers[0].promisedIn?.tradeId, trade.id);
    assert.equal(series.slots[0].fillers[0].promisedIn?.partnerName, "Anna");
  });

  it("refuses a platform that is not one of the collection's", async () => {
    await assert.rejects(findSeriesRecombinations(userId, collectionId, partnerId));
  });
});
