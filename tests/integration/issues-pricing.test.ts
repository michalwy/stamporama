import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { listIssuesPaginated, listIssueMembers } from "../../src/lib/issues";
import { upsertStampCatalogPrice } from "../../src/lib/stamps";

describe("issue list price staleness", () => {
  let userId: string;
  let collectionId: string;
  let issueId: string;
  let stampId: string;
  let editionId2023: string;
  let editionId2024: string;

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
    await upsertStampCatalogPrice(userId, stampId, editionId2023, "12.50", "EUR");

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
    await upsertStampCatalogPrice(userId, stampId, editionId2024, "20.00", "EUR");

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
    await upsertStampCatalogPrice(userId, stampCurrentId, editionId2023, "10.00", "EUR");
    await upsertStampCatalogPrice(userId, stampOldId, editionId2023, "5.00", "EUR");

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
    await upsertStampCatalogPrice(userId, stampCurrentId, editionId2024, "12.00", "EUR");

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
    await upsertStampCatalogPrice(userId, stampOldId, editionId2024, "6.00", "EUR");

    const { items } = await listIssuesPaginated(userId, collectionId, {});
    const t = items.find((i) => i.id === issueId)?.requiredPriceTotal;
    assert.ok(t);
    assert.equal(t.amount, "18.00");
    assert.equal(t.usesOlderEdition, false);
    assert.equal(t.pricedCount, 2);
    assert.equal(t.olderEditionExcludedCount, 0);
  });
});
