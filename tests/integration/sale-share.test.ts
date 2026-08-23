import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import { addSaleLines, createSale, getSaleDetail, setSaleStatus, swapSaleLineSet } from "../../src/lib/sales";
import {
  createSaleShareToken,
  readSaleShareLink,
  revokeSaleShareToken,
  setSaleShareOptions,
  verifySaleShareToken,
} from "../../src/lib/sale-share";
import {
  canServeSaleSharePhoto,
  readSaleShareView,
  saveBuyerSetChoice,
} from "../../src/lib/sale-share-choice";

// The buyer chooses their own copy through a share link (#699).
//
// Three things are worth asserting here rather than reasoning about. The token **names one sale**
// and nothing outside it is reachable through it. The pick is the seller's own `swapSaleLineSet`,
// so the copies move and the price stands. And the window is the parcel: open until it is packed,
// closed after, with the buyer free to change their mind in between.

describe("the buyer's copy choice link (#699)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-saleshare-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User saleshare-${ts}`,
        email: `test-saleshare-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-saleshare-${ts}`,
        name: `Collection saleshare-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp Q" } })).id;
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

  /** A live offer at quantity `n`: `n` interchangeable single-copy sets, which is what a listing at
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

  const setItemIds = (setId: string) =>
    prisma.offerSetItem
      .findMany({ where: { offerSetId: setId }, select: { itemId: true } })
      .then((rows) => rows.map((r) => r.itemId));

  async function saleWithPendingLine(): Promise<{
    saleId: string;
    lineId: string;
    offerId: string;
    setIds: string[];
  }> {
    const { offerId, setIds } = await quantityOffer(3);
    const saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: "TX-1",
      transactionUrl: null,
      soldAt: new Date(),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await addSaleLines(userId, saleId, [
      // What an automatic pick writes (#697/#698): the line names a set so every read keeps working,
      // and says that nobody has chosen it.
      {
        offerId,
        offerSetId: setIds[0],
        price: "4.25",
        itemIds: await setItemIds(setIds[0]),
        setChoicePending: true,
      },
    ]);
    const line = await prisma.saleLine.findFirstOrThrow({
      where: { saleId },
      select: { id: true },
    });
    return { saleId, lineId: line.id, offerId, setIds };
  }

  const lineOf = (lineId: string) =>
    prisma.saleLine.findUniqueOrThrow({
      where: { id: lineId },
      select: {
        offerSetId: true,
        price: true,
        setChoicePending: true,
        setChosenByBuyerAt: true,
        items: { select: { itemId: true } },
      },
    });

  async function access(saleId: string) {
    const { token } = await createSaleShareToken(userId, saleId, { expiresAt: null });
    const verified = await verifySaleShareToken(token);
    assert.equal(verified.ok, true);
    return { token, access: verified.ok ? verified.access : null! };
  }

  describe("the link itself", () => {
    it("resolves to exactly the sale it was minted for, and records the visit", async () => {
      const { saleId } = await saleWithPendingLine();
      const { token } = await createSaleShareToken(userId, saleId, { expiresAt: null });

      const verified = await verifySaleShareToken(token);
      assert.equal(verified.ok, true);
      if (!verified.ok) return;
      assert.equal(verified.access.saleId, saleId);
      assert.equal(verified.access.ownerId, userId);
      assert.equal(verified.access.collectionId, collectionId);

      const link = await readSaleShareLink(userId, saleId);
      assert.ok(link?.lastUsedAt, "opening the page is the one receipt the seller gets");
    });

    it("refuses an invented address, another credential's prefix, and an expired link", async () => {
      const { saleId } = await saleWithPendingLine();
      assert.deepEqual(await verifySaleShareToken("stmps_nonsense"), {
        ok: false,
        reason: "unknown",
      });
      const { token } = await createSaleShareToken(userId, saleId, { expiresAt: null });
      // A trade's share link authorises a different thing and is told apart before anything is
      // hashed.
      assert.deepEqual(await verifySaleShareToken(token.replace("stmps_", "stmpx_")), {
        ok: false,
        reason: "unknown",
      });
      await setSaleShareOptions(userId, saleId, { expiresAt: new Date("2020-01-01") });
      assert.deepEqual(await verifySaleShareToken(token), { ok: false, reason: "expired" });
    });

    it("has one address at a time, and withdrawing means the old one stops working", async () => {
      const { saleId } = await saleWithPendingLine();
      const first = await createSaleShareToken(userId, saleId, { expiresAt: null });
      const second = await createSaleShareToken(userId, saleId, { expiresAt: null });
      assert.deepEqual(await verifySaleShareToken(first.token), { ok: false, reason: "unknown" });
      assert.equal((await verifySaleShareToken(second.token)).ok, true);

      await revokeSaleShareToken(userId, saleId);
      assert.deepEqual(await verifySaleShareToken(second.token), { ok: false, reason: "unknown" });
      assert.equal(await readSaleShareLink(userId, saleId), null);
    });

    it("is not another user's to mint or read", async () => {
      const { saleId } = await saleWithPendingLine();
      await assert.rejects(() => createSaleShareToken("someone-else", saleId, { expiresAt: null }));
      await assert.rejects(() => readSaleShareLink("someone-else", saleId));
    });

    it("reaches the sale screen, so the header can say a question is out there", async () => {
      const { saleId } = await saleWithPendingLine();
      assert.equal((await getSaleDetail(userId, saleId))?.share, null);
      await createSaleShareToken(userId, saleId, { expiresAt: null });
      const detail = await getSaleDetail(userId, saleId);
      assert.ok(detail?.share, "the link is a fact about the sale, not a second fetch");
    });
  });

  describe("the page", () => {
    it("asks about the pending line, offering every set of its own listing", async () => {
      const { saleId, setIds } = await saleWithPendingLine();
      const { access: a } = await access(saleId);
      const view = await readSaleShareView(a);
      assert.ok(view);
      assert.equal(view.lines.length, 1);
      assert.deepEqual(
        view.lines[0].options.map((o) => o.offerSetId).sort(),
        [...setIds].sort(),
        "all three copies of the listing, the one pencilled in included"
      );
      assert.deepEqual(view.lines[0].options.map((o) => o.label), ["Copy 1", "Copy 2", "Copy 3"]);
      // Nothing is marked as chosen while nobody has chosen: the set the line names was picked, not
      // chosen, and marking it would present an automatic pick as the buyer's own decision.
      assert.deepEqual(view.lines[0].options.map((o) => o.chosen), [false, false, false]);
      assert.equal(view.lines[0].answered, false);
      assert.equal(view.open, true);
      // The order is identified, and nothing else about the sale is: no figures anywhere in it.
      assert.equal(view.orderRef, "TX-1");
      assert.equal(JSON.stringify(view).includes("4.25"), false);
    });

    it("says nothing is outstanding once the seller has settled the line themselves", async () => {
      const { saleId, lineId, setIds } = await saleWithPendingLine();
      const { access: a } = await access(saleId);
      await swapSaleLineSet(userId, lineId, setIds[1]);
      const view = await readSaleShareView(a);
      assert.deepEqual(view?.lines, [], "a line the seller settled leaves the page");
    });
  });

  describe("the pick", () => {
    it("moves the copies, keeps the price, clears the flag and records who chose", async () => {
      const { saleId, lineId, setIds } = await saleWithPendingLine();
      const { access: a } = await access(saleId);

      await saveBuyerSetChoice(a, lineId, setIds[2]);

      const line = await lineOf(lineId);
      assert.equal(line.offerSetId, setIds[2]);
      assert.equal(line.setChoicePending, false);
      assert.equal(Number(line.price).toFixed(2), "4.25", "the price is what the buyer paid");
      assert.deepEqual(line.items.map((i) => i.itemId), await setItemIds(setIds[2]));
      assert.ok(line.setChosenByBuyerAt, "the seller sees who chose");
    });

    it("keeps the line on the page afterwards, so the buyer can change their mind", async () => {
      const { saleId, lineId, setIds } = await saleWithPendingLine();
      const { access: a } = await access(saleId);
      await saveBuyerSetChoice(a, lineId, setIds[2]);

      const view = await readSaleShareView(a);
      assert.equal(view?.lines.length, 1);
      assert.equal(view?.lines[0].answered, true);
      assert.deepEqual(
        view?.lines[0].options.filter((o) => o.chosen).map((o) => o.offerSetId),
        [setIds[2]]
      );

      await saveBuyerSetChoice(a, lineId, setIds[1]);
      assert.equal((await lineOf(lineId)).offerSetId, setIds[1]);
    });

    it("is overridden by the seller, and stops being the buyer's answer when it is", async () => {
      const { saleId, lineId, setIds } = await saleWithPendingLine();
      const { access: a } = await access(saleId);
      await saveBuyerSetChoice(a, lineId, setIds[2]);

      // The parcel is the seller's to pack, and once they have overridden the pick the line is no
      // longer the buyer's answer — so the mark goes and the line leaves the buyer's page.
      await swapSaleLineSet(userId, lineId, setIds[0]);
      const line = await lineOf(lineId);
      assert.equal(line.offerSetId, setIds[0]);
      assert.equal(line.setChosenByBuyerAt, null);
      assert.deepEqual((await readSaleShareView(a))?.lines, []);
    });

    it("refuses a line that is not on this order", async () => {
      const first = await saleWithPendingLine();
      const second = await saleWithPendingLine();
      const { access: a } = await access(first.saleId);
      await assert.rejects(
        () => saveBuyerSetChoice(a, second.lineId, second.setIds[1]),
        /not one this order is asking about/
      );
      assert.equal((await lineOf(second.lineId)).offerSetId, second.setIds[0]);
    });

    it("refuses a set of another listing", async () => {
      const { saleId, lineId } = await saleWithPendingLine();
      const other = await quantityOffer(1);
      const { access: a } = await access(saleId);
      await assert.rejects(() => saveBuyerSetChoice(a, lineId, other.setIds[0]));
    });

    it("closes when the parcel is packed", async () => {
      const { saleId, lineId, setIds } = await saleWithPendingLine();
      const { access: open } = await access(saleId);
      await setSaleStatus(userId, saleId, "packed");

      // The page still opens — the buyer is entitled to see what was chosen — and says why it no
      // longer asks.
      const { access: closed } = await access(saleId);
      const view = await readSaleShareView(closed);
      assert.equal(view?.open, false);
      assert.match(view?.closedMessage ?? "", /packed/);

      // Including through a token resolved before the parcel was packed: the status is read at
      // resolve time, and the write asks again.
      assert.equal(open.status, "ordered");
      await assert.rejects(() => saveBuyerSetChoice(closed, lineId, setIds[1]), /packed/);
      assert.equal((await lineOf(lineId)).offerSetId, setIds[0]);
    });
  });

  describe("the scans", () => {
    it("serves a candidate's picture and refuses one from outside the order", async () => {
      const { saleId } = await saleWithPendingLine();
      const { access: a } = await access(saleId);
      const candidateId = (await readSaleShareView(a))!.lines[0].options[1].offerSetId;
      const candidateItem = (await setItemIds(candidateId))[0];
      const stranger = await copy();

      const mine = await prisma.photo.create({
        data: {
          itemId: candidateItem,
          storageBackend: "local",
          storageKey: `saleshare-${Date.now()}-a`,
          mime: "image/jpeg",
          width: 10,
          height: 10,
          sizeBytes: 1,
        },
      });
      const theirs = await prisma.photo.create({
        data: {
          itemId: stranger,
          storageBackend: "local",
          storageKey: `saleshare-${Date.now()}-b`,
          mime: "image/jpeg",
          width: 10,
          height: 10,
          sizeBytes: 1,
        },
      });

      assert.equal(await canServeSaleSharePhoto(a, mine.id), true);
      assert.equal(
        await canServeSaleSharePhoto(a, theirs.id),
        false,
        "a copy that is not one of this order's candidates is not reachable through this token"
      );
      await prisma.photo.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
    });
  });
});
