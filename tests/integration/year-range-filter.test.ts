import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { listIssueAreaFacets, listIssuesPaginated } from "../../src/lib/issues";
import { listStampAreaFacets, listStampsPaginated } from "../../src/lib/stamps";
import { listWantsPaginated } from "../../src/lib/wants";
import { readYearFilter } from "../../src/lib/list-area-year-filter";

// #2258: the Year column selects a span of years as well as one. Every list route reads the rail's
// value through `readYearFilter`, so a span is asked here exactly as a route asks it — the Issues,
// Stamps and Want lists, and the area counts beside them. Both ends are included, either may be
// open, and a thing of no year is outside every span.

const ts = Date.now();
const YEARS = [1944, 1945, 1952, 1960, 1961, null] as const;

describe("a span of years on the shared filter rail", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  /** The issue, stamp and want of each year, keyed by the year (`none` for no year). */
  const issueOf: Record<string, string> = {};
  const stampOf: Record<string, string> = {};
  const wantOf: Record<string, string> = {};

  before(async () => {
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-yearrange-${ts}`,
          name: "Year range",
          email: `test-yearrange-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-yearrange-${ts}`, name: "Y", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    await prisma.stampCondition.create({
      data: { collectionId, name: "Mint", abbreviation: "M", sortOrder: 0 },
    });
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Poland" } })).id;
    let issueNo = 0;
    for (const year of YEARS) {
      const key = year === null ? "none" : String(year);
      const issue = await prisma.issue.create({
        data: { collectionId, collectionAreaId: areaId, issueNo: ++issueNo, name: `Issue ${key}`, year },
      });
      issueOf[key] = issue.id;
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${key}`,
          issuedYear: year,
          stampAreaLinks: { create: [{ collectionAreaId: areaId }] },
          issueMemberships: { create: [{ issueId: issue.id }] },
        },
      });
      stampOf[key] = stamp.id;
      wantOf[key] = (await prisma.want.create({ data: { collectionId, stampId: stamp.id } })).id;
    }
  });

  after(async () => {
    await prisma.want.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const of = (ids: Record<string, string>, keys: string[]) => keys.map((k) => ids[k]).sort();

  const issues = async (year: string) =>
    (await listIssuesPaginated(userId, collectionId, { ...readYearFilter(year) })).items
      .map((i) => i.id)
      .sort();
  const stamps = async (year: string) =>
    (await listStampsPaginated(userId, collectionId, { ...readYearFilter(year) })).items
      .map((s) => s.id)
      .sort();
  const wants = async (year: string) =>
    (await listWantsPaginated(userId, collectionId, { year })).items.map((w) => w.id).sort();

  it("includes both ends and leaves No year outside the span", async () => {
    const inside = ["1945", "1952", "1960"];
    assert.deepEqual(await issues("1945-1960"), of(issueOf, inside));
    assert.deepEqual(await stamps("1945-1960"), of(stampOf, inside));
    assert.deepEqual(await wants("1945-1960"), of(wantOf, inside));
  });

  it("takes one open end as the years onwards, or the years up to it", async () => {
    assert.deepEqual(await issues("1960-"), of(issueOf, ["1960", "1961"]));
    assert.deepEqual(await stamps("-1945"), of(stampOf, ["1944", "1945"]));
    assert.deepEqual(await wants("1952-"), of(wantOf, ["1952", "1960", "1961"]));
  });

  it("still selects one year, and No year on its own", async () => {
    assert.deepEqual(await stamps("1952"), of(stampOf, ["1952"]));
    assert.deepEqual(await wants("none"), of(wantOf, ["none"]));
  });

  it("counts the span on the area tree as the list holds it", async () => {
    const issueAreas = await listIssueAreaFacets(userId, collectionId, {
      ...readYearFilter("1945-1960"),
    });
    assert.equal(issueAreas.find((f) => f.areaId === areaId)?.count, 3);
    const stampAreas = await listStampAreaFacets(userId, collectionId, {
      ...readYearFilter("-1952"),
    });
    assert.equal(stampAreas.find((f) => f.areaId === areaId)?.count, 3);
  });
});
