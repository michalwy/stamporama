import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addSaleFreeExtras,
  createSale,
  listFreeExtraCandidates,
  SaleActionBlockedError,
} from "../../src/lib/sales";

// Free extras never break a complete set (#2422), against a real database: the series are the
// collection's checklists, the copies the ones the sale may give away. The rule itself — the issue's
// three examples, the proposal's order — is pinned in `tests/unit/free-extra-rules.test.ts`; what only
// a database can show is that the read sends whole sets apart from the copies above them, and that
// the write refuses a set broken by hand.

const ts = Date.now();

describe("free extras keep complete series whole (#2422)", () => {
  let userId: string;
  let collectionId: string;
  let saleId: string;
  const stamp: Record<string, string> = {};
  const copies: Record<string, string[]> = { A: [], B: [], C: [], D: [] };

  const blocked = (reason: string) => (e: unknown) =>
    e instanceof SaleActionBlockedError && e.reason === reason;

  before(async () => {
    userId = `test-user-free-extras-series-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-free-extras-series-${ts}`, name: "Free extras series", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const catalogName = await prisma.catalogName.create({
      data: { vendorId, name: "Michel Europa", currency: "EUR" },
    });
    const editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2026 } })
    ).id;
    const areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
      })
    ).id;
    await prisma.collectionAreaCatalog.create({
      data: { collectionAreaId: areaId, catalogNameId: catalogName.id },
    });
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const platformId = (await prisma.platform.create({ data: { collectionId, name: "Fair" } })).id;

    // A series A B C held A×2, B×3, C×2 — two complete sets and one B above them — and a D on no
    // checklist.
    const held: [string, string, number][] = [
      ["A", "0.50", 2],
      ["B", "0.30", 3],
      ["C", "0.20", 2],
      ["D", "0.10", 1],
    ];
    for (const [name, price, count] of held) {
      stamp[name] = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Stamp ${name}`,
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: stamp[name],
          catalogEditionId: editionId,
          conditionId,
          certificateStatusId: null,
          formatId: null,
          price,
          currency: "EUR",
        },
      });
      for (let i = 0; i < count; i++) {
        copies[name].push(
          (
            await createItem(userId, collectionId, {
              stampId: stamp[name],
              conditionId,
              inCollection: false,
              forSale: true,
              forTrade: false,
            })
          ).id
        );
      }
    }
    await prisma.checklist.create({
      data: {
        collectionId,
        name: "Definitives",
        stamps: {
          create: ["A", "B", "C"].map((name, sortOrder) => ({ stampId: stamp[name], sortOrder })),
        },
      },
    });

    saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-11-04"),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const stampOf = (itemId: string) => Object.keys(copies).find((name) => copies[name].includes(itemId));

  it("sends each complete set whole, and only the copies above the sets as loose ones", async () => {
    const result = await listFreeExtraCandidates(userId, saleId);
    assert.deepEqual(
      result.series.map((s) => [s.title, s.value, s.copies.map((c) => stampOf(c.item.id))]),
      [
        ["Definitives", "1.00", ["A", "B", "C"]],
        ["Definitives", "1.00", ["A", "B", "C"]],
      ]
    );
    assert.deepEqual(
      result.candidates.map((c) => stampOf(c.item.id)),
      ["D", "B"]
    );
  });

  it("refuses a copy that would break a set, and takes the one above the sets", async () => {
    await assert.rejects(addSaleFreeExtras(userId, saleId, [copies.A[0]]), blocked("breaks-set"));
    await assert.rejects(addSaleFreeExtras(userId, saleId, [copies.B[0], copies.B[1]]), blocked("breaks-set"));
    // Any one B is above the sets — whichever copy the dialog was shown.
    await addSaleFreeExtras(userId, saleId, [copies.B[0]]);
    const after = await listFreeExtraCandidates(userId, saleId);
    assert.equal(after.series.length, 2);
    assert.deepEqual(
      after.candidates.map((c) => stampOf(c.item.id)),
      ["D"]
    );
  });

  it("gives a whole series away as its copies", async () => {
    const [set] = (await listFreeExtraCandidates(userId, saleId)).series;
    await addSaleFreeExtras(
      userId,
      saleId,
      set.copies.map((c) => c.item.id)
    );
    const after = await listFreeExtraCandidates(userId, saleId);
    assert.equal(after.series.length, 1);
    assert.deepEqual(
      after.candidates.map((c) => stampOf(c.item.id)),
      ["D"]
    );
    const line = await prisma.saleLine.findFirstOrThrow({
      where: { saleId, freeExtra: true },
      select: { _count: { select: { items: true } } },
    });
    assert.equal(line._count.items, 4);
  });
});
