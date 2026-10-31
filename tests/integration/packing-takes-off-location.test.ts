import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, disposeItem, restoreItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import {
  addSaleLines,
  createSale,
  listSaleCopies,
  markSaleCopiesPacked,
  setSaleLineItemPacked,
} from "../../src/lib/sales";
import { createTrade } from "../../src/lib/trades";
import { setTradeLineFulfillment } from "../../src/lib/trade-realisation";
import { readTradePackingList } from "../../src/lib/trade-packing";
import { getLocationRefUsage, getLocations } from "../../src/lib/locations";
import { getCopyLocationMoves } from "../../src/lib/location-moves";

// A copy leaving the collection leaves its location (#2278): packed for a sale or a trade it is given
// away in, or written off, it is taken off its location and ref, and the history (#2277) records
// where from and why. Nothing puts it back. What is pinned here: each way of leaving clears it and
// names itself; unpacking and restoring leave the copy unfiled; the packing lists keep saying where a
// packed copy was pulled from; a location counts only the copies still in it; and the next ref still
// follows every ref the location ever held.

const ts = Date.now();

describe("packing or writing off takes a copy off its location (#2278)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let partnerId: string;
  let stampId: string;
  let conditionId: string;
  let bookId: string;

  before(async () => {
    userId = `test-user-packoff-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User packoff-${ts}`,
        email: `test-packoff-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-packoff-${ts}`, name: "Packing", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Chopin" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Colnect" } })).id;
    partnerId = (
      await prisma.contact.create({ data: { collectionId, name: "Karel", exchangePartner: true } })
    ).id;
    bookId = (await prisma.location.create({ data: { collectionId, code: "A", name: "Klaser A" } })).id;
  });

  after(async () => {
    // Sales and trades first: `sale_line_item.itemId` and the trade's lines hold copies.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const filedCopy = async (ref: string, forSale = false) =>
    (await createItem(userId, collectionId, { stampId, conditionId, forSale, locationId: bookId, locationRef: ref }))
      .id;

  const placeOf = (id: string) =>
    prisma.item.findUniqueOrThrow({ where: { id }, select: { locationId: true, locationRef: true } });

  const lastMove = (itemId: string) =>
    prisma.itemLocationMove.findFirstOrThrow({
      where: { itemId },
      orderBy: [{ movedAt: "desc" }, { id: "desc" }],
    });

  /** A sale of `refs.length` copies, each filed on its own card, none packed. */
  async function saleOf(refs: string[]): Promise<{ saleId: string; itemIds: string[] }> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    const sets: { setId: string; itemId: string }[] = [];
    for (const ref of refs) {
      const itemId = await filedCopy(ref, true);
      sets.push({ setId: await addOfferSet(userId, offerId, [itemId]), itemId });
    }
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    const saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await addSaleLines(
      userId,
      saleId,
      sets.map((s) => ({ offerId, offerSetId: s.setId, price: "5.00", itemIds: [s.itemId] }))
    );
    return { saleId, itemIds: sets.map((s) => s.itemId) };
  }

  it("takes a copy packed for a sale off its location, and unpacking does not put it back", async () => {
    const { saleId, itemIds } = await saleOf(["1", "2"]);
    const [packed, waiting] = itemIds;

    await setSaleLineItemPacked(userId, packed, true);
    assert.deepEqual(await placeOf(packed), { locationId: null, locationRef: null });
    // Sold but not yet packed, it is still on the shelf — and still counted there.
    assert.deepEqual(await placeOf(waiting), { locationId: bookId, locationRef: "2" });

    const move = await lastMove(packed);
    assert.deepEqual(
      [move.source, move.sourceId, move.fromLocationId, move.fromRef, move.toLocationId],
      ["sale_packing", saleId, bookId, "1", null]
    );

    await setSaleLineItemPacked(userId, packed, false);
    assert.deepEqual(await placeOf(packed), { locationId: null, locationRef: null });
    assert.equal((await lastMove(packed)).id, move.id, "unpacking is not a move");
  });

  it("keeps saying on the sale's packing list where a packed copy was pulled from", async () => {
    const { saleId, itemIds } = await saleOf(["3", "4"]);
    await setSaleLineItemPacked(userId, itemIds[0], true);

    const copies = await listSaleCopies(userId, saleId);
    const byId = new Map(copies.map((c) => [c.id, c]));
    assert.deepEqual(
      [byId.get(itemIds[0])!.locationId, byId.get(itemIds[0])!.locationRef, byId.get(itemIds[0])!.packed],
      [bookId, "3", true]
    );
    assert.deepEqual([byId.get(itemIds[1])!.locationId, byId.get(itemIds[1])!.locationRef], [bookId, "4"]);

    // Unpacked, it is unfiled, and says so: the sheet names a place only for a copy that went.
    await setSaleLineItemPacked(userId, itemIds[0], false);
    const again = (await listSaleCopies(userId, saleId)).find((c) => c.id === itemIds[0])!;
    assert.equal(again.locationId, null);
  });

  it("takes every copy off at once when the whole sale is marked packed", async () => {
    const { saleId, itemIds } = await saleOf(["5", "6"]);
    await markSaleCopiesPacked(userId, saleId);
    for (const id of itemIds) {
      assert.deepEqual(await placeOf(id), { locationId: null, locationRef: null });
      const move = await lastMove(id);
      assert.deepEqual([move.source, move.sourceId], ["sale_packing", saleId]);
    }
    const [entry] = await getCopyLocationMoves(userId, collectionId, itemIds[0]);
    assert.equal(entry.named?.kind, "sale");
    assert.equal(entry.named?.id, saleId);
    assert.match(entry.named!.label, /Colnect/);
  });

  it("takes a copy that went in a trade's parcel off its location, and leaves a withdrawn one", async () => {
    const trade = await createTrade(userId, collectionId, { partnerId, currency: "EUR" });
    const sectionId = trade.sections[0].id;
    const sent = await filedCopy("7");
    const missing = await filedCopy("8");
    const withdrawn = await filedCopy("9");
    const lineIds: string[] = [];
    for (const itemId of [sent, missing, withdrawn]) {
      lineIds.push(
        (await prisma.tradeLine.create({ data: { tradeId: trade.id, sectionId, side: "give", itemId } })).id
      );
    }
    // Verdicts are recorded only on an agreed trade (#642); the way there is not what is tested here.
    await prisma.trade.update({ where: { id: trade.id }, data: { status: "agreed" } });

    await setTradeLineFulfillment(userId, lineIds[0], { fulfillment: "fulfilled" });
    await setTradeLineFulfillment(userId, lineIds[1], { fulfillment: "missing", note: "lost in the post" });
    await setTradeLineFulfillment(userId, lineIds[2], { fulfillment: "withdrawn", note: "damaged" });

    for (const id of [sent, missing]) {
      assert.deepEqual(await placeOf(id), { locationId: null, locationRef: null });
      const move = await lastMove(id);
      assert.deepEqual([move.source, move.sourceId], ["trade_packing", trade.id]);
    }
    assert.deepEqual(await placeOf(withdrawn), { locationId: bookId, locationRef: "9" });

    const [entry] = await getCopyLocationMoves(userId, collectionId, sent);
    assert.deepEqual([entry.named?.kind, entry.named?.id], ["trade", trade.id]);
    assert.match(entry.named!.label, /Karel/);

    // The trade's packing list still says where the sent copy was.
    const read = (await readTradePackingList(userId, trade.id, { withValues: false, voice: "own" }))!;
    const onSheet = read.copies.find((c) => c.line?.id === lineIds[0])!;
    assert.deepEqual([onSheet.locationId, onSheet.locationRef, onSheet.packed], [bookId, "7", true]);
  });

  it("takes a written-off copy off its location, and a restore leaves it unfiled", async () => {
    const id = await filedCopy("10");
    await disposeItem(userId, id, { reason: "lost" });
    assert.deepEqual(await placeOf(id), { locationId: null, locationRef: null });
    const move = await lastMove(id);
    assert.deepEqual([move.source, move.fromLocationId, move.fromRef], ["write_off", bookId, "10"]);

    await restoreItem(userId, id);
    assert.deepEqual(await placeOf(id), { locationId: null, locationRef: null });
  });

  it("counts only the copies still in a location, and never hands out a ref it once held", async () => {
    const box = await prisma.location.create({ data: { collectionId, code: "B", name: "Pudełko" } });
    const stays = (
      await createItem(userId, collectionId, { stampId, conditionId, locationId: box.id, locationRef: "B1" })
    ).id;
    const goes = (
      await createItem(userId, collectionId, { stampId, conditionId, locationId: box.id, locationRef: "B2" })
    ).id;
    await disposeItem(userId, goes, { reason: "damaged" });

    const location = (await getLocations(userId, collectionId)).find((l) => l.id === box.id)!;
    assert.equal(location.itemCount, 1);

    const usage = await getLocationRefUsage(userId, collectionId, box.id);
    assert.deepEqual(usage.refs, [{ ref: "B1", count: 1 }]);
    // Card B2 is empty now, but it had its number: the next card is B3.
    assert.equal(usage.highest, "B2");
    assert.equal(usage.suggestion, "B3");
    assert.ok(stays);
  });
});
