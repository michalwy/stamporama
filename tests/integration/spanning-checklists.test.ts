import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  addStampsToSpanningChecklist,
  createChecklist,
  getChecklist,
  getChecklistUsage,
  reorderChecklists,
} from "../../src/lib/checklists";
import { getSpanningChecklistOverview } from "../../src/lib/spanning-checklists";
import { createItem } from "../../src/lib/items";
import { createAlbum, addAlbumEntry } from "../../src/lib/albums";
import { createWantsForIssue, previewIssueMissingWants } from "../../src/lib/wants";

// Checklists that span issues (#1416).
//
// What is pinned: that stamps join one from several issues **after** what is on it and never twice;
// that an issue's own checklist cannot be filled through this door; that the screen's figures are an
// issue checklist's — completeness counted from held copies, value read per stamp through **its own
// area's** leading catalogue, and stated in the base currency when those catalogues disagree on one;
// that deleting names the albums using it; and that the want-list gap runs on it.

const ts = Date.now();

describe("checklists spanning issues (#1416)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let plIssueId: string;
  let deIssueId: string;
  /** Two stamps of a Polish issue (Michel, EUR) and one of a German issue (Fischer, PLN). */
  let a: string, b: string, c: string;
  let spanningId: string;
  let issueChecklistId: string;
  let plAreaId: string;

  before(async () => {
    userId = `test-user-span-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User span-${ts}`,
        email: `test-span-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-span-${ts}`, name: "Span", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    await prisma.exchangeRate.createMany({
      data: [
        ["EUR", "1"],
        ["PLN", "4"],
      ].map(([toCurrency, rate]) => ({
        collectionId,
        fromCurrency: "EUR",
        toCurrency,
        rate,
        fetchedAt: new Date(),
      })),
    });
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;

    const area = async (name: string, vendorName: string, abbr: string, currency: string) => {
      const vendor = await prisma.catalogVendor.create({
        data: { collectionId, name: vendorName, abbreviation: abbr },
      });
      const catalog = await prisma.catalogName.create({
        data: { vendorId: vendor.id, name: `${vendorName} ${name}`, currency },
      });
      const edition = await prisma.catalogEdition.create({
        data: { catalogNameId: catalog.id, year: 2024 },
      });
      const areaId = (
        await prisma.collectionArea.create({
          data: {
            collectionId,
            name,
            primaryCatalogNameId: catalog.id,
            collectionAreaCatalogs: { create: [{ catalogNameId: catalog.id }] },
          },
        })
      ).id;
      return { vendorId: vendor.id, editionId: edition.id, areaId, currency };
    };
    const pl = await area("Poland", "Michel", "Mi", "EUR");
    const de = await area("Germany", "Fischer", "Fi", "PLN");
    plAreaId = pl.areaId;

    plIssueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 91416, collectionAreaId: pl.areaId, name: "Grosik", year: 1928 },
      })
    ).id;
    deIssueId = (
      await prisma.issue.create({
        data: { collectionId, issueNo: 91417, collectionAreaId: de.areaId, name: "Birds", year: 1930 },
      })
    ).id;

    const stamp = async (
      where: typeof pl,
      issueId: string,
      number: string,
      price: string | null
    ): Promise<string> => {
      const id = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: number,
            catalogNumbers: { create: [{ catalogVendorId: where.vendorId, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: where.areaId, isPrimary: true }] },
          },
        })
      ).id;
      await prisma.issueMember.create({ data: { issueId, stampId: id, sortOrder: 0 } });
      if (price) {
        await prisma.stampCatalogPrice.create({
          data: {
            stampId: id,
            catalogEditionId: where.editionId,
            conditionId,
            certificateStatusId: null,
            price,
            currency: where.currency,
          },
        });
      }
      return id;
    };
    a = await stamp(pl, plIssueId, "240", "10.00");
    b = await stamp(pl, plIssueId, "241", null);
    c = await stamp(de, deIssueId, "12", "20.00");

    issueChecklistId = await createChecklist(userId, collectionId, {
      issueId: plIssueId,
      name: "Grosik",
    });
    spanningId = await createChecklist(userId, collectionId, {
      issueId: null,
      name: "Across",
    });
  });

  after(async () => {
    await prisma.want.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.album.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.exchangeRate.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("takes stamps from several issues, in the order given", async () => {
    assert.equal(await addStampsToSpanningChecklist(userId, spanningId, [c, a]), 2);
    const checklist = await getChecklist(userId, collectionId, spanningId);
    assert.deepEqual(checklist?.stampIds, [c, a]);
  });

  it("appends what joins later and leaves what is already on it where it is", async () => {
    assert.equal(await addStampsToSpanningChecklist(userId, spanningId, [a, b]), 1);
    const checklist = await getChecklist(userId, collectionId, spanningId);
    assert.deepEqual(checklist?.stampIds, [c, a, b]);
  });

  it("refuses an issue's own checklist", async () => {
    await assert.rejects(
      addStampsToSpanningChecklist(userId, issueChecklistId, [c]),
      /from the issue itself/
    );
    assert.equal(await prisma.checklistStamp.count({ where: { checklistId: issueChecklistId } }), 0);
  });

  it("lists only the checklists spanning issues, with the issues they reach", async () => {
    const overview = await getSpanningChecklistOverview(userId, collectionId, false);
    assert.deepEqual(
      overview.map((o) => o.id),
      [spanningId]
    );
    assert.equal(overview[0].issueCount, 2);
    assert.deepEqual(overview[0].stampIds, [c, a, b]);
  });

  it("values each stamp through its own area's catalogue, in the base currency when they differ", async () => {
    const [row] = await getSpanningChecklistOverview(userId, collectionId, false);
    // 10 EUR at 4 PLN/EUR, plus 20 PLN; `b` has no price.
    assert.equal(row.priceTotal?.currency, "PLN");
    assert.equal(row.priceTotal?.amount, "60.00");
    assert.equal(row.priceTotal?.pricedCount, 2);
    assert.equal(row.priceTotal?.requiredCount, 3);
  });

  it("counts completeness from held copies, as an issue's checklist does", async () => {
    await createItem(userId, collectionId, {
      stampId: c,
      conditionId,
      inCollection: true,
      deliveryState: "delivered",
    });
    const [row] = await getSpanningChecklistOverview(userId, collectionId, false);
    assert.equal(row.completeness.owned, 1);
    assert.equal(row.completeness.completeSets, 0);
  });

  it("wants what it is missing, and only that", async () => {
    const gaps = await previewIssueMissingWants(userId, collectionId, null);
    const gap = gaps.find((g) => g.checklistId === spanningId);
    assert.deepEqual(new Set(gap?.missingStampIds), new Set([a, b]));
    const result = await createWantsForIssue(userId, collectionId, null, [spanningId]);
    assert.equal(result.created, 2);
    // An issue's checklist is not reachable through the spanning door.
    await assert.rejects(createWantsForIssue(userId, collectionId, null, [issueChecklistId]));
  });

  it("names the albums a delete would take it out of", async () => {
    const albumId = await createAlbum(
      userId,
      collectionId,
      { name: "Binder", collectionAreaId: plAreaId, language: "en" },
      null
    );
    await addAlbumEntry(userId, albumId, spanningId);
    assert.deepEqual(await getChecklistUsage(userId, spanningId), {
      albums: [{ id: albumId, name: "Binder" }],
    });
    const [row] = await getSpanningChecklistOverview(userId, collectionId, false);
    assert.deepEqual(row.albums, [{ id: albumId, name: "Binder" }]);
  });

  it("orders the checklists spanning issues among themselves", async () => {
    const second = await createChecklist(userId, collectionId, { issueId: null, name: "Second" });
    await reorderChecklists(userId, collectionId, null, [second, spanningId, issueChecklistId]);
    const overview = await getSpanningChecklistOverview(userId, collectionId, false);
    assert.deepEqual(
      overview.map((o) => o.id),
      [second, spanningId]
    );
    // The issue's own checklist was named but is not among them, so it kept its place.
    const own = await prisma.checklist.findUnique({ where: { id: issueChecklistId } });
    assert.equal(own?.sortOrder, 0);
  });
});
