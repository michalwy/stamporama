import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { listCatalogDuplicates } from "../../src/lib/duplicate-catalog";
import { matchColnectItems } from "../../src/lib/colnect";

// **The area prefix is catalog identity, not a label** (#66/#377, extended by #675).
//
// The prefix now has two levels — the area's own `catalogPrefix` and the per-vendor row — and every
// surface that turns a bare number into an identity has to resolve them the same way. Two of them
// are checked here against a real database, because they are the ones where a disagreement is
// invisible until it has already done damage: duplicate detection (#85), which would let the same
// stamp in twice, and the Colnect strict full-key match (#155), which would attach the wrong
// Colnect item to a stamp whose chip reads exactly right.
//
// The shape of both cases is the same: one stamp gets its `PL` from the **area level**, the other
// from a **vendor row**, and nothing downstream may be able to tell them apart.

describe("the two prefix levels resolve to one catalog identity (#675)", () => {
  let userId: string;
  let collectionId: string;
  let michelVendorId: string;
  let fromAreaLevel: string;
  let fromVendorRow: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-api-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User api-${ts}`,
        email: `test-api-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-api-${ts}`,
          name: `Collection api-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    michelVendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;

    // One area says `PL` at the area level and ticks Michel plainly (a null row, which states
    // nothing about the prefix and so takes the area's).
    const areaLevel = await prisma.collectionArea.create({
      data: { collectionId, name: "Poland (area prefix)", catalogPrefix: "PL" },
    });
    await prisma.collectionAreaVendor.create({
      data: {
        collectionAreaId: areaLevel.id,
        catalogVendorId: michelVendorId,
        areaPrefix: null,
      },
    });

    // The other says nothing at the area level and carries `PL` on the Michel row — how every area
    // said it before #675, and how areas that disagree with their own area prefix still say it.
    const vendorRow = await prisma.collectionArea.create({
      data: { collectionId, name: "Poland (vendor row)" },
    });
    await prisma.collectionAreaVendor.create({
      data: {
        collectionAreaId: vendorRow.id,
        catalogVendorId: michelVendorId,
        areaPrefix: "PL",
      },
    });

    async function makeStamp(name: string, areaId: string) {
      const stamp = await prisma.stamp.create({ data: { collectionId, name } });
      await prisma.stampCollectionArea.create({
        data: { stampId: stamp.id, collectionAreaId: areaId, isPrimary: true },
      });
      await prisma.stampCatalogNumber.create({
        data: { stampId: stamp.id, catalogVendorId: michelVendorId, number: "200" },
      });
      return stamp.id;
    }
    fromAreaLevel = await makeStamp("From the area prefix", areaLevel.id);
    fromVendorRow = await makeStamp("From the vendor row", vendorRow.id);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("catches them as duplicates of each other", async () => {
    const groups = await listCatalogDuplicates(userId, collectionId);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, "Mi·PL 200");
    assert.deepEqual(
      groups[0].stamps.map((s) => s.stampId).sort(),
      [fromAreaLevel, fromVendorRow].sort()
    );
  });

  it("makes the Colnect matcher read both the way their chips do", async () => {
    // `Mi PL 200` as Colnect prints it. Both stamps key to it, so the matcher must find the pair
    // ambiguous rather than silently pick one — which is the proof that neither prefix level is
    // resolving differently from the other.
    const [result] = await matchColnectItems(
      userId,
      collectionId,
      [{ colnectId: "12345", catalogRefs: [{ catalog: "Mi", number: "PL 200" }] }],
      { dryRun: true }
    );
    assert.ok(result.status === "needs-confirm", `expected needs-confirm, got ${result.status}`);
    assert.deepEqual(
      result.candidates.map((c) => c.stampId).sort(),
      [fromAreaLevel, fromVendorRow].sort()
    );
    // …and the chips read the same on both, which is the half a key comparison cannot show.
    for (const candidate of result.candidates) {
      assert.deepEqual(
        candidate.catalogNumbers.map((n) => n.label),
        ["Mi·PL 200"]
      );
    }
  });
});
