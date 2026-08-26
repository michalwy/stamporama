import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  listWantsPaginated,
  listWantIssueGroups,
  listWantYearFacets,
  getWant,
  createWant,
  updateWant,
  narrowWant,
  closeWant,
  reopenWant,
  deleteWant,
  findWantsSatisfiedBy,
  createWantsForMissing,
  createWantsForIssue,
  previewIssueMissingWants,
  loadStampWantSummaries,
  loadItemWantSummaries,
  type WantInput,
} from "../../src/lib/wants";
import { createItem } from "../../src/lib/items";
import {
  intakeStamps,
  markPurchaseArrived,
  bulkUpdateLotItemsScoped,
} from "../../src/lib/lots";
import { createPurchase } from "../../src/lib/purchases";
import { narrowConditionSeed, wantMatchesCopy } from "../../src/lib/want-rules";
import { NO_ISSUE } from "../../src/lib/issue-groups";

async function seedFixtures(suffix: string) {
  const user = await prisma.user.create({
    data: {
      id: `test-user-want-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-want-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const collection = await prisma.collection.create({
    data: { slug: `col-want-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId: user.id },
  });
  const collectionId = collection.id;
  const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp 309" } });
  const otherStamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp 310" } });
  const used = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
  });
  const mnh = await prisma.stampCondition.create({
    data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 1 },
  });
  const mh = await prisma.stampCondition.create({
    data: { collectionId, name: "Mint Hinged", abbreviation: "MH", sortOrder: 2 },
  });
  const cert = await prisma.certificateStatus.create({
    data: { collectionId, name: "Photo certificate", abbreviation: "Fot", sortOrder: 0 },
  });
  const block4 = await prisma.stampFormat.create({
    data: { collectionId, name: "Block of 4", abbreviation: "B4", sortOrder: 0 },
  });
  return { userId: user.id, collectionId, stamp, otherStamp, used, mnh, mh, cert, block4 };
}

type Fixtures = Awaited<ReturnType<typeof seedFixtures>>;

/** The whole list, as one page — what most of these tests mean by "the list". Pagination itself is
 *  covered by its own describe below. */
async function listWants(userId: string, collectionId: string) {
  const { items } = await listWantsPaginated(userId, collectionId, { pageSize: 500 });
  return items;
}

async function cleanup(userId: string) {
  await prisma.collection.deleteMany({ where: { ownerId: userId } });
  await prisma.user.delete({ where: { id: userId } });
}

const want = (f: Fixtures, over: Partial<WantInput> = {}): WantInput => ({
  stampId: f.stamp.id,
  conditionIds: [],
  certificateStatusIds: [],
  formatIds: [],
  priority: "normal",
  notes: null,
  ...over,
});

describe("createWant / getWant", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures(`create-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("a want with no acceptance rows at all is 'anything will do', and is open", async () => {
    const { ids: [id] } = await createWant(f.userId, f.collectionId, want(f));
    const row = await getWant(f.userId, id);
    assert.deepEqual(row.conditionIds, []);
    assert.deepEqual(row.certificateStatusIds, []);
    assert.deepEqual(row.formatIds, []);
    assert.equal(row.closedAt, null);
    assert.equal(row.priority, "normal");
  });

  it("stores a condition set and a priority", async () => {
    const { ids: [id] } = await createWant(
      f.userId,
      f.collectionId,
      want(f, {
        conditionIds: [f.mnh.id, f.mh.id],
        priority: "high",
        notes: "  only from a dealer  ",
      })
    );
    const row = await getWant(f.userId, id);
    assert.deepEqual([...row.conditionIds].sort(), [f.mh.id, f.mnh.id].sort());
    assert.equal(row.priority, "high");
    assert.equal(row.notes, "only from a dealer");
  });

  it("keeps the null member of the certificate set apart from an empty set", async () => {
    const noCert = await createWant(
      f.userId,
      f.collectionId,
      want(f, { certificateStatusIds: [null] })
    );
    const dontCare = await createWant(f.userId, f.collectionId, want(f));
    assert.deepEqual((await getWant(f.userId, noCert.ids[0])).certificateStatusIds, [null]);
    assert.deepEqual((await getWant(f.userId, dontCare.ids[0])).certificateStatusIds, []);
  });

  it("keeps the null member of the format set — 'only singles' is not 'any format'", async () => {
    const singles = await createWant(f.userId, f.collectionId, want(f, { formatIds: [null] }));
    const blocks = await createWant(f.userId, f.collectionId, want(f, { formatIds: [f.block4.id] }));
    assert.deepEqual((await getWant(f.userId, singles.ids[0])).formatIds, [null]);
    assert.deepEqual((await getWant(f.userId, blocks.ids[0])).formatIds, [f.block4.id]);
  });

  it("collapses a repeated member rather than tripping the NULLS NOT DISTINCT index", async () => {
    const { ids: [id] } = await createWant(
      f.userId,
      f.collectionId,
      want(f, { certificateStatusIds: [null, null], formatIds: [f.block4.id, f.block4.id] })
    );
    const row = await getWant(f.userId, id);
    assert.deepEqual(row.certificateStatusIds, [null]);
    assert.deepEqual(row.formatIds, [f.block4.id]);
  });

  it("refuses a stamp or a condition that is not this collection's", async () => {
    const other = await seedFixtures(`foreign-${Date.now()}`);
    await assert.rejects(
      () => createWant(f.userId, f.collectionId, want(f, { stampId: other.stamp.id })),
      /Stamp not found/
    );
    await assert.rejects(
      () => createWant(f.userId, f.collectionId, want(f, { conditionIds: [other.used.id] })),
      /condition is not in this collection/
    );
    await cleanup(other.userId);
  });

  it("refuses a collection that is not the caller's", async () => {
    const other = await seedFixtures(`owner-${Date.now()}`);
    await assert.rejects(
      () => createWant(f.userId, other.collectionId, want(other)),
      /access denied/
    );
    await cleanup(other.userId);
  });
});

describe("createWant over a whole checklist", () => {
  let f: Fixtures;
  let checklistId: string;
  before(async () => {
    f = await seedFixtures(`set-${Date.now()}`);
    const checklist = await prisma.checklist.create({
      data: {
        collectionId: f.collectionId,
        name: "Basic set",
        stamps: { create: [{ stampId: f.stamp.id }, { stampId: f.otherStamp.id }] },
      },
    });
    checklistId = checklist.id;
  });
  after(() => cleanup(f.userId));

  it("creates one want per stamp, all on the same terms", async () => {
    const result = await createWant(f.userId, f.collectionId, {
      checklistId,
      conditionIds: [f.mnh.id],
      certificateStatusIds: [null],
      formatIds: [],
      priority: "high",
      notes: "from the 1928 series",
    });
    assert.deepEqual({ created: result.created, skipped: result.skipped }, { created: 2, skipped: 0 });

    const rows = await listWants(f.userId, f.collectionId);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.stampId).sort(),
      [f.stamp.id, f.otherStamp.id].sort()
    );
    for (const row of rows) {
      assert.deepEqual(row.conditionIds, [f.mnh.id]);
      // The `null` member survives the fan-out — "only without a certificate", not "any".
      assert.deepEqual(row.certificateStatusIds, [null]);
      assert.deepEqual(row.formatIds, []);
      assert.equal(row.priority, "high");
      assert.equal(row.notes, "from the 1928 series");
      assert.equal(row.closedAt, null);
    }
  });

  it("passes over a stamp that already has an open want, and says how many", async () => {
    const result = await createWant(f.userId, f.collectionId, { ...want(f), checklistId, stampId: null });
    assert.deepEqual({ created: result.created, skipped: result.skipped }, { created: 0, skipped: 2 });
    assert.equal((await listWants(f.userId, f.collectionId)).length, 2);
  });

  it("a closed want is not a reason to pass over — the stamp is wanted again", async () => {
    const [first] = await listWants(f.userId, f.collectionId);
    await closeWant(f.userId, first.id);
    const result = await createWant(f.userId, f.collectionId, { ...want(f), checklistId, stampId: null });
    assert.deepEqual({ created: result.created, skipped: result.skipped }, { created: 1, skipped: 1 });
  });

  it("does not pass over a stamp merely because a copy is held — this is not the gap generator", async () => {
    const other = await seedFixtures(`set-held-${Date.now()}`);
    const checklist = await prisma.checklist.create({
      data: {
        collectionId: other.collectionId,
        name: "Set",
        stamps: { create: [{ stampId: other.stamp.id }, { stampId: other.otherStamp.id }] },
      },
    });
    await createItem(other.userId, other.collectionId, {
      stampId: other.stamp.id,
      conditionId: other.used.id,
    });

    const result = await createWant(other.userId, other.collectionId, {
      ...want(other),
      checklistId: checklist.id,
      stampId: null,
      conditionIds: [other.mnh.id],
    });
    // Both wanted: an upgrade on the copy already held is the ordinary case.
    assert.deepEqual({ created: result.created, skipped: result.skipped }, { created: 2, skipped: 0 });
    await cleanup(other.userId);
  });

  it("refuses a checklist that is empty or not this collection's", async () => {
    const empty = await prisma.checklist.create({
      data: { collectionId: f.collectionId, name: "Empty" },
    });
    await assert.rejects(
      () => createWant(f.userId, f.collectionId, { ...want(f), checklistId: empty.id, stampId: null }),
      /has no stamps on it yet/
    );
    await assert.rejects(
      () => createWant(f.userId, f.collectionId, { ...want(f), stampId: null }),
      /Select a stamp or a whole set/
    );
  });
});

describe("updateWant / narrowWant", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures(`update-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("replaces each acceptance set whole — the form owns all three", async () => {
    const { ids: [id] } = await createWant(
      f.userId,
      f.collectionId,
      want(f, { conditionIds: [f.used.id], formatIds: [f.block4.id] })
    );
    await updateWant(
      f.userId,
      id,
      want(f, { conditionIds: [f.mnh.id], certificateStatusIds: [f.cert.id], formatIds: [] })
    );
    const row = await getWant(f.userId, id);
    assert.deepEqual(row.conditionIds, [f.mnh.id]);
    assert.deepEqual(row.certificateStatusIds, [f.cert.id]);
    assert.deepEqual(row.formatIds, []);
  });

  it("narrowWant changes the acceptance and nothing else", async () => {
    const { ids: [id] } = await createWant(
      f.userId,
      f.collectionId,
      want(f, { priority: "high", notes: "keep me" })
    );
    await narrowWant(f.userId, id, {
      conditionIds: [f.mnh.id, f.mh.id],
      certificateStatusIds: [],
      formatIds: [],
    });
    const row = await getWant(f.userId, id);
    assert.deepEqual([...row.conditionIds].sort(), [f.mh.id, f.mnh.id].sort());
    assert.equal(row.priority, "high");
    assert.equal(row.notes, "keep me");
    assert.equal(row.stampId, f.stamp.id);
    assert.equal(row.closedAt, null);
  });
});

describe("closeWant / reopenWant / deleteWant", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures(`close-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("closing is idempotent and keeps the first moment", async () => {
    const { ids: [id] } = await createWant(f.userId, f.collectionId, want(f));
    await closeWant(f.userId, id);
    const first = (await getWant(f.userId, id)).closedAt;
    assert.notEqual(first, null);
    await closeWant(f.userId, id);
    assert.equal((await getWant(f.userId, id)).closedAt, first);
  });

  it("reopening clears the moment, and deleting takes the acceptance rows with it", async () => {
    const { ids: [id] } = await createWant(
      f.userId,
      f.collectionId,
      want(f, { conditionIds: [f.mnh.id], formatIds: [null] })
    );
    await closeWant(f.userId, id);
    await reopenWant(f.userId, id);
    assert.equal((await getWant(f.userId, id)).closedAt, null);

    await deleteWant(f.userId, id);
    assert.equal(await prisma.want.findUnique({ where: { id } }), null);
    assert.equal(await prisma.wantCondition.count({ where: { wantId: id } }), 0);
    assert.equal(await prisma.wantFormat.count({ where: { wantId: id } }), 0);
  });
});

describe("listWants", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures(`list-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("puts open wants before closed ones, and high priority first", async () => {
    const low = await createWant(f.userId, f.collectionId, want(f, { priority: "low" }));
    const high = await createWant(f.userId, f.collectionId, want(f, { priority: "high" }));
    const closed = await createWant(f.userId, f.collectionId, want(f, { priority: "high" }));
    await closeWant(f.userId, closed.ids[0]);

    const rows = await listWants(f.userId, f.collectionId);
    assert.deepEqual(
      rows.map((r) => r.id),
      [high.ids[0], low.ids[0], closed.ids[0]]
    );
  });

  it("carries the wanted stamp's catalog photos, front before back before extras", async () => {
    const other = await seedFixtures(`photos-${Date.now()}`);
    await createWant(other.userId, other.collectionId, want(other));
    const photo = (role: string | null, sortOrder: number) => ({
      stampId: other.stamp.id,
      role,
      storageKey: `k-${role ?? "extra"}-${sortOrder}`,
      mime: "image/webp",
      width: 10,
      height: 10,
      sizeBytes: 1,
      sortOrder,
    });
    await prisma.photo.createMany({
      data: [photo(null, 0), photo("back", 0), photo("front", 0)],
    });

    const [row] = await listWants(other.userId, other.collectionId);
    assert.deepEqual(
      row.photos.map((p) => p.role),
      ["front", "back", null]
    );
    await cleanup(other.userId);
  });

  it("splits the wanted stamp's copies by where they are, and closes nothing", async () => {
    const other = await seedFixtures(`held-${Date.now()}`);
    const { ids: [id] } = await createWant(other.userId, other.collectionId, want(other));
    await createItem(other.userId, other.collectionId, {
      stampId: other.stamp.id,
      conditionId: other.used.id,
    });
    const [row] = await listWants(other.userId, other.collectionId);
    assert.equal(row.id, id);
    assert.deepEqual(row.copies, { held: 1, toSort: 0, ordered: 0, inTransit: 0 });
    assert.equal(row.closedAt, null);
    await cleanup(other.userId);
  });
});

describe("listWantsPaginated", () => {
  let f: Fixtures;
  /** Six stamps, so a page size of two leaves something to scroll to. */
  let stampIds: string[];
  before(async () => {
    f = await seedFixtures(`page-${Date.now()}`);
    stampIds = [];
    for (let i = 0; i < 6; i++) {
      const stamp = await prisma.stamp.create({
        data: { collectionId: f.collectionId, name: `Paged ${i}`, issuedYear: 1920 + (i % 2) },
      });
      stampIds.push(stamp.id);
      await createWant(f.userId, f.collectionId, want(f, { stampId: stamp.id }));
    }
  });
  after(() => cleanup(f.userId));

  it("walks the whole list in pages, each row exactly once", async () => {
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page: Awaited<ReturnType<typeof listWantsPaginated>> = await listWantsPaginated(
        f.userId,
        f.collectionId,
        { pageSize: 2, offset }
      );
      assert.ok(page.items.length <= 2);
      seen.push(...page.items.map((i) => i.id));
      offset = page.nextCursor === null ? null : Number(page.nextCursor);
    }
    assert.equal(seen.length, 6);
    assert.equal(new Set(seen).size, 6, "a row appeared on two pages");
  });

  it("ends the walk rather than offering a page that is not there", async () => {
    const last = await listWantsPaginated(f.userId, f.collectionId, { pageSize: 6 });
    assert.equal(last.items.length, 6);
    assert.equal(last.nextCursor, null);
  });

  it("orders open before closed, then by urgency, and holds that order across pages", async () => {
    await closeWant(f.userId, (await listWants(f.userId, f.collectionId))[0].id);
    const raised = (await listWants(f.userId, f.collectionId)).filter((w) => !w.closedAt)[2];
    await updateWant(f.userId, raised.id, want(f, { stampId: raised.stampId, priority: "high" }));

    const all: string[] = [];
    for (let offset = 0; offset < 6; offset += 2) {
      const page = await listWantsPaginated(f.userId, f.collectionId, { pageSize: 2, offset });
      all.push(...page.items.map((i) => i.id));
    }
    const rows = await listWants(f.userId, f.collectionId);
    assert.deepEqual(all, rows.map((r) => r.id), "paged order differs from the whole-list order");
    assert.equal(rows[0].id, raised.id, "high priority does not lead");
    assert.equal(rows[rows.length - 1].closedAt !== null, true, "a closed want is not last");
  });

  it("narrows by status, priority and free text on the server", async () => {
    const open = await listWantsPaginated(f.userId, f.collectionId, { status: "open" });
    assert.equal(open.items.every((w) => w.closedAt === null), true);
    const closed = await listWantsPaginated(f.userId, f.collectionId, { status: "closed" });
    assert.equal(closed.items.every((w) => w.closedAt !== null), true);
    assert.equal(open.items.length + closed.items.length, 6);

    const high = await listWantsPaginated(f.userId, f.collectionId, { priorities: ["high"] });
    assert.equal(high.items.length, 1);

    const search = await listWantsPaginated(f.userId, f.collectionId, { search: "Paged 3" });
    assert.deepEqual(
      search.items.map((w) => w.stampName),
      ["Paged 3"]
    );
  });

  it("a condition filter keeps the wants that would take anything, empty set and all", async () => {
    const other = await seedFixtures(`cond-filter-${Date.now()}`);
    await createWant(other.userId, other.collectionId, want(other)); // anything
    await createWant(other.userId, other.collectionId, {
      ...want(other),
      stampId: other.otherStamp.id,
      conditionIds: [other.mnh.id],
    });

    const used = await listWantsPaginated(other.userId, other.collectionId, {
      conditionIds: [other.used.id],
    });
    // Only the "anything" want takes a used copy — the mint-only one does not.
    assert.equal(used.items.length, 1);
    assert.deepEqual(used.items[0].conditionIds, []);

    const mnh = await listWantsPaginated(other.userId, other.collectionId, {
      conditionIds: [other.mnh.id],
    });
    assert.equal(mnh.items.length, 2);
    await cleanup(other.userId);
  });

  it("narrows to one stamp — what the stamp page's Wants card reads", async () => {
    const other = await seedFixtures(`stamp-filter-${Date.now()}`);
    await createWant(other.userId, other.collectionId, want(other));
    await createWant(other.userId, other.collectionId, {
      ...want(other),
      stampId: other.otherStamp.id,
    });

    const mine = await listWantsPaginated(other.userId, other.collectionId, {
      stampId: other.stamp.id,
      status: "all",
    });
    assert.deepEqual(
      mine.items.map((w) => w.stampId),
      [other.stamp.id]
    );
    await cleanup(other.userId);
  });

  it("narrows by the wanted stamp's area and year", async () => {
    const byYear = await listWantsPaginated(f.userId, f.collectionId, { year: "1921" });
    assert.equal(byYear.items.length, 3);
    assert.equal(byYear.items.every((w) => w.issuedYear === 1921), true);

    // The fixture's own two stamps carry no year at all.
    const other = await seedFixtures(`area-year-${Date.now()}`);
    await createWant(other.userId, other.collectionId, want(other));
    const noYear = await listWantsPaginated(other.userId, other.collectionId, { year: "none" });
    assert.equal(noYear.items.length, 1);

    const area = await prisma.collectionArea.create({
      data: { collectionId: other.collectionId, name: "Poland" },
    });
    const outside = await listWantsPaginated(other.userId, other.collectionId, {
      areaIds: [area.id],
    });
    // A stamp linked to no area is outside every area's scope rather than inside all of them.
    assert.equal(outside.items.length, 0);

    await prisma.stampCollectionArea.create({
      data: { stampId: other.stamp.id, collectionAreaId: area.id, isPrimary: true },
    });
    const inside = await listWantsPaginated(other.userId, other.collectionId, {
      areaIds: [area.id],
    });
    assert.equal(inside.items.length, 1);
    await cleanup(other.userId);
  });
});

describe("the catalogue range on a want row", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures(`range-${Date.now()}`);
    const area = await prisma.collectionArea.create({
      data: { collectionId: f.collectionId, name: "Poland" },
    });
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId: f.collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Europa", currency: "EUR" },
    });
    const edition = await prisma.catalogEdition.create({
      data: { catalogNameId: catalogName.id, year: 2024 },
    });
    await prisma.collectionArea.update({
      where: { id: area.id },
      data: { primaryCatalogNameId: catalogName.id },
    });
    await prisma.collectionAreaCatalog.create({
      data: { collectionAreaId: area.id, catalogNameId: catalogName.id },
    });
    await prisma.stampCollectionArea.create({
      data: { stampId: f.stamp.id, collectionAreaId: area.id, isPrimary: true },
    });
    // Used 1.50, MNH 40.00 — both singles, no certificate.
    for (const [conditionId, price] of [
      [f.used.id, "1.50"],
      [f.mnh.id, "40.00"],
    ] as const) {
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: f.stamp.id,
          catalogEditionId: edition.id,
          conditionId,
          price,
          currency: "EUR",
        },
      });
    }
  });
  after(() => cleanup(f.userId));

  it("ranges over what the want accepts, and narrows when the want does", async () => {
    const anything = await createWant(f.userId, f.collectionId, want(f));
    const [wide] = await listWants(f.userId, f.collectionId);
    assert.equal(wide.catalogRange?.minBase, "1.50");
    assert.equal(wide.catalogRange?.maxBase, "40.00");
    assert.equal(wide.catalogRange?.baseCurrency, "EUR");

    await updateWant(f.userId, anything.ids[0], want(f, { conditionIds: [f.mnh.id] }));
    const [narrow] = await listWants(f.userId, f.collectionId);
    assert.equal(narrow.catalogRange?.minBase, "40.00");
    assert.equal(narrow.catalogRange?.maxBase, "40.00");
  });

  it("is null for a stamp with no catalogue price at all", async () => {
    await createWant(f.userId, f.collectionId, want(f, { stampId: f.otherStamp.id }));
    const rows = await listWants(f.userId, f.collectionId);
    const unpriced = rows.find((w) => w.stampId === f.otherStamp.id)!;
    assert.equal(unpriced.catalogRange, null);
  });

  it("is not computed where the row is not drawn — the intake review carries none", async () => {
    const matches = await findWantsSatisfiedBy(f.userId, f.collectionId, [
      {
        itemId: "item-1",
        itemNo: 1,
        stampId: f.stamp.id,
        conditionId: f.mnh.id,
        certificateStatusId: null,
        formatId: null,
      },
    ]);
    assert.equal(matches.length > 0, true);
    assert.equal(matches[0].want.catalogRange, null);
  });
});

describe("loadStampWantSummaries", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures(`summary-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("reports open wants per stamp, loudest priority first, and skips stamps with none", async () => {
    await createWant(f.userId, f.collectionId, want(f, { priority: "low" }));
    await createWant(
      f.userId,
      f.collectionId,
      want(f, { priority: "high", conditionIds: [f.mnh.id], notes: "key value" })
    );

    const map = await loadStampWantSummaries(f.collectionId, [f.stamp.id, f.otherStamp.id]);
    assert.equal(map.has(f.otherStamp.id), false, "a stamp with no wants is absent, not zero");

    const summary = map.get(f.stamp.id)!;
    assert.equal(summary.openCount, 2);
    // The chip shows the loudest of the wants behind it, not an average.
    assert.equal(summary.topPriority, "high");
    assert.equal(summary.entries[0].priority, "high");
    assert.equal(summary.entries[0].conditions, "MNH");
    assert.equal(summary.entries[0].notes, "key value");
    // An empty axis says "any" out loud rather than coming back blank.
    assert.equal(summary.entries[1].conditions, "Any condition");
    assert.equal(summary.entries[1].certificate, "Certificate: any");
    assert.equal(summary.entries[1].format, "Any format");
  });

  it("splits the stamp's copies so the popover can say one is already on its way", async () => {
    const other = await seedFixtures(`summary-copies-${Date.now()}`);
    await createWant(other.userId, other.collectionId, want(other));
    const purchase = await createPurchase(other.userId, other.collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    const lot = await prisma.purchaseLot.create({
      data: { purchaseId: purchase.id, title: "Lot", price: "10.00", status: "open" },
      select: { id: true },
    });
    // One in hand, one ordered and not yet arrived — the case a single "held" figure hid.
    await createItem(other.userId, other.collectionId, {
      stampId: other.stamp.id,
      conditionId: other.used.id,
    });
    await intakeStamps(other.userId, lot.id, {
      stampId: other.stamp.id,
      conditionId: other.mnh.id,
    });

    const summary = (await loadStampWantSummaries(other.collectionId, [other.stamp.id])).get(
      other.stamp.id
    )!;
    assert.deepEqual(summary.copies, { held: 1, toSort: 0, ordered: 1, inTransit: 0 });

    // The want is untouched by any of it — only the collector closes one.
    const [row] = await listWants(other.userId, other.collectionId);
    assert.equal(row.closedAt, null);
    assert.deepEqual(row.copies, { held: 1, toSort: 0, ordered: 1, inTransit: 0 });
    await cleanup(other.userId);
  });

  it("keeps an arrived-but-unsorted copy in its own bucket, apart from held", async () => {
    const other = await seedFixtures(`summary-tosort-${Date.now()}`);
    await createWant(other.userId, other.collectionId, want(other));
    await createItem(other.userId, other.collectionId, {
      stampId: other.stamp.id,
      conditionId: other.used.id,
      deliveryState: "to_sort",
    });
    const summary = (await loadStampWantSummaries(other.collectionId, [other.stamp.id])).get(
      other.stamp.id
    )!;
    // Arrived, but not yet in the collection — a different answer to "have I got this" than held.
    assert.deepEqual(summary.copies, { held: 0, toSort: 1, ordered: 0, inTransit: 0 });
    await cleanup(other.userId);
  });

  it("counts per want as well as per stamp, and only the per-want figure may claim 'on its way'", async () => {
    const other = await seedFixtures(`summary-per-want-${Date.now()}`);
    // A mint-only want, against a **used** copy already in the post.
    await createWant(other.userId, other.collectionId, {
      ...want(other),
      conditionIds: [other.mnh.id],
    });
    const purchase = await createPurchase(other.userId, other.collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    const lot = await prisma.purchaseLot.create({
      data: { purchaseId: purchase.id, title: "Lot", price: "10.00", status: "open" },
      select: { id: true },
    });
    await intakeStamps(other.userId, lot.id, {
      stampId: other.stamp.id,
      conditionId: other.used.id,
    });

    const summary = (await loadStampWantSummaries(other.collectionId, [other.stamp.id])).get(
      other.stamp.id
    )!;
    // The stamp has one on order…
    assert.deepEqual(summary.copies, { held: 0, toSort: 0, ordered: 1, inTransit: 0 });
    // …but it would not satisfy the mint-only want, so that want has nothing coming. Claiming
    // otherwise is what would send the collector past a mint copy at the next auction.
    assert.deepEqual(summary.entries[0].copies, { held: 0, toSort: 0, ordered: 0, inTransit: 0 });

    const [row] = await listWants(other.userId, other.collectionId);
    assert.deepEqual(row.copies, { held: 0, toSort: 0, ordered: 1, inTransit: 0 });
    assert.deepEqual(row.matchingCopies, { held: 0, toSort: 0, ordered: 0, inTransit: 0 });

    // A mint one on the way *does* count for it.
    await intakeStamps(other.userId, lot.id, {
      stampId: other.stamp.id,
      conditionId: other.mnh.id,
    });
    const [after] = await listWants(other.userId, other.collectionId);
    assert.deepEqual(after.copies, { held: 0, toSort: 0, ordered: 2, inTransit: 0 });
    assert.deepEqual(after.matchingCopies, { held: 0, toSort: 0, ordered: 1, inTransit: 0 });
    await cleanup(other.userId);
  });

  it("leaves the copy it is drawn on out of its own figures", async () => {
    const other = await seedFixtures(`summary-self-${Date.now()}`);
    await createWant(other.userId, other.collectionId, want(other));
    const purchase = await createPurchase(other.userId, other.collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    const lot = await prisma.purchaseLot.create({
      data: { purchaseId: purchase.id, title: "Lot", price: "10.00", status: "open" },
      select: { id: true },
    });
    const [copy] = await intakeStamps(other.userId, lot.id, {
      stampId: other.stamp.id,
      conditionId: other.used.id,
    });

    // Per stamp, that copy is on order.
    const byStamp = (await loadStampWantSummaries(other.collectionId, [other.stamp.id])).get(
      other.stamp.id
    )!;
    assert.deepEqual(byStamp.copies, { held: 0, toSort: 0, ordered: 1, inTransit: 0 });

    // Drawn **on that copy's own row**, it must not report itself as something already coming.
    const byItem = (
      await loadItemWantSummaries(other.collectionId, [
        { itemId: copy.itemId, stampId: other.stamp.id },
      ])
    ).get(copy.itemId)!;
    assert.deepEqual(byItem.copies, { held: 0, toSort: 0, ordered: 0, inTransit: 0 });
    assert.deepEqual(byItem.entries[0].copies, { held: 0, toSort: 0, ordered: 0, inTransit: 0 });

    // A *second* copy of the same stamp is still counted on the first one's row.
    const [other2] = await intakeStamps(other.userId, lot.id, {
      stampId: other.stamp.id,
      conditionId: other.mnh.id,
    });
    const bothRows = await loadItemWantSummaries(other.collectionId, [
      { itemId: copy.itemId, stampId: other.stamp.id },
      { itemId: other2.itemId, stampId: other.stamp.id },
    ]);
    // Each row sees the other copy and not itself — which is why this is keyed per copy.
    assert.deepEqual(bothRows.get(copy.itemId)!.copies, {
      held: 0,
      toSort: 0,
      ordered: 1,
      inTransit: 0,
    });
    assert.deepEqual(bothRows.get(other2.itemId)!.copies, {
      held: 0,
      toSort: 0,
      ordered: 1,
      inTransit: 0,
    });
    await cleanup(other.userId);
  });

  it("leaves closed wants out — the marker is about what is still being chased", async () => {
    const other = await seedFixtures(`summary-closed-${Date.now()}`);
    const { ids } = await createWant(other.userId, other.collectionId, want(other));
    await closeWant(other.userId, ids[0]);
    const map = await loadStampWantSummaries(other.collectionId, [other.stamp.id]);
    assert.equal(map.size, 0);
    await cleanup(other.userId);
  });

  it("carries the raw acceptance too, so a lot line can ask whether *it* would satisfy one", async () => {
    const other = await seedFixtures(`summary-match-${Date.now()}`);
    await createWant(other.userId, other.collectionId, {
      ...want(other),
      conditionIds: [other.mnh.id],
    });
    const entry = (await loadStampWantSummaries(other.collectionId, [other.stamp.id])).get(
      other.stamp.id
    )!.entries[0];

    const line = {
      stampId: other.stamp.id,
      certificateStatusId: null,
      formatId: null,
    };
    assert.equal(
      wantMatchesCopy(entry.acceptance, { ...line, conditionId: other.mnh.id }),
      true
    );
    assert.equal(
      wantMatchesCopy(entry.acceptance, { ...line, conditionId: other.used.id }),
      false,
      "a used lot answered a mint-only want"
    );
    await cleanup(other.userId);
  });

  it("names the 'none' member of an axis rather than calling it any", async () => {
    const other = await seedFixtures(`summary-none-${Date.now()}`);
    await createWant(other.userId, other.collectionId, {
      ...want(other),
      certificateStatusIds: [null],
      formatIds: [null],
    });
    const entry = (await loadStampWantSummaries(other.collectionId, [other.stamp.id])).get(
      other.stamp.id
    )!.entries[0];
    assert.equal(entry.certificate, "No certificate");
    assert.equal(entry.format, "Single");
    await cleanup(other.userId);
  });
});

describe("listWantIssueGroups", () => {
  let f: Fixtures;
  let issueId: string;
  let otherIssueId: string;
  before(async () => {
    f = await seedFixtures(`groups-${Date.now()}`);
    const area = await prisma.collectionArea.create({
      data: { collectionId: f.collectionId, name: "Poland" },
    });
    const issue = await prisma.issue.create({
      data: {
        collectionId: f.collectionId,
        issueNo: 9301,
        collectionAreaId: area.id,
        name: "Chopin",
        year: 1949,
      },
    });
    const other = await prisma.issue.create({
      data: {
        collectionId: f.collectionId,
        issueNo: 9302,
        collectionAreaId: area.id,
        name: "Birds",
        year: 1960,
      },
    });
    issueId = issue.id;
    otherIssueId = other.id;

    // Three wants under Chopin (one of them closed), one under Birds, one on a stamp in no issue.
    for (const [name, target] of [
      ["C1", issue.id],
      ["C2", issue.id],
      ["C3", issue.id],
      ["B1", other.id],
      ["Loose", null],
    ] as const) {
      const stamp = await prisma.stamp.create({ data: { collectionId: f.collectionId, name } });
      if (target) {
        await prisma.issueMember.create({ data: { issueId: target, stampId: stamp.id } });
      }
      await createWant(f.userId, f.collectionId, want(f, { stampId: stamp.id }));
    }
    const c3 = (await listWants(f.userId, f.collectionId)).find((w) => w.stampName === "C3")!;
    await closeWant(f.userId, c3.id);
  });
  after(() => cleanup(f.userId));

  it("collapses to one row per issue, counting open over total", async () => {
    const { groups } = await listWantIssueGroups(f.userId, f.collectionId, { status: "all" });
    const chopin = groups.find((g) => g.issueId === issueId)!;
    assert.deepEqual(
      { open: chopin.openCount, total: chopin.totalCount },
      { open: 2, total: 3 },
      "a closed want must stay in the total"
    );
    assert.equal(chopin.label, "Chopin (1949)");
  });

  it("puts the wants whose stamp is in no issue in their own bucket, last", async () => {
    const { groups } = await listWantIssueGroups(f.userId, f.collectionId, { status: "all" });
    // The fixture's own two stamps are in no issue too, so the bucket holds them and `Loose`.
    const loose = groups[groups.length - 1];
    assert.equal(loose.issueId, null);
    assert.equal(loose.label, "No issue");
  });

  it("orders by the Issues list's own reading order — year, then number, then name", async () => {
    const { groups } = await listWantIssueGroups(f.userId, f.collectionId, { status: "all" });
    assert.deepEqual(
      groups.map((g) => g.issueId),
      [issueId, otherIssueId, null]
    );
  });

  it("the fraction does not move when the status toggle does", async () => {
    const open = await listWantIssueGroups(f.userId, f.collectionId, { status: "open" });
    const all = await listWantIssueGroups(f.userId, f.collectionId, { status: "all" });
    const pick = (r: typeof open) => r.groups.find((g) => g.issueId === issueId)!;
    assert.deepEqual(
      { open: pick(open).openCount, total: pick(open).totalCount },
      { open: pick(all).openCount, total: pick(all).totalCount }
    );
  });

  it("but which groups appear does — a series with nothing closed is absent from Closed", async () => {
    const closed = await listWantIssueGroups(f.userId, f.collectionId, { status: "closed" });
    assert.deepEqual(
      closed.groups.map((g) => g.issueId),
      [issueId],
      "only Chopin has a closed want"
    );
  });

  it("obeys the screen's other filters", async () => {
    const { groups } = await listWantIssueGroups(f.userId, f.collectionId, {
      status: "all",
      search: "B1",
    });
    assert.deepEqual(
      groups.map((g) => g.issueId),
      [otherIssueId]
    );
  });

  it("a group's members are exactly the wants it counted", async () => {
    const { items } = await listWantsPaginated(f.userId, f.collectionId, {
      status: "all",
      issueId,
    });
    assert.deepEqual(
      items.map((w) => w.stampName).sort(),
      ["C1", "C2", "C3"]
    );

    const loose = await listWantsPaginated(f.userId, f.collectionId, {
      status: "all",
      issueId: NO_ISSUE,
    });
    assert.equal(loose.items.every((w) => w.issueId === null), true);
    assert.equal(
      loose.items.some((w) => w.stampName === "Loose"),
      true
    );
  });

  it("pages over groups without repeating or skipping one", async () => {
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page: Awaited<ReturnType<typeof listWantIssueGroups>> = await listWantIssueGroups(
        f.userId,
        f.collectionId,
        { status: "all", pageSize: 2, offset }
      );
      seen.push(...page.groups.map((g) => g.key));
      offset = page.nextCursor === null ? null : Number(page.nextCursor);
    }
    assert.equal(seen.length, 3);
    assert.equal(new Set(seen).size, 3);
  });
});

describe("listWantYearFacets", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures(`facets-${Date.now()}`);
    for (const year of [1920, 1920, 1921, null]) {
      const stamp = await prisma.stamp.create({
        data: { collectionId: f.collectionId, name: `Y${year}`, issuedYear: year },
      });
      await createWant(f.userId, f.collectionId, want(f, { stampId: stamp.id }));
    }
  });
  after(() => cleanup(f.userId));

  it("counts by the wanted stamp's issue year, oldest first and 'no year' last", async () => {
    const facets = await listWantYearFacets(f.userId, f.collectionId);
    assert.deepEqual(facets, [
      { year: 1920, count: 2 },
      { year: 1921, count: 1 },
      { year: null, count: 1 },
    ]);
  });

  it("ignores the year filter, so each count says what that year would leave", async () => {
    const facets = await listWantYearFacets(f.userId, f.collectionId, { year: "1920" });
    assert.equal(facets.length, 3, "the year narrowed its own facets");
  });

  it("but obeys every other filter", async () => {
    const facets = await listWantYearFacets(f.userId, f.collectionId, { search: "Y1921" });
    assert.deepEqual(facets, [{ year: 1921, count: 1 }]);
  });
});

describe("findWantsSatisfiedBy", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures(`satisfy-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  const arriving = (over: Partial<Parameters<typeof findWantsSatisfiedBy>[2][number]> = {}) => ({
    itemId: "item-1",
    itemNo: 1,
    stampId: f.stamp.id,
    conditionId: f.used.id,
    certificateStatusId: null,
    formatId: null,
    ...over,
  });

  it("surfaces an 'anything' want, and never a want on another stamp", async () => {
    const mine = await createWant(f.userId, f.collectionId, want(f));
    await createWant(f.userId, f.collectionId, want(f, { stampId: f.otherStamp.id }));
    const matches = await findWantsSatisfiedBy(f.userId, f.collectionId, [arriving()]);
    assert.deepEqual(
      matches.map((m) => m.want.id),
      [mine.ids[0]]
    );
    await prisma.want.deleteMany({ where: { collectionId: f.collectionId } });
  });

  it("leaves a mint-only want alone when a used copy arrives — the upgrade stays open", async () => {
    await createWant(f.userId, f.collectionId, want(f, { conditionIds: [f.mnh.id, f.mh.id] }));
    assert.deepEqual(await findWantsSatisfiedBy(f.userId, f.collectionId, [arriving()]), []);
    const matches = await findWantsSatisfiedBy(f.userId, f.collectionId, [
      arriving({ conditionId: f.mnh.id }),
    ]);
    assert.equal(matches.length, 1);
    await prisma.want.deleteMany({ where: { collectionId: f.collectionId } });
  });

  it("never surfaces a closed want", async () => {
    const { ids: [id] } = await createWant(f.userId, f.collectionId, want(f));
    await closeWant(f.userId, id);
    assert.deepEqual(await findWantsSatisfiedBy(f.userId, f.collectionId, [arriving()]), []);
    await prisma.want.deleteMany({ where: { collectionId: f.collectionId } });
  });

  it("reports one row per (copy, want) so a whole-checklist intake names each copy", async () => {
    const { ids: [id] } = await createWant(f.userId, f.collectionId, want(f));
    const matches = await findWantsSatisfiedBy(f.userId, f.collectionId, [
      arriving({ itemId: "item-a" }),
      arriving({ itemId: "item-b", conditionId: f.mnh.id }),
    ]);
    assert.deepEqual(
      matches.map((m) => `${m.itemId}:${m.want.id}`).sort(),
      [`item-a:${id}`, `item-b:${id}`].sort()
    );
    await prisma.want.deleteMany({ where: { collectionId: f.collectionId } });
  });
});

describe("the intake review (ADR-0032 §7)", () => {
  let f: Fixtures;
  let lotId: string;
  before(async () => {
    f = await seedFixtures(`intake-${Date.now()}`);
    const purchase = await createPurchase(f.userId, f.collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    const lot = await prisma.purchaseLot.create({
      data: { purchaseId: purchase.id, title: "Lot", price: "10.00", status: "open" },
      select: { id: true },
    });
    lotId = lot.id;
  });
  after(() => cleanup(f.userId));

  it("hands the copies it created to the review, and closes nothing on its own", async () => {
    const { ids: [id] } = await createWant(f.userId, f.collectionId, want(f));
    const copies = await intakeStamps(f.userId, lotId, {
      stampId: f.stamp.id,
      conditionId: f.used.id,
    });

    assert.equal(copies.length, 1);
    assert.equal(copies[0].stampId, f.stamp.id);
    assert.equal(copies[0].conditionId, f.used.id);
    // Intake records no format, so the copy is a single — the value the want's format axis reads.
    assert.equal(copies[0].formatId, null);
    assert.ok(copies[0].itemId);
    assert.ok(copies[0].itemNo > 0);

    const matches = await findWantsSatisfiedBy(f.userId, f.collectionId, copies);
    assert.deepEqual(
      matches.map((m) => m.want.id),
      [id]
    );
    // The want is still open: only the collector closes it.
    assert.equal((await getWant(f.userId, id)).closedAt, null);

    await closeWant(f.userId, id);
    assert.notEqual((await getWant(f.userId, id)).closedAt, null);
  });

  it("a copy is not in hand until it is delivered — that is the transition the review hangs off", async () => {
    const other = await seedFixtures(`delivered-${Date.now()}`);
    await createWant(other.userId, other.collectionId, want(other));
    const purchase = await createPurchase(other.userId, other.collectionId, {
      currency: "EUR",
      purchasedAt: "2026-01-01",
    });
    const lot = await prisma.purchaseLot.create({
      data: { purchaseId: purchase.id, title: "Lot", price: "10.00", status: "open" },
      select: { id: true },
    });

    // Intake makes the copy `ordered` — bought, not here. Nothing has arrived to judge.
    const created = await intakeStamps(other.userId, lot.id, {
      stampId: other.stamp.id,
      conditionId: other.used.id,
    });
    const row = await prisma.item.findUniqueOrThrow({
      where: { id: created[0].itemId },
      select: { deliveryState: true },
    });
    assert.equal(row.deliveryState, "ordered");

    // Marking the order arrived only gets it as far as `to_sort` — still not the transition.
    await markPurchaseArrived(other.userId, purchase.id);
    const arrived = await bulkUpdateLotItemsScoped(
      other.userId,
      other.collectionId,
      { lotId: lot.id },
      { locationId: undefined }
    );
    assert.deepEqual(arrived.delivered, [], "a no-op bulk change reported an arrival");

    // Sorting it is what puts it in hand, and that is what the review is offered for.
    const sorted = await bulkUpdateLotItemsScoped(
      other.userId,
      other.collectionId,
      { lotId: lot.id },
      { markSorted: true }
    );
    assert.equal(sorted.delivered.length, 1);
    assert.equal(sorted.delivered[0].itemId, created[0].itemId);
    assert.equal(sorted.delivered[0].conditionId, other.used.id);

    const matches = await findWantsSatisfiedBy(
      other.userId,
      other.collectionId,
      sorted.delivered
    );
    assert.equal(matches.length, 1);

    // Sorting again reports nothing: the copy was already here, and an arrival happens once.
    const again = await bulkUpdateLotItemsScoped(
      other.userId,
      other.collectionId,
      { lotId: lot.id },
      { markSorted: true }
    );
    assert.deepEqual(again.delivered, []);
    await cleanup(other.userId);
  });

  it("narrowing at intake keeps the want open and looking for something else", async () => {
    await prisma.want.deleteMany({ where: { collectionId: f.collectionId } });
    const { ids: [id] } = await createWant(f.userId, f.collectionId, want(f));
    const copies = await intakeStamps(f.userId, lotId, {
      stampId: f.stamp.id,
      conditionId: f.used.id,
    });
    assert.equal((await findWantsSatisfiedBy(f.userId, f.collectionId, copies)).length, 1);

    // What the review's seed offers: every condition except the one that arrived.
    await narrowWant(f.userId, id, {
      conditionIds: narrowConditionSeed([f.used.id, f.mnh.id, f.mh.id], f.used.id, []),
      certificateStatusIds: [],
      formatIds: [],
    });

    const row = await getWant(f.userId, id);
    assert.equal(row.closedAt, null);
    assert.deepEqual([...row.conditionIds].sort(), [f.mh.id, f.mnh.id].sort());
    // The same copy no longer satisfies it — the upgrade the want has become.
    assert.deepEqual(await findWantsSatisfiedBy(f.userId, f.collectionId, copies), []);
  });

  it("a whole-checklist intake returns one copy per stamp, each with its own number", async () => {
    await prisma.want.deleteMany({ where: { collectionId: f.collectionId } });
    const checklist = await prisma.checklist.create({
      data: {
        collectionId: f.collectionId,
        name: "Set",
        stamps: { create: [{ stampId: f.stamp.id }, { stampId: f.otherStamp.id }] },
      },
    });
    await createWant(f.userId, f.collectionId, want(f, { stampId: f.otherStamp.id }));

    const copies = await intakeStamps(f.userId, lotId, {
      checklistId: checklist.id,
      conditionId: f.mnh.id,
    });
    assert.equal(copies.length, 2);
    assert.equal(new Set(copies.map((c) => c.itemNo)).size, 2);

    const matches = await findWantsSatisfiedBy(f.userId, f.collectionId, copies);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].itemId, copies.find((c) => c.stampId === f.otherStamp.id)!.itemId);
  });
});

describe("createWantsForMissing", () => {
  let f: Fixtures;
  before(async () => {
    f = await seedFixtures(`missing-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  async function makeChecklist() {
    const checklist = await prisma.checklist.create({
      data: {
        collectionId: f.collectionId,
        name: "Complete set",
        stamps: { create: [{ stampId: f.stamp.id }, { stampId: f.otherStamp.id }] },
      },
    });
    return checklist.id;
  }

  it("creates an open, wide-open want for each missing stamp and skips the held one", async () => {
    const checklistId = await makeChecklist();
    await createItem(f.userId, f.collectionId, {
      stampId: f.stamp.id,
      conditionId: f.used.id,
    });

    const result = await createWantsForMissing(f.userId, f.collectionId, checklistId);
    assert.deepEqual(result, { created: 1, missing: 1 });

    const rows = await listWants(f.userId, f.collectionId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stampId, f.otherStamp.id);
    assert.deepEqual(rows[0].conditionIds, []);
    assert.deepEqual(rows[0].certificateStatusIds, []);
    assert.deepEqual(rows[0].formatIds, []);
    assert.equal(rows[0].closedAt, null);
  });

  it("is a no-op the second time — an open want is not a gap to fill again", async () => {
    const checklistId = (await prisma.checklist.findFirstOrThrow({
      where: { collectionId: f.collectionId },
    })).id;
    const result = await createWantsForMissing(f.userId, f.collectionId, checklistId);
    assert.deepEqual(result, { created: 0, missing: 1 });
    assert.equal((await listWants(f.userId, f.collectionId)).length, 1);
  });

  it("a closed want is not a reason to skip — the gap is real again", async () => {
    const [row] = await listWants(f.userId, f.collectionId);
    await closeWant(f.userId, row.id);
    const checklistId = (await prisma.checklist.findFirstOrThrow({
      where: { collectionId: f.collectionId },
    })).id;
    const result = await createWantsForMissing(f.userId, f.collectionId, checklistId);
    assert.deepEqual(result, { created: 1, missing: 1 });
    assert.equal((await listWants(f.userId, f.collectionId)).length, 2);
  });
});

describe("previewIssueMissingWants / createWantsForIssue", () => {
  let f: Fixtures;
  let issueId: string;
  let otherIssueId: string;
  let basicId: string;
  let withBlockId: string;

  before(async () => {
    f = await seedFixtures(`issue-wants-${Date.now()}`);
    const area = await prisma.collectionArea.create({
      data: { collectionId: f.collectionId, name: "Poland" },
    });
    const issue = await prisma.issue.create({
      data: { collectionId: f.collectionId, issueNo: 9401, collectionAreaId: area.id, name: "Set" },
    });
    issueId = issue.id;
    const other = await prisma.issue.create({
      data: { collectionId: f.collectionId, issueNo: 9402, collectionAreaId: area.id, name: "Other" },
    });
    otherIssueId = other.id;

    // Two goals of one issue, overlapping on `stamp`: the union is what a bulk add is over.
    basicId = (
      await prisma.checklist.create({
        data: {
          collectionId: f.collectionId,
          issueId,
          name: "Basic set",
          sortOrder: 0,
          stamps: { create: [{ stampId: f.stamp.id }] },
        },
      })
    ).id;
    withBlockId = (
      await prisma.checklist.create({
        data: {
          collectionId: f.collectionId,
          issueId,
          name: "With block",
          sortOrder: 1,
          stamps: { create: [{ stampId: f.stamp.id }, { stampId: f.otherStamp.id }] },
        },
      })
    ).id;
  });
  after(() => cleanup(f.userId));

  it("previews each checklist of the issue in its own order, gap by gap", async () => {
    const gaps = await previewIssueMissingWants(f.userId, f.collectionId, issueId);
    assert.deepEqual(
      gaps.map((g) => g.name),
      ["Basic set", "With block"]
    );
    assert.deepEqual(gaps[0].toCreateStampIds, [f.stamp.id]);
    assert.deepEqual([...gaps[1].toCreateStampIds].sort(), [f.stamp.id, f.otherStamp.id].sort());
  });

  it("wants the union of the picked checklists — a stamp on both is one want", async () => {
    const result = await createWantsForIssue(f.userId, f.collectionId, issueId, [
      basicId,
      withBlockId,
    ]);
    assert.deepEqual(result, { created: 2, missing: 2 });
    const rows = await listWants(f.userId, f.collectionId);
    assert.deepEqual(
      [...new Set(rows.map((r) => r.stampId))].sort(),
      [f.stamp.id, f.otherStamp.id].sort()
    );
    assert.equal(rows.length, 2);
  });

  it("says what is already on the list rather than writing it twice", async () => {
    const gaps = await previewIssueMissingWants(f.userId, f.collectionId, issueId);
    assert.deepEqual(gaps[1].missingStampIds.length, 2);
    assert.deepEqual(gaps[1].toCreateStampIds, []);
    const result = await createWantsForIssue(f.userId, f.collectionId, issueId, [withBlockId]);
    assert.deepEqual(result, { created: 0, missing: 2 });
    assert.equal((await listWants(f.userId, f.collectionId)).length, 2);
  });

  it("wants the same stamp again on other terms — and only once per terms", async () => {
    const mnh = { conditionIds: [f.mnh.id], certificateStatusIds: [], formatIds: [] };
    // The wide-open wants from the runs above are not what a want for MNH would duplicate.
    const preview = await previewIssueMissingWants(f.userId, f.collectionId, issueId, mnh);
    assert.deepEqual(
      [...preview[1].toCreateStampIds].sort(),
      [f.stamp.id, f.otherStamp.id].sort()
    );

    const first = await createWantsForIssue(
      f.userId,
      f.collectionId,
      issueId,
      [withBlockId],
      mnh
    );
    assert.deepEqual(first, { created: 2, missing: 2 });
    const rows = await listWants(f.userId, f.collectionId);
    assert.equal(rows.length, 4);
    assert.equal(rows.filter((r) => r.conditionIds.length === 1).length, 2);

    // A second run on the *same* terms is the no-op the wide-open one is.
    const again = await createWantsForIssue(f.userId, f.collectionId, issueId, [withBlockId], mnh);
    assert.deepEqual(again, { created: 0, missing: 2 });
    assert.equal((await listWants(f.userId, f.collectionId)).length, 4);
  });

  it("a held copy the terms would not take leaves the stamp missing", async () => {
    const stamp = await prisma.stamp.create({
      data: { collectionId: f.collectionId, name: "Stamp 311" },
    });
    const usedOnly = await prisma.checklist.create({
      data: {
        collectionId: f.collectionId,
        issueId,
        name: "Third",
        sortOrder: 2,
        stamps: { create: [{ stampId: stamp.id }] },
      },
    });
    await createItem(f.userId, f.collectionId, { stampId: stamp.id, conditionId: f.used.id });

    // Wide open: the used copy in the album is a copy held, so there is no gap.
    const any = await previewIssueMissingWants(f.userId, f.collectionId, issueId);
    assert.deepEqual(any.find((g) => g.checklistId === usedOnly.id)!.missingStampIds, []);

    // For MNH it answers nothing, so the stamp is missing and a want is written.
    const mnh = { conditionIds: [f.mnh.id], certificateStatusIds: [], formatIds: [] };
    const gap = await previewIssueMissingWants(f.userId, f.collectionId, issueId, mnh);
    assert.deepEqual(gap.find((g) => g.checklistId === usedOnly.id)!.toCreateStampIds, [stamp.id]);
    const result = await createWantsForIssue(f.userId, f.collectionId, issueId, [usedOnly.id], mnh);
    assert.deepEqual(result, { created: 1, missing: 1 });
    const written = (await listWants(f.userId, f.collectionId)).find((r) => r.stampId === stamp.id)!;
    assert.deepEqual(written.conditionIds, [f.mnh.id]);
  });

  it("refuses a checklist that is not this issue's — and one that is nobody's", async () => {
    await assert.rejects(
      () => createWantsForIssue(f.userId, f.collectionId, otherIssueId, [basicId]),
      /No checklist of this issue/
    );
    await assert.rejects(
      () => createWantsForIssue(f.userId, f.collectionId, issueId, []),
      /No checklist of this issue/
    );
  });

  it("writes the run's priority onto every want, and normal when none is stated (#695)", async () => {
    const stamp = await prisma.stamp.create({
      data: { collectionId: f.collectionId, name: "Stamp 312" },
    });
    const otherStamp = await prisma.stamp.create({
      data: { collectionId: f.collectionId, name: "Stamp 313" },
    });
    const list = await prisma.checklist.create({
      data: {
        collectionId: f.collectionId,
        issueId,
        name: "Fourth",
        sortOrder: 3,
        stamps: { create: [{ stampId: stamp.id }, { stampId: otherStamp.id }] },
      },
    });

    // Stated once for the run, landing on both rows — the point of asking it here at all.
    const high = await createWantsForIssue(
      f.userId,
      f.collectionId,
      issueId,
      [list.id],
      undefined,
      "high"
    );
    assert.deepEqual(high, { created: 2, missing: 2 });
    const rows = await listWants(f.userId, f.collectionId);
    const written = rows.filter((r) => r.stampId === stamp.id || r.stampId === otherStamp.id);
    assert.equal(written.length, 2);
    assert.deepEqual([...new Set(written.map((r) => r.priority))], ["high"]);

    // Unstated is `normal`, the column's default and what the completeness card's own button writes.
    const mnh = { conditionIds: [f.mnh.id], certificateStatusIds: [], formatIds: [] };
    const plain = await createWantsForIssue(f.userId, f.collectionId, issueId, [list.id], mnh);
    assert.deepEqual(plain, { created: 2, missing: 2 });
    const onMnh = (await listWants(f.userId, f.collectionId)).filter(
      (r) =>
        (r.stampId === stamp.id || r.stampId === otherStamp.id) && r.conditionIds.length === 1
    );
    assert.equal(onMnh.length, 2);
    assert.deepEqual([...new Set(onMnh.map((r) => r.priority))], ["normal"]);
  });
});
