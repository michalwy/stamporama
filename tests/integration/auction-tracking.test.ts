import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createAuctionLot,
  createAuctionSale,
  deleteAuctionSale,
  findOpenAuctionSale,
  getAuctionSaleDetail,
  getAuctionSellerDefaults,
  listAuctionLots,
  auctionLotFilterCounts,
  recordAuctionLotOutcome,
  setAuctionLotBid,
  setAuctionLotMyBid,
  touchAuctionLotChecked,
  updateAuctionLot,
} from "../../src/lib/auctions";

// Auction tracking (#350–#352; ADR-0021). Three things are worth a real database: the **open-sale
// matching** that lets a lot be added by naming seller and platform, the seeding of the seller's
// terms onto the sale (and their independence from the contact afterwards), and the `checkedAt`
// stamping that the staleness signal is built on.

describe("auction tracking (#351/#352)", () => {
  let userId: string;
  let collectionId: string;
  let sellerId: string;
  let platformId: string;
  let otherSellerId: string;

  const hourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-auction-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User auction-${ts}`,
        email: `test-auction-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-auction-${ts}`,
        name: `Collection auction-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;
    sellerId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Philkam",
          seller: true,
          defaultCurrency: "PLN",
          defaultShippingCost: "15.00",
          buyerPremiumPercent: "10.00",
          buyerPremiumFixed: "2.00",
        },
      })
    ).id;
    otherSellerId = (
      await prisma.contact.create({ data: { collectionId, name: "Köhler", seller: true } })
    ).id;
    platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
  });

  it("seeds a new sale from the seller's own terms and keeps them independent afterwards", async () => {
    const saleId = await createAuctionSale(userId, collectionId, {
      sellerId,
      platformId,
      name: null,
      url: null,
      endsAt: null,
      currency: "",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
    const sale = await getAuctionSaleDetail(userId, saleId);
    assert.equal(sale.currency, "PLN");
    assert.equal(sale.shippingCost, "15.00");
    assert.equal(sale.premiumPercent, "10.00");
    assert.equal(sale.premiumFixed, "2.00");
    // Blank name derives `Seller · Platform` — what actually identifies a marketplace basket.
    assert.equal(sale.name, "Philkam · Allegro");

    // Raising the seller's premium must not re-price a parcel already being tracked (#308/#319).
    await prisma.contact.update({
      where: { id: sellerId },
      data: { buyerPremiumPercent: "25.00" },
    });
    const again = await getAuctionSaleDetail(userId, saleId);
    assert.equal(again.premiumPercent, "10.00");
    await prisma.contact.update({
      where: { id: sellerId },
      data: { buyerPremiumPercent: "10.00" },
    });
  });

  // A seller met for the first time has no currency of their own, and that is the common case for
  // the add-lot dialog: it creates the contact as it creates the lot. The platform's own fixed
  // currency (#196) answers it before the collection's base does — a lot on a zloty-only
  // marketplace was landing in a EUR sale.
  it("falls back to the platform's currency, then the collection's base, for a seller with none", async () => {
    await prisma.contact.update({
      where: { id: platformId },
      data: { platformCurrency: "PLN" },
    });
    const onPlatform = await createAuctionSale(userId, collectionId, {
      sellerId: otherSellerId,
      platformId,
      name: null,
      url: null,
      endsAt: null,
      currency: "",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
    assert.equal((await getAuctionSaleDetail(userId, onPlatform)).currency, "PLN");

    // The seller still wins when they have one: an aggregator carries houses trading in EUR, CHF
    // and GBP alike, so the platform can never overrule them.
    const sellerWins = await createAuctionSale(userId, collectionId, {
      sellerId,
      platformId,
      name: "Second parcel",
      url: null,
      endsAt: null,
      currency: "",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
    assert.equal((await getAuctionSaleDetail(userId, sellerWins)).currency, "PLN");

    // Neither side says anything: the collection's base, rather than a hard-coded currency.
    await prisma.contact.update({ where: { id: platformId }, data: { platformCurrency: null } });
    const neither = await createAuctionSale(userId, collectionId, {
      sellerId: otherSellerId,
      platformId,
      name: "Third parcel",
      url: null,
      endsAt: null,
      currency: "",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
    assert.equal((await getAuctionSaleDetail(userId, neither)).currency, "EUR");

    // Housekeeping: these parcels are open sales for their pairs, and the matching tests that
    // follow expect the first sale to be the only one — and creating a sale also *remembers* the
    // platform on its seller, which a later test reads as never-tracked.
    await prisma.auctionSale.deleteMany({
      where: { id: { in: [onPlatform, sellerWins, neither] } },
    });
    await prisma.contact.update({
      where: { id: otherSellerId },
      data: { defaultAuctionPlatformId: null },
    });
  });

  it("proposes the open sale for a seller + platform pair, and only that pair", async () => {
    const proposal = await findOpenAuctionSale(userId, collectionId, sellerId, platformId);
    assert.ok(proposal, "the open sale for the pair should be proposed");
    assert.equal(proposal.currency, "PLN");

    // A different seller on the same platform is a different parcel.
    assert.equal(await findOpenAuctionSale(userId, collectionId, otherSellerId, platformId), null);

    // A closed sale is never proposed: winning after the parcel shipped starts a second one.
    await prisma.auctionSale.update({ where: { id: proposal.id }, data: { status: "closed" } });
    assert.equal(await findOpenAuctionSale(userId, collectionId, sellerId, platformId), null);
    await prisma.auctionSale.update({ where: { id: proposal.id }, data: { status: "open" } });
  });

  it("stamps checkedAt when a bid is recorded, and again when it is only confirmed", async () => {
    const sale = await findOpenAuctionSale(userId, collectionId, sellerId, platformId);
    assert.ok(sale);
    const lotId = await createAuctionLot(userId, collectionId, {
      auctionSaleId: sale.id,
      lotNo: "12",
      url: null,
      title: "Poland 1919 set",
      endsAt: hourFromNow(),
      startingPrice: "20.00",
      currentBid: "40.00",
      myBid: null,
      maxBid: "80.00",
      notes: null,
    });

    const created = await prisma.auctionLot.findUniqueOrThrow({
      where: { id: lotId },
      select: { checkedAt: true },
    });
    assert.ok(created.checkedAt, "recording a bid is an observation and must carry its time");

    // Editing something that is not the bid must not make a stale reading look current.
    await updateAuctionLot(userId, lotId, {
      auctionSaleId: sale.id,
      lotNo: "12",
      url: null,
      title: "Poland 1919 set, mint",
      endsAt: hourFromNow(),
      startingPrice: "20.00",
      currentBid: "40.00",
      myBid: null,
      maxBid: "80.00",
      notes: null,
    });
    const afterTitleEdit = await prisma.auctionLot.findUniqueOrThrow({
      where: { id: lotId },
      select: { checkedAt: true },
    });
    assert.equal(afterTitleEdit.checkedAt?.getTime(), created.checkedAt.getTime());

    // The inline refresh stamps even when the figure has not moved: "still at 40" is the
    // observation the staleness signal is asking for.
    await new Promise((r) => setTimeout(r, 5));
    await touchAuctionLotChecked(userId, lotId);
    const touched = await prisma.auctionLot.findUniqueOrThrow({
      where: { id: lotId },
      select: { checkedAt: true },
    });
    assert.ok(touched.checkedAt!.getTime() > created.checkedAt.getTime());

    // Clearing the bid clears the observation with it — there is then nothing to date.
    await setAuctionLotBid(userId, lotId, null);
    const cleared = await prisma.auctionLot.findUniqueOrThrow({
      where: { id: lotId },
      select: { currentBid: true, checkedAt: true },
    });
    assert.equal(cleared.currentBid, null);
    assert.equal(cleared.checkedAt, null);

    // The starting price is untouched by any of it: it is what the lot opened at, not an
    // observation of what it is at now.
    const start = await prisma.auctionLot.findUniqueOrThrow({
      where: { id: lotId },
      select: { startingPrice: true },
    });
    assert.equal(start.startingPrice?.toFixed(2), "20.00");

    await setAuctionLotBid(userId, lotId, "55.00");
  });

  it("costs a lot all-in with the premium, and the parcel with shipping once", async () => {
    const sale = await findOpenAuctionSale(userId, collectionId, sellerId, platformId);
    assert.ok(sale);
    await createAuctionLot(userId, collectionId, {
      auctionSaleId: sale.id,
      lotNo: "13",
      url: null,
      title: "Second lot",
      endsAt: hourFromNow(),
      startingPrice: null,
      currentBid: "100.00",
      myBid: null,
      maxBid: null,
      notes: null,
    });

    const detail = await getAuctionSaleDetail(userId, sale.id);
    const second = detail.lots.find((l) => l.lotNo === "13");
    // 100 + 10% + 2 fixed — no shipping on the row, because the parcel ships once.
    assert.equal(second?.allIn, "112.00");
    // 155 in bids, premium on both lots, and 15 shipping added once:
    // (55 + 5.5 + 2) + (100 + 10 + 2) + 15 = 189.50
    assert.equal(detail.summary.bidTotal, "155.00");
    assert.equal(detail.summary.allInTotal, "189.50");
    assert.equal(detail.summary.payableCount, 2);
  });

  it("derives where the collector stands, and how much room a ceiling leaves", async () => {
    const sale = await findOpenAuctionSale(userId, collectionId, sellerId, platformId);
    assert.ok(sale);
    const detail = await getAuctionSaleDetail(userId, sale.id);
    const lot = detail.lots.find((l) => l.lotNo === "12");
    assert.ok(lot);
    // Nothing placed yet: the question has no answer, which is not the same as "leading".
    assert.equal(lot.myBid, null);
    assert.equal(lot.standing, null);

    // The ceiling is 80 all-in on a 10% + 2 seller, so the most that fits is (80 − 2) / 1.1.
    assert.equal(lot.bidRoom, "70.90");

    await setAuctionLotMyBid(userId, lot.id, lot.bidRoom);
    const after = (await getAuctionSaleDetail(userId, sale.id)).lots.find((l) => l.id === lot.id);
    // 70.90 placed against a lot standing at 55 — still in front.
    assert.equal(after?.myBid, "70.90");
    assert.equal(after?.standing, "leading");
    // What that commitment costs: 70.90 + 10% + 2 = 79.99, just inside the 80 ceiling.
    assert.equal(after?.myAllIn, "79.99");
    assert.equal(after?.myBidOverCeiling, false);

    // A bid past the room the ceiling leaves is the collector's own doing, and is flagged apart
    // from the price having run away from them.
    await setAuctionLotMyBid(userId, lot.id, "80.00");
    const over = (await getAuctionSaleDetail(userId, sale.id)).lots.find((l) => l.id === lot.id);
    assert.equal(over?.myAllIn, "90.00");
    assert.equal(over?.myBidOverCeiling, true);
    await setAuctionLotMyBid(userId, lot.id, "70.90");

    // Recording a bid is a commitment, not an observation: `checkedAt` must not move with it.
    const stamped = await prisma.auctionLot.findUniqueOrThrow({
      where: { id: lot.id },
      select: { checkedAt: true },
    });
    await new Promise((r) => setTimeout(r, 5));
    await setAuctionLotMyBid(userId, lot.id, "72.00");
    const restamped = await prisma.auctionLot.findUniqueOrThrow({
      where: { id: lot.id },
      select: { checkedAt: true },
    });
    assert.equal(restamped.checkedAt?.getTime(), stamped.checkedAt?.getTime());

    // The price passing the placed bid flips the standing, with nothing else touched.
    await setAuctionLotBid(userId, lot.id, "90.00");
    const outbid = (await getAuctionSaleDetail(userId, sale.id)).lots.find((l) => l.id === lot.id);
    assert.equal(outbid?.standing, "outbid");
    await setAuctionLotBid(userId, lot.id, "55.00");
  });

  it("lists lots flat across sales and facets the filters", async () => {
    const { items } = await listAuctionLots(userId, collectionId);
    assert.equal(items.length, 2);
    // The flat list carries the sale as a column, so a row names its own settlement.
    assert.ok(items.every((l) => l.saleName === "Philkam · Allegro"));

    const counts = await auctionLotFilterCounts(userId, collectionId, {});
    assert.equal(counts.statuses.watching, 2);
    assert.equal(counts.sellers[sellerId], 2);
    assert.equal(counts.platforms[platformId], 2);
    assert.equal(counts.total, 2);

    // A seller with no lots narrows to nothing rather than falling back to everything.
    const narrowed = await listAuctionLots(userId, collectionId, { sellerId: otherSellerId });
    assert.equal(narrowed.items.length, 0);
  });

  it("remembers which platform a seller was last tracked on", async () => {
    // Written server-side, because a seller and a platform typed in by name only become contacts
    // once the server has resolved them — that is where both ids first exist.
    const defaults = await getAuctionSellerDefaults(userId, collectionId, sellerId);
    assert.equal(defaults?.defaultPlatform?.id, platformId);
    assert.equal(defaults?.defaultPlatform?.name, "Allegro");

    // A seller never bid with remembers nothing, rather than inheriting someone else's platform.
    const untouched = await getAuctionSellerDefaults(userId, collectionId, otherSellerId);
    assert.equal(untouched?.defaultPlatform, null);

    // The next lot on another platform moves the memory with it.
    const otherPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: "philasearch", platform: true },
      })
    ).id;
    const otherSaleId = await createAuctionSale(userId, collectionId, {
      sellerId,
      platformId: otherPlatformId,
      name: "Köhler 385",
      url: null,
      endsAt: null,
      currency: "EUR",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
    const moved = await getAuctionSellerDefaults(userId, collectionId, sellerId);
    assert.equal(moved?.defaultPlatform?.id, otherPlatformId);
    await prisma.auctionSale.delete({ where: { id: otherSaleId } });
  });

  it("refuses to delete a sale that still holds lots", async () => {
    const sale = await findOpenAuctionSale(userId, collectionId, sellerId, platformId);
    assert.ok(sale);
    await assert.rejects(deleteAuctionSale(userId, sale.id), /still holds/);
  });

  it("scopes everything to the owner", async () => {
    const sale = await findOpenAuctionSale(userId, collectionId, sellerId, platformId);
    assert.ok(sale);
    await assert.rejects(listAuctionLots("someone-else", collectionId), /not found/i);
    await assert.rejects(getAuctionSaleDetail("someone-else", sale.id), /not found/i);
  });

  // The losing half of the fork (#354). The sale is deliberately in the **base** currency, so the
  // rate rule is exercised without the test depending on the ECB being reachable.
  it("records a lost lot's price, and carries nothing over from an outcome that has none", async () => {
    const saleId = await createAuctionSale(userId, collectionId, {
      sellerId: otherSellerId,
      platformId,
      name: "Köhler 385",
      url: null,
      endsAt: null,
      currency: "EUR",
      shippingCost: null,
      premiumPercent: null,
      premiumFixed: null,
    });
    const lotId = await createAuctionLot(userId, collectionId, {
      auctionSaleId: saleId,
      lotNo: "77",
      url: null,
      title: null,
      endsAt: hourFromNow(),
      startingPrice: null,
      currentBid: "40.00",
      myBid: "45.00",
      maxBid: null,
      notes: null,
    });
    const read = () =>
      prisma.auctionLot.findUniqueOrThrow({
        where: { id: lotId },
        select: { status: true, finalPrice: true, fxRateToBase: true, currentBid: true },
      });

    await recordAuctionLotOutcome(userId, lotId, { status: "lost", finalPrice: "62.00" });
    const lost = await read();
    assert.equal(lost.status, "lost");
    assert.equal(lost.finalPrice?.toFixed(2), "62.00");
    // Base currency: there is no conversion to freeze, exactly as on a same-currency purchase.
    assert.equal(lost.fxRateToBase, null);
    // The last bid anyone saw is left alone — it is what the lot had reached, not what it fetched.
    assert.equal(lost.currentBid?.toFixed(2), "40.00");

    // Withdrawn or ended without a sale: no datapoint, so a price recorded before is cleared.
    await recordAuctionLotOutcome(userId, lotId, { status: "cancelled" });
    const cancelled = await read();
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.finalPrice, null);
    assert.equal(cancelled.fxRateToBase, null);

    // Lost with no figure at all: the lot went away before the result was seen, which is an
    // absent observation and not an error to be filled in.
    await recordAuctionLotOutcome(userId, lotId, { status: "lost", finalPrice: null });
    const unpriced = await read();
    assert.equal(unpriced.status, "lost");
    assert.equal(unpriced.finalPrice, null);

    // Reversible: a lot filed by mistake goes back on the watchlist carrying no result.
    await recordAuctionLotOutcome(userId, lotId, { status: "watching" });
    const reopened = await read();
    assert.equal(reopened.status, "watching");
    assert.equal(reopened.finalPrice, null);

    // Winning carries the price paid, and refuses to be recorded without one: settlement (#28)
    // prices its purchase line from exactly this figure.
    await assert.rejects(
      recordAuctionLotOutcome(userId, lotId, {
        status: "won",
        // The domain guard is what is under test, so the type is deliberately bypassed here — the
        // server action refuses a blank field before it ever gets this far.
        finalPrice: null as unknown as string,
      }),
      /what you paid/i
    );
    await recordAuctionLotOutcome(userId, lotId, { status: "won", finalPrice: "58.00" });
    const won = await read();
    assert.equal(won.status, "won");
    assert.equal(won.finalPrice?.toFixed(2), "58.00");

    // A won lot is payable, and is costed at what was paid rather than at the last bid observed.
    const sale = await getAuctionSaleDetail(userId, saleId);
    assert.equal(sale.summary.wonCount, 1);
    assert.equal(sale.summary.payableCount, 1);
    assert.equal(sale.summary.bidTotal, "58.00");

    await recordAuctionLotOutcome(userId, lotId, { status: "watching" });

    await assert.rejects(
      recordAuctionLotOutcome("someone-else", lotId, { status: "cancelled" }),
      /not found/i
    );

    await prisma.auctionLot.delete({ where: { id: lotId } });
    await deleteAuctionSale(userId, saleId);
  });
});
