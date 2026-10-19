import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated } from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import {
  countCopiesByStamp,
  countVariantDescendantCopies,
  heldCopiesWhere,
} from "../../src/lib/copy-counts";
import { otherCopiesFilters } from "../../src/lib/other-copies-rules";
import { itemFilterParams } from "../../src/app/c/[collectionSlug]/inventory/use-inventory-query";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";

// The copy page's *Other copies of this stamp* card (#2090) lists **the copies the stamp page
// counts**, less the copy whose page it is. The card reads the Copies list's own route, so this test
// sends its filters the way the card does — through the query string the route reads — and holds
// the answer to `heldCopiesWhere`, the predicate behind the stamp's count.
//
// One stamp, Mi 10, with a variant under it, and the copies that make the rule visible:
//
//   - **self** — the copy whose page it is.
//   - **delivered**, **in transit**, **to sort** — held, each listed; the row marks the last two.
//   - **damaged** — arrived damaged, so never usably held: not listed.
//   - **disposed** — no longer held (#395): not listed.
//   - **carrier** — a cover bearing Mi 10 and Mi 11, a copy of neither (#745): not listed.
//   - **variant** — a copy of Mi 10's variant: not listed, counted under the card instead.

const ts = Date.now();

describe("the copy page's other copies of its stamp (#2090)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let mi10: string, mi11: string, variantId: string;
  let selfId: string, deliveredId: string, inTransitId: string, toSortId: string;

  before(async () => {
    userId = `test-user-othercopies-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User othercopies-${ts}`,
        email: `test-othercopies-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-othercopies-${ts}`, name: "Others", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    mi10 = (await prisma.stamp.create({ data: { collectionId, name: "Mi 10" } })).id;
    mi11 = (await prisma.stamp.create({ data: { collectionId, name: "Mi 11" } })).id;
    const subtype = await prisma.stampSubtype.create({
      data: { collectionId, name: "Perforation", actsAsVariant: true, sortOrder: 0 },
    });
    variantId = (
      await prisma.stamp.create({
        data: { collectionId, name: "Mi 10 II", parentId: mi10, subtypeId: subtype.id },
      })
    ).id;

    const copy = async (deliveryState: string, stampId = mi10) =>
      (await createItem(userId, collectionId, { stampId, conditionId, deliveryState })).id;
    selfId = await copy("delivered");
    deliveredId = await copy("delivered");
    inTransitId = await copy("in_transit");
    toSortId = await copy("to_sort");
    await copy("damaged");
    const disposedId = await copy("delivered");
    await prisma.item.update({ where: { id: disposedId }, data: { disposedAt: new Date() } });
    const carrierId = await copy("delivered");
    await setItemStamps(userId, carrierId, [{ stampId: mi10 }, { stampId: mi11 }]);
    await copy("delivered", variantId);
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId, parentId: { not: null } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampSubtype.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** The card's rows: its filters through the route's own reader, less the copy whose page it is. */
  async function cardCopyIds(): Promise<string[]> {
    const filters = readItemFilters(itemFilterParams(otherCopiesFilters(mi10)));
    const { items } = await listItemsPaginated(userId, collectionId, { ...filters, pageSize: 100 });
    return items.map((item) => item.id).filter((id) => id !== selfId).sort();
  }

  it("lists every other held copy, the ones on their way and to sort among them", async () => {
    assert.deepEqual(await cardCopyIds(), [deliveredId, inTransitId, toSortId].sort());
  });

  it("lists exactly the copies the stamp page counts, less this one", async () => {
    const held = await prisma.item.findMany({
      where: heldCopiesWhere(collectionId, [mi10]),
      select: { id: true },
    });
    assert.deepEqual(
      await cardCopyIds(),
      held.map((row) => row.id).filter((id) => id !== selfId).sort()
    );
    assert.equal((await countCopiesByStamp(collectionId, [mi10])).get(mi10)?.total, 4);
  });

  it("counts the variant's copy under the card rather than listing it", async () => {
    assert.equal((await countVariantDescendantCopies(collectionId, [mi10])).get(mi10)?.total, 1);
  });
});
