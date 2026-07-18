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
