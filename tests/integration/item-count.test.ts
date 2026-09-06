import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  countItems,
  createItem,
  disposeItem,
  getHoldingsValuation,
  listItemsPaginated,
} from "../../src/lib/items";

// How many copies the current filter holds (#845) — the figure the Copies summary bar states.
//
// The one thing worth pinning down is that it counts the **list's** scope and not the holdings
// bar's. Those two differ by exactly the disposed copies: `getHoldingsValuation` lifts the disposal
// exclusion on purpose (#396) so that it can state a write-off line, so a count derived from its
// buckets would over-report by every copy the collector no longer holds — and would do it silently,
// on a figure nobody re-counts by hand.

const ts = Date.now();

describe("countItems (#845)", () => {
  let userId: string;
  let collectionId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    userId = `test-user-itemcount-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Item count",
        email: `test-itemcount-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-itemcount-${ts}`, name: "IC", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function addCopy(overrides: { forSale?: boolean } = {}) {
    return createItem(userId, collectionId, {
      stampId,
      conditionId,
      deliveryState: "delivered",
      ...overrides,
    });
  }

  it("counts the whole filtered set, not one page", async () => {
    for (let i = 0; i < 3; i++) await addCopy();

    const page = await listItemsPaginated(userId, collectionId, { pageSize: 2 });
    assert.equal(page.items.length, 2);
    assert.notEqual(page.nextCursor, null);
    assert.equal(await countItems(userId, collectionId, {}), 3);
  });

  it("narrows with the same filters the list does", async () => {
    await addCopy({ forSale: true });

    const forSale = await countItems(userId, collectionId, { forSale: true });
    const all = await countItems(userId, collectionId, {});
    assert.equal(forSale, 1);
    assert.equal(all, 4);

    const { items } = await listItemsPaginated(userId, collectionId, {
      forSale: true,
      pageSize: 100,
    });
    assert.equal(items.length, forSale);
  });

  it("follows the list past a disposal, where the holdings bar deliberately does not", async () => {
    const copy = await addCopy();
    await disposeItem(userId, copy.id, { reason: "other", note: "gone" });

    // The list hides it, and so does the count.
    const listed = await listItemsPaginated(userId, collectionId, { pageSize: 100 });
    assert.equal(await countItems(userId, collectionId, {}), listed.items.length);
    assert.equal(await countItems(userId, collectionId, {}), 4);

    // Asked for explicitly, it comes back — again in step with the list.
    const withDisposed = await listItemsPaginated(userId, collectionId, {
      includeDisposed: true,
      pageSize: 100,
    });
    assert.equal(
      await countItems(userId, collectionId, { includeDisposed: true }),
      withDisposed.items.length
    );
    assert.equal(await countItems(userId, collectionId, { includeDisposed: true }), 5);

    // The holdings bar's scope is the wider one whichever way the flag is set, which is why the
    // count is its own query rather than a subtraction off these buckets.
    const holdings = await getHoldingsValuation(userId, collectionId, {});
    assert.equal(holdings.writeOff.count, 1);
  });
});
