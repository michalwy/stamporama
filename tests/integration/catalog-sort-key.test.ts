import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createIssue, listIssuesPaginated, setIssueCatalogRange } from "../../src/lib/issues";
import { updateCollectionArea } from "../../src/lib/areas";

// End-to-end coverage of the denormalized catalog sort key (#181; ADR-0014): that mutations
// populate `primaryCatalogSortKey`, that the primary vendor wins over a lower secondary number,
// that the issue list orders by it as a tiebreaker, and that an area primary-catalog change
// bulk-recomputes the affected issues.

async function keyOf(issueId: string): Promise<string | null> {
  const row = await prisma.issue.findUniqueOrThrow({
    where: { id: issueId },
    select: { primaryCatalogSortKey: true },
  });
  return row.primaryCatalogSortKey;
}

describe("catalog sort key maintenance", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let miVendorId: string;
  let scVendorId: string;
  let miCatalogNameId: string;

  before(async () => {
    const ts = Date.now();
    userId = (
      await prisma.user.create({
        data: {
          id: `csk-${ts}`,
          name: "CSK",
          email: `csk-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `csk-${ts}`, name: "CSK", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const mi = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const sc = await prisma.catalogVendor.create({
      data: { collectionId, name: "Scott", abbreviation: "Sc" },
    });
    miVendorId = mi.id;
    scVendorId = sc.id;
    miCatalogNameId = (
      await prisma.catalogName.create({
        data: { vendorId: mi.id, name: "Michel DE", currency: "EUR" },
      })
    ).id;
    // Area whose effective primary catalog is Michel.
    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Germany",
          primaryCatalogNameId: miCatalogNameId,
          primaryCatalogVendorId: mi.id,
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("prefers the primary vendor's number over a lower secondary number", async () => {
    const { id } = await createIssue(userId, collectionId, areaId, {
      name: "Primary wins",
      catalogNumbers: [
        { catalogVendorId: miVendorId, firstNumber: "200" }, // primary (Michel)
        { catalogVendorId: scVendorId, firstNumber: "45" }, // lower, but secondary
      ],
    });
    assert.equal(await keyOf(id), "0000000200");
  });

  it("falls back to the lowest numeric when the issue has no primary-vendor number", async () => {
    const { id } = await createIssue(userId, collectionId, areaId, {
      name: "Fallback",
      catalogNumbers: [{ catalogVendorId: scVendorId, firstNumber: "45" }],
    });
    assert.equal(await keyOf(id), "0000000045");
  });

  it("is null when the issue has no numeric catalog number", async () => {
    const { id } = await createIssue(userId, collectionId, areaId, { name: "No numbers" });
    assert.equal(await keyOf(id), null);
  });

  it("updates the key when a vendor range is set via setIssueCatalogRange", async () => {
    const { id } = await createIssue(userId, collectionId, areaId, { name: "Range later" });
    assert.equal(await keyOf(id), null);
    await setIssueCatalogRange(userId, collectionId, id, miVendorId, "310", "315");
    assert.equal(await keyOf(id), "0000000310");
  });

  it("orders same-year issues by primary catalog number as the tiebreaker", async () => {
    const ts = Date.now();
    const area = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: `Tie ${ts}`,
        primaryCatalogNameId: miCatalogNameId,
        primaryCatalogVendorId: miVendorId,
      },
    });
    // Same year, inserted out of catalog order.
    await createIssue(userId, collectionId, area.id, {
      name: "B",
      year: 1950,
      catalogNumbers: [{ catalogVendorId: miVendorId, firstNumber: "500" }],
    });
    await createIssue(userId, collectionId, area.id, {
      name: "A",
      year: 1950,
      catalogNumbers: [{ catalogVendorId: miVendorId, firstNumber: "100" }],
    });
    const page = await listIssuesPaginated(userId, collectionId, {
      areaIds: [area.id],
      sortBy: "year",
      sortDir: "asc",
    });
    const keys = page.items.map((i) => i.catalogNumbers[0]?.firstNumber);
    assert.deepEqual(keys, ["100", "500"]);
  });

  it("recomputes the subtree when an area's leading vendor changes", async () => {
    const ts = Date.now();
    const scCatalogName = await prisma.catalogName.create({
      data: { vendorId: scVendorId, name: `Scott ${ts}`, currency: "USD" },
    });
    const area = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: `Switch ${ts}`,
        primaryCatalogNameId: miCatalogNameId,
        primaryCatalogVendorId: miVendorId,
      },
    });
    const { id } = await createIssue(userId, collectionId, area.id, {
      name: "Switch primary",
      catalogNumbers: [
        { catalogVendorId: miVendorId, firstNumber: "900" },
        { catalogVendorId: scVendorId, firstNumber: "12" },
      ],
    });
    assert.equal(await keyOf(id), "0000000900"); // Michel leads

    // Repoint the area's leading vendor to Scott → the key should follow to Scott's number.
    await updateCollectionArea(userId, area.id, {
      name: area.name,
      primaryCatalogNameId: scCatalogName.id,
      primaryCatalogVendorId: scVendorId,
    });
    assert.equal(await keyOf(id), "0000000012");
  });

  // The fault this key was reshaped for: Michel's Porto, block and Dienst families are written with
  // a letter prefix, and a leading-digits integer sent every one of them to the number-less bucket
  // at the end of the list, ordered by name — "P15" read before "P1—14".
  it("orders each prefix family as its own block after the basic numbering", async () => {
    const ts = Date.now();
    const area = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: `Families ${ts}`,
        primaryCatalogNameId: miCatalogNameId,
        primaryCatalogVendorId: miVendorId,
      },
    });
    // Created out of catalog order, and with the prefixed ones interleaved.
    for (const n of ["P15", "Bl 3", "200", "P1", "15", "Bl 20"]) {
      await createIssue(userId, collectionId, area.id, {
        name: `Issue ${n}`,
        catalogNumbers: [{ catalogVendorId: miVendorId, firstNumber: n }],
      });
    }
    const page = await listIssuesPaginated(userId, collectionId, {
      areaIds: [area.id],
      sortBy: "catalogNumber",
      sortDir: "asc",
    });
    assert.deepEqual(
      page.items.map((i) => i.catalogNumbers[0]?.firstNumber),
      ["15", "200", "Bl 3", "Bl 20", "P1", "P15"]
    );
  });

  // The sort key follows the **vendor**, so swapping which volume prices the area moves nothing
  // about how its stamps sort (#675). Observed by leaving a deliberately wrong key in place: a
  // recompute would correct it, and the point is that this edit does not run one.
  it("does not recompute when only the area's primary book changes", async () => {
    const ts = Date.now();
    const otherMichelBook = await prisma.catalogName.create({
      data: { vendorId: miVendorId, name: `Michel Spezial ${ts}`, currency: "EUR" },
    });
    const area = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: `Book only ${ts}`,
        primaryCatalogNameId: miCatalogNameId,
        primaryCatalogVendorId: miVendorId,
      },
    });
    const { id } = await createIssue(userId, collectionId, area.id, {
      name: "Book only",
      catalogNumbers: [{ catalogVendorId: miVendorId, firstNumber: "700" }],
    });
    assert.equal(await keyOf(id), "0000000700");

    await prisma.issue.update({
      where: { id },
      data: { primaryCatalogSortKey: "stale" },
    });
    await updateCollectionArea(userId, area.id, {
      name: area.name,
      primaryCatalogNameId: otherMichelBook.id,
      primaryCatalogVendorId: miVendorId,
    });
    assert.equal(await keyOf(id), "stale");

    // …and the vendor edit that *does* affect it still recomputes the subtree.
    await updateCollectionArea(userId, area.id, {
      name: area.name,
      primaryCatalogNameId: otherMichelBook.id,
      primaryCatalogVendorId: scVendorId,
    });
    assert.equal(await keyOf(id), "0000000700");
  });
});
