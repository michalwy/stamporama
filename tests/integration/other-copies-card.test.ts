import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { countItemsByHoldingState, createItem, listItemsPaginated } from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import { heldCopiesWhere } from "../../src/lib/copy-counts";
import { loadStampFamilies } from "../../src/lib/stamp-family";
import { otherCopiesFilters } from "../../src/lib/other-copies-rules";
import type { HoldingState } from "../../src/lib/copy-card-states";
import { itemFilterParams } from "../../src/app/c/[collectionSlug]/inventory/use-inventory-query";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";

// The copy page's *Other copies* card (#2090, #2282) lists **the copies the stamp page counts** over
// the stamp's whole family — the umbrella and its variants — less the copy whose page it is, in the
// holding states its chips have on (#2281). The card reads the Copies list's own routes, so this test
// sends its filters the way the card does — through the query string the routes read — and holds the
// answer to `heldCopiesWhere`, the predicate behind the stamp's count.
//
// One stamp, Mi 10, with a variant and an error under it, and the copies that make the rule visible:
//
//   - **self** — the copy whose page it is: never listed, never counted.
//   - **delivered**, **in transit**, **to sort** — held, each listed; the row marks the last two.
//   - **variant** — a copy of Mi 10's variant: the same family, listed.
//   - **error** — a copy of Mi 10's error, a distinct entry: its own family, not listed.
//   - **damaged** — arrived damaged, so never usably held: not listed under any chip.
//   - **disposed** — no longer held (#395): listed only under that chip.
//   - **carrier** — a cover bearing Mi 10 and Mi 11, a copy of neither (#745): not listed.

const ts = Date.now();

describe("the copy page's other copies of its stamp's family (#2090, #2282)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let mi10: string, mi11: string, variantId: string, errorId: string;
  let selfId: string, deliveredId: string, inTransitId: string, toSortId: string;
  let variantCopyId: string, disposedId: string;

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
    const perforation = await prisma.stampSubtype.create({
      data: { collectionId, name: "Perforation", actsAsVariant: true, sortOrder: 0 },
    });
    const error = await prisma.stampSubtype.create({
      data: { collectionId, name: "Error", actsAsVariant: false, sortOrder: 1 },
    });
    variantId = (
      await prisma.stamp.create({
        data: { collectionId, name: "Mi 10 II", parentId: mi10, subtypeId: perforation.id },
      })
    ).id;
    errorId = (
      await prisma.stamp.create({
        data: { collectionId, name: "Mi 10 F", parentId: mi10, subtypeId: error.id },
      })
    ).id;

    const copy = async (deliveryState: string, stampId = mi10) =>
      (await createItem(userId, collectionId, { stampId, conditionId, deliveryState })).id;
    selfId = await copy("delivered");
    deliveredId = await copy("delivered");
    inTransitId = await copy("in_transit");
    toSortId = await copy("to_sort");
    await copy("damaged");
    disposedId = await copy("delivered");
    await prisma.item.update({ where: { id: disposedId }, data: { disposedAt: new Date() } });
    const carrierId = await copy("delivered");
    await setItemStamps(userId, carrierId, [{ stampId: mi10 }, { stampId: mi11 }]);
    variantCopyId = await copy("delivered", variantId);
    await copy("delivered", errorId);
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

  /** The card's filters for a copy of `stampId`, through the routes' own reader. */
  async function cardFilters(stampId: string, itemId: string, shown?: HoldingState[]) {
    const family = (await loadStampFamilies(collectionId, [stampId])).get(stampId);
    assert.ok(family);
    return readItemFilters(itemFilterParams(otherCopiesFilters(family, itemId, shown)));
  }

  /** The card's rows for a copy of `stampId`. */
  async function cardCopyIds(stampId: string, itemId: string, shown: HoldingState[] = ["held"]) {
    const filters = await cardFilters(stampId, itemId, shown);
    const { items } = await listItemsPaginated(userId, collectionId, { ...filters, pageSize: 100 });
    return items.map((item) => item.id).sort();
  }

  it("takes the umbrella and its variants as one family, and leaves a distinct entry its own", async () => {
    const families = await loadStampFamilies(collectionId, [mi10, variantId, errorId]);
    assert.deepEqual(families.get(mi10), [mi10, variantId]);
    assert.deepEqual(families.get(variantId), [mi10, variantId]);
    assert.deepEqual(families.get(errorId), [errorId]);
  });

  it("lists every other held copy of the family, the variant's and those on their way among them", async () => {
    assert.deepEqual(
      await cardCopyIds(mi10, selfId),
      [deliveredId, inTransitId, toSortId, variantCopyId].sort()
    );
  });

  it("lists the umbrella's copies on a variant copy's page", async () => {
    assert.deepEqual(
      await cardCopyIds(variantId, variantCopyId),
      [selfId, deliveredId, inTransitId, toSortId].sort()
    );
  });

  it("lists exactly the copies the stamp page counts over the family, less this one", async () => {
    const held = await prisma.item.findMany({
      where: heldCopiesWhere(collectionId, [mi10, variantId]),
      select: { id: true },
    });
    assert.deepEqual(
      await cardCopyIds(mi10, selfId),
      held
        .map((row) => row.id)
        .filter((id) => id !== selfId)
        .sort()
    );
  });

  it("counts each chip without the copy itself, and lists the written-off copy under its own", async () => {
    const counts = await countItemsByHoldingState(userId, collectionId, await cardFilters(mi10, selfId));
    assert.deepEqual(counts, { held: 4, gone: 0, disposed: 1 });
    assert.deepEqual(await cardCopyIds(mi10, selfId, ["disposed"]), [disposedId]);
  });
});
