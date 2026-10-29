import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getIssueCompleteness } from "../../src/lib/checklist-completeness";
import { headlineCompleteness } from "../../src/lib/checklist-completeness-rules";
import { createItem } from "../../src/lib/items";
import {
  getCompletenessReport,
  getChecklistMissingStamps,
  type CompletenessScope,
} from "../../src/lib/completeness-screen";
import {
  COMPLETENESS_DISPOSITION_CHIPS,
  type CompletenessDispositionChip,
} from "../../src/lib/completeness-screen-rules";

// The Completeness screen (#2266): the chosen area and years, narrowed to the copies of chosen
// conditions and dispositions. What is pinned here is what the pure rules cannot see — that the
// rail's area and years pick the issues' checklists, that the two narrowings reach the copies, that
// the variant rollup (#661) and the counted-copy exclusions are the issue grid's, and that with the
// defaults every checklist reads what the Issues list's branch heading reads.

const ts = Date.now();

describe("Completeness screen (#2266)", () => {
  let userId: string;
  let collectionId: string;
  let polandId: string, germanyId: string;
  let mnhId: string, usedId: string;
  let issueA: string, issueB: string, issueC: string, issueD: string;
  let listA: string, listB: string, listC: string, listD: string, listE: string;

  const everything: CompletenessScope = {
    conditionIds: [],
    dispositions: [...COMPLETENESS_DISPOSITION_CHIPS],
    includeSpecialised: false,
  };
  const report = (scope: Partial<CompletenessScope> = {}) =>
    getCompletenessReport(userId, collectionId, { ...everything, ...scope });
  const only = (...dispositions: CompletenessDispositionChip[]) => ({ dispositions });

  before(async () => {
    userId = `test-user-complscr-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User complscr-${ts}`,
        email: `test-complscr-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-complscr-${ts}`, name: "Completeness", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendor = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const catalog = await prisma.catalogName.create({
      data: { vendorId: vendor.id, name: "Michel Europa", currency: "EUR" },
    });
    const area = async (name: string) =>
      (
        await prisma.collectionArea.create({
          data: {
            collectionId,
            name,
            primaryCatalogNameId: catalog.id,
            collectionAreaCatalogs: { create: [{ catalogNameId: catalog.id }] },
          },
        })
      ).id;
    polandId = await area("Poland");
    germanyId = await area("Germany");
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint never hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;
    const variantSubtypeId = (
      await prisma.stampSubtype.create({
        data: { collectionId, name: "Shade", actsAsVariant: true, isDefault: true, sortOrder: 0 },
      })
    ).id;

    let issueNo = 9800;
    const issue = async (areaId: string, name: string, year: number) =>
      (
        await prisma.issue.create({
          // Past the collection's counter: these rows bypass `allocateEntityNumber` (#432).
          data: { collectionId, issueNo: issueNo++, collectionAreaId: areaId, name, year },
        })
      ).id;
    const stamp = async (areaId: string, number: string, parentId?: string) =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: number,
            parentId,
            subtypeId: parentId ? variantSubtypeId : undefined,
            catalogNumbers: { create: [{ catalogVendorId: vendor.id, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
    const checklist = async (
      issueId: string,
      name: string,
      stampIds: string[],
      kind: "standard" | "specialised" = "standard"
    ) => {
      await prisma.issueMember.createMany({
        data: stampIds.map((stampId, i) => ({ issueId, stampId, sortOrder: i })),
        skipDuplicates: true,
      });
      return (
        await prisma.checklist.create({
          data: {
            collectionId,
            issueId,
            name,
            kind,
            stamps: { create: stampIds.map((stampId, i) => ({ stampId, sortOrder: i })) },
          },
        })
      ).id;
    };
    const copy = (
      stampId: string,
      conditionId: string,
      flags: { inCollection?: boolean; forSale?: boolean; forTrade?: boolean }
    ) =>
      createItem(userId, collectionId, {
        stampId,
        conditionId,
        inCollection: flags.inCollection ?? false,
        forSale: flags.forSale ?? false,
        forTrade: flags.forTrade ?? false,
        deliveryState: "delivered",
      });

    issueA = await issue(polandId, "Reconstruction", 1950);
    issueB = await issue(polandId, "Chopin", 1955);
    issueC = await issue(germanyId, "Posthorn", 1951);
    issueD = await issue(polandId, "Millennium", 1966);

    const a1 = await stamp(polandId, "501");
    const a2 = await stamp(polandId, "502");
    const a3 = await stamp(polandId, "503");
    const b1 = await stamp(polandId, "601");
    const b2 = await stamp(polandId, "602");
    const c1 = await stamp(germanyId, "123");
    const d1 = await stamp(polandId, "1500");
    const d1shade = await stamp(polandId, "1500a", d1);
    const d2 = await stamp(polandId, "1501");

    listA = await checklist(issueA, "Basic", [a1, a2, a3]);
    listB = await checklist(issueB, "Basic", [b1, b2]);
    listC = await checklist(issueC, "Basic", [c1]);
    listD = await checklist(issueD, "Basic", [d1, d2]);
    listE = await checklist(issueD, "Shades", [d1shade], "specialised");

    await copy(a1, mnhId, { inCollection: true });
    await copy(a2, usedId, { forSale: true });
    // A copy disposed of is not held — the issue grid's own exclusion.
    const gone = await copy(a3, mnhId, { inCollection: true });
    await prisma.item.update({ where: { id: gone.id }, data: { disposedAt: new Date() } });
    await copy(b1, mnhId, { inCollection: true });
    await copy(b2, mnhId, { inCollection: true, forSale: true });
    await copy(c1, usedId, { forTrade: true });
    // Filed under a shade of `1500`, with no disposition yet: it counts for `1500` (#661).
    await copy(d1shade, mnhId, {});
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("sums every standard checklist and lists the incomplete ones closest to complete first", async () => {
    const { summary, incomplete } = await report();
    // A 2/3 (the disposed `503` is not held), B 2/2, C 1/1, D 1/2 through the shade.
    assert.deepEqual(summary, { held: 6, total: 8, completeChecklists: 2, checklists: 4 });
    assert.deepEqual(
      incomplete.map((c) => [c.checklistId, c.owned, c.requiredCount]),
      [
        [listA, 2, 3],
        [listD, 1, 2],
      ]
    );
    assert.ok(!incomplete.some((c) => c.checklistId === listB || c.checklistId === listC));
    assert.equal(incomplete[0].issueId, issueA);
    assert.equal(incomplete[0].issueName, "Reconstruction");
    assert.equal(incomplete[0].issueYear, 1950);
  });

  it("with the defaults, reads every checklist as the Issues list does", async () => {
    const { incomplete, summary } = await report();
    const byChecklist = new Map(incomplete.map((c) => [c.checklistId, c.owned]));
    let complete = 0;
    for (const issueId of [issueA, issueB, issueC, issueD]) {
      const grid = await getIssueCompleteness(userId, collectionId, issueId, false);
      for (const c of grid.checklists) {
        const { owned } = headlineCompleteness(c);
        if (owned === c.requiredCount) complete += 1;
        else assert.equal(byChecklist.get(c.checklistId), owned, `checklist ${c.name} of ${issueId}`);
      }
    }
    assert.equal(summary.completeChecklists, complete);
  });

  it("narrows to the chosen area and years", async () => {
    const { summary, incomplete } = await report({
      areaIds: [polandId],
      yearFrom: 1950,
      yearTo: 1960,
    });
    assert.deepEqual(summary, { held: 4, total: 5, completeChecklists: 1, checklists: 2 });
    assert.deepEqual(incomplete.map((c) => c.checklistId), [listA]);

    const germany1951 = await report({ areaIds: [germanyId], year: 1951 });
    assert.deepEqual(germany1951.summary, { held: 1, total: 1, completeChecklists: 1, checklists: 1 });
    assert.deepEqual(germany1951.incomplete, []);
  });

  it("counts only the copies in a chosen condition", async () => {
    const { summary, incomplete } = await report({ conditionIds: [mnhId] });
    // `502` and `123` are used: A drops to 1/3 and C to 0/1.
    assert.deepEqual(summary, { held: 4, total: 8, completeChecklists: 1, checklists: 4 });
    assert.deepEqual(
      incomplete.map((c) => [c.checklistId, c.owned]),
      [
        [listD, 1],
        [listA, 1],
        [listC, 0],
      ]
    );
  });

  it("counts a copy carrying any disposition chip that is on, None being no disposition", async () => {
    const inCollection = await report(only("in-collection"));
    // `501`, `601`, `602` — not the for-sale `502`, the for-trade `123` or the undecided shade.
    assert.equal(inCollection.summary.held, 3);

    const forSaleOrTrade = await report(only("for-sale", "for-trade"));
    // `502`, `602` and `123`.
    assert.equal(forSaleOrTrade.summary.held, 3);

    const none = await report(only("none"));
    assert.equal(none.summary.held, 1);
    assert.deepEqual(
      none.incomplete.find((c) => c.checklistId === listD)?.owned,
      1
    );
  });

  it("counts the specialised checklists only with the switch on", async () => {
    const off = await report();
    assert.ok(!off.incomplete.some((c) => c.checklistId === listE));
    const on = await report({ includeSpecialised: true });
    // The shades list is held whole by its one copy.
    assert.deepEqual(on.summary, { held: 7, total: 9, completeChecklists: 3, checklists: 5 });
  });

  it("names the stamps a checklist lacks, in its order, under the same narrowing", async () => {
    const missing = await getChecklistMissingStamps(userId, collectionId, listA, everything);
    assert.equal(missing.length, 1);
    assert.match(missing[0], /503/);

    const mnhOnly = await getChecklistMissingStamps(userId, collectionId, listA, {
      ...everything,
      conditionIds: [mnhId],
    });
    assert.equal(mnhOnly.length, 2);
    assert.match(mnhOnly[0], /502/);
    assert.match(mnhOnly[1], /503/);
  });

  it("answers nothing for a collection that is not the caller's", async () => {
    await assert.rejects(
      getCompletenessReport("someone-else", collectionId, everything),
      /access denied/
    );
  });
});
