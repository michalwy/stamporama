import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import {
  addSaleLines,
  createSale,
  getSaleDetail,
  markSaleCopiesPacked,
  setSaleLineItemPacked,
} from "../../src/lib/sales";

// Marking a whole sale's copies packed (#973), and the count the question is asked with.
//
// #192 gave the detail screen the *copies → sale* half: when every copy is packed it hints that the
// sale can advance. The other direction had nothing, so a sale could reach `packed` — or `sent` —
// with copies still unmarked and nothing said. `unpackedItemCount` is what the question names and
// `markSaleCopiesPacked` is the answer "they all went in the parcel"; the status is moved separately
// by the caller, so the rule that `Sale.status` never changes on its own is untouched.

describe("marking every copy on a sale packed (#973)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;
  let otherUserId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-packall-${ts}`;
    otherUserId = `test-user-packall-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    const col = await prisma.collection.create({
      data: {
        slug: `col-packall-${ts}`,
        name: `Collection packall-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp P" } })).id;
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
    // Sales first: `sale_line.offerSetId` and `sale_line_item.itemId` are both Restrict.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  const copy = async () =>
    (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;

  /** A live offer at quantity `n` — `n` interchangeable single-copy sets (ADR-0013 §2). */
  async function quantityOffer(n: number): Promise<{ offerId: string; setIds: string[] }> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    const setIds: string[] = [];
    for (let i = 0; i < n; i++) setIds.push(await addOfferSet(userId, offerId, [await copy()]));
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    return { offerId, setIds };
  }

  async function sale(): Promise<string> {
    return createSale(userId, collectionId, {
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
  }

  const setItemIds = (setId: string) =>
    prisma.offerSetItem.findMany({ where: { offerSetId: setId }, select: { itemId: true } });

  /** A sale carrying `n` sold copies, none of them packed. */
  async function saleWithCopies(n: number): Promise<{ saleId: string; itemIds: string[] }> {
    const { offerId, setIds } = await quantityOffer(n);
    const saleId = await sale();
    const itemIds: string[] = [];
    for (const setId of setIds) {
      const items = (await setItemIds(setId)).map((r) => r.itemId);
      itemIds.push(...items);
      await addSaleLines(userId, saleId, [
        { offerId, offerSetId: setId, price: "5.00", itemIds: items },
      ]);
    }
    return { saleId, itemIds };
  }

  it("counts the unmarked copies, which is the number the question is asked with", async () => {
    const { saleId, itemIds } = await saleWithCopies(3);

    let detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.unpackedItemCount, 3);
    assert.equal(detail.allItemsPacked, false);

    await setSaleLineItemPacked(userId, itemIds[0], true);
    detail = (await getSaleDetail(userId, saleId))!;
    // A count rather than a flag, because *one of three* and *three of three* are the same flag and
    // very different decisions.
    assert.equal(detail.unpackedItemCount, 2);
    assert.equal(detail.allItemsPacked, false);
  });

  it("marks every copy packed in one call, and says how many it changed", async () => {
    const { saleId, itemIds } = await saleWithCopies(3);
    // One already in the parcel: the write must reach the other two and leave this one alone.
    await setSaleLineItemPacked(userId, itemIds[0], true);

    const changed = await markSaleCopiesPacked(userId, saleId);
    assert.equal(changed, 2);

    const detail = (await getSaleDetail(userId, saleId))!;
    assert.equal(detail.unpackedItemCount, 0);
    assert.equal(detail.allItemsPacked, true);
    // The sale's own status is untouched — the caller moves it, in a call it can abandon.
    assert.equal(detail.status, "ordered");
  });

  it("changes nothing when every copy is already packed", async () => {
    const { saleId } = await saleWithCopies(2);
    await markSaleCopiesPacked(userId, saleId);

    assert.equal(await markSaleCopiesPacked(userId, saleId), 0);
    assert.equal((await getSaleDetail(userId, saleId))!.unpackedItemCount, 0);
  });

  it("leaves another sale's copies alone", async () => {
    const mine = await saleWithCopies(2);
    const theirs = await saleWithCopies(2);

    await markSaleCopiesPacked(userId, mine.saleId);

    assert.equal((await getSaleDetail(userId, theirs.saleId))!.unpackedItemCount, 2);
  });

  it("refuses a sale that is not the caller's", async () => {
    const { saleId } = await saleWithCopies(1);

    await assert.rejects(() => markSaleCopiesPacked(otherUserId, saleId), /not found or access denied/i);
    assert.equal((await getSaleDetail(userId, saleId))!.unpackedItemCount, 1);
  });

  it("reports a sale with no copies as nothing to pack, not as all packed", async () => {
    const saleId = await sale();

    const detail = (await getSaleDetail(userId, saleId))!;
    // Zero unpacked *and* `allItemsPacked` false: an empty sale is neither, which is why the count
    // cannot simply be read off the flag.
    assert.equal(detail.unpackedItemCount, 0);
    assert.equal(detail.allItemsPacked, false);
  });
});
