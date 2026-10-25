import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { buildOpenApiDocument } from "../../src/lib/agent-api/openapi";
import { GET } from "../../src/app/api/v1/[...path]/route";

// **`list_issues` (#2167), driven through the real route with real tokens.** The *Done when* as
// calls: an area's issues with and without its sub-areas, narrowed by years and by text, paged with a
// total, each row with its range, its own prefixes, its counts and its held copies by condition — and
// a read-only token served. `tests/unit/agent-api-issue-list-reads.test.ts` holds the row and the fold.

const ts = Date.now();

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

interface Row {
  issueId: string;
  issueNo: number;
  name?: string;
  translatedNames?: Record<string, string>;
  year?: number;
  area?: string;
  catalogRanges: string[];
  prefixes?: string[];
  memberCount: number;
  requiredCount: number;
  heldCopies: number;
  heldByCondition: { condition: string; copies: number }[];
  path: string;
}

interface Answer {
  items: Row[];
  total: number;
  nextCursor: string | null;
}

async function call(token: string, path: string) {
  const request = new NextRequest(`http://localhost/api/v1${path.replaceAll(" ", "%20")}`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  const response = await GET(request, {
    params: Promise.resolve({ path: path.split("?")[0].split("/").filter(Boolean) }),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

describe("list_issues (#2167)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let castles: string;

  const list = async (query: string) => {
    const answer = await call(token, `/issues?${query}`);
    assert.equal(answer.status, 200, `${query} → ${JSON.stringify(answer.body)}`);
    return answer.body as Answer;
  };
  const names = (answer: Answer) => answer.items.map((row) => row.name);

  before(async () => {
    userId = `test-user-listissues-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User listissues-${ts}`,
        email: `test-listissues-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-listissues-${ts}`, name: "List issues", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const michel = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });

    const poland = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Poland",
        sortOrder: 0,
        collectionAreaVendors: { create: [{ catalogVendorId: michel.id, areaPrefix: "PL" }] },
      },
    });
    const gg = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Generalgouvernement",
        parentId: poland.id,
        collectionAreaVendors: { create: [{ catalogVendorId: michel.id, areaPrefix: "GG" }] },
      },
    });

    const mnh = await prisma.stampCondition.create({
      data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
    });
    const used = await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 } });

    const issue = async (issueNo: number, areaId: string, name: string, year: number | null, first: string, last: string) =>
      (
        await prisma.issue.create({
          data: {
            collectionId,
            issueNo,
            collectionAreaId: areaId,
            name,
            year,
            primaryCatalogSortKey: first.padStart(6, "0"),
            catalogNumbers: { create: [{ catalogVendorId: michel.id, firstNumber: first, lastNumber: last }] },
          },
        })
      ).id;
    castles = await issue(1, gg.id, "Castles", 1940, "1", "5");
    await issue(2, gg.id, "Buildings", 1941, "60", "64");
    await issue(3, poland.id, "Warsaw", 1938, "300", "302");
    await issue(4, poland.id, "Undated", null, "900", "900");
    await prisma.issueTranslation.create({ data: { issueId: castles, language: "pl", name: "Zamki" } });
    await prisma.issueCatalogPrefix.create({ data: { issueId: castles, catalogVendorId: michel.id, areaPrefix: "GGX" } });

    const stamp = async (number: string, issueId: string) => {
      const created = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Tower ${number}`,
          catalogNumbers: { create: [{ catalogVendorId: michel.id, number }] },
        },
      });
      await prisma.issueMember.create({ data: { issueId, stampId: created.id } });
      return created.id;
    };
    const one = await stamp("1", castles);
    const two = await stamp("2", castles);
    let itemNo = 0;
    const copy = (stampId: string, conditionId: string, extra = {}) =>
      prisma.item.create({ data: { collectionId, itemNo: ++itemNo, stampId, conditionId, ...extra } });
    await copy(one, mnh.id);
    await copy(one, mnh.id);
    await copy(two, used.id);
    // Gone: not held.
    await copy(two, used.id, { disposedAt: new Date() });

    token = (await createAssistantToken(userId, collectionId, { label: "issues agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "issues agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId, parentId: { not: null } } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("lists an area's issues with its sub-areas, in the Issues list's order, with a total", async () => {
    const answer = await list("area=Poland");
    assert.deepEqual(names(answer), ["Warsaw", "Castles", "Buildings", "Undated"]);
    assert.equal(answer.total, 4);
    assert.equal(answer.nextCursor, null);
  });

  it("lists only the area's own issues when sub_areas is false", async () => {
    assert.deepEqual(names(await list("area=Poland&sub_areas=false")), ["Warsaw", "Undated"]);
  });

  it("states each issue as the Issues list does, held copies by condition", async () => {
    const [row] = (await list("area=Generalgouvernement&text=Castles")).items;
    assert.equal(row.issueId, castles);
    assert.equal(row.issueNo, 1);
    assert.equal(row.year, 1940);
    assert.equal(row.area, "Generalgouvernement");
    assert.deepEqual(row.translatedNames, { pl: "Zamki" });
    assert.deepEqual(row.catalogRanges, ["Mi·GGX 1–5"]);
    assert.deepEqual(row.prefixes, ["Mi: GGX"]);
    assert.equal(row.memberCount, 2);
    assert.equal(row.heldCopies, 3);
    assert.deepEqual(row.heldByCondition, [
      { condition: "Mint Never Hinged", copies: 2 },
      { condition: "Used", copies: 1 },
    ]);
    assert.ok(row.path.endsWith(`/issues/${castles}`));

    const [buildings] = (await list("area=Generalgouvernement&text=Buildings")).items;
    assert.equal(buildings.prefixes, undefined);
    assert.deepEqual(buildings.catalogRanges, ["Mi·GG 60–64"]);
    assert.equal(buildings.heldCopies, 0);
    assert.deepEqual(buildings.heldByCondition, []);
  });

  it("narrows by a span of years, leaving out issues with no year", async () => {
    assert.deepEqual(names(await list("area=Poland&year_from=1940&year_to=1941")), ["Castles", "Buildings"]);
    assert.deepEqual(names(await list("area=Poland&year_from=1940&year_to=1940")), ["Castles"]);
    assert.deepEqual(names(await list("area=Poland&year_to=1939")), ["Warsaw"]);
  });

  it("narrows by text as the Issues list's search does, with or without an area", async () => {
    assert.deepEqual(names(await list("text=Tower")), ["Castles"]);
    assert.deepEqual(names(await list("text=Mi GG 64")), ["Buildings"]);
    assert.deepEqual(names(await list("text=%233")), ["Warsaw"]);
  });

  it("pages, the total counting every page", async () => {
    const first = await list("area=Poland&limit=3");
    assert.deepEqual(names(first), ["Warsaw", "Castles", "Buildings"]);
    assert.equal(first.total, 4);
    assert.ok(first.nextCursor);
    const second = await list(`area=Poland&limit=3&cursor=${first.nextCursor}`);
    assert.deepEqual(names(second), ["Undated"]);
    assert.equal(second.nextCursor, null);
  });

  it("refuses a call with neither area nor text, a backwards span, and an unknown area", async () => {
    const none = await call(token, "/issues?year_from=1940");
    assert.equal(none.status, 400);
    assert.deepEqual((none.body as ApiErrorBody).error.accepted, ["area", "text"]);
    assert.equal((await call(token, "/issues?area=Poland&year_from=1945&year_to=1940")).status, 400);
    const unknown = await call(token, "/issues?area=Atlantis");
    assert.equal(unknown.status, 400);
    assert.ok((unknown.body as ApiErrorBody).error.accepted?.includes("Poland"));
  });

  it("serves a read-only token, and is in the document as a read", async () => {
    assert.equal((await call(readOnlyToken, "/issues?area=Poland")).status, 200);
    const operation = OPERATIONS.find((op) => op.name === "list_issues");
    assert.equal(operation?.writes, false);
    const document = buildOpenApiDocument(OPERATIONS, { appVersion: "test" }) as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    assert.equal(document.paths["/api/v1/issues"]?.get?.operationId, "list_issues");
    assert.equal(document.paths["/api/v1/issues"]?.post?.operationId, "create_issue");
  });
});
