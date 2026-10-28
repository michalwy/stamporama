import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { listAuctionSales } from "../../src/lib/auctions";
import type { AuctionSaleSearchField } from "../../src/lib/auction-sale-search-fields";

// #2245: the auction Sales list's search box matches only the fields ticked beside it. `Gärtner` is
// made to read as every field at once — a sale's name, a catalogue URL, a seller and a platform — so
// each field ticked alone has to find its own sale and nothing else.

const ts = Date.now();

describe("auction sale search narrowed to the ticked fields", () => {
  let userId: string;
  let collectionId: string;

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
    const contact = (name: string) =>
      prisma.contact.create({ data: { collectionId, name, seller: true } });
    const platform = (name: string) => prisma.platform.create({ data: { collectionId, name } });
    const plainSeller = (await contact("Philkam")).id;
    const plainPlatform = (await platform("Allegro")).id;
    const sale = (data: {
      name: string;
      url?: string;
      sellerId?: string;
      platformId?: string;
    }) =>
      prisma.auctionSale.create({
        data: {
          collectionId,
          currency: "EUR",
          sellerId: plainSeller,
          platformId: plainPlatform,
          ...data,
        },
      });
    await sale({ name: "Gärtner 66" });
    await sale({ name: "By address", url: "https://auktionen-gaertner.de/gärtner/66" });
    await sale({ name: "By seller", sellerId: (await contact("Christoph Gärtner")).id });
    await sale({ name: "By platform", platformId: (await platform("Gärtner Live")).id });
    await sale({ name: "Unrelated" });
  });

  after(async () => {
    await prisma.auctionSale.deleteMany({ where: { collectionId } });
    await prisma.platform.deleteMany({ where: { collectionId } });
    await prisma.contact.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const names = async (searchFields?: AuctionSaleSearchField[]) =>
    (await listAuctionSales(userId, collectionId, { search: "gärtner", searchFields }))
      .map((s) => s.name)
      .sort();

  it("searches every field when nothing narrows it", async () => {
    assert.deepEqual(await names(), ["By address", "By platform", "By seller", "Gärtner 66"]);
  });

  it("finds each field's own sale when that field is ticked alone", async () => {
    assert.deepEqual(await names(["name"]), ["Gärtner 66"]);
    assert.deepEqual(await names(["url"]), ["By address"]);
    assert.deepEqual(await names(["seller"]), ["By seller"]);
    assert.deepEqual(await names(["platform"]), ["By platform"]);
  });

  it("matches any of several ticked fields", async () => {
    assert.deepEqual(await names(["seller", "platform"]), ["By platform", "By seller"]);
  });
});
