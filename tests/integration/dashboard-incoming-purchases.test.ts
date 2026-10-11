import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getDashboardSection } from "../../src/lib/dashboard";
import { markPurchaseArrived } from "../../src/lib/lots";
import {
  createPurchase,
  markPurchaseCompleted,
  reopenCompletedPurchase,
  setPurchaseStatus,
  updatePurchase,
} from "../../src/lib/purchases";

// The dashboard's Incoming purchases section (#1810): orders in transit, documents arrived with a
// lot still open (an opening balance among them), and scans nothing has been cut from — each group
// with its count, oldest in its state first. And `Purchase.statusChangedAt`, which says how old:
// written when the status changes, never when an edit restates it.

describe("the dashboard's Incoming purchases section (#1810)", () => {
  let userId: string;
  let collectionId: string;
  let strangerId: string;
  let sellerId: string;

  async function purchase(purchasedAt: string): Promise<string> {
    const created = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt,
      contactId: sellerId,
    });
    return created.id;
  }

  async function lot(purchaseId: string, status: "open" | "closed", price: string | null = "10.00") {
    await prisma.purchaseLot.create({ data: { purchaseId, status, price } });
  }

  async function stampOf(purchaseId: string): Promise<Date> {
    const row = await prisma.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      select: { statusChangedAt: true },
    });
    return row.statusChangedAt;
  }

  async function backdate(purchaseId: string, iso: string) {
    await prisma.purchase.update({ where: { id: purchaseId }, data: { statusChangedAt: new Date(iso) } });
  }

  async function sheet(purchaseId: string, batchNo: number, side: "front" | "back", opts: { purged?: boolean; createdAt?: string } = {}) {
    return prisma.scanSheet.create({
      data: {
        collectionId,
        purchaseId,
        batchNo,
        side,
        storageKey: `test/${purchaseId}/${batchNo}-${side}`,
        mime: "image/png",
        width: 100,
        height: 100,
        viewWidth: 100,
        viewHeight: 100,
        sizeBytes: 1,
        purgedAt: opts.purged ? new Date() : null,
        ...(opts.createdAt ? { createdAt: new Date(opts.createdAt) } : {}),
      },
    });
  }

  async function section() {
    return getDashboardSection(userId, collectionId, "incoming-purchases");
  }

  function group(s: Awaited<ReturnType<typeof section>>, id: string) {
    const found = s.groups.find((g) => g.id === id);
    assert.ok(found, `group ${id}`);
    return found;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-dash-incoming-${ts}`;
    strangerId = `test-user-dash-incoming-stranger-${ts}`;
    for (const id of [userId, strangerId]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    const col = await prisma.collection.create({
      data: { slug: `col-dash-incoming-${ts}`, name: `Dash incoming ${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    const seller = await prisma.contact.create({
      data: { collectionId, name: "Kowalski", seller: true },
    });
    sellerId = seller.id;
  });

  after(async () => {
    await prisma.scanSheet.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("shows its three groups with a zero when nothing is incoming", async () => {
    const s = await section();
    assert.deepEqual(
      s.groups.map((g) => [g.id, g.count]),
      [
        ["incoming-in-transit", 0],
        ["incoming-arrived-to-sort", 0],
        ["incoming-scans-to-cut", 0],
      ]
    );
  });

  it("refuses a collection that is not the caller's", async () => {
    await assert.rejects(() => getDashboardSection(strangerId, collectionId, "incoming-purchases"));
  });

  it("stamps the status change, and not an edit that restates the status", async () => {
    const id = await purchase("2026-01-05");
    await backdate(id, "2026-01-05T00:00:00Z");

    await setPurchaseStatus(userId, id, "preparing");
    assert.equal((await stampOf(id)).toISOString(), "2026-01-05T00:00:00.000Z", "same status is no change");

    await updatePurchase(userId, id, { currency: "EUR", purchasedAt: "2026-01-06", contactId: sellerId, status: "preparing" });
    assert.equal((await stampOf(id)).toISOString(), "2026-01-05T00:00:00.000Z", "an edit restating it is no change");

    await setPurchaseStatus(userId, id, "in_transit");
    const transit = await stampOf(id);
    assert.ok(transit.getTime() > Date.parse("2026-02-01"), "moving to In transit stamps it");

    await backdate(id, "2026-01-07T00:00:00Z");
    await updatePurchase(userId, id, { currency: "EUR", purchasedAt: "2026-01-06", contactId: sellerId, status: "preparing" });
    assert.ok((await stampOf(id)).getTime() > Date.parse("2026-02-01"), "an edit that changes it stamps it");

    await backdate(id, "2026-01-07T00:00:00Z");
    await markPurchaseArrived(userId, id);
    assert.ok((await stampOf(id)).getTime() > Date.parse("2026-02-01"), "arriving stamps it");

    await backdate(id, "2026-01-08T00:00:00Z");
    await markPurchaseArrived(userId, id);
    assert.equal((await stampOf(id)).toISOString(), "2026-01-08T00:00:00.000Z", "arriving again does not");

    await markPurchaseCompleted(userId, id);
    assert.ok((await stampOf(id)).getTime() > Date.parse("2026-02-01"), "completing stamps it");

    await backdate(id, "2026-01-09T00:00:00Z");
    await reopenCompletedPurchase(userId, id);
    assert.ok((await stampOf(id)).getTime() > Date.parse("2026-02-01"), "reopening stamps it");

    await prisma.purchase.delete({ where: { id } });
  });

  it("lists orders in transit, oldest in transit first, each opening its purchase", async () => {
    const older = await purchase("2026-03-01");
    const newer = await purchase("2026-02-01");
    const preparing = await purchase("2026-01-01");
    await setPurchaseStatus(userId, older, "in_transit");
    await setPurchaseStatus(userId, newer, "in_transit");
    // Bought later but shipped earlier: the age is in the state, not since the purchase.
    await backdate(older, "2026-03-02T00:00:00Z");
    await backdate(newer, "2026-03-05T00:00:00Z");
    await lot(older, "open", "12.50");

    const g = group(await section(), "incoming-in-transit");
    assert.equal(g.count, 2);
    assert.deepEqual(g.items.map((i) => i.key), [older, newer]);
    assert.equal(g.href, "purchases?status=in_transit");
    const [first] = g.items;
    assert.equal(first.label, "Kowalski");
    assert.match(first.detail ?? "", /^Order #\d+ · 2026-03-01 · 12\.50 EUR$/);
    assert.equal(first.at, "2026-03-02T00:00:00.000Z");
    assert.equal(first.href, `purchases/${older}`);

    await prisma.purchase.deleteMany({ where: { id: { in: [older, newer, preparing] } } });
  });

  it("lists arrived documents with an open lot, opening balances among them", async () => {
    const toSort = await purchase("2026-04-01");
    const allClosed = await purchase("2026-04-02");
    const completed = await purchase("2026-04-03");
    for (const id of [toSort, allClosed, completed]) await markPurchaseArrived(userId, id);
    await lot(toSort, "closed");
    await lot(toSort, "open");
    await lot(allClosed, "closed");
    await lot(completed, "open");
    await markPurchaseCompleted(userId, completed);

    const opening = (
      await createPurchase(userId, collectionId, {
        kind: "opening_balance",
        title: "Klaser Polska 1",
        currency: "EUR",
        purchasedAt: "2026-04-04",
      })
    ).id;
    await lot(opening, "open", null);
    const openingDone = (
      await createPurchase(userId, collectionId, {
        kind: "opening_balance",
        title: "Inheritance",
        currency: "EUR",
        purchasedAt: "2026-04-05",
      })
    ).id;
    await lot(openingDone, "closed", null);
    await backdate(toSort, "2026-04-10T00:00:00Z");
    await backdate(opening, "2026-04-09T00:00:00Z");

    const g = group(await section(), "incoming-arrived-to-sort");
    assert.equal(g.count, 2);
    assert.deepEqual(g.items.map((i) => i.key), [opening, toSort]);
    assert.equal(g.items[0].label, "Klaser Polska 1");
    assert.match(g.items[0].detail ?? "", /^Opening balance #\d+ · 2026-04-04 · No opening value$/);
    assert.equal(g.href, "purchases?status=arrived");

    await prisma.purchase.deleteMany({ where: { id: { in: [toSort, allClosed, completed, opening, openingDone] } } });
  });

  it("lists the scans nothing has been cut from, oldest first", async () => {
    const id = await purchase("2026-05-01");
    const uncutFront = await sheet(id, 1, "front", { createdAt: "2026-05-03T00:00:00Z" });
    const cutFront = await sheet(id, 2, "front");
    const uncutBack = await sheet(id, 2, "back", { createdAt: "2026-05-02T00:00:00Z" });
    await sheet(id, 3, "front", { purged: true });
    await prisma.scanSheet.update({ where: { id: uncutFront.id }, data: { label: "Klaser A" } });
    await prisma.scanTile.create({
      data: { collectionId, purchaseId: id, batchNo: 2, position: 1, frontSheetId: cutFront.id },
    });

    const g = group(await section(), "incoming-scans-to-cut");
    assert.equal(g.count, 2);
    assert.deepEqual(g.items.map((i) => i.key), [uncutBack.id, uncutFront.id]);
    assert.equal(g.items[0].label, "Batch 2 — back");
    assert.equal(g.items[1].label, "Batch 1 · Klaser A");
    assert.match(g.items[1].detail ?? "", /^Order #\d+ · Kowalski$/);
    assert.equal(g.items[1].href, `purchases/${id}`);
    assert.equal(g.items[0].at, "2026-05-02T00:00:00.000Z");

    await prisma.scanTile.deleteMany({ where: { purchaseId: id } });
    await prisma.scanSheet.deleteMany({ where: { purchaseId: id } });
    await prisma.purchase.delete({ where: { id } });
  });
});
