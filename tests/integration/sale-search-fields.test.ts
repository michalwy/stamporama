import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { listSalesPaginated } from "../../src/lib/sales";
import type { SaleSearchField } from "../../src/lib/sale-search-fields";

// #2243: the Sales list's search box matches only the fields ticked beside it. `K77` is made to read
// as every field at once — a buyer's name, a platform's name, an order number, a sold copy's stamp
// name and its catalogue number — so each field ticked alone has to find its own sale and nothing
// else.

const ts = Date.now();

describe("sales search narrowed to the ticked fields", () => {
  let userId: string;
  let collectionId: string;
  const ids: Record<string, string> = {};

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-salesearchfields-${ts}`,
          name: "Sale search fields",
          email: `test-salesearchfields-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-salesearchfields-${ts}`, name: "S", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint", abbreviation: "M", sortOrder: 0 },
      })
    ).id;
    const vendorId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    const plainPlatform = (await prisma.platform.create({ data: { collectionId, name: "Delcampe" } }))
      .id;
    const matchingPlatform = (
      await prisma.platform.create({ data: { collectionId, name: "Market K77" } })
    ).id;
    const buyer = (await prisma.contact.create({ data: { collectionId, name: "Anna K77", buyer: true } }))
      .id;

    const copyOf = async (stamp: { name: string; catalog?: string }) => {
      const stampId = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: stamp.name,
            ...(stamp.catalog
              ? { catalogNumbers: { create: [{ catalogVendorId: vendorId, number: stamp.catalog }] } }
              : {}),
          },
        })
      ).id;
      return (await createItem(userId, collectionId, { stampId, conditionId })).id;
    };

    let saleNo = 0;
    const sale = async (data: {
      platformId?: string;
      buyerId?: string;
      externalRef?: string;
      itemId?: string;
    }) =>
      (
        await prisma.sale.create({
          data: {
            collectionId,
            saleNo: ++saleNo,
            platformId: data.platformId ?? plainPlatform,
            buyerId: data.buyerId,
            externalRef: data.externalRef,
            soldAt: new Date(),
            currency: "EUR",
            lines: {
              create: [
                {
                  price: "1.00",
                  items: { create: [{ itemId: data.itemId ?? (await copyOf({ name: "Chopin" })) }] },
                },
              ],
            },
          },
        })
      ).id;

    ids.buyer = await sale({ buyerId: buyer });
    ids.platform = await sale({ platformId: matchingPlatform });
    ids.orderNumber = await sale({ externalRef: "K77-001" });
    ids.stampName = await sale({ itemId: await copyOf({ name: "Overprint K77" }) });
    ids.catalogNumber = await sale({ itemId: await copyOf({ name: "Moniuszko", catalog: "K77a" }) });
    ids.none = await sale({});
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const found = async (search: string, searchFields?: SaleSearchField[]) =>
    (await listSalesPaginated(userId, collectionId, { search, searchFields })).items
      .map((s) => s.id)
      .sort();

  it("matches every field while none is narrowed", async () => {
    const all = ["buyer", "platform", "orderNumber", "stampName", "catalogNumber"];
    assert.deepEqual(await found("k77"), all.map((k) => ids[k]).sort());
  });

  for (const field of [
    "buyer",
    "platform",
    "orderNumber",
    "stampName",
    "catalogNumber",
  ] as const satisfies readonly SaleSearchField[]) {
    it(`finds only the ${field} match with ${field} alone ticked`, async () => {
      assert.deepEqual(await found("K77", [field]), [ids[field]]);
    });
  }

  it("unions the fields ticked together", async () => {
    assert.deepEqual(
      await found("K77", ["buyer", "catalogNumber"]),
      [ids.buyer, ids.catalogNumber].sort()
    );
  });
});
