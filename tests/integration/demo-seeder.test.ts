import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { seedDemoData, wipeDemoData } from "../../src/lib/demo/index";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

describe("seedDemoData", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`demo-seed-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `demo-seed-${ts}`)).id;
    await prisma.$transaction(
      (tx) => seedDemoData(collectionId, tx as never),
      { timeout: 60000 }
    );
  });

  after(async () => {
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("seeds Fischer and Michel catalog vendors", async () => {
    const vendors = await prisma.catalogVendor.findMany({
      where: { collectionId },
      orderBy: { name: "asc" },
    });
    assert.equal(vendors.length, 2);
    assert.equal(vendors[0].name, "Fischer");
    assert.equal(vendors[0].abbreviation, "Fi");
    assert.equal(vendors[1].name, "Michel");
    assert.equal(vendors[1].abbreviation, "Mi");
  });

  it("seeds three catalog names (Fischer, Michel Osteuropa, Michel Deutschland)", async () => {
    const names = await prisma.catalogName.findMany({
      where: { vendor: { collectionId } },
      orderBy: { name: "asc" },
    });
    assert.equal(names.length, 3);
    assert.equal(names[0].name, "Fischer");
    assert.equal(names[0].currency, "PLN");
    assert.equal(names[1].name, "Michel Deutschland");
    assert.equal(names[1].currency, "EUR");
    assert.equal(names[2].name, "Michel Osteuropa");
    assert.equal(names[2].currency, "EUR");
  });

  it("seeds three catalog editions", async () => {
    const editions = await prisma.catalogEdition.findMany({
      where: { catalogName: { vendor: { collectionId } } },
    });
    assert.equal(editions.length, 3);
    assert.ok(editions.every((e) => e.year === 2023));
  });

  it("seeds at least 20 collection areas", async () => {
    const count = await prisma.collectionArea.count({ where: { collectionId } });
    assert.ok(count >= 20, `Expected >=20 areas, got ${count}`);
  });

  it("seeds Poland and Germany as root areas", async () => {
    const roots = await prisma.collectionArea.findMany({
      where: { collectionId, parentId: null },
      orderBy: { name: "asc" },
    });
    assert.equal(roots.length, 2);
    assert.equal(roots[0].name, "Germany");
    assert.ok(roots[0].primaryCatalogNameId);
    assert.equal(roots[1].name, "Poland");
    assert.ok(roots[1].primaryCatalogNameId);
  });

  it("seeds hierarchical area tree (at least depth 3)", async () => {
    const areas = await prisma.collectionArea.findMany({
      where: { collectionId },
      select: { id: true, parentId: true },
    });
    const parentIds = new Set(areas.map((a) => a.parentId).filter(Boolean));
    const leafAreas = areas.filter((a) => !parentIds.has(a.id));
    assert.ok(leafAreas.length >= 10, `Expected >=10 leaf areas, got ${leafAreas.length}`);

    const areaMap = new Map(areas.map((a) => [a.id, a.parentId]));
    let maxDepth = 0;
    for (const area of areas) {
      let depth = 0;
      let current: string | null = area.id;
      while (current) {
        current = areaMap.get(current) ?? null;
        depth++;
      }
      maxDepth = Math.max(maxDepth, depth);
    }
    assert.ok(maxDepth >= 3, `Expected depth >=3, got ${maxDepth}`);
  });

  it("links leaf areas to catalog vendors", async () => {
    const areas = await prisma.collectionArea.findMany({
      where: { collectionId },
      select: { id: true },
    });
    const parentIds = new Set(
      (
        await prisma.collectionArea.findMany({
          where: { collectionId, parentId: { not: null } },
          select: { parentId: true },
        })
      ).map((a) => a.parentId)
    );
    const leafIds = areas.filter((a) => !parentIds.has(a.id)).map((a) => a.id);

    const vendorLinks = await prisma.collectionAreaVendor.findMany({
      where: { collectionAreaId: { in: leafIds } },
    });
    assert.ok(vendorLinks.length >= leafIds.length);
  });

  it("seeds at least 150 issues", async () => {
    const count = await prisma.issue.count({ where: { collectionId } });
    assert.ok(count >= 150, `Expected >=150 issues, got ${count}`);
  });

  it("distributes issues across both countries", async () => {
    const poland = await prisma.collectionArea.findFirst({
      where: { collectionId, name: "Poland" },
    });
    const germany = await prisma.collectionArea.findFirst({
      where: { collectionId, name: "Germany" },
    });
    assert.ok(poland && germany);

    const allPolishAreaIds = await prisma.collectionArea
      .findMany({ where: { collectionId }, select: { id: true, parentId: true, name: true } })
      .then((areas) => {
        const childMap = new Map<string, string[]>();
        for (const a of areas) {
          if (a.parentId) {
            const siblings = childMap.get(a.parentId) ?? [];
            siblings.push(a.id);
            childMap.set(a.parentId, siblings);
          }
        }
        const result: string[] = [];
        const queue = [poland.id];
        while (queue.length) {
          const id = queue.pop()!;
          result.push(id);
          queue.push(...(childMap.get(id) ?? []));
        }
        return result;
      });

    const polishIssues = await prisma.issue.count({
      where: { collectionAreaId: { in: allPolishAreaIds } },
    });
    const germanIssues = await prisma.issue.count({
      where: { collectionId, collectionAreaId: { notIn: allPolishAreaIds } },
    });
    assert.ok(polishIssues >= 80, `Expected >=80 Polish issues, got ${polishIssues}`);
    assert.ok(germanIssues >= 50, `Expected >=50 German issues, got ${germanIssues}`);
  });

  it("seeds issue catalog number ranges", async () => {
    const count = await prisma.issueCatalogNumber.count({
      where: { issue: { collectionId } },
    });
    assert.ok(count >= 150, `Expected >=150 issue catalog numbers, got ${count}`);
  });

  it("seeds at least 600 stamps", async () => {
    const count = await prisma.stamp.count({ where: { collectionId } });
    assert.ok(count >= 600, `Expected >=600 stamps, got ${count}`);
  });

  it("seeds catalog numbers for every stamp", async () => {
    const stampCount = await prisma.stamp.count({ where: { collectionId } });
    const numCount = await prisma.stampCatalogNumber.count({
      where: { stamp: { collectionId } },
    });
    assert.ok(numCount >= stampCount, `Expected >=${stampCount} catalog numbers, got ${numCount}`);
  });

  it("seeds stamp-area links for every stamp", async () => {
    const stampCount = await prisma.stamp.count({ where: { collectionId } });
    const linkCount = await prisma.stampCollectionArea.count({
      where: { stamp: { collectionId } },
    });
    assert.equal(linkCount, stampCount);
  });

  it("seeds issue members for every root stamp", async () => {
    const rootStampCount = await prisma.stamp.count({
      where: { collectionId, parentId: null },
    });
    const memberCount = await prisma.issueMember.count({
      where: { issue: { collectionId } },
    });
    assert.equal(memberCount, rootStampCount);
  });

  it("seeds catalog prices for stamps against a condition", async () => {
    const priceCount = await prisma.stampCatalogPrice.count({
      where: { stamp: { collectionId } },
    });
    assert.ok(priceCount >= 600, `Expected >=600 prices, got ${priceCount}`);

    // Every seeded price is tagged with the collection's first condition and no
    // certificate status (see #91 / seed-stamps).
    const firstCondition = await prisma.stampCondition.findFirst({
      where: { collectionId },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    });
    assert.ok(firstCondition);
    const mismatched = await prisma.stampCatalogPrice.count({
      where: {
        stamp: { collectionId },
        OR: [{ conditionId: { not: firstCondition.id } }, { certificateStatusId: { not: null } }],
      },
    });
    assert.equal(mismatched, 0);
  });

  it("includes issues with optional stamps", async () => {
    const issues = await prisma.issue.findMany({
      where: { collectionId },
      include: { members: { select: { requiredForCompleteness: true } } },
    });
    const withOptional = issues.filter((i) =>
      i.members.some((m) => !m.requiredForCompleteness)
    );
    assert.ok(withOptional.length >= 1, `Expected >=1 issues with optional stamps`);
  });

  it("includes stamps with variants", async () => {
    const parents = await prisma.stamp.findMany({
      where: { collectionId, variants: { some: {} } },
    });
    assert.ok(parents.length >= 5, `Expected >=5 stamps with variants, got ${parents.length}`);
  });

  it("seeds contacts (address book)", async () => {
    const count = await prisma.contact.count({ where: { collectionId } });
    assert.ok(count >= 5, `Expected >=5 contacts, got ${count}`);
  });

  it("seeds certificate statuses", async () => {
    const count = await prisma.certificateStatus.count({ where: { collectionId } });
    assert.ok(count >= 1, `Expected >=1 certificate status, got ${count}`);
  });

  it("seeds a large inventory of owned copies", async () => {
    const count = await prisma.item.count({ where: { collectionId } });
    assert.ok(count >= 1000, `Expected >=1000 items, got ${count}`);
  });

  it("links some inventory copies to certificate statuses", async () => {
    // Acquisition/cost fields moved to the purchase model (ADR-0009); demo copies no
    // longer carry a source contact or purchase price. Certificate linkage remains.
    const withCert = await prisma.item.count({
      where: { collectionId, certificateStatusId: { not: null } },
    });
    assert.ok(withCert > 0, "Expected some items with a certificate status");
  });

  it("seeds exchange rates for offline valuation", async () => {
    // Test collection base is EUR; demo prices are in PLN and EUR, so a PLN→EUR
    // rate is seeded (EUR→EUR is identity and not stored).
    const rates = await prisma.exchangeRate.findMany({ where: { collectionId } });
    assert.ok(rates.length >= 1, `Expected >=1 exchange rate, got ${rates.length}`);
    const plnToEur = rates.find(
      (r) => r.fromCurrency === "PLN" && r.toCurrency === "EUR"
    );
    assert.ok(plnToEur, "Expected a PLN→EUR rate");
    assert.ok(Number(plnToEur.rate) > 0, "Expected a positive PLN→EUR rate");
  });

  it("records refinement history for variant copies", async () => {
    const count = await prisma.itemVariantHistory.count({
      where: { item: { collectionId } },
    });
    assert.ok(count >= 5, `Expected >=5 variant history rows, got ${count}`);
  });

  it("seeds storage locations with grouping and assignable nodes", async () => {
    const grouping = await prisma.location.count({
      where: { collectionId, assignable: false },
    });
    const assignable = await prisma.location.count({
      where: { collectionId, assignable: true },
    });
    assert.ok(grouping > 0, "Expected some grouping-only locations");
    assert.ok(assignable > 0, "Expected some assignable locations");
  });

  it("files some inventory copies into locations, some with a ref", async () => {
    const withLocation = await prisma.item.count({
      where: { collectionId, locationId: { not: null } },
    });
    const withRef = await prisma.item.count({
      where: { collectionId, locationRef: { not: null } },
    });
    assert.ok(withLocation > 0, "Expected some copies filed in a location");
    assert.ok(withRef > 0, "Expected some copies with an in-location ref");
  });

  it("only ever files copies into assignable locations", async () => {
    const misfiled = await prisma.item.count({
      where: { collectionId, location: { assignable: false } },
    });
    assert.equal(misfiled, 0);
  });
});

describe("wipeDemoData", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`demo-wipe-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `demo-wipe-${ts}`)).id;
    await prisma.$transaction(
      (tx) => seedDemoData(collectionId, tx as never),
      { timeout: 60000 }
    );
    await prisma.$transaction(
      (tx) => wipeDemoData(collectionId, tx as never),
      { timeout: 30000 }
    );
  });

  after(async () => {
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("removes all stamps", async () => {
    const count = await prisma.stamp.count({ where: { collectionId } });
    assert.equal(count, 0);
  });

  it("removes all issues", async () => {
    const count = await prisma.issue.count({ where: { collectionId } });
    assert.equal(count, 0);
  });

  it("removes all catalog vendors", async () => {
    const count = await prisma.catalogVendor.count({ where: { collectionId } });
    assert.equal(count, 0);
  });

  it("removes all collection areas", async () => {
    const count = await prisma.collectionArea.count({ where: { collectionId } });
    assert.equal(count, 0);
  });

  it("removes all storage locations", async () => {
    const count = await prisma.location.count({ where: { collectionId } });
    assert.equal(count, 0);
  });

  it("removes all inventory items and contacts", async () => {
    const items = await prisma.item.count({ where: { collectionId } });
    const history = await prisma.itemVariantHistory.count({
      where: { item: { collectionId } },
    });
    const contacts = await prisma.contact.count({ where: { collectionId } });
    const certStatuses = await prisma.certificateStatus.count({
      where: { collectionId },
    });
    const rates = await prisma.exchangeRate.count({ where: { collectionId } });
    assert.equal(items, 0);
    assert.equal(history, 0);
    assert.equal(contacts, 0);
    assert.equal(certStatuses, 0);
    assert.equal(rates, 0);
  });

  it("leaves the collection itself intact", async () => {
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
    });
    assert.ok(collection);
  });
});
