import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { setDelcampePlatform } from "../../src/lib/delcampe";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import {
  getDelcampeOfferListingConfig,
  rematchDelcampeOfferCategory,
  setDelcampeOfferCategory,
} from "../../src/lib/delcampe-offer-listing";
import { listPlatformCategoryLessons } from "../../src/lib/platform-category";

// Delcampe's learned categories (#609; ADR-0035) — the claim the whole feature makes, which is one no
// pure test can reach: **the second offer of a kind carries no category work at all.**
//
// It needs a database because it is a claim about three things agreeing — the key derived from an
// offer's copies, a row written on `preparing → ready`, and a backfill reading it back on a different
// offer. Each of those is testable on its own and none of them is what the collector notices.
//
// The register itself is shared with Allegro and its ladder is unit-tested in
// `platform-category-rules.test.ts`; what is exercised here is the Delcampe half of the wiring.

describe("Delcampe learned categories (#609)", () => {
  let userId: string;
  let collectionId: string;
  let delcampeId: string;
  let polandId: string;
  let usedId: string;
  let mintId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-delccat-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User delccat-${ts}`,
        email: `test-delccat-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-delccat-${ts}`,
          name: `Collection delccat-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    delcampeId = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    await setDelcampePlatform(userId, collectionId, delcampeId);

    polandId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    mintId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint", abbreviation: "**", sortOrder: 1 },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** One offer of one copy: a Polish stamp of `issuedYear` in `conditionId`. */
  async function offerOf(
    name: string,
    issuedYear: number | null,
    conditionId: string
  ): Promise<string> {
    const stamp = await prisma.stamp.create({
      data: {
        collectionId,
        name,
        issuedYear,
        stampAreaLinks: { create: [{ collectionAreaId: polandId, isPrimary: true }] },
      },
    });
    const item = await createItem(userId, collectionId, {
      stampId: stamp.id,
      conditionId,
      forSale: true,
    });
    return createOffer(
      userId,
      collectionId,
      {
        platformId: delcampeId,
        url: null,
        price: "10.00",
        currency: "EUR",
        listingDate: null,
        state: "preparing",
      },
      { seedItemIds: [item.id] }
    );
  }

  it("has no category on the first offer of a kind, and says so rather than guessing", async () => {
    const offerId = await offerOf("Poland 1935 A", 1935, usedId);
    const config = await getDelcampeOfferListingConfig(userId, offerId);
    assert.equal(config?.categoryId, null);
    assert.equal(config?.source, null);
    // The picker opens on the offer's own key rather than on the whole tree — a head start, and the
    // only thing this app can honestly say about where a Polish used stamp goes on Delcampe.
    assert.equal(config?.categorySearchTerm, "Poland Used");
  });

  it("learns nothing from an offer still being prepared", async () => {
    const offerId = await offerOf("Poland 1935 B", 1935, usedId);
    await setDelcampeOfferCategory(userId, offerId, {
      categoryId: "7945",
      categoryName: "Used stamps",
      categoryPath: "Stamps > Europe > Poland > 1919-1939 Republic > Used stamps",
    });
    assert.deepEqual(await listPlatformCategoryLessons(delcampeId), []);
  });

  it("learns when the offer is finished being prepared, and fills the next one in unasked", async () => {
    const taught = await offerOf("Poland 1935 C", 1935, usedId);
    await setDelcampeOfferCategory(userId, taught, {
      categoryId: "7945",
      categoryName: "Used stamps",
      categoryPath: "Stamps > Europe > Poland > 1919-1939 Republic > Used stamps",
    });
    await setOfferState(userId, taught, "ready");

    const lessons = await listPlatformCategoryLessons(delcampeId);
    assert.equal(lessons.length, 1);
    assert.equal(lessons[0].categoryId, "7945");
    assert.equal(lessons[0].areaName, "Poland");
    assert.equal(lessons[0].conditionName, "Used");
    assert.equal(lessons[0].issuedYear, 1935);

    // The claim the feature makes: a comparable offer is categorised the moment it has a copy, with
    // no question asked. `createOffer` seeds its copies, so the backfill has already run.
    const next = await offerOf("Poland 1935 D", 1935, usedId);
    const config = await getDelcampeOfferListingConfig(userId, next);
    assert.equal(config?.categoryId, "7945");
    assert.equal(config?.source, "learned");
    assert.match(config?.matchedOn ?? "", /Learned from Poland · 1935 · Used/);
  });

  it("widens the year rather than failing, and never the condition", async () => {
    // Another year, same area and condition: the ladder's first rung after the exact key.
    const later = await offerOf("Poland 1938", 1938, usedId);
    const widened = await getDelcampeOfferListingConfig(userId, later);
    assert.equal(widened?.categoryId, "7945");
    assert.match(widened?.matchedOn ?? "", /the year was widened/);

    // Mint is not used, and on Delcampe those are different categories by construction. A suggestion
    // that crossed that line would be worse than none.
    const mint = await offerOf("Poland 1935 mint", 1935, mintId);
    assert.equal((await getDelcampeOfferListingConfig(userId, mint))?.categoryId, null);
  });

  it("keeps a hand-picked category out of the register's way, and gives it back on ↻", async () => {
    const offerId = await offerOf("Poland 1935 sheet", 1935, usedId);
    assert.equal((await getDelcampeOfferListingConfig(userId, offerId))?.categoryId, "7945");

    // The souvenir-sheet case: the key cannot see it, so the offer says otherwise. This is the whole
    // reason a per-offer override exists rather than a wider key.
    await setDelcampeOfferCategory(userId, offerId, {
      categoryId: "7911",
      categoryName: "Blocks & sheetlets & Panes",
      categoryPath: "Stamps > Europe > Poland > Blocks & sheetlets & Panes",
    });
    const corrected = await getDelcampeOfferListingConfig(userId, offerId);
    assert.equal(corrected?.categoryId, "7911");
    assert.equal(corrected?.source, "manual");
    // A choice somebody made answers for itself; leaving the old sentence beside it would have the
    // card explaining a match that is no longer why this category is here.
    assert.equal(corrected?.matchedOn, null);

    const rematched = await rematchDelcampeOfferCategory(userId, offerId);
    assert.equal(rematched?.categoryId, "7945");
    assert.equal(rematched?.source, "learned");
  });

  it("clears rather than keeping a stale value when ↻ finds nothing", async () => {
    const offerId = await offerOf("Poland 1935 mint again", 1935, mintId);
    await setDelcampeOfferCategory(userId, offerId, {
      categoryId: "7936",
      categoryName: "Unused stamps",
      categoryPath: "Stamps > Europe > Poland > 1919-1939 Republic > Unused stamps",
    });
    // Asking the register what it says now must not be answered with something the register did not
    // say — so a miss empties the card rather than leaving the correction in place pretending to be
    // a match.
    const rematched = await rematchDelcampeOfferCategory(userId, offerId);
    assert.equal(rematched?.categoryId, null);
    assert.equal(rematched?.source, null);
  });

  it("is not offered on an offer that is not on the Delcampe platform", async () => {
    const other = (
      await prisma.contact.create({ data: { collectionId, name: "Somewhere else", platform: true } })
    ).id;
    const offerId = await createOffer(userId, collectionId, {
      platformId: other,
      url: null,
      price: "1.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    assert.equal(await getDelcampeOfferListingConfig(userId, offerId), null);
  });
});
