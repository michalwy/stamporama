import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { createFacebookPost } from "../../src/lib/facebook-posts";
import { getFacebookPostCatalogueFill } from "../../src/lib/facebook-post-catalogue-fill";
import { catalogueFillGroups, needsCatalogueValue } from "../../src/lib/lot-catalogue-fill";

// A post's copies as *Fill catalogue values* lines (#2220): every copy of every lot, keyed by the
// lot's offer id, valued as the copies list values it — so the window asks for exactly the copies
// that are unpriced there — and nothing once the post is up.

describe("a post's copies as Fill catalogue values lines (#2220)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let facebookId: string;
  let groupId: string;
  let conditionId: string;
  let editionId: string;
  let areaId: string;
  let pricedStampId: string;
  let unpricedStampId: string;
  let umbrellaStampId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbpostfill-${ts}`;
    otherUserId = `test-user-fbpostfill-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-fbpostfill-${ts}`, name: `fbpostfill-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    await prisma.collection.create({
      data: { slug: `col-fbpostfill-o-${ts}`, name: `fbpostfill-o-${ts}`, baseCurrency: "PLN", ownerId: otherUserId },
    });
    facebookId = (
      await prisma.platform.create({
        data: { collectionId, name: "Facebook", platformCurrency: "PLN", maxPhotoEdge: 2000 },
      })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;

    const vendor = await prisma.catalogVendor.create({ data: { collectionId, name: "Fischer", abbreviation: "Fi" } });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Fischer", currency: "PLN" },
    });
    editionId = (await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })).id;
    areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id } })
    ).id;
    const variantSubtype = await prisma.stampSubtype.create({
      data: { collectionId, name: "Variant", actsAsVariant: true, isDefault: true, sortOrder: 0 },
    });

    async function stamp(name: string, number: string, parentId?: string, subtypeId?: string): Promise<string> {
      const s = await prisma.stamp.create({ data: { collectionId, name, parentId, subtypeId } });
      await prisma.stampCollectionArea.create({ data: { stampId: s.id, collectionAreaId: areaId, isPrimary: true } });
      await prisma.stampCatalogNumber.create({ data: { stampId: s.id, catalogVendorId: vendor.id, number } });
      return s.id;
    }
    pricedStampId = await stamp("Priced", "1");
    await prisma.stampCatalogPrice.create({
      data: { stampId: pricedStampId, catalogEditionId: editionId, conditionId, price: "12.00", currency: "PLN" },
    });
    unpricedStampId = await stamp("Unpriced", "2");
    umbrellaStampId = await stamp("Umbrella", "3");
    await stamp("Umbrella a", "3a", umbrellaStampId, variantSubtype.id);

    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — wartości",
        url: "https://www.facebook.com/groups/222000",
        postTemplate: "{lot}. {title}",
        custom: ["postTemplate"],
      })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  /** A Preparing Facebook auction over fresh copies of these stamps, one set. */
  async function lot(stampIds: string[]): Promise<string> {
    const itemIds = [];
    for (const stampId of stampIds) {
      itemIds.push((await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id);
    }
    return createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: "0.00",
        startingPrice: null,
        currency: "PLN",
        listingDate: null,
        state: "preparing",
        facebookGroupId: groupId,
      },
      { seedItemIds: itemIds }
    );
  }

  it("reads every copy of every lot, valued as the copies list values it", async () => {
    const a = await lot([pricedStampId, unpricedStampId]);
    const b = await lot([unpricedStampId, umbrellaStampId]);
    const post = await createFacebookPost(userId, collectionId, [a, b], "Values to type");

    const fill = await getFacebookPostCatalogueFill(userId, collectionId, post.postId);
    assert.ok(fill);
    assert.deepEqual(Object.keys(fill).sort(), [a, b].sort());

    const byStamp = (offerId: string, stampId: string) => fill[offerId].find((l) => l.stampId === stampId)!;
    assert.equal(byStamp(a, pricedStampId).unpriced, false, "a priced copy is no gap");
    assert.equal(byStamp(a, unpricedStampId).unpriced, true);
    assert.match(byStamp(a, unpricedStampId).catalogLabel ?? "", /\b2$/);
    assert.equal(byStamp(a, unpricedStampId).conditionAbbreviation, "U");
    assert.equal(byStamp(b, umbrellaStampId).unknownVariant, true, "an umbrella's value is its variants'");

    // The window asks for the unpriced stamp once, in lot 1, and nothing of lot 2 but what it already
    // asked there: the umbrella is left out.
    const sections = catalogueFillGroups([
      { key: a, label: "Lot 1", title: "Lot 1", lines: fill[a] },
      { key: b, label: "Lot 2", title: "Lot 2", lines: fill[b] },
    ]);
    assert.deepEqual(
      sections.map((s) => [s.group.key, s.entries.map((e) => [e.stampId, e.lines.length])]),
      [[a, [[unpricedStampId, 2]]]]
    );
    assert.equal(fill[b].filter(needsCatalogueValue).length, 1);
  });

  it("reads nothing once the post is up, and refuses another collector's post", async () => {
    const a = await lot([unpricedStampId]);
    const b = await lot([unpricedStampId]);
    const post = await createFacebookPost(userId, collectionId, [a, b], "Going up");
    await assert.rejects(() => getFacebookPostCatalogueFill(otherUserId, collectionId, post.postId), /not found/i);

    assert.ok(await getFacebookPostCatalogueFill(userId, collectionId, post.postId));
    // Up in the group — written directly: going up is the publish flow's, tested on its own.
    await prisma.offer.update({ where: { id: a }, data: { state: "active" } });
    assert.equal(await getFacebookPostCatalogueFill(userId, collectionId, post.postId), null);
  });
});
