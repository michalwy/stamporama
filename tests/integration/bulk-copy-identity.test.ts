import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createLot, intakeStamps, bulkUpdateLotItems } from "../../src/lib/lots";
import { createPurchase, setPurchaseStatus } from "../../src/lib/purchases";

// Re-stating what a batch of copies **is** in one write (#723): the grade, the certificate status
// and the physical format, alongside the filing and re-flagging the same bulk change already did
// (#682). What is pinned here is what a collector cannot see going wrong from the list: that an
// axis nobody answered is left exactly as it was rather than blanked, that the null on the two
// axes that have one is a *value* (no certificate, single) and not "leave it alone", and that a
// dictionary row from another collection is refused instead of quietly written where no read of
// this collection would ever show it.

describe("bulk condition / certificate / format (#723)", () => {
  let userId: string;
  let collectionId: string;
  let usedId: string;
  let mintId: string;
  let expertisedId: string;
  let blockOfFourId: string;
  let stampId: string;
  /** A second collection's grade, for the cross-collection refusal. */
  let foreignConditionId: string;

  async function arrivedLot(): Promise<string> {
    const purchase = await createPurchase(userId, collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    await setPurchaseStatus(userId, purchase.id, "arrived");
    return createLot(userId, purchase.id, 10);
  }

  /** `count` copies, all in the `Used` grade with no certificate and no format. */
  async function addCopies(count: number): Promise<string[]> {
    const lotId = await arrivedLot();
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const [copy] = await intakeStamps(userId, { lotId }, { stampId, conditionId: usedId });
      ids.push(copy.itemId);
    }
    return ids;
  }

  async function readCopies(ids: string[]) {
    return prisma.item.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        conditionId: true,
        certificateStatusId: true,
        formatId: true,
        locationId: true,
        inCollection: true,
        deliveryState: true,
      },
    });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-bulk-identity-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User bulk-identity-${ts}`,
        email: `test-bulk-identity-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-bulk-identity-${ts}`,
        name: `Collection bulk-identity-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    mintId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint never hinged", abbreviation: "**", sortOrder: 1 },
      })
    ).id;
    expertisedId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Expertised", abbreviation: "exp", sortOrder: 0 },
      })
    ).id;
    blockOfFourId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Block of four", abbreviation: "blk4", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Test stamp" } })).id;

    const otherCol = await prisma.collection.create({
      data: {
        slug: `col-bulk-identity-other-${ts}`,
        name: `Other collection bulk-identity-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    foreignConditionId = (
      await prisma.stampCondition.create({
        data: {
          collectionId: otherCol.id,
          name: "Used",
          abbreviation: "U",
          sortOrder: 0,
        },
      })
    ).id;
  });

  it("re-states grade, certificate and format in one write", async () => {
    const ids = await addCopies(3);
    const before = await readCopies(ids);

    const result = await bulkUpdateLotItems(userId, ids, {
      conditionId: mintId,
      certificateStatusId: expertisedId,
      formatId: blockOfFourId,
    });
    assert.equal(result.count, 3);

    for (const copy of await readCopies(ids)) {
      assert.equal(copy.conditionId, mintId);
      assert.equal(copy.certificateStatusId, expertisedId);
      assert.equal(copy.formatId, blockOfFourId);
      // Nothing this change did not name moved: the copies are still where the intake left them.
      assert.equal(copy.locationId, null);
      assert.equal(
        copy.deliveryState,
        before.find((b) => b.id === copy.id)!.deliveryState
      );
    }
  });

  it("leaves every axis the change does not name exactly as it was", async () => {
    const ids = await addCopies(2);
    await bulkUpdateLotItems(userId, ids, {
      certificateStatusId: expertisedId,
      formatId: blockOfFourId,
    });

    // Only the grade this time — an absent axis is "leave it alone", never a blanking.
    await bulkUpdateLotItems(userId, ids, { conditionId: mintId });

    for (const copy of await readCopies(ids)) {
      assert.equal(copy.conditionId, mintId);
      assert.equal(copy.certificateStatusId, expertisedId);
      assert.equal(copy.formatId, blockOfFourId);
    }
  });

  it("writes the null value on the two axes that have one", async () => {
    const ids = await addCopies(2);
    await bulkUpdateLotItems(userId, ids, {
      certificateStatusId: expertisedId,
      formatId: blockOfFourId,
    });

    // Present-but-null is *no certificate* / *single*, which is a value here (ADR-0006 §2;
    // ADR-0020) and has to be distinguishable from the absent field above.
    await bulkUpdateLotItems(userId, ids, { certificateStatusId: null, formatId: null });

    for (const copy of await readCopies(ids)) {
      assert.equal(copy.certificateStatusId, null);
      assert.equal(copy.formatId, null);
      assert.equal(copy.conditionId, usedId);
    }
  });

  it("refuses a dictionary row from another collection", async () => {
    const ids = await addCopies(1);
    await assert.rejects(
      () => bulkUpdateLotItems(userId, ids, { conditionId: foreignConditionId }),
      /Condition not found in this collection/
    );
    assert.equal((await readCopies(ids))[0].conditionId, usedId);
  });
});
