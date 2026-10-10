import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, addOfferSetsPerCopy, getOfferDetail } from "../../src/lib/offers";

// `{areaSymbol}` end to end (#1740): the symbol stored on an area reaches an offer's generated title
// through the real loader, a sub-area without one prints nothing even under a parent that has one,
// and an offer spanning areas lists the symbols as `{area}` lists the names. The engine's own rules
// are unit-tested in `tests/unit/offer-title-template.test.ts`.

describe("{areaSymbol} in generated titles (#1740)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let polandCopy: string;
  let secondRepublicCopy: string;
  let austriaCopy: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-area-symbol-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User area-symbol-${ts}`,
        email: `test-area-symbol-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-area-symbol-${ts}`, name: "Area symbols", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const poland = await prisma.collectionArea.create({
      data: { collectionId, name: "Poland", titleName: "Poland", symbol: "🇵🇱" },
    });
    // Its title name is cleared, so `{area}` rolls up to Poland — but its symbol does not.
    const secondRepublic = await prisma.collectionArea.create({
      data: { collectionId, name: "Second Republic", parentId: poland.id },
    });
    const austria = await prisma.collectionArea.create({
      data: { collectionId, name: "Austria", titleName: "Austria", symbol: "🇦🇹" },
    });
    const stampIn = async (name: string, areaId: string) =>
      (
        await prisma.stamp.create({
          data: { collectionId, name, stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] } },
        })
      ).id;
    const conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    const copyOf = async (stampId: string) =>
      (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
    polandCopy = await copyOf(await stampIn("Eagle", poland.id));
    secondRepublicCopy = await copyOf(await stampIn("Chopin", secondRepublic.id));
    austriaCopy = await copyOf(await stampIn("Mozart", austria.id));
    platformId = (
      await prisma.contact.create({
        data: { collectionId, name: "Allegro", platform: true, titleTemplate: "{areaSymbol} {name} {area}" },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const offer = () =>
    createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });

  it("prints the area's own symbol, and nothing for a sub-area without one", async () => {
    const offerId = await offer();
    await addOfferSetsPerCopy(userId, offerId, [polandCopy, secondRepublicCopy]);
    const detail = await getOfferDetail(userId, offerId);
    assert.deepEqual(detail?.sets.map((s) => s.title), ["🇵🇱 Eagle Poland", "Chopin Poland"]);
  });

  it("lists the symbols of several areas in the order and with the separator of {area}", async () => {
    const offerId = await offer();
    await addOfferSet(userId, offerId, [austriaCopy, secondRepublicCopy, polandCopy]);
    const detail = await getOfferDetail(userId, offerId);
    assert.equal(detail?.sets[0].title, "🇦🇹 / 🇵🇱 Mozart / Chopin / Eagle Austria / Poland");
  });
});
