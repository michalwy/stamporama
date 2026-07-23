import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  listIssuesPaginated,
  listIssueMembers,
  getIssuePriceDetails,
} from "../../src/lib/issues";

// Records a single price against the given condition (no certificate status).
async function addPrice(
  stampId: string,
  catalogEditionId: string,
  conditionId: string,
  price: string
) {
  await prisma.stampCatalogPrice.create({
    data: { stampId, catalogEditionId, conditionId, certificateStatusId: null, price, currency: "EUR" },
  });
}

describe("issue list price staleness", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  let stampId: string;
  let editionId2023: string;
  let editionId2024: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-isspr-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User isspr-${ts}`,
        email: `test-isspr-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-isspr-${ts}`, name: `Collection isspr-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    editionId2023 = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2023 } })
    ).id;
    editionId2024 = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id },
    });
    const issue = await prisma.issue.create({
      data: { collectionId, collectionAreaId: area.id, name: "First Issue", year: 1872 },
    });
    issueId = issue.id;

    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Member Stamp" } });
    stampId = stamp.id;
    await prisma.stampCollectionArea.create({
      data: { stampId, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.issueMember.create({
      data: { issueId, stampId, requiredForCompleteness: true },
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("flags the issue total as stale when a required member is priced on a non-latest edition", async () => {
    await addPrice(stampId, editionId2023, conditionId, "12.50");

    const { items } = await listIssuesPaginated(userId, collectionId, {});
    const item = items.find((i) => i.id === issueId);
    assert.ok(item);
    assert.equal(item.requiredPriceTotal?.amount, "12.50");
    assert.equal(item.requiredPriceStale, true);

    // member node exposes staleness too (used in the expanded issue view)
    const members = await listIssueMembers(userId, collectionId, issueId);
    const node = members.find((n) => n.stampId === stampId);
    assert.ok(node);
    assert.equal(node.mainCatalogPriceStale, true);
  });

  it("clears the flag once the latest edition is priced", async () => {
    await addPrice(stampId, editionId2024, conditionId, "20.00");

    const { items } = await listIssuesPaginated(userId, collectionId, {});
    const item = items.find((i) => i.id === issueId);
    assert.ok(item);
    assert.equal(item.requiredPriceTotal?.amount, "20.00");
    assert.equal(item.requiredPriceStale, false);

    const members = await listIssueMembers(userId, collectionId, issueId);
    const node = members.find((n) => n.stampId === stampId);
    assert.ok(node);
    assert.equal(node.mainCatalogPriceStale, false);
  });
});

describe("issue member price tracks the display condition (#238)", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  let stampId: string;
  let editionId: string;
  let condMintId: string;
  let condUsedId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-isscond-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User isscond-${ts}`,
        email: `test-isscond-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-isscond-${ts}`, name: `Collection isscond-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;

    condMintId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    condUsedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id },
    });
    const issue = await prisma.issue.create({
      data: { collectionId, collectionAreaId: area.id, name: "Condition Issue", year: 1872 },
    });
    issueId = issue.id;

    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Member Stamp" } });
    stampId = stamp.id;
    await prisma.stampCollectionArea.create({
      data: { stampId, collectionAreaId: area.id, isPrimary: true },
    });
    await prisma.issueMember.create({
      data: { issueId, stampId, requiredForCompleteness: true },
    });

    // Distinct prices per condition so the wrong condition is obvious.
    await addPrice(stampId, editionId, condMintId, "30.00");
    await addPrice(stampId, editionId, condUsedId, "8.00");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("defaults to the first condition when none is requested", async () => {
    const members = await listIssueMembers(userId, collectionId, issueId);
    const node = members.find((n) => n.stampId === stampId);
    assert.equal(node?.mainCatalogPrice?.amount, "30.00");
  });

  it("uses the requested non-first condition's price", async () => {
    const members = await listIssueMembers(userId, collectionId, issueId, condUsedId);
    const node = members.find((n) => n.stampId === stampId);
    assert.equal(node?.mainCatalogPrice?.amount, "8.00");
  });
});

describe("issue headline price rolls up from variants (#238)", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  let umbrellaId: string; // base "10", no own price, has variant children
  let midId: string; // intermediate "10a", no own price, has variant child "10aI"
  let plainId: string; // required member with its own price
  let editionId: string;
  let conditionId: string;
  let variantSubtypeId: string;

  const addPriceP = async (stampId: string, price: string) =>
    addPrice(stampId, editionId, conditionId, price);

  before(async () => {
    const ts = Date.now();
    userId = `test-user-issroll-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User issroll-${ts}`,
        email: `test-issroll-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-issroll-${ts}`, name: `Collection issroll-${ts}`, baseCurrency: "PLN", ownerId: userId },
    });
    collectionId = col.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Fischer", abbreviation: "Fi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Fischer Katalog", currency: "PLN" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Variety", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id },
    });
    const issue = await prisma.issue.create({
      data: { collectionId, collectionAreaId: area.id, name: "Rollup Issue", year: 1990 },
    });
    issueId = issue.id;

    const link = (stampId: string) =>
      prisma.stampCollectionArea.create({
        data: { stampId, collectionAreaId: area.id, isPrimary: true },
      });
    const requireMember = (stampId: string) =>
      prisma.issueMember.create({
        data: { issueId, stampId, requiredForCompleteness: true },
      });
    const optionalMember = (stampId: string) =>
      prisma.issueMember.create({
        data: { issueId, stampId, requiredForCompleteness: false },
      });

    // Required umbrella "10" (no own price) → variant "10a" (no own price) → variant "10aI" = 1000.
    umbrellaId = (await prisma.stamp.create({ data: { collectionId, name: "10" } })).id;
    await link(umbrellaId);
    await requireMember(umbrellaId);
    midId = (
      await prisma.stamp.create({
        data: { collectionId, parentId: umbrellaId, name: "10a", subtypeId: variantSubtypeId },
      })
    ).id;
    await link(midId);
    await optionalMember(midId);
    const deepId = (
      await prisma.stamp.create({
        data: { collectionId, parentId: midId, name: "10aI", subtypeId: variantSubtypeId },
      })
    ).id;
    await link(deepId);
    await optionalMember(deepId);
    await addPriceP(deepId, "1000.00");

    // A second variant of "10", priced higher, so "lowest" is exercised.
    const otherVariantId = (
      await prisma.stamp.create({
        data: { collectionId, parentId: umbrellaId, name: "10b", subtypeId: variantSubtypeId },
      })
    ).id;
    await link(otherVariantId);
    await optionalMember(otherVariantId);
    await addPriceP(otherVariantId, "1500.00");

    // A plain required member with its own price.
    plainId = (await prisma.stamp.create({ data: { collectionId, name: "2" } })).id;
    await link(plainId);
    await requireMember(plainId);
    await addPriceP(plainId, "20.00");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("member node: umbrella with no own price shows the lowest variant, flagged uncertain", async () => {
    const members = await listIssueMembers(userId, collectionId, issueId);
    const umbrella = members.find((n) => n.stampId === umbrellaId);
    assert.equal(umbrella?.mainCatalogPrice?.amount, "1000.00");
    assert.equal(umbrella?.mainCatalogPriceUncertain, true);
    // Intermediate node "10a" is also an umbrella (its variant child priced) — rolls up too (#239).
    const mid = members.find((n) => n.stampId === midId);
    assert.equal(mid?.mainCatalogPrice?.amount, "1000.00");
    assert.equal(mid?.mainCatalogPriceUncertain, true);
    // Plain member keeps its own certain price.
    const plain = members.find((n) => n.stampId === plainId);
    assert.equal(plain?.mainCatalogPrice?.amount, "20.00");
    assert.equal(plain?.mainCatalogPriceUncertain, false);
  });

  it("issue total: sums the rolled-up umbrella price and flags the estimate", async () => {
    const { items } = await listIssuesPaginated(userId, collectionId, {});
    const t = items.find((i) => i.id === issueId)?.requiredPriceTotal;
    assert.ok(t);
    assert.equal(t.amount, "1020.00"); // 20 (plain) + 1000 (umbrella lowest variant)
    assert.equal(t.pricedCount, 2);
    assert.equal(t.requiredCount, 2);
    assert.equal(t.estimatedCount, 1);
  });
});

describe("issue total edition-mix handling", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  let stampCurrentId: string;
  let stampOldId: string;
  let editionId2023: string;
  let editionId2024: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-issmix-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User issmix-${ts}`,
        email: `test-issmix-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-issmix-${ts}`, name: `Collection issmix-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Katalog", currency: "EUR" },
    });
    editionId2023 = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2023 } })
    ).id;
    editionId2024 = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2024 } })
    ).id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Germany", primaryCatalogNameId: catalogName.id },
    });
    const issue = await prisma.issue.create({
      data: { collectionId, collectionAreaId: area.id, name: "Mixed Issue", year: 1872 },
    });
    issueId = issue.id;

    const linkStamp = async (name: string) => {
      const s = await prisma.stamp.create({ data: { collectionId, name } });
      await prisma.stampCollectionArea.create({
        data: { stampId: s.id, collectionAreaId: area.id, isPrimary: true },
      });
      await prisma.issueMember.create({
        data: { issueId, stampId: s.id, requiredForCompleteness: true },
      });
      return s.id;
    };
    stampCurrentId = await linkStamp("On current edition");
    stampOldId = await linkStamp("On old edition only");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("all-old: sums older-edition prices and flags stale", async () => {
    await addPrice(stampCurrentId, editionId2023, conditionId, "10.00");
    await addPrice(stampOldId, editionId2023, conditionId, "5.00");

    const { items } = await listIssuesPaginated(userId, collectionId, {});
    const t = items.find((i) => i.id === issueId)?.requiredPriceTotal;
    assert.ok(t);
    assert.equal(t.amount, "15.00");
    assert.equal(t.usesOlderEdition, true);
    assert.equal(t.pricedCount, 2);
    assert.equal(t.requiredCount, 2);
    assert.equal(t.olderEditionExcludedCount, 0);
  });

  it("mixed: sums only current-edition prices and excludes older-only members", async () => {
    // promote one member to the current (2024) edition; the other stays on 2023
    await addPrice(stampCurrentId, editionId2024, conditionId, "12.00");

    const { items } = await listIssuesPaginated(userId, collectionId, {});
    const t = items.find((i) => i.id === issueId)?.requiredPriceTotal;
    assert.ok(t);
    assert.equal(t.amount, "12.00"); // only the current-edition member counts
    assert.equal(t.usesOlderEdition, false);
    assert.equal(t.pricedCount, 1);
    assert.equal(t.requiredCount, 2);
    assert.equal(t.olderEditionExcludedCount, 1);
  });

  it("all-current: full sum with no warning", async () => {
    await addPrice(stampOldId, editionId2024, conditionId, "6.00");

    const { items } = await listIssuesPaginated(userId, collectionId, {});
    const t = items.find((i) => i.id === issueId)?.requiredPriceTotal;
    assert.ok(t);
    assert.equal(t.amount, "18.00");
    assert.equal(t.usesOlderEdition, false);
    assert.equal(t.pricedCount, 2);
    assert.equal(t.olderEditionExcludedCount, 0);
  });

  it("getIssuePriceDetails totals and averages the complete catalog per condition", async () => {
    const details = await getIssuePriceDetails(userId, collectionId, issueId);
    assert.equal(details.requiredCount, 2);
    assert.equal(details.baseCurrency, "EUR");

    // Single catalog, latest edition (2024): 12.00 + 6.00, both members priced (cert = None).
    assert.equal(details.catalogsLatest.length, 1);
    const catCell = details.catalogsLatest[0].cells.find(
      (c) => c.conditionId === conditionId && c.certificateStatusId === null
    );
    assert.ok(catCell);
    assert.equal(catCell.conditionAbbreviation, "MNH");
    assert.equal(catCell.sumCatalog, "18.00");
    assert.equal(catCell.pricedCount, 2);
    assert.equal(catCell.complete, true);

    // Average across catalogs (the one complete catalog), in base currency.
    const avg = details.averageCells.find(
      (a) => a.conditionId === conditionId && a.certificateStatusId === null
    );
    assert.ok(avg);
    assert.equal(avg.averageBase, "18.00");
    assert.equal(avg.completeCatalogCount, 1);
    assert.equal(avg.incompleteCatalogs.length, 0);
  });
});

describe("issue price details cross-catalog averaging", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  let conditionId: string;
  let editionAId: string;
  let editionBId: string;
  let stampOneId: string;
  let stampTwoId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-issavg-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User issavg-${ts}`,
        email: `test-issavg-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-issavg-${ts}`, name: `Collection issavg-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Vendor", abbreviation: "Vn" },
    });
    // Two catalogs, both in the base currency so no rate is needed.
    const catalogA = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Catalog A", currency: "EUR" },
    });
    const catalogB = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Catalog B", currency: "EUR" },
    });
    editionAId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogA.id, year: 2024 } })
    ).id;
    editionBId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalogB.id, year: 2024 } })
    ).id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Area", primaryCatalogNameId: catalogA.id },
    });
    const issue = await prisma.issue.create({
      data: { collectionId, collectionAreaId: area.id, name: "Averaged Issue", year: 1900 },
    });
    issueId = issue.id;

    const linkStamp = async (name: string) => {
      const s = await prisma.stamp.create({ data: { collectionId, name } });
      await prisma.stampCollectionArea.create({
        data: { stampId: s.id, collectionAreaId: area.id, isPrimary: true },
      });
      await prisma.issueMember.create({
        data: { issueId, stampId: s.id, requiredForCompleteness: true },
      });
      return s.id;
    };
    stampOneId = await linkStamp("Stamp One");
    stampTwoId = await linkStamp("Stamp Two");

    // Catalog A prices both required members → complete (10 + 20 = 30).
    await addPrice(stampOneId, editionAId, conditionId, "10.00");
    await addPrice(stampTwoId, editionAId, conditionId, "20.00");
    // Catalog B prices only one member → incomplete, excluded from the average.
    await addPrice(stampOneId, editionBId, conditionId, "100.00");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("averages only complete catalogs and reports the incomplete ones", async () => {
    const details = await getIssuePriceDetails(userId, collectionId, issueId);
    assert.equal(details.requiredCount, 2);

    const avg = details.averageCells.find(
      (a) => a.conditionId === conditionId && a.certificateStatusId === null
    );
    assert.ok(avg);
    // Only Catalog A is complete, so the average equals its sum (30), not (30+100)/2.
    assert.equal(avg.averageBase, "30.00");
    assert.equal(avg.completeCatalogCount, 1);
    assert.equal(avg.incompleteCatalogs.length, 1);
    assert.equal(avg.incompleteCatalogs[0].catalogName, "Catalog B");
    assert.equal(avg.incompleteCatalogs[0].pricedCount, 1);
    assert.equal(avg.incompleteCatalogs[0].requiredCount, 2);

    // Both catalogs still appear in the per-catalog breakdown.
    assert.equal(details.catalogsLatest.length, 2);
    const catB = details.catalogsLatest.find((c) => c.catalogName === "Catalog B");
    assert.ok(catB);
    const catBCell = catB.cells.find(
      (c) => c.conditionId === conditionId && c.certificateStatusId === null
    );
    assert.ok(catBCell);
    assert.equal(catBCell.complete, false);
    assert.equal(catBCell.pricedCount, 1);
  });
});

describe("issue price details certificate breakdown", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  let conditionId: string;
  let certStatusId: string;
  let editionId: string;
  let stampOneId: string;
  let stampTwoId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-isscert-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User isscert-${ts}`,
        email: `test-isscert-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-isscert-${ts}`, name: `Collection isscert-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;

    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Vendor", abbreviation: "Vn" },
    });
    const catalog = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Catalog", currency: "EUR" },
    });
    editionId = (
      await prisma.catalogEdition.create({ data: { catalogNameId: catalog.id, year: 2024 } })
    ).id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    certStatusId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Certificate", abbreviation: "Cert", sortOrder: 0 },
      })
    ).id;

    const area = await prisma.collectionArea.create({
      data: { collectionId, name: "Area", primaryCatalogNameId: catalog.id },
    });
    const issue = await prisma.issue.create({
      data: { collectionId, collectionAreaId: area.id, name: "Cert Issue", year: 1900 },
    });
    issueId = issue.id;

    const linkStamp = async (name: string) => {
      const s = await prisma.stamp.create({ data: { collectionId, name } });
      await prisma.stampCollectionArea.create({
        data: { stampId: s.id, collectionAreaId: area.id, isPrimary: true },
      });
      await prisma.issueMember.create({
        data: { issueId, stampId: s.id, requiredForCompleteness: true },
      });
      return s.id;
    };
    stampOneId = await linkStamp("Stamp One");
    stampTwoId = await linkStamp("Stamp Two");

    // Both members priced with no certificate (10 + 20 = 30) → None column complete.
    await addPrice(stampOneId, editionId, conditionId, "10.00");
    await addPrice(stampTwoId, editionId, conditionId, "20.00");
    // Only one member priced with a certificate → Certificate column incomplete.
    await prisma.stampCatalogPrice.create({
      data: {
        stampId: stampOneId,
        catalogEditionId: editionId,
        conditionId,
        certificateStatusId: certStatusId,
        price: "50.00",
        currency: "EUR",
      },
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("breaks totals and averages down per certificate status", async () => {
    const details = await getIssuePriceDetails(userId, collectionId, issueId);
    const cells = details.catalogsLatest[0].cells;

    // None column: both members priced → complete, summed.
    const none = cells.find((c) => c.conditionId === conditionId && c.certificateStatusId === null);
    assert.ok(none);
    assert.equal(none.sumCatalog, "30.00");
    assert.equal(none.complete, true);

    // Certificate column exists but only one member is priced → incomplete.
    const cert = cells.find(
      (c) => c.conditionId === conditionId && c.certificateStatusId === certStatusId
    );
    assert.ok(cert);
    assert.equal(cert.certificateStatusAbbreviation, "Cert");
    assert.equal(cert.pricedCount, 1);
    assert.equal(cert.complete, false);

    // The None average is present; the Certificate average has no complete catalog.
    const noneAvg = details.averageCells.find(
      (a) => a.conditionId === conditionId && a.certificateStatusId === null
    );
    assert.ok(noneAvg);
    assert.equal(noneAvg.averageBase, "30.00");

    const certAvg = details.averageCells.find(
      (a) => a.conditionId === conditionId && a.certificateStatusId === certStatusId
    );
    assert.ok(certAvg);
    assert.equal(certAvg.averageBase, null);
    assert.equal(certAvg.completeCatalogCount, 0);
    assert.equal(certAvg.incompleteCatalogs.length, 1);
  });
});
