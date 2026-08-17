import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, getOfferDetail } from "../../src/lib/offers";

// A listing text saying that a piece was **not identified down to its variant** (#619). The rendering
// rules are unit-tested (`tests/unit/offer-listing-template.test.ts`); what is exercised here is the
// wiring: that `{#unknownVariant}` fires off the stamp's real variant children, that `{variants}`
// collapses their numbers under the area's own prefix, and that `{listedAs}` names the very variant
// #616's rollup would list the copy under — and nothing at all where that question does not apply.

describe("unknown-variant listing text (#619)", () => {
  let userId: string;
  let collectionId: string;
  /** Colnect: lists against a catalogue, so `{listedAs}` has something to say. */
  let cataloguePlatformId: string;
  /** A marketplace listed by hand — no module, hence no catalogue entry to stand under (#493). */
  let plainPlatformId: string;
  let mnhId: string;
  let areaId: string;
  let vendorId: string;
  let catalogEditionId: string;
  let variantSubtypeId: string;

  // `{listedAs}` sits on a line of its own: it is the one part that can come back empty, and a line
  // whose placeholders all resolved empty is dropped whole (#266) rather than leaving scaffolding.
  const TEMPLATE =
    "{#copy}{catalog} {name}\n{/copy}" +
    "{#unknownVariant}Not identified: one of {variants}.\nOffered under {listedAs}.\n{/unknownVariant}";

  before(async () => {
    const ts = Date.now();
    userId = `test-user-unknown-variant-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User unknown-variant-${ts}`,
        email: `test-unknown-variant-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-unknown-variant-${ts}`,
          name: `Collection unknown-variant-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
          defaultLanguage: "en",
        },
      })
    ).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    const catalogNameId = (
      await prisma.catalogName.create({
        data: { vendorId, name: "Michel Katalog", currency: "EUR" },
      })
    ).id;
    catalogEditionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId, year: 2024 } })
    ).id;
    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogNameId },
      })
    ).id;
    // The area's catalogue and its vendor prefix: a variant is named `Mi·PL 865a` (#66/#377), which
    // is the form both new tokens print.
    await prisma.collectionAreaCatalog.create({
      data: { collectionAreaId: areaId, catalogNameId },
    });
    await prisma.collectionAreaVendor.create({
      data: { collectionAreaId: areaId, catalogVendorId: vendorId, areaPrefix: "PL" },
    });
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: {
          collectionId,
          name: "Colour variety",
          actsAsVariant: true,
          isDefault: true,
          sortOrder: 0,
        },
      })
    ).id;
    cataloguePlatformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Colnect",
          platform: true,
          platformModule: "colnect",
          platformCurrency: "EUR",
          descriptionTemplate: TEMPLATE,
        },
      })
    ).id;
    plainPlatformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "By hand",
          platform: true,
          platformCurrency: "EUR",
          descriptionTemplate: TEMPLATE,
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** A plain stamp with its own number — nothing about it is unidentified. */
  async function plainStamp(number: string): Promise<string> {
    const stamp = await prisma.stamp.create({
      data: { collectionId, name: "Venus", colnectId: "9000" },
    });
    await prisma.stampCollectionArea.create({
      data: { stampId: stamp.id, collectionAreaId: areaId, isPrimary: true },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: stamp.id, catalogVendorId: vendorId, number },
    });
    return stamp.id;
  }

  /** A base stamp with variant children (ADR-0010 §3), the shape #616 derives a listing over. */
  async function umbrella(
    number: string,
    variants: { number: string; colnectId: string | null; price?: string }[]
  ): Promise<string> {
    const base = await prisma.stamp.create({
      data: { collectionId, name: "Mercury", colnectId: null },
    });
    await prisma.stampCollectionArea.create({
      data: { stampId: base.id, collectionAreaId: areaId, isPrimary: true },
    });
    await prisma.stampCatalogNumber.create({
      data: { stampId: base.id, catalogVendorId: vendorId, number },
    });
    for (const v of variants) {
      const child = await prisma.stamp.create({
        data: {
          collectionId,
          parentId: base.id,
          name: `Mercury ${v.number}`,
          subtypeId: variantSubtypeId,
          colnectId: v.colnectId,
        },
      });
      await prisma.stampCollectionArea.create({
        data: { stampId: child.id, collectionAreaId: areaId, isPrimary: true },
      });
      await prisma.stampCatalogNumber.create({
        data: { stampId: child.id, catalogVendorId: vendorId, number: v.number },
      });
      if (v.price !== undefined) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: child.id,
            catalogEditionId,
            conditionId: mnhId,
            certificateStatusId: null,
            price: v.price,
            currency: "EUR",
          },
        });
      }
    }
    return base.id;
  }

  async function copy(stampId: string): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId: mnhId, forSale: true })).id;
  }

  /** An offer on `platformId` over one set, and the description its templates generated. */
  async function description(platformId: string, itemIds: string[]): Promise<string | null> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "12.50",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, itemIds);
    return (await getOfferDetail(userId, offerId))?.description ?? null;
  }

  it("states the caveat, collapses the variants and names the one it is listed under", async () => {
    // The cheapest priced variant is `865b`, so that is what #616 lists the copy under — and what the
    // description has to name, or the text and the form would describe different variants.
    const base = await umbrella("865", [
      { number: "865a", colnectId: "3001", price: "30.00" },
      { number: "865b", colnectId: "3002", price: "12.00" },
      { number: "865c", colnectId: "3003", price: "40.00" },
    ]);
    assert.equal(
      await description(cataloguePlatformId, [await copy(base)]),
      "Mi·PL 865 Mercury\nNot identified: one of Mi·PL 865a-c.\nOffered under Mi·PL 865b."
    );
  });

  it("says nothing at all about a stamp that carries no variants", async () => {
    assert.equal(
      await description(cataloguePlatformId, [await copy(await plainStamp("13"))]),
      "Mi·PL 13 Venus"
    );
  });

  it("still states which variants it might be where the platform lists against no catalogue", async () => {
    // `{listedAs}` is a claim about the platform's own catalogue (#493) and has nothing to say here,
    // so the clause carrying it goes; the caveat itself is a fact about the goods and stays.
    const base = await umbrella("870", [
      { number: "870a", colnectId: "3101", price: "30.00" },
      { number: "870b", colnectId: "3102", price: "12.00" },
    ]);
    assert.equal(
      await description(plainPlatformId, [await copy(base)]),
      "Mi·PL 870 Mercury\nNot identified: one of Mi·PL 870a-b."
    );
  });

  it("names the variants but nothing to list under while the tree is not fully priced (#617)", async () => {
    // Which variant is cheapest is not knowable yet, so the rollup resolves nothing — and the text
    // says so by omission rather than by naming the one variant that happens to carry a price.
    const base = await umbrella("880", [
      { number: "880a", colnectId: "3201" },
      { number: "880b", colnectId: "3202", price: "12.00" },
    ]);
    assert.equal(
      await description(cataloguePlatformId, [await copy(base)]),
      "Mi·PL 880 Mercury\nNot identified: one of Mi·PL 880a-b."
    );
  });
});
