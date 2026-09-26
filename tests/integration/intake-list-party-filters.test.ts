import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { listIntakeParties, listPurchasesPaginated } from "../../src/lib/purchases";

// The Intake documents list narrowed by platform and by supplier (#1392), read through the list's own
// query. What is worth a database here is the *none* branch — `null` is never a member of an `in`, so
// *No platform* has to be ORed in beside the named ones — and that an opening balance, which carries
// neither field, answers *none* and no named party.

const TS = Date.now();

describe("Intake documents list — platform and supplier filters (#1392)", () => {
  let userId: string;
  let collectionId: string;
  let allegro: string;
  let ebay: string;
  let janek: string;
  let unused: string;
  /** Allegro, from Janek. */
  let viaAllegro: string;
  /** eBay, no supplier. */
  let viaEbay: string;
  /** No platform, from Janek. */
  let direct: string;
  /** An opening balance: neither field. */
  let opening: string;

  let nextNo = 8100;

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-intakeparty-${TS}`,
          name: "Test User Intake Party",
          email: `test-intakeparty-${TS}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-intakeparty-${TS}`,
          name: "Intake Party",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    const contact = async (name: string, role: "platform" | "seller") =>
      (await prisma.contact.create({ data: { collectionId, name, [role]: true } })).id;
    allegro = await contact("Allegro", "platform");
    ebay = await contact("eBay", "platform");
    janek = await contact("Janek", "seller");
    unused = await contact("Never bought from", "seller");

    const purchase = async (data: {
      platformId?: string;
      contactId?: string;
      kind?: string;
      title?: string;
      status?: string;
    }) =>
      (
        await prisma.purchase.create({
          data: {
            collectionId,
            purchaseNo: nextNo++,
            purchasedAt: new Date("2026-09-01"),
            currency: "EUR",
            ...data,
          },
        })
      ).id;
    viaAllegro = await purchase({ platformId: allegro, contactId: janek });
    viaEbay = await purchase({ platformId: ebay });
    direct = await purchase({ contactId: janek });
    // Stored `arrived`, as `purchase_kind_shape` requires of an opening balance (#1323).
    opening = await purchase({ kind: "opening_balance", title: "The shelf", status: "arrived" });
  });

  after(async () => {
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.contact.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function ids(filters: { platformIds?: string[]; supplierIds?: string[] }): Promise<string[]> {
    const { items } = await listPurchasesPaginated(userId, collectionId, filters);
    return items.map((p) => p.id).sort();
  }

  it("lists every document with neither filter set", async () => {
    assert.deepEqual(await ids({}), [viaAllegro, viaEbay, direct, opening].sort());
    assert.deepEqual(
      await ids({ platformIds: [], supplierIds: [] }),
      [viaAllegro, viaEbay, direct, opening].sort()
    );
  });

  it("narrows to one platform, or several", async () => {
    assert.deepEqual(await ids({ platformIds: [allegro] }), [viaAllegro]);
    assert.deepEqual(await ids({ platformIds: [allegro, ebay] }), [viaAllegro, viaEbay].sort());
  });

  it("finds the documents without a platform, opening balances among them, under none", async () => {
    assert.deepEqual(await ids({ platformIds: ["none"] }), [direct, opening].sort());
    assert.deepEqual(await ids({ platformIds: ["none", ebay] }), [viaEbay, direct, opening].sort());
  });

  it("does the same for suppliers", async () => {
    assert.deepEqual(await ids({ supplierIds: [janek] }), [viaAllegro, direct].sort());
    assert.deepEqual(await ids({ supplierIds: ["none"] }), [viaEbay, opening].sort());
  });

  it("applies both filters together", async () => {
    assert.deepEqual(await ids({ platformIds: ["none"], supplierIds: ["none"] }), [opening]);
    assert.deepEqual(await ids({ platformIds: [allegro], supplierIds: ["none"] }), []);
  });

  it("offers only the platforms and suppliers that appear on a document", async () => {
    const parties = await listIntakeParties(userId, collectionId);
    assert.deepEqual(parties.platforms, [
      { id: allegro, name: "Allegro" },
      { id: ebay, name: "eBay" },
    ]);
    assert.deepEqual(parties.suppliers, [{ id: janek, name: "Janek" }]);
    assert.ok(!parties.suppliers.some((s) => s.id === unused));
  });
});
