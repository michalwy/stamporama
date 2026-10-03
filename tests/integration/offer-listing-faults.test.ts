import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, offerTranslationGaps } from "../../src/lib/offers";
import { saveEntityTranslation } from "../../src/lib/entity-translations";

// **An offer's description names the faults of its copies, in the offer's language (#1559)**, driven
// through the real generation: `{faults}` and `{#faultyCopy}` over the copies' own faults, each
// translated into the platform's listing language and falling back to the collection's own, the title
// left as it was, and an untranslated fault reported as a gap that the in-place editor fills. The
// engine's rules are pinned in `tests/unit/offer-listing-template.test.ts`.

describe("faults in offer texts (#1559)", () => {
  const ts = Date.now();
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let thinId: string;
  let creaseId: string;
  let thinnedCopy: string;
  let soundCopy: string;

  before(async () => {
    userId = `test-user-offer-faults-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User offer-faults-${ts}`,
        email: `test-offer-faults-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-offer-faults-${ts}`,
          name: `Collection offer-faults-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint", abbreviation: "*", sortOrder: 0 },
      })
    ).id;
    const stamp = async (name: string) =>
      (await prisma.stamp.create({ data: { collectionId, name } })).id;
    const [mercury, venus] = [await stamp("Mercury"), await stamp("Venus")];

    // Two faults, the second listed first in the dictionary: the description follows the
    // dictionary's order, not the order they were put on the copy.
    creaseId = (
      await prisma.fault.create({ data: { collectionId, name: "Crease", sortOrder: 1 } })
    ).id;
    thinId = (
      await prisma.fault.create({
        data: {
          collectionId,
          name: "Thin",
          sortOrder: 0,
          translations: { create: [{ language: "pl", name: "Ścienienie" }] },
        },
      })
    ).id;

    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Allegro",
          platform: true,
          titleTemplate: "{name} {faults}",
          titleLanguage: "pl",
          descriptionTemplate: "{name}\n{#faultyCopy}Wady {name}: {faults}\n{/faultyCopy}",
        },
      })
    ).id;
    thinnedCopy = (await createItem(userId, collectionId, { stampId: mercury, conditionId, forSale: true })).id;
    soundCopy = (await createItem(userId, collectionId, { stampId: venus, conditionId, forSale: true })).id;
    await prisma.itemFault.createMany({
      data: [
        { itemId: thinnedCopy, faultId: creaseId },
        { itemId: thinnedCopy, faultId: thinId },
      ],
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function offerWithBothCopies(): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [thinnedCopy, soundCopy]);
    return offerId;
  }

  async function texts(offerId: string) {
    return prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { name: true, description: true },
    });
  }

  it("names each faulty copy's faults in the platform's language, falling back where untranslated", async () => {
    const { description } = await texts(await offerWithBothCopies());
    assert.equal(description, "Mercury / Venus\nWady Mercury: Ścienienie, Crease");
  });

  it("leaves the title as it was", async () => {
    const { name } = await texts(await offerWithBothCopies());
    assert.equal(name, "Mercury / Venus");
  });

  it("reports the untranslated fault as a gap, and filling it reaches the next description", async () => {
    const offerId = await offerWithBothCopies();
    const { gaps } = await offerTranslationGaps(userId, offerId);
    assert.deepEqual(
      gaps.filter((g) => g.entityType === "fault"),
      [{ field: "faults", entityType: "fault", entityId: creaseId, entityField: "name", defaultValue: "Crease" }]
    );

    await saveEntityTranslation(userId, collectionId, {
      entityType: "fault",
      entityId: creaseId,
      entityField: "name",
      language: "pl",
      value: "Zagięcie",
    });
    assert.deepEqual(
      await prisma.faultTranslation.findMany({
        where: { faultId: creaseId },
        select: { language: true, name: true },
      }),
      [{ language: "pl", name: "Zagięcie" }]
    );
    const { description } = await texts(await offerWithBothCopies());
    assert.equal(description, "Mercury / Venus\nWady Mercury: Ścienienie, Zagięcie");
    assert.deepEqual(
      (await offerTranslationGaps(userId, offerId)).gaps.filter((g) => g.entityType === "fault"),
      []
    );
  });
});
