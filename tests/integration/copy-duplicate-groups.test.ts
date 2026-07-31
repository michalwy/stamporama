import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createItem,
  listItemDuplicateGroups,
  listItemsPaginated,
} from "../../src/lib/items";
import { createOffer } from "../../src/lib/offers";

// Duplicate grouping on the Copies list (#372). What is worth pinning down is the *key*: the fixed
// `stamp × condition` part (Colnect refuses a second offer for the same stamp in the same
// condition), the two optional axes, and the eligibility — grouping only covers copies that can
// still be listed, so a not-for-sale, undelivered or sold copy is not part of any group. Plus the
// two derived figures a group carries beyond a plain count: how many are already listed, and
// whether its members disagree on an axis left at *any*.

const ts = Date.now();

describe("duplicate groups", () => {
  let userId: string;
  let collectionId: string;
  let mnhId: string;
  let usedId: string;
  let pairFormatId: string;
  let certId: string;
  let stampId: string;
  let otherStampId: string;
  let listedItemId: string;

  before(async () => {
    userId = `test-user-dupgroups-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User dupgroups-${ts}`,
        email: `test-dupgroups-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-dupgroups-${ts}`, name: "Dup", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint never hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;
    pairFormatId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Pair", abbreviation: "pair", sortOrder: 0 },
      })
    ).id;
    certId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Photo certificate", abbreviation: "cert", sortOrder: 0 },
      })
    ).id;

    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Chopin" } })).id;
    otherStampId = (await prisma.stamp.create({ data: { collectionId, name: "Curie" } })).id;

    const sellable = { forSale: true, deliveryState: "delivered" as const };
    // Chopin / MNH: four sellable copies — three plain singles, one a pair (the outlier) and one of
    // the singles carrying a certificate. Ungrouped by format or certificate they are one group of
    // four, mixed on both axes.
    await createItem(userId, collectionId, { stampId, conditionId: mnhId, ...sellable });
    await createItem(userId, collectionId, { stampId, conditionId: mnhId, ...sellable });
    listedItemId = (
      await createItem(userId, collectionId, {
        stampId,
        conditionId: mnhId,
        certificateStatusId: certId,
        ...sellable,
      })
    ).id;
    await createItem(userId, collectionId, {
      stampId,
      conditionId: mnhId,
      formatId: pairFormatId,
      ...sellable,
    });
    // Same stamp, other condition — never joined to the group above.
    await createItem(userId, collectionId, { stampId, conditionId: usedId, ...sellable });
    // Another stamp, so the page holds more than one group.
    await createItem(userId, collectionId, {
      stampId: otherStampId,
      conditionId: mnhId,
      ...sellable,
    });
    await createItem(userId, collectionId, {
      stampId: otherStampId,
      conditionId: mnhId,
      ...sellable,
    });

    // Three copies that must never be grouped: not for sale, not in hand, and sold.
    await createItem(userId, collectionId, { stampId, conditionId: mnhId, forSale: false });
    await createItem(userId, collectionId, {
      stampId,
      conditionId: mnhId,
      forSale: true,
      deliveryState: "in_transit",
    });
    const gone = await createItem(userId, collectionId, {
      stampId,
      conditionId: mnhId,
      ...sellable,
    });

    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Colnect", platform: true } })
    ).id;
    const offer = await prisma.offer.create({
      // Written straight to the table, so it bypasses `allocateOfferNumber` (#416) — a number well
      // past the collection's counter keeps it from colliding with one `createOffer` hands out.
      data: { collectionId, offerNo: 9001, platformId, currency: "EUR", price: "5.00", state: "active" },
    });
    const offerSet = await prisma.offerSet.create({ data: { offerId: offer.id } });
    // One live listing over the certified copy — that is the `listedCount` the group reports.
    await prisma.offerSetItem.create({ data: { offerSetId: offerSet.id, itemId: listedItemId } });
    const sale = await prisma.sale.create({
      data: { collectionId, saleNo: 9001, platformId, soldAt: new Date(), currency: "EUR" },
    });
    const saleLine = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId: offer.id, offerSetId: offerSet.id, price: "5.00" },
    });
    await prisma.saleLineItem.create({ data: { saleLineId: saleLine.id, itemId: gone.id } });
  });

  after(async () => {
    await prisma.saleLineItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.saleLine.deleteMany({ where: { sale: { collectionId } } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offerSetItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.contact.deleteMany({ where: { collectionId } });
    await prisma.stampFormat.deleteMany({ where: { collectionId } });
    await prisma.certificateStatus.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("groups by stamp × condition, biggest stack first", async () => {
    const { groups } = await listItemDuplicateGroups(userId, collectionId);
    // Chopin/MNH (4), Curie/MNH (2), Chopin/Used (1) — count descending.
    assert.deepEqual(
      groups.map((g) => g.count),
      [4, 2, 1]
    );
    const top = groups[0];
    assert.equal(top.stampId, stampId);
    assert.equal(top.conditionId, mnhId);
    assert.equal(top.conditionAbbreviation, "MNH");
    // The two conditions of the same stamp are never merged.
    assert.equal(groups.filter((g) => g.stampId === stampId).length, 2);
  });

  it("leaves out copies that cannot be listed", async () => {
    const { groups } = await listItemDuplicateGroups(userId, collectionId);
    const total = groups.reduce((n, g) => n + g.count, 0);
    // Seven sellable copies were created; the not-for-sale, in-transit and sold ones are excluded.
    assert.equal(total, 7);
  });

  it("reports how many of a group are already listed", async () => {
    const { groups } = await listItemDuplicateGroups(userId, collectionId);
    const top = groups.find((g) => g.stampId === stampId && g.conditionId === mnhId)!;
    assert.equal(top.listedCount, 1);
    assert.equal(groups.find((g) => g.stampId === otherStampId)!.listedCount, 0);
  });

  it("marks a group mixed on the axes left at any", async () => {
    const { groups } = await listItemDuplicateGroups(userId, collectionId);
    const top = groups.find((g) => g.stampId === stampId && g.conditionId === mnhId)!;
    assert.equal(top.mixedFormat, true);
    assert.equal(top.mixedCertificate, true);
    const curie = groups.find((g) => g.stampId === otherStampId)!;
    assert.equal(curie.mixedFormat, false);
    assert.equal(curie.mixedCertificate, false);
  });

  it("splits on format and certificate when those axes join the key", async () => {
    const { groups } = await listItemDuplicateGroups(userId, collectionId, {
      axes: { format: true, certificate: true },
    });
    const chopinMnh = groups.filter((g) => g.stampId === stampId && g.conditionId === mnhId);
    // Four copies become three groups: two plain singles, one certified single, one pair.
    assert.deepEqual(
      chopinMnh.map((g) => g.count).sort(),
      [1, 1, 2]
    );
    // With both axes on, nothing can be mixed by construction.
    assert.ok(groups.every((g) => !g.mixedFormat && !g.mixedCertificate));
    const pair = chopinMnh.find((g) => g.formatId === pairFormatId)!;
    assert.equal(pair.count, 1);
    assert.equal(pair.formatAbbreviation, "pair");
    const certified = chopinMnh.find((g) => g.certificateStatusId === certId)!;
    assert.equal(certified.count, 1);
    assert.equal(certified.certificateStatusName, "Photo certificate");
  });

  it("still narrows by the list's own filters — grouping and filtering compose", async () => {
    const { groups } = await listItemDuplicateGroups(userId, collectionId, {
      conditionIds: [usedId],
    });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].conditionId, usedId);
    assert.equal(groups[0].count, 1);
  });

  it("seeds an offer with one single-copy set per copy", async () => {
    // The group's own action (#372): one offer, one set each, so the listing carries a quantity —
    // the shape Colnect requires, since it refuses a second offer for the same stamp in the same
    // condition. `seedPerCopy` is the only difference from the single-set seed (#189).
    const { groups } = await listItemDuplicateGroups(userId, collectionId);
    const top = groups.find((g) => g.stampId === stampId && g.conditionId === mnhId)!;
    const { items } = await listItemsPaginated(userId, collectionId, {
      stampId,
      conditionIds: [mnhId],
      forSale: true,
      deliveryStates: ["delivered"],
      excludeSold: true,
    });
    assert.equal(items.length, top.count);
    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId,
        url: null,
        price: "4.00",
        currency: "EUR",
        listingDate: null,
        state: "preparing",
      },
      { seedItemIds: items.map((i) => i.id), seedPerCopy: true }
    );
    const sets = await prisma.offerSet.findMany({
      where: { offerId },
      select: { sortOrder: true, items: { select: { itemId: true } } },
      orderBy: { sortOrder: "asc" },
    });
    assert.equal(sets.length, items.length);
    assert.ok(sets.every((s) => s.items.length === 1));
    assert.deepEqual(
      sets.map((s) => s.sortOrder),
      items.map((_, i) => i)
    );
  });

  it("paginates without splitting a group across a page boundary", async () => {
    const first = await listItemDuplicateGroups(userId, collectionId, { pageSize: 2 });
    assert.equal(first.groups.length, 2);
    assert.equal(first.nextCursor, "2");
    const second = await listItemDuplicateGroups(userId, collectionId, {
      pageSize: 2,
      offset: 2,
    });
    assert.equal(second.groups.length, 1);
    assert.equal(second.nextCursor, null);
    const keys = [...first.groups, ...second.groups].map((g) => g.key);
    assert.equal(new Set(keys).size, 3);
  });
});
