import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createChecklist, setChecklistStamps } from "../../src/lib/checklists";
import { getIssueListItem } from "../../src/lib/issues";

// An issue's one catalogue value (#2659): the stamps on its checklists, each counted once — the
// same union the completeness count reads, by the same switch for specialised checklists (#1617) —
// while each checklist keeps its own total.

const ts = Date.now();

describe("an issue's catalogue value across its checklists (#2659)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let editionId: string;
  let conditionId: string;

  before(async () => {
    userId = `test-user-isunion-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User isunion-${ts}`,
        email: `test-isunion-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-isunion-${ts}`, name: "Union", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Fischer", abbreviation: "Fi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Fischer", currency: "PLN" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    areaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  let issueNo = 92659;
  async function issueWith(prices: Record<string, string | null>) {
    const issueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: issueNo++, collectionAreaId: areaId, name: "Monuments" },
      })
    ).id;
    const ids: Record<string, string> = {};
    let sortOrder = 0;
    for (const [name, price] of Object.entries(prices)) {
      const id = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name,
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
      await prisma.issueMember.create({ data: { issueId, stampId: id, sortOrder: sortOrder++ } });
      if (price !== null) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: id,
            catalogEditionId: editionId,
            conditionId,
            certificateStatusId: null,
            price,
            currency: "PLN",
          },
        });
      }
      ids[name] = id;
    }
    return { issueId, ids };
  }

  it("sums disjoint checklists, each keeping its own total", async () => {
    const { issueId, ids } = await issueWith({ a1: "100", a2: "80", b1: "120" });
    const imperf = await createChecklist(userId, collectionId, { issueId, name: "Imperforate (A)" });
    const perf = await createChecklist(userId, collectionId, { issueId, name: "Perforated (B)" });
    await setChecklistStamps(userId, imperf, [ids.a1, ids.a2]);
    await setChecklistStamps(userId, perf, [ids.b1]);

    const item = await getIssueListItem(userId, collectionId, issueId);
    assert.ok(item?.priceTotal);
    assert.equal(item.priceTotal.amount, "300.00");
    assert.equal(item.priceTotal.pricedCount, 3);
    assert.equal(item.priceTotal.requiredCount, 3);
    assert.equal(item.priceStale, false);
    assert.deepEqual(
      item.checklists.map((c) => [c.name, c.priceTotal?.amount]),
      [
        ["Imperforate (A)", "180.00"],
        ["Perforated (B)", "120.00"],
      ]
    );
  });

  it("counts a stamp on two checklists once, and leaves out stamps only specialised ones list while they do not count", async () => {
    const { issueId, ids } = await issueWith({ s1: "10", s2: "20", shade: "5", bare: null });
    const basic = await createChecklist(userId, collectionId, { issueId, name: "Basic" });
    const shades = await createChecklist(userId, collectionId, {
      issueId,
      name: "Shades",
      kind: "specialised",
    });
    await setChecklistStamps(userId, basic, [ids.s1, ids.s2, ids.bare]);
    await setChecklistStamps(userId, shades, [ids.s1, ids.shade]);

    const on = await getIssueListItem(userId, collectionId, issueId, { includeSpecialised: true });
    assert.ok(on?.priceTotal);
    // s1 is on both and counts once: 10 + 20 + 5, not 10 + 20 + 10 + 5.
    assert.equal(on.priceTotal.amount, "35.00");
    assert.equal(on.priceTotal.requiredCount, on.requiredCount);
    assert.equal(on.priceTotal.requiredCount, 4);
    assert.equal(on.priceTotal.pricedCount, 3);
    assert.deepEqual(
      on.checklists.map((c) => c.priceTotal?.amount),
      ["30.00", "15.00"]
    );

    const off = await getIssueListItem(userId, collectionId, issueId);
    assert.ok(off?.priceTotal);
    assert.equal(off.priceTotal.amount, "30.00");
    assert.equal(off.priceTotal.requiredCount, off.requiredCount);
    assert.equal(off.priceTotal.requiredCount, 3);
  });

  it("is the one checklist's total when there is one, and nothing when there is none", async () => {
    const one = await issueWith({ x: "7.50", y: "2.50" });
    const set = await createChecklist(userId, collectionId, { issueId: one.issueId, name: "Set" });
    await setChecklistStamps(userId, set, [one.ids.x, one.ids.y]);
    const item = await getIssueListItem(userId, collectionId, one.issueId);
    assert.deepEqual(item?.priceTotal, item?.checklists[0]?.priceTotal);
    assert.equal(item?.priceTotal?.amount, "10.00");

    const none = await issueWith({ z: "3" });
    const bare = await getIssueListItem(userId, collectionId, none.issueId);
    assert.equal(bare?.priceTotal, null);
    assert.equal(bare?.priceStale, false);
  });
});
