import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { runCatalogImport, buildCatalogImportPlan } from "../../src/lib/catalog-import";
import type { CatalogImportMapping } from "../../src/lib/catalog-import-rules";

// Executing a catalog CSV (#717): a mixed file creates and fills, a filled issue keeps whatever it
// already had, declared ranges widen over the numbers just appended, and one bad row costs its own
// row and nothing else.

const MAPPING: CatalogImportMapping = { year: 0, name: 1, spec: 2 };

function csv(...rows: string[]): string {
  return ["Year,Name,Numbers", ...rows].join("\n") + "\n";
}

describe("catalog CSV import", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let vendorId: string;

  before(async () => {
    const ts = Date.now();
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-csvimport-${ts}`,
          name: "Test User",
          email: `test-csvimport-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-csvimport-${ts}`,
          name: "Collection",
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    vendorId = (
      await prisma.catalogVendor.create({
        data: { collectionId, name: "Michel", abbreviation: "Mi" },
      })
    ).id;
    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          catalogPrefix: "PL",
          primaryCatalogVendorId: vendorId,
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  beforeEach(async () => {
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
  });

  async function run(text: string) {
    const result = await runCatalogImport(userId, collectionId, areaId, text, MAPPING);
    // `assert/strict`'s `equal` narrows the discriminant, so the refusal branch is gone from here.
    assert.equal(result.ok, true, result.ok ? "" : result.message);
    return result.report;
  }

  async function issueByName(name: string) {
    const issue = await prisma.issue.findFirst({
      where: { collectionId, name },
      select: {
        id: true,
        name: true,
        year: true,
        catalogNumbers: { select: { catalogVendorId: true, firstNumber: true, lastNumber: true } },
        members: {
          select: {
            sortOrder: true,
            stamp: {
              select: {
                issuedYear: true,
                catalogNumbers: { select: { number: true } },
              },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    assert.ok(issue, `expected an issue named ${name}`);
    return issue;
  }

  /** The issue's members' numbers, in the order the tree holds them (#549). */
  function memberNumbers(issue: { members: { stamp: { catalogNumbers: { number: string }[] } }[] }) {
    return issue.members.map((m) => m.stamp.catalogNumbers.map((c) => c.number).join("+"));
  }

  it("creates an issue with every stamp its spec generates, and the derived declared range", async () => {
    const report = await run(csv("1918,Chain breakers,1-3"));
    assert.deepEqual(
      { created: report.issuesCreated, stamps: report.stampsCreated, failed: report.rowsFailed },
      { created: 1, stamps: 3, failed: 0 }
    );

    const issue = await issueByName("Chain breakers");
    assert.equal(issue.year, 1918);
    assert.deepEqual(memberNumbers(issue), ["1", "2", "3"]);
    // Derived from the spec exactly as `createIssueAction` derives it (#452).
    assert.deepEqual(issue.catalogNumbers, [
      { catalogVendorId: vendorId, firstNumber: "1", lastNumber: "3" },
    ]);
    // The stamps carry the issue's year, as auto-create gives them (#70).
    assert.deepEqual(
      issue.members.map((m) => m.stamp.issuedYear),
      [1918, 1918, 1918]
    );
  });

  it("creates the stamps a two-variant spec generates, and declares the basic span", async () => {
    await run(csv('1963,Definitives,"2895A-2897A, 2895B-2897B"'));
    const issue = await issueByName("Definitives");
    assert.deepEqual(memberNumbers(issue), ["2895A", "2896A", "2897A", "2895B", "2896B", "2897B"]);
    assert.deepEqual(issue.catalogNumbers, [
      { catalogVendorId: vendorId, firstNumber: "2895", lastNumber: "2897" },
    ]);
  });

  it("fills an existing issue: appends only the missing numbers, at the end of the group", async () => {
    await run(csv("1918,Chain breakers,1-3"));
    const report = await run(csv("1918,Chain breakers,1-5"));

    assert.deepEqual(
      {
        created: report.issuesCreated,
        filled: report.issuesFilled,
        stamps: report.stampsCreated,
        failed: report.rowsFailed,
      },
      { created: 0, filled: 1, stamps: 2, failed: 0 }
    );
    assert.equal(await prisma.issue.count({ where: { collectionId } }), 1);

    const issue = await issueByName("Chain breakers");
    // 4 and 5 land at the end of the sibling group (#549), never renumbering what was there.
    assert.deepEqual(memberNumbers(issue), ["1", "2", "3", "4", "5"]);
    // The declared range widened over the numbers just appended (#333's rule).
    assert.deepEqual(issue.catalogNumbers, [
      { catalogVendorId: vendorId, firstNumber: "1", lastNumber: "5" },
    ]);
  });

  it("fills an empty name and a missing year, and never overwrites a filled one", async () => {
    // An issue with a name and no year, and one with neither.
    await run(csv("1918,Chain breakers,1-2", ",,10-11"));
    await prisma.issue.updateMany({ where: { collectionId, name: "Chain breakers" }, data: { year: null } });

    const report = await run(csv("1920,Renamed by the file,1-3", "1921,Given a name,10-12"));
    assert.equal(report.issuesFilled, 2);

    const kept = await issueByName("Chain breakers");
    assert.equal(kept.name, "Chain breakers", "a filled name is never overwritten");
    assert.equal(kept.year, 1920, "an empty year is filled from the file");

    const named = await issueByName("Given a name");
    assert.equal(named.year, 1921);
    // The stamp appended after the year was filled carries it.
    const appended = named.members.find((m) =>
      m.stamp.catalogNumbers.some((c) => c.number === "12")
    );
    assert.equal(appended?.stamp.issuedYear, 1921);
  });

  it("reports a fill row that changes nothing as unchanged, not as a write", async () => {
    await run(csv("1918,Chain breakers,1-3"));
    const report = await run(csv("1918,Chain breakers,1-3"));
    assert.deepEqual(
      {
        created: report.issuesCreated,
        filled: report.issuesFilled,
        unchanged: report.rowsUnchanged,
        stamps: report.stampsCreated,
      },
      { created: 0, filled: 0, unchanged: 1, stamps: 0 }
    );
  });

  it("runs a mixed file whole: creates, fills and skips the rows the plan refused", async () => {
    await run(csv("1918,Chain breakers,1"));
    const report = await run(
      csv(
        "1918,Chain breakers,1-3", // fills: appends 2 and 3
        "1919,Overprints,10-12", // creates
        "19x9,Bad year,20", // refused: year
        "1920,Clash,3" // refused: line 2 claimed it
      )
    );
    assert.deepEqual(report, {
      issuesCreated: 1,
      issuesFilled: 1,
      stampsCreated: 5,
      rowsUnchanged: 0,
      rowsSkipped: 2,
      rowsFailed: 0,
      failures: [],
    });
    assert.equal(await prisma.issue.count({ where: { collectionId } }), 2);
    assert.equal(await prisma.stamp.count({ where: { collectionId } }), 6);
  });

  it("leaves earlier rows written and still attempts later ones when a row fails mid-file", async () => {
    // The issue the middle row fills exists; the middle row itself is a *create* whose short issue
    // number (#432) is already taken, so its transaction rolls back at the very last step — a
    // failure no classification could have foreseen, which is exactly the case the per-row writer
    // exists for. The row after it is a fill, which allocates no number, so it is unaffected by the
    // rollback and proves later rows are still attempted.
    await run(csv("1918,Existing,1-2"));
    const counter = await prisma.collection.findUniqueOrThrow({
      where: { id: collectionId },
      select: { nextIssueNo: true },
    });
    await prisma.issue.create({
      data: {
        collectionId,
        collectionAreaId: areaId,
        // The number the *second* create of the run will be handed.
        issueNo: counter.nextIssueNo + 1,
        name: "Blocker",
      },
    });

    const report = await run(
      csv(
        "1919,First,10-11", // creates, taking the free number
        "1920,Doomed,20-21", // creates, handed the taken number: fails
        "1918,Existing,1-3" // fills: appends 3, allocating nothing
      )
    );

    assert.equal(report.issuesCreated, 1);
    assert.equal(report.issuesFilled, 1);
    assert.equal(report.rowsFailed, 1);
    assert.deepEqual(
      report.failures.map((f) => f.line),
      [3]
    );

    // The row before the failure was written and stayed written.
    assert.deepEqual(memberNumbers(await issueByName("First")), ["10", "11"]);
    // The failing row wrote nothing — its own transaction rolled back whole.
    assert.equal(await prisma.issue.count({ where: { collectionId, name: "Doomed" } }), 0);
    assert.equal(await prisma.stamp.count({ where: { collectionId, catalogNumbers: { some: { number: "20" } } } }), 0);
    // The row after it was attempted, and written.
    assert.deepEqual(memberNumbers(await issueByName("Existing")), ["1", "2", "3"]);
  });

  it("refuses a whole file whose area cannot hold issues, rather than half-writing it", async () => {
    const grouping = await prisma.collectionArea.create({
      data: { collectionId, name: "Europe", assignable: false },
    });
    const result = await runCatalogImport(
      userId,
      collectionId,
      grouping.id,
      csv("1918,X,1"),
      MAPPING
    );
    assert.equal(result.ok, false);
    assert.equal(await prisma.issue.count({ where: { collectionId } }), 0);
  });

  it("plans without writing: the preview and the commit are the same classification", async () => {
    await run(csv("1918,Chain breakers,1-2"));
    const planned = await buildCatalogImportPlan(
      userId,
      collectionId,
      areaId,
      csv("1918,Chain breakers,1-3", "1919,Overprints,10-11"),
      MAPPING
    );
    assert.equal(planned.ok, true);
    if (!planned.ok) return;
    assert.deepEqual(
      planned.plan.rows.map((r) => r.kind),
      ["fill-existing", "new-issue"]
    );
    assert.equal(planned.plan.summary.stampsToCreate, 3);
    assert.equal(planned.target.areaPrefix, "PL");
    assert.equal(planned.target.catalogVendorId, vendorId);
    // Nothing was written by planning.
    assert.equal(await prisma.issue.count({ where: { collectionId } }), 1);
    assert.equal(await prisma.stamp.count({ where: { collectionId } }), 2);
  });

  it("refuses a file whose area declares no primary catalog", async () => {
    const bare = await prisma.collectionArea.create({
      data: { collectionId, name: "Nowhere" },
    });
    const result = await runCatalogImport(userId, collectionId, bare.id, csv("1918,X,1"), MAPPING);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /no primary catalog/);
  });

  it("refuses a collection the caller does not own", async () => {
    await assert.rejects(
      runCatalogImport("someone-else", collectionId, areaId, csv("1918,X,1"), MAPPING),
      /access denied/
    );
  });
});
