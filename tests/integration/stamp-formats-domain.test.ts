import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createStampFormat,
  deleteStampFormat,
  getStampFormats,
  reorderStampFormats,
  seedDefaultFormats,
  updateStampFormat,
  FormatInUseError,
  DEFAULT_FORMATS,
} from "../../src/lib/stamp-formats";
import {
  createFormatFactor,
  deleteFormatFactor,
  getFormatFactorRows,
  getCollectionFormatFactors,
  getFormatFactorsForScope,
  updateFormatFactor,
  DuplicateFormatFactorError,
} from "../../src/lib/format-factors";
import { resolveFormatFactor } from "../../src/lib/format-factor";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-formats-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-formats-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: {
      slug: `col-formats-${suffix}`,
      name: `Collection ${suffix}`,
      baseCurrency: "EUR",
      ownerId,
    },
  });
}

describe("stamp format dictionary", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    const user = await createTestUser(`dict-${ts}`);
    userId = user.id;
    const collection = await createTestCollection(userId, `dict-${ts}`);
    collectionId = collection.id;
    await seedDefaultFormats(collectionId, prisma as never);
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("seeds the default formats in display order", async () => {
    const formats = await getStampFormats(userId, collectionId);
    assert.deepEqual(
      formats.map((f) => f.name),
      DEFAULT_FORMATS.map((f) => f.name)
    );
  });

  it("seeds no 'single' row — a null format is what a single copy is", async () => {
    const formats = await getStampFormats(userId, collectionId);
    assert.equal(
      formats.some((f) => /single/i.test(f.name)),
      false
    );
  });

  it("creates, renames and reorders", async () => {
    await createStampFormat(userId, collectionId, {
      name: "Block of 6",
      abbreviation: "Blk6",
    });
    let formats = await getStampFormats(userId, collectionId);
    const added = formats.find((f) => f.abbreviation === "Blk6");
    assert.ok(added);
    assert.equal(added.sortOrder, formats.length - 1, "a new format is appended");

    await updateStampFormat(userId, added.id, { name: "Block of six", abbreviation: "B6" });
    formats = await getStampFormats(userId, collectionId);
    assert.equal(formats.find((f) => f.id === added.id)?.name, "Block of six");

    const reversed = formats.map((f) => f.id).reverse();
    await reorderStampFormats(userId, collectionId, reversed);
    formats = await getStampFormats(userId, collectionId);
    assert.deepEqual(formats.map((f) => f.id), reversed);

    await deleteStampFormat(userId, added.id);
    formats = await getStampFormats(userId, collectionId);
    assert.equal(formats.some((f) => f.id === added.id), false);
  });

  it("refuses to delete a format a copy is recorded in", async () => {
    const format = await prisma.stampFormat.create({
      data: { collectionId, name: "Pair (in use)", abbreviation: "PU", sortOrder: 99 },
    });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Mint", abbreviation: "M", sortOrder: 0 },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId } });
    const item = await prisma.item.create({
      data: {
        collectionId,
        itemNo: 1,
        stampId: stamp.id,
        conditionId: condition.id,
        formatId: format.id,
      },
    });

    await assert.rejects(
      () => deleteStampFormat(userId, format.id),
      (err: unknown) => err instanceof FormatInUseError
    );

    await prisma.item.delete({ where: { id: item.id } });
    await deleteStampFormat(userId, format.id);
    await prisma.stamp.delete({ where: { id: stamp.id } });
    await prisma.stampCondition.delete({ where: { id: condition.id } });
  });
});

describe("format multipliers", () => {
  let userId: string;
  let collectionId: string;
  let formatId: string;
  let conditionId: string;
  let parentAreaId: string;
  let childAreaId: string;
  let issueId: string;

  before(async () => {
    const ts = Date.now();
    const user = await createTestUser(`fac-${ts}`);
    userId = user.id;
    const collection = await createTestCollection(userId, `fac-${ts}`);
    collectionId = collection.id;

    formatId = (
      await prisma.stampFormat.create({
        data: { collectionId, name: "Block of 4", abbreviation: "Blk4", sortOrder: 0 },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    parentAreaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "German Reich" } })
    ).id;
    childAreaId = (
      await prisma.collectionArea.create({
        data: { collectionId, name: "Infla", parentId: parentAreaId },
      })
    ).id;
    issueId = (
      await prisma.issue.create({
        data: { collectionId, collectionAreaId: childAreaId, name: "Infla", year: 1923 },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("stores the all-anchors-null row as the collection default", async () => {
    await createFormatFactor(userId, collectionId, {
      formatId,
      factor: 4.5,
      collectionAreaId: null,
      issueId: null,
      conditionId: null,
    });
    const rows = await getCollectionFormatFactors(userId, collectionId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].factor, 4.5);
    assert.equal(rows[0].areaName, null);
  });

  it("rejects a second row with the same anchors — NULLS NOT DISTINCT is doing the work", async () => {
    // Without the raw unique index Postgres treats each all-null anchor set as distinct and this
    // insert would silently succeed, giving the collection two conflicting defaults.
    await assert.rejects(
      () =>
        createFormatFactor(userId, collectionId, {
          formatId,
          factor: 5,
          collectionAreaId: null,
          issueId: null,
          conditionId: null,
        }),
      (err: unknown) => err instanceof DuplicateFormatFactorError
    );
  });

  it("allows rows that differ only by an anchor", async () => {
    await createFormatFactor(userId, collectionId, {
      formatId,
      factor: 6,
      collectionAreaId: parentAreaId,
      issueId: null,
      conditionId: null,
    });
    await createFormatFactor(userId, collectionId, {
      formatId,
      factor: 9,
      collectionAreaId: null,
      issueId,
      conditionId,
    });
    const rows = await getCollectionFormatFactors(userId, collectionId);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.factor).sort((a, b) => a - b),
      [4.5, 6]
    );
  });

  it("keeps issue-anchored rows out of the collection list and in their own scope", async () => {
    // There can be one per issue per format, so a collection-wide list would run to thousands of
    // rows nobody reads. Settings never loads them; the issue's own row is the editor.
    const collectionWide = await getCollectionFormatFactors(userId, collectionId);
    assert.equal(collectionWide.some((r) => r.issueId !== null), false);

    const onIssue = await getFormatFactorsForScope(userId, collectionId, {
      kind: "issue",
      id: issueId,
    });
    assert.equal(onIssue.length, 1);
    assert.equal(onIssue[0].factor, 9);
    assert.equal(onIssue[0].issueName, "Infla (1923)");
  });

  it("scopes an area's list to what is set on that area alone", async () => {
    // Not what would *apply* here through inheritance: this is an editor for the area's own rules,
    // and listing a parent's would invite editing it from a child.
    const onParent = await getFormatFactorsForScope(userId, collectionId, {
      kind: "area",
      id: parentAreaId,
    });
    assert.equal(onParent.length, 1);
    assert.equal(onParent[0].factor, 6);

    const onChild = await getFormatFactorsForScope(userId, collectionId, {
      kind: "area",
      id: childAreaId,
    });
    assert.equal(onChild.length, 0);
  });

  it("resolves a stored set the way the precedence order says", async () => {
    const rows = await getFormatFactorRows(collectionId);

    // A stamp in Infla, in that issue, MNH: the issue-anchored row wins over the area one.
    assert.equal(
      resolveFormatFactor(rows, {
        formatId,
        areaPath: [childAreaId, parentAreaId],
        issueId,
        conditionId,
      })?.factor,
      9
    );

    // Same area, a different issue: the area-anchored row applies, inherited from the parent.
    assert.equal(
      resolveFormatFactor(rows, {
        formatId,
        areaPath: [childAreaId, parentAreaId],
        issueId: "some-other-issue",
        conditionId,
      })?.factor,
      6
    );

    // Outside the area entirely: only the collection default is left.
    assert.equal(
      resolveFormatFactor(rows, {
        formatId,
        areaPath: ["unrelated-area"],
        issueId: null,
        conditionId,
      })?.factor,
      4.5
    );
  });

  it("updates and deletes a row", async () => {
    const rows = await getCollectionFormatFactors(userId, collectionId);
    const areaRow = rows.find((r) => r.collectionAreaId === parentAreaId);
    assert.ok(areaRow);

    await updateFormatFactor(userId, areaRow.id, {
      formatId,
      factor: 7.25,
      collectionAreaId: parentAreaId,
      issueId: null,
      conditionId: null,
    });
    assert.equal(
      (await getCollectionFormatFactors(userId, collectionId)).find((r) => r.id === areaRow.id)?.factor,
      7.25
    );

    await deleteFormatFactor(userId, areaRow.id);
    assert.equal(
      (await getCollectionFormatFactors(userId, collectionId)).some((r) => r.id === areaRow.id),
      false
    );
  });

  it("drops a format's multipliers with the format, but never a copy's", async () => {
    // A factor is a rule *about* a format and means nothing once it is gone, so it cascades —
    // unlike a price or a copy, which block the delete instead.
    await prisma.stampFormat.delete({ where: { id: formatId } });
    assert.equal((await getCollectionFormatFactors(userId, collectionId)).length, 0);
    assert.equal(
      (await getFormatFactorsForScope(userId, collectionId, { kind: "issue", id: issueId })).length,
      0
    );
  });
});

describe("format on catalog prices", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    const user = await createTestUser(`price-${ts}`);
    userId = user.id;
    const collection = await createTestCollection(userId, `price-${ts}`);
    collectionId = collection.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("lets one stamp carry a single and a block price at the same condition", async () => {
    // The whole point of the format column: before it, these two rows collided on the
    // (stamp, edition, condition, certificate) unique index and only one could exist.
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Deutschland Spezial", currency: "EUR" },
    });
    const edition = await prisma.catalogEdition.create({
      data: { catalogNameId: catalogName.id, year: 2026 },
    });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
    });
    const format = await prisma.stampFormat.create({
      data: { collectionId, name: "Block of 4", abbreviation: "Blk4", sortOrder: 0 },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId } });

    await prisma.stampCatalogPrice.createMany({
      data: [
        {
          stampId: stamp.id,
          catalogEditionId: edition.id,
          conditionId: condition.id,
          certificateStatusId: null,
          formatId: null,
          price: "20.00",
          currency: "EUR",
        },
        {
          stampId: stamp.id,
          catalogEditionId: edition.id,
          conditionId: condition.id,
          certificateStatusId: null,
          formatId: format.id,
          price: "95.00",
          currency: "EUR",
        },
      ],
    });

    const prices = await prisma.stampCatalogPrice.findMany({
      where: { stampId: stamp.id },
      select: { formatId: true, price: true },
    });
    assert.equal(prices.length, 2);
    assert.equal(prices.find((p) => p.formatId === null)?.price.toString(), "20");
    assert.equal(prices.find((p) => p.formatId === format.id)?.price.toString(), "95");
  });
});
