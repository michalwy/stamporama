import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import {
  addSaleLines,
  createSale,
  getSaleDetail,
  listSalesPaginated,
  listSaleLineSetOptions,
  setSaleLineItemPacked,
  swapSaleLineSet,
  SaleActionBlockedError,
} from "../../src/lib/sales";

// Which set left on a sale line (#697).
//
// An offer listed at quantity 3 has three sets, and a buyer who takes one has said *one of these*,
// not *this one*. The sets of one offer are the same thing at the same price — that is why they are
// one listing — so which copy leaves is the seller's own fulfilment choice, made at the packing
// table, and it stays correctable afterwards. Before this, `removeSaleLine` + `addSaleLines` was the
// only way to say so, and that path throws away the line's price and its per-copy `packed` marks.

describe("choosing which set left on a sale line (#697)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-setchoice-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User setchoice-${ts}`,
        email: `test-setchoice-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-setchoice-${ts}`,
        name: `Collection setchoice-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp S" } })).id;
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
    // Sales first: `sale_line.offerSetId` and `sale_line_item.itemId` are both Restrict, so a sold
    // set and its copies cannot cascade until the sale that took them goes.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const copy = async () =>
    (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;

  /** A live offer at quantity `n`: `n` interchangeable single-copy sets, exactly what a listing at
   *  quantity `n` is here (ADR-0013 §2). */
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

  const lineOf = (saleId: string) =>
    prisma.saleLine.findFirstOrThrow({
      where: { saleId },
      select: {
        id: true,
        offerSetId: true,
        price: true,
        setChoicePending: true,
        items: { select: { itemId: true, packed: true } },
      },
    });

  it("a hand-recorded line is not pending — the collector chose the set on the way in", async () => {
    const { offerId, setIds } = await quantityOffer(2);
    const saleId = await sale();
    await addSaleLines(userId, saleId, [
      {
        offerId,
        offerSetId: setIds[0],
        price: "5.00",
        itemIds: (await setItemIds(setIds[0])).map((r) => r.itemId),
      },
    ]);
    assert.equal((await lineOf(saleId)).setChoicePending, false);
  });

  it("moves the copies to the chosen set, keeps the price, and clears the flag", async () => {
    const { offerId, setIds } = await quantityOffer(3);
    const saleId = await sale();
    const first = (await setItemIds(setIds[0])).map((r) => r.itemId);
    await addSaleLines(userId, saleId, [
      // What an automatic pick writes (#698): the line names a set so every read keeps working, and
      // says that nobody has chosen it.
      { offerId, offerSetId: setIds[0], price: "4.25", itemIds: first, setChoicePending: true },
    ]);
    const before = await lineOf(saleId);
    assert.equal(before.setChoicePending, true);
    // A copy of the picked set is already in the parcel, which is the mark a swap must not carry.
    await setSaleLineItemPacked(userId, first[0], true);

    await swapSaleLineSet(userId, before.id, setIds[2]);

    const after = await lineOf(saleId);
    assert.equal(after.offerSetId, setIds[2]);
    assert.equal(after.setChoicePending, false);
    // The price is what the buyer paid; swapping which copy goes does not change it.
    assert.equal(Number(after.price).toFixed(2), "4.25");
    const wanted = (await setItemIds(setIds[2])).map((r) => r.itemId);
    assert.deepEqual(after.items.map((i) => i.itemId).sort(), [...wanted].sort());
    // `packed` went with the copy it was about — a different copy has not been packed.
    assert.deepEqual(after.items.map((i) => i.packed), [false]);
  });

  it("confirming the set already on the line clears the flag and keeps the packing", async () => {
    const { offerId, setIds } = await quantityOffer(2);
    const saleId = await sale();
    const items = (await setItemIds(setIds[0])).map((r) => r.itemId);
    await addSaleLines(userId, saleId, [
      { offerId, offerSetId: setIds[0], price: "5.00", itemIds: items, setChoicePending: true },
    ]);
    const line = await lineOf(saleId);
    await setSaleLineItemPacked(userId, items[0], true);

    await swapSaleLineSet(userId, line.id, setIds[0]);

    const after = await lineOf(saleId);
    assert.equal(after.setChoicePending, false);
    assert.equal(after.offerSetId, setIds[0]);
    assert.deepEqual(after.items.map((i) => i.packed), [true], "nothing moved, so nothing unpacked");
  });

  it("refuses a set whose copies already left on another sale", async () => {
    const { offerId, setIds } = await quantityOffer(2);
    const saleOne = await sale();
    const saleTwo = await sale();
    await addSaleLines(userId, saleOne, [
      {
        offerId,
        offerSetId: setIds[0],
        price: "5.00",
        itemIds: (await setItemIds(setIds[0])).map((r) => r.itemId),
      },
    ]);
    await addSaleLines(userId, saleTwo, [
      {
        offerId,
        offerSetId: setIds[1],
        price: "5.00",
        itemIds: (await setItemIds(setIds[1])).map((r) => r.itemId),
      },
    ]);
    const line = await lineOf(saleTwo);

    await assert.rejects(
      () => swapSaleLineSet(userId, line.id, setIds[0]),
      (e: unknown) => e instanceof SaleActionBlockedError && e.reason === "already-sold"
    );
    assert.equal((await lineOf(saleTwo)).offerSetId, setIds[1]);
  });

  it("refuses a set of a different offer — that is a listing another buyer is looking at", async () => {
    const a = await quantityOffer(1);
    const b = await quantityOffer(1);
    const saleId = await sale();
    await addSaleLines(userId, saleId, [
      {
        offerId: a.offerId,
        offerSetId: a.setIds[0],
        price: "5.00",
        itemIds: (await setItemIds(a.setIds[0])).map((r) => r.itemId),
      },
    ]);
    const line = await lineOf(saleId);

    await assert.rejects(
      () => swapSaleLineSet(userId, line.id, b.setIds[0]),
      (e: unknown) => e instanceof SaleActionBlockedError && e.reason === "bad-set"
    );
  });

  it("offers the offer's still-free sets and its own, and drops the ones that have left", async () => {
    const { offerId, setIds } = await quantityOffer(3);
    const saleOne = await sale();
    const saleTwo = await sale();
    await addSaleLines(userId, saleOne, [
      {
        offerId,
        offerSetId: setIds[0],
        price: "5.00",
        itemIds: (await setItemIds(setIds[0])).map((r) => r.itemId),
      },
    ]);
    await addSaleLines(userId, saleTwo, [
      {
        offerId,
        offerSetId: setIds[1],
        price: "5.00",
        itemIds: (await setItemIds(setIds[1])).map((r) => r.itemId),
        setChoicePending: true,
      },
    ]);
    const line = await lineOf(saleTwo);

    const choice = await listSaleLineSetOptions(userId, line.id);
    assert.ok(choice);
    assert.equal(choice.currentSetId, setIds[1]);
    assert.equal(choice.setChoicePending, true);
    const offered = choice.sets.map((s) => s.offerSetId);
    assert.ok(offered.includes(setIds[1]), "its own set is always among them, so confirming is one click");
    assert.ok(offered.includes(setIds[2]), "a set nobody has taken is a candidate");
    assert.ok(!offered.includes(setIds[0]), "a set that left on another sale is not");

    // The copies come back enriched, so the picker can show what is in each set rather than name it:
    // choosing between interchangeable sets is choosing between physical pieces.
    const offeredItemIds = choice.sets.flatMap((s) => s.itemIds);
    assert.deepEqual(
      choice.copies.map((c) => c.id).sort(),
      [...offeredItemIds].sort(),
      "every copy of every offered set is carried, and nothing else"
    );
  });

  it("offers the one set an offer has, so the picker can always show what is on the line", async () => {
    // The single-set case is not an empty answer: the collector opened the picker to see which set
    // this line is standing on, and that set is the answer.
    const { offerId, setIds } = await quantityOffer(1);
    const saleId = await sale();
    await addSaleLines(userId, saleId, [
      {
        offerId,
        offerSetId: setIds[0],
        price: "5.00",
        itemIds: (await setItemIds(setIds[0])).map((r) => r.itemId),
      },
    ]);
    const choice = await listSaleLineSetOptions(userId, (await lineOf(saleId)).id);
    assert.deepEqual(choice!.sets.map((s) => s.offerSetId), [setIds[0]]);
    assert.equal(choice!.copies.length, 1);
  });

  it("narrows the sales list to the sales still waiting on the decision", async () => {
    const undecided = await quantityOffer(2);
    const decided = await quantityOffer(1);
    const pendingSale = await sale();
    const settledSale = await sale();
    await addSaleLines(userId, pendingSale, [
      {
        offerId: undecided.offerId,
        offerSetId: undecided.setIds[0],
        price: "5.00",
        itemIds: (await setItemIds(undecided.setIds[0])).map((r) => r.itemId),
        setChoicePending: true,
      },
    ]);
    await addSaleLines(userId, settledSale, [
      {
        offerId: decided.offerId,
        offerSetId: decided.setIds[0],
        price: "5.00",
        itemIds: (await setItemIds(decided.setIds[0])).map((r) => r.itemId),
      },
    ]);

    const filtered = await listSalesPaginated(userId, collectionId, { setChoicePending: true });
    const ids = filtered.items.map((s) => s.id);
    assert.ok(ids.includes(pendingSale));
    assert.ok(!ids.includes(settledSale), "a sale whose sets were all chosen is not waiting");

    // …and the filter is not the default view: unfiltered, both are listed.
    const all = (await listSalesPaginated(userId, collectionId, {})).items.map((s) => s.id);
    assert.ok(all.includes(pendingSale) && all.includes(settledSale));

    // Settling the line takes the sale off the filtered list, which is what makes it a worklist.
    await swapSaleLineSet(userId, (await lineOf(pendingSale)).id, undecided.setIds[1]);
    const after = (await listSalesPaginated(userId, collectionId, { setChoicePending: true })).items;
    assert.ok(!after.map((s) => s.id).includes(pendingSale));
  });

  it("shows as pending on the sale detail and on the sales list, from the same column", async () => {
    const { offerId, setIds } = await quantityOffer(2);
    const saleId = await sale();
    await addSaleLines(userId, saleId, [
      {
        offerId,
        offerSetId: setIds[0],
        price: "5.00",
        itemIds: (await setItemIds(setIds[0])).map((r) => r.itemId),
        setChoicePending: true,
      },
    ]);

    const detail = await getSaleDetail(userId, saleId);
    assert.deepEqual(detail!.lines.map((l) => l.setChoicePending), [true]);
    const listed = (await listSalesPaginated(userId, collectionId, {})).items.find(
      (s) => s.id === saleId
    );
    assert.equal(listed?.pendingSetChoiceCount, 1);

    // …and stops saying so on both the moment a person settles it.
    await swapSaleLineSet(userId, detail!.lines[0].id, setIds[1]);
    assert.deepEqual(
      (await getSaleDetail(userId, saleId))!.lines.map((l) => l.setChoicePending),
      [false]
    );
    const after = (await listSalesPaginated(userId, collectionId, {})).items.find(
      (s) => s.id === saleId
    );
    assert.equal(after?.pendingSetChoiceCount, 0);
  });
});
