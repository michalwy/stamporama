import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getDashboardSection } from "../../src/lib/dashboard";
import {
  deletePurchase,
  listPurchasesPaginated,
  markPurchaseCompleted,
  markPurchaseDoneAtDesk,
  reopenCompletedPurchase,
  startPurchaseOnPhone,
} from "../../src/lib/purchases";
import { getPurchaseDetail } from "../../src/lib/lots";
import { listPurchaseNotedStamps } from "../../src/lib/purchase-noted-stamps";
import type { PhonePurchaseInput } from "../../src/lib/phone-purchase-rules";

// A purchase started on the phone (#2006, ADR-0072): a real purchase, `arrived`, with one open lot
// priced at the amount paid and titled by the description, the stamps it was told about noted on it,
// and the mark *started on the phone — to complete* — which lists it on the purchase list and the
// Dashboard's Incoming purchases until the collector says *Done at the desk*, and nothing else.

describe("starting a purchase on the phone (#2006)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let sellerId: string;
  let stampA: string;
  let stampB: string;
  let foreignStamp: string;

  function input(patch: Partial<PhonePurchaseInput> = {}): PhonePurchaseInput {
    return {
      sellerContactId: null,
      sellerName: "kowalski",
      amount: 120.5,
      currency: "PLN",
      purchasedAt: "2026-10-17",
      description: "Stockbook Poland 1950s",
      stampIds: [stampB, stampA],
      ...patch,
    };
  }

  async function incoming() {
    const s = await getDashboardSection(userId, collectionId, "incoming-purchases");
    const ids = (id: string) => s.groups.find((g) => g.id === id)!.items.map((i) => i.key);
    return {
      started: ids("incoming-started-on-phone"),
      arrived: ids("incoming-arrived-to-sort"),
    };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-phone-purchase-${ts}`;
    strangerId = `test-user-phone-purchase-stranger-${ts}`;
    for (const id of [userId, strangerId]) {
      await prisma.user.create({
        data: { id, name: id, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-phone-purchase-${ts}`, name: `Phone purchase ${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-phone-purchase-other-${ts}`, name: `Other ${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    sellerId = (await prisma.contact.create({ data: { collectionId, name: "Kowalski", seller: true } })).id;
    const vendor = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    stampA = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: "Chopin",
          catalogNumbers: { create: { catalogVendorId: vendor.id, number: "200" } },
        },
      })
    ).id;
    stampB = (
      await prisma.stamp.create({
        data: { collectionId, catalogNumbers: { create: { catalogVendorId: vendor.id, number: "201" } } },
      })
    ).id;
    foreignStamp = (await prisma.stamp.create({ data: { collectionId: otherCollectionId, name: "Elsewhere" } })).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("writes an arrived purchase with one open lot, the stamps noted and the mark", async () => {
    const id = await startPurchaseOnPhone(userId, collectionId, input());
    const row = await prisma.purchase.findUniqueOrThrow({
      where: { id },
      select: {
        kind: true,
        status: true,
        contactId: true,
        currency: true,
        purchasedAt: true,
        toCompleteSince: true,
        lots: { select: { title: true, price: true, status: true, _count: { select: { items: true } } } },
        notedStamps: { select: { stampId: true }, orderBy: { position: "asc" } },
      },
    });
    assert.equal(row.kind, "purchase");
    assert.equal(row.status, "arrived");
    // An existing contact, found by its name whatever the case.
    assert.equal(row.contactId, sellerId);
    assert.equal(row.currency, "PLN");
    assert.equal(row.purchasedAt.toISOString().slice(0, 10), "2026-10-17");
    assert.ok(row.toCompleteSince);
    assert.equal(row.lots.length, 1);
    assert.equal(row.lots[0].title, "Stockbook Poland 1950s");
    assert.equal(row.lots[0].price?.toFixed(2), "120.50");
    assert.equal(row.lots[0].status, "open");
    // No copies: intake stays at the desk.
    assert.equal(row.lots[0]._count.items, 0);
    assert.deepEqual(row.notedStamps.map((n) => n.stampId), [stampB, stampA]);

    const detail = await getPurchaseDetail(userId, id);
    assert.equal(detail?.toCompleteSince, row.toCompleteSince.toISOString());
    assert.equal(detail?.total, "120.50");
  });

  it("takes a picked seller by its id", async () => {
    const id = await startPurchaseOnPhone(userId, collectionId, input({ sellerContactId: sellerId, sellerName: "Kowalski", stampIds: [] }));
    const row = await prisma.purchase.findUniqueOrThrow({ where: { id }, select: { contactId: true } });
    assert.equal(row.contactId, sellerId);
  });

  it("creates a new seller for a name no contact has", async () => {
    const id = await startPurchaseOnPhone(userId, collectionId, input({ sellerName: "Fair stall 12", stampIds: [] }));
    const row = await prisma.purchase.findUniqueOrThrow({
      where: { id },
      select: { contact: { select: { name: true, seller: true } }, notedStamps: true },
    });
    assert.deepEqual(row.contact, { name: "Fair stall 12", seller: true });
    assert.equal(row.notedStamps.length, 0);
  });

  it("refuses a stamp of another collection and writes nothing", async () => {
    const before = await prisma.purchase.count({ where: { collectionId } });
    await assert.rejects(() => startPurchaseOnPhone(userId, collectionId, input({ stampIds: [stampA, foreignStamp] })));
    assert.equal(await prisma.purchase.count({ where: { collectionId } }), before);
  });

  it("refuses a collection that is not the caller's", async () => {
    await assert.rejects(() => startPurchaseOnPhone(strangerId, collectionId, input()));
  });

  it("reads the noted stamps in the order picked, labelled", async () => {
    const id = await startPurchaseOnPhone(userId, collectionId, input());
    const stamps = await listPurchaseNotedStamps(userId, id);
    assert.deepEqual(
      stamps.map((s) => [s.stampId, s.name, s.catalogNumbers]),
      [
        [stampB, null, ["Mi 201"]],
        [stampA, "Chopin", ["Mi 200"]],
      ]
    );
    assert.deepEqual(await listPurchaseNotedStamps(strangerId, id), []);
  });

  it("is marked on the list and listed on the Dashboard until Done at the desk, and nothing else clears it", async () => {
    const id = await startPurchaseOnPhone(userId, collectionId, input({ stampIds: [] }));
    const page = await listPurchasesPaginated(userId, collectionId, { pageSize: 200 });
    assert.ok(page.items.find((p) => p.id === id)?.toCompleteSince);
    const marked = await listPurchasesPaginated(userId, collectionId, { toComplete: true, pageSize: 200 });
    assert.ok(marked.items.some((p) => p.id === id));

    // Listed once — in its own group, not again under *Arrived, to sort*.
    let dash = await incoming();
    assert.ok(dash.started.includes(id));
    assert.ok(!dash.arrived.includes(id));

    // Marking the order completed leaves the mark on.
    await markPurchaseCompleted(userId, id);
    dash = await incoming();
    assert.ok(dash.started.includes(id));
    await reopenCompletedPurchase(userId, id);

    await markPurchaseDoneAtDesk(userId, id);
    const after = await prisma.purchase.findUniqueOrThrow({ where: { id }, select: { toCompleteSince: true, status: true } });
    assert.equal(after.toCompleteSince, null);
    assert.equal(after.status, "arrived");
    dash = await incoming();
    assert.ok(!dash.started.includes(id));
    // Its lot is still open, so it is now an ordinary arrived order to sort.
    assert.ok(dash.arrived.includes(id));

    // Again is a no-op; a stranger is refused.
    await markPurchaseDoneAtDesk(userId, id);
    await assert.rejects(() => markPurchaseDoneAtDesk(strangerId, id));
  });

  it("deletes its noted stamps with it", async () => {
    const id = await startPurchaseOnPhone(userId, collectionId, input());
    await deletePurchase(userId, id);
    assert.equal(await prisma.purchaseNotedStamp.count({ where: { purchaseId: id } }), 0);
  });

  it("refuses the mark on an opening balance", async () => {
    await assert.rejects(() =>
      prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: 9999,
          kind: "opening_balance",
          title: "Klaser",
          status: "arrived",
          purchasedAt: new Date("2026-10-17"),
          currency: "PLN",
          toCompleteSince: new Date(),
        },
      })
    );
  });
});
