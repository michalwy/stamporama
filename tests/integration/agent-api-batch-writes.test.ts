import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { buildOpenApiDocument } from "../../src/lib/agent-api/openapi";
import { GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentColnectIdBatch } from "../../src/lib/agent-api/colnect-ids";
import type { AgentIssueBatch, AgentStampNumbersBatch } from "../../src/lib/agent-api/operations/catalog-edits";

// **The batch forms of three single writes (#2173, #2174, #2175), driven through the real route with
// real tokens.** `tests/unit/agent-api-batch.test.ts` holds the item grammars and the per-item
// answer. This file holds the *Done when* as calls: many items in one call, each answered on its own
// — written, unchanged or refused, created or refused — a refused one stopping none of the others,
// the items applied in the order sent, the single call's rules holding for each, and a read-only
// token refused.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH";
const HANDLERS = { GET, POST, PATCH };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

async function call(token: string, method: Method, path: string, body?: unknown) {
  const request = new NextRequest(`http://localhost/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: path.split("/").filter(Boolean) }),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

async function ok<T>(token: string, method: Method, path: string, body?: unknown): Promise<T> {
  const answer = await call(token, method, path, body);
  assert.equal(answer.status, 200, `${method} ${path} → ${JSON.stringify(answer.body)}`);
  return answer.body as T;
}

async function refused(token: string, method: Method, path: string, body?: unknown) {
  const answer = await call(token, method, path, body);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  return { status: answer.status, error: (answer.body as ApiErrorBody).error };
}

describe("the batch writes (#2173, #2174, #2175)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let michelId: string;
  let s501: string, s502: string, s503: string;
  /** Two stamps both catalogued `Mi 600`, so the number names neither. */
  let dupA: string, dupB: string;

  const colnectIdOf = async (stampId: string) =>
    (await prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: { colnectId: true } })).colnectId;
  const numbersOf = async (stampId: string) =>
    (
      await prisma.stampCatalogNumber.findMany({
        where: { stampId },
        select: { catalogVendor: { select: { abbreviation: true } }, number: true },
        orderBy: { catalogVendor: { name: "asc" } },
      })
    ).map((row) => `${row.catalogVendor.abbreviation} ${row.number}`);

  before(async () => {
    userId = `test-user-batch-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User batch-${ts}`,
        email: `test-batch-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-batch-${ts}`, name: "Batch writes", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    michelId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    const fischerId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Fischer", abbreviation: "Fi" } })).id;
    // A catalogue the collection has and the area does not keep.
    await prisma.catalogVendor.create({ data: { collectionId, name: "Scott", abbreviation: "Sc" } });
    const areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Germany",
          primaryCatalogVendorId: michelId,
          collectionAreaVendors: { create: [{ catalogVendorId: michelId }, { catalogVendorId: fischerId }] },
        },
      })
    ).id;

    const stamp = async (number: string) =>
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Germania ${number}`,
            catalogNumbers: { create: [{ catalogVendorId: michelId, number }] },
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
    s501 = await stamp("501");
    s502 = await stamp("502");
    s503 = await stamp("503");
    dupA = await stamp("600");
    dupB = await stamp("600");

    token = (await createAssistantToken(userId, collectionId, { label: "batch agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "batch agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("set_stamp_colnect_ids (#2173)", () => {
    it("writes many pairs in one call, each answered on its own, a refused pair stopping none", async () => {
      await prisma.stamp.update({ where: { id: s503 }, data: { colnectId: "300" } });
      const answer = await ok<AgentColnectIdBatch>(token, "POST", "/stamp-colnect-ids", {
        pairs: [
          "stamp=Mi 501; colnect_id=100",
          "stamp=Mi 600; colnect_id=1",
          `stamp=${s502}; colnect_id=https://colnect.com/en/stamps/stamp/200-Germania`,
          "stamp=Mi 503; colnect_id=300",
          "stamp=Mi 501; colnect_id=101",
          "stamp=Mi 999; colnect_id=2",
          "colnect_id=3",
        ],
      });
      assert.deepEqual([answer.written, answer.unchanged, answer.refused], [2, 1, 4]);
      assert.deepEqual(
        answer.pairs.map((pair) => [pair.index, pair.status]),
        [[0, "written"], [1, "refused"], [2, "written"], [3, "unchanged"], [4, "refused"], [5, "refused"], [6, "refused"]]
      );
      const first = answer.pairs[0];
      assert.ok(first.status === "written");
      assert.deepEqual(
        [first.entry, first.stampId, first.colnectId, first.catalogNumbers],
        ["stamp=Mi 501; colnect_id=100", s501, "100", ["Mi 501"]]
      );
      const ambiguous = answer.pairs[1];
      assert.ok(ambiguous.status === "refused");
      assert.deepEqual([...(ambiguous.accepted ?? [])].sort(), [dupA, dupB].sort());
      const twice = answer.pairs[4];
      assert.ok(twice.status === "refused");
      assert.match(twice.reason, /same stamp as the pair at index 0/);
      const unknown = answer.pairs[5];
      assert.ok(unknown.status === "refused");
      assert.match(unknown.reason, /Mi 999/);
      assert.deepEqual([await colnectIdOf(s501), await colnectIdOf(s502), await colnectIdOf(s503)], ["100", "200", "300"]);
      assert.deepEqual([await colnectIdOf(dupA), await colnectIdOf(dupB)], [null, null]);
    });

    it("applies the pairs in the order sent, so an ID given to two stamps goes to the first and the second is refused naming it", async () => {
      const answer = await ok<AgentColnectIdBatch>(token, "POST", "/stamp-colnect-ids", {
        pairs: ["stamp=Mi 502; colnect_id=777", "stamp=Mi 503; colnect_id=777", "stamp=Mi 501; colnect_id=200"],
      });
      assert.deepEqual(answer.pairs.map((pair) => pair.status), ["written", "refused", "written"]);
      const held = answer.pairs[1];
      assert.ok(held.status === "refused");
      assert.match(held.reason, /777 already belongs to "Germania 502"/);
      assert.deepEqual(held.accepted, [s502]);
      const changed = answer.pairs[0];
      assert.ok(changed.status === "written");
      assert.equal(changed.replaced, "200", "the ID a change took off is named, as the single call names it");
      // `Mi 501` takes 200 only because `Mi 502` gave it up earlier in the same call.
      assert.deepEqual([await colnectIdOf(s501), await colnectIdOf(s502), await colnectIdOf(s503)], ["200", "777", "300"]);
    });

    it("refuses an empty call and one over 100 pairs, writing nothing", async () => {
      const empty = await refused(token, "POST", "/stamp-colnect-ids", { pairs: [] });
      assert.equal(empty.status, 400);
      const over = await refused(token, "POST", "/stamp-colnect-ids", {
        pairs: Array.from({ length: 101 }, (_, i) => `stamp=Mi 501; colnect_id=${9000 + i}`),
      });
      assert.match(over.error.message, /at most 100/);
      assert.equal(await colnectIdOf(s501), "200");
    });
  });

  describe("update_stamps (#2174)", () => {
    it("corrects many stamps' numbers in one call, only the catalogues named changing, each answered on its own", async () => {
      await prisma.stampCatalogNumber.create({
        data: { stampId: s502, catalogVendorId: (await prisma.catalogVendor.findFirstOrThrow({ where: { collectionId, abbreviation: "Fi" } })).id, number: "77" },
      });
      const answer = await ok<AgentStampNumbersBatch>(token, "PATCH", "/stamps", {
        updates: [
          "stamp=Mi 501; catalog_numbers=Mi: 501a, Fi: 61",
          "stamp=Mi 502; catalog_numbers=Mi: 502",
          "stamp=Mi 503; catalog_numbers=Mi: 600",
          `stamp=${dupA}; catalog_numbers=Sc: 1`,
          `stamp=${s503}; catalog_numbers=Mi: 503-504`,
          "stamp=st 999999; catalog_numbers=Mi: 1",
          "stamp=Mi 502; catalog_numbers=Fi: 78",
        ],
      });
      assert.deepEqual([answer.written, answer.unchanged, answer.refused], [1, 1, 5]);
      assert.deepEqual(
        answer.updates.map((update) => update.status),
        ["written", "unchanged", "refused", "refused", "refused", "refused", "refused"]
      );
      const written = answer.updates[0];
      assert.ok(written.status === "written");
      assert.deepEqual([written.stampId, written.catalogNumbers, written.replaced], [s501, ["Mi 501a", "Fi 61"], ["Mi 501"]]);
      const duplicate = answer.updates[2];
      assert.ok(duplicate.status === "refused");
      assert.match(duplicate.reason, /600/);
      assert.deepEqual([...(duplicate.accepted ?? [])].sort(), [dupA, dupB].sort());
      const notKept = answer.updates[3];
      assert.ok(notKept.status === "refused");
      assert.match(notKept.reason, /does not keep the catalogue "Sc"/);
      const twice = answer.updates[4];
      assert.ok(twice.status === "refused");
      assert.match(twice.reason, /same stamp as the update at index 2/);
      const unknown = answer.updates[5];
      assert.ok(unknown.status === "refused");
      assert.match(unknown.reason, /st 999999/);

      assert.deepEqual(await numbersOf(s501), ["Fi 61", "Mi 501a"]);
      assert.deepEqual(await numbersOf(s502), ["Fi 77", "Mi 502"], "an unchanged stamp, and the second update of it refused");
      assert.deepEqual(await numbersOf(s503), ["Mi 503"]);
      const name = await prisma.stamp.findUniqueOrThrow({ where: { id: s501 }, select: { name: true } });
      assert.equal(name.name, "Germania 501", "nothing but the numbers sent changes");
    });

    it("refuses a run and applies the updates in the order sent, so a number one stamp takes is refused on the next", async () => {
      const answer = await ok<AgentStampNumbersBatch>(token, "PATCH", "/stamps", {
        updates: ["stamp=Mi 503; catalog_numbers=Mi: 503-504", "stamp=Mi 502; catalog_numbers=Fi: 90", `stamp=${s501}; catalog_numbers=Fi: 90`],
      });
      assert.deepEqual(answer.updates.map((update) => update.status), ["refused", "written", "refused"]);
      const run = answer.updates[0];
      assert.ok(run.status === "refused");
      assert.match(run.reason, /a run of 2 numbers/);
      const taken = answer.updates[2];
      assert.ok(taken.status === "refused");
      assert.deepEqual(taken.accepted, [s502]);
      assert.deepEqual(await numbersOf(s501), ["Fi 61", "Mi 501a"]);
      assert.deepEqual(await numbersOf(s502), ["Fi 90", "Mi 502"]);
    });

    it("leaves update_stamp's own path alone", async () => {
      const read = await ok<{ stampId: string }>(token, "GET", `/stamps/${s503}`);
      assert.equal(read.stampId, s503);
    });
  });

  describe("create_issues (#2175)", () => {
    it("creates many issues in one call, each with its stamps, a refused one leaving nothing behind and stopping none", async () => {
      const issuesBefore = await prisma.issue.count({ where: { collectionId } });
      const answer = await ok<AgentIssueBatch>(token, "POST", "/issues/batch", {
        issues: [
          "area=Germany\nyear=1950\nname=Posthorn\ncatalog_numbers=Mi: 700-702\ncatalog_numbers=Fi: 800-802",
          "area=Germany\nyear=1951\nname=Clashes\ncatalog_numbers=Mi: 703, 600",
          "area=Germany\nyear=1839\nname=Too early",
          "area=Germany\nyear=1952\nname=Ranges only\ncatalog_numbers=Mi: 710-711\ngenerate_stamps=false",
          "area=Germany\nyear=1953\nname=Later\ncatalog_numbers=Mi: 702",
          "area=Nowhere\nname=Lost",
          "area=Germany\nname=First\nname=Second",
          "area=Germany\nyear=1954\nname=Last\ncatalog_numbers=Mi: 720",
        ],
      });
      assert.deepEqual([answer.created, answer.refused], [3, 5]);
      assert.deepEqual(
        answer.issues.map((issue) => [issue.index, issue.status]),
        [[0, "created"], [1, "refused"], [2, "refused"], [3, "created"], [4, "refused"], [5, "refused"], [6, "refused"], [7, "created"]]
      );

      const first = answer.issues[0];
      assert.ok(first.status === "created");
      assert.deepEqual([first.issue.name, first.issue.year], ["Posthorn", 1950]);
      assert.deepEqual(
        first.issue.createdStamps.map((stamp) => stamp.catalogNumbers),
        [["Mi 700", "Fi 800"], ["Mi 701", "Fi 801"], ["Mi 702", "Fi 802"]]
      );
      const rangesOnly = answer.issues[3];
      assert.ok(rangesOnly.status === "created");
      assert.deepEqual(rangesOnly.issue.createdStamps, []);

      const clash = answer.issues[1];
      assert.ok(clash.status === "refused");
      assert.deepEqual([...(clash.accepted ?? [])].sort(), [dupA, dupB].sort());
      const early = answer.issues[2];
      assert.ok(early.status === "refused");
      assert.match(early.reason, /1840/);
      // `Mi 702` was generated by the first issue of this same call.
      const later = answer.issues[4];
      assert.ok(later.status === "refused");
      assert.deepEqual(later.accepted, [first.issue.createdStamps[2].stampId]);
      const twice = answer.issues[6];
      assert.ok(twice.status === "refused");
      assert.match(twice.reason, /names "name" twice/);

      assert.equal(await prisma.issue.count({ where: { collectionId } }), issuesBefore + 3);
      assert.equal(await prisma.issue.count({ where: { collectionId, name: { in: ["Clashes", "Too early", "Later"] } } }), 0);
      assert.equal(await prisma.stampCatalogNumber.count({ where: { catalogVendorId: michelId, number: "703" } }), 0);
    });

    it("refuses an empty call and one over 25 issues, creating nothing", async () => {
      const before = await prisma.issue.count({ where: { collectionId } });
      await refused(token, "POST", "/issues/batch", { issues: [] });
      const over = await refused(token, "POST", "/issues/batch", {
        issues: Array.from({ length: 26 }, (_, i) => `area=Germany\nname=Bulk ${i}`),
      });
      assert.match(over.error.message, /at most 25/);
      assert.equal(await prisma.issue.count({ where: { collectionId } }), before);
    });
  });

  describe("the surface", () => {
    it("refuses a read-only token on every batch write, and writes nothing", async () => {
      const issues = await prisma.issue.count({ where: { collectionId } });
      for (const [method, path, body] of [
        ["POST", "/stamp-colnect-ids", { pairs: ["stamp=Mi 503; colnect_id=5"] }],
        ["PATCH", "/stamps", { updates: ["stamp=Mi 503; catalog_numbers=Mi: 503b"] }],
        ["POST", "/issues/batch", { issues: ["area=Germany\nname=Read only"] }],
      ] as const) {
        const err = await refused(readOnlyToken, method, path, body);
        assert.equal(err.status, 403, `${method} ${path}`);
        assert.ok(err.error.accepted?.includes("read_write"));
      }
      assert.equal(await colnectIdOf(s503), "300");
      assert.deepEqual(await numbersOf(s503), ["Mi 503"]);
      assert.equal(await prisma.issue.count({ where: { collectionId } }), issues);
    });

    it("publishes all three as writes in the OpenAPI document", () => {
      const document = buildOpenApiDocument(OPERATIONS, { appVersion: "test" }) as { paths: Record<string, Record<string, { operationId: string }>> };
      for (const [name, path, method] of [
        ["set_stamp_colnect_ids", "/stamp-colnect-ids", "post"],
        ["update_stamps", "/stamps", "patch"],
        ["create_issues", "/issues/batch", "post"],
      ]) {
        assert.equal(OPERATIONS.find((op) => op.name === name)?.writes, true, name);
        assert.equal(document.paths[`/api/v1${path}`]?.[method]?.operationId, name);
      }
    });
  });
});
