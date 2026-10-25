import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { addAlbumEntry, createAlbum } from "../../src/lib/albums";
import { addStampToIssue } from "../../src/lib/issues";
import { createItem } from "../../src/lib/items";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, POST } from "../../src/app/api/v1/[...path]/route";
import { buildOpenApiDocument } from "../../src/lib/agent-api/openapi";

// **A stamp moved between issues, a base stamp and an empty issue deleted, through the agent API
// (#2169, #2171, #2172)**, driven through the real route with real tokens.
// `tests/unit/agent-api-issue-tree.test.ts` holds the refusal sentences and
// `tests/unit/agent-api-operation-boundary.test.ts` holds *only this module moves a stamp between
// issues or deletes an issue*. This file holds the three *Done when*s as calls: a stamp moved with its
// variants, at the end or at a position, its checklist places following it; a clash under the
// target's prefix refused with both stamps named; `update_ranges` recomputing both issues; another
// area and a lone variant refused; a base stamp nothing holds deleted off its checklists and one
// something holds refused; an empty issue deleted with its checklists and one with stamps refused.

const ts = Date.now();
type Method = "POST" | "DELETE";
const HANDLERS = { POST, DELETE };

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

interface Moved {
  stamp: { stampId: string; stampNo: number };
  from: { issueId: string };
  to: { issueId: string };
  stampsMoved: { stampId: string }[];
  position: number;
  checklists: {
    left: { checklistId: string; stamps: number[] }[];
    joined: { checklistId: string; created: boolean; stamps: number[] };
  };
  ranges: { issueId: string; catalogue: string; before: string | null; after: string | null }[] | null;
}

let nextIssueNo = 9901;

describe("a stamp between issues, and deleting a base stamp or an empty issue, through the agent API (#2169, #2171, #2172)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let otherAreaId: string;
  let michelId: string;
  let conditionId: string;
  let token: string;
  let readOnlyToken: string;

  before(async () => {
    userId = `test-user-itree-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User itree-${ts}`,
        email: `test-itree-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-itree-${ts}`, name: "Issue tree", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    michelId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    const area = (name: string) =>
      prisma.collectionArea.create({
        data: {
          collectionId,
          name,
          primaryCatalogVendorId: michelId,
          collectionAreaVendors: { create: [{ catalogVendorId: michelId, areaPrefix: null }] },
        },
      });
    areaId = (await area("Poland")).id;
    otherAreaId = (await area("Germany")).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    await prisma.stampSubtype.create({ data: { collectionId, name: "Color", actsAsVariant: true, isDefault: true, sortOrder: 0 } });
    token = (await createAssistantToken(userId, collectionId, { label: "issue agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "issue agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.album.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function newIssue(name: string, area = areaId) {
    return (await prisma.issue.create({ data: { collectionId, issueNo: nextIssueNo++, collectionAreaId: area, name } })).id;
  }

  async function addStamp(issueId: string, number: string, parentStampId?: string) {
    const { stampId } = await addStampToIssue(userId, collectionId, issueId, {
      name: null,
      catalogNumbers: [{ catalogVendorId: michelId, number }],
      checklistIds: [],
      ...(parentStampId ? { parentStampId } : {}),
    });
    return stampId;
  }

  async function checklist(issueId: string, name: string, stampIds: string[], kind = "standard") {
    const id = (await prisma.checklist.create({ data: { collectionId, issueId, name, kind } })).id;
    await prisma.checklistStamp.createMany({ data: stampIds.map((stampId, i) => ({ checklistId: id, stampId, sortOrder: i })) });
    return id;
  }

  const membersOf = async (issueId: string) =>
    (await prisma.issueMember.findMany({ where: { issueId }, select: { stampId: true } })).map((row) => row.stampId).sort();
  const onChecklist = async (checklistId: string) =>
    (await prisma.checklistStamp.findMany({ where: { checklistId }, select: { stampId: true } })).map((row) => row.stampId).sort();
  const stampNo = async (stampId: string) => (await prisma.stamp.findUniqueOrThrow({ where: { id: stampId } })).stampNo;

  describe("move_stamp_to_issue (#2169)", () => {
    it("moves a stamp with its variants to the end of the target, its checklist places following it", async () => {
      const source = await newIssue("Fischer 361");
      const target = await newIssue("Fischer 3348");
      const stay = await addStamp(source, "510");
      const base = await addStamp(source, "511");
      const onStandard = await addStamp(source, "511a", base);
      const offChecklist = await addStamp(source, "511b", base);
      const first = await addStamp(target, "520");
      const sourceSet = await checklist(source, "Fischer 361", [stay, base, onStandard]);
      const special = await checklist(source, "Colours", [offChecklist], "specialised");
      const copy = await createItem(userId, collectionId, { stampId: base, conditionId, inCollection: true, deliveryState: "delivered" });

      const answer = await ok<Moved>(token, "POST", `/stamps/Mi 511/issue`, { issue_id: target });
      assert.equal(answer.stamp.stampId, base);
      assert.equal(answer.from.issueId, source);
      assert.equal(answer.to.issueId, target);
      assert.deepEqual(answer.stampsMoved.map((row) => row.stampId), [base, onStandard, offChecklist]);
      assert.equal(answer.position, 2);
      assert.equal(answer.ranges, null);
      assert.deepEqual(await membersOf(source), [stay]);
      assert.deepEqual(await membersOf(target), [first, base, onStandard, offChecklist].sort());

      // It left both source checklists; it and the variant that was on the standard one joined the
      // target's standard checklist, created for it — the variant that was on none joined none.
      assert.deepEqual(await onChecklist(sourceSet), [stay]);
      assert.deepEqual(await onChecklist(special), []);
      assert.deepEqual(answer.checklists.left.map((row) => row.checklistId).sort(), [sourceSet, special].sort());
      assert.equal(answer.checklists.joined.created, true);
      assert.deepEqual(answer.checklists.joined.stamps, [await stampNo(base), await stampNo(onStandard)]);
      assert.deepEqual(await onChecklist(answer.checklists.joined.checklistId), [base, onStandard].sort());

      // Its numbers and copies are where they were.
      assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: copy.id } })).stampId, base);
      assert.deepEqual(
        (await prisma.stampCatalogNumber.findMany({ where: { stampId: base }, select: { number: true } })).map((row) => row.number),
        ["511"]
      );
    });

    it("puts it at a position among the target's top-level stamps, and joins an existing standard checklist", async () => {
      const source = await newIssue("Pos source");
      const target = await newIssue("Pos target");
      const moving = await addStamp(source, "610");
      const a = await addStamp(target, "600");
      const b = await addStamp(target, "620");
      const set = await checklist(target, "Pos target", [a, b]);

      const answer = await ok<Moved>(token, "POST", `/stamps/${moving}/issue`, { issue_id: target, position: 2 });
      assert.equal(answer.position, 2);
      assert.equal(answer.checklists.joined.checklistId, set);
      assert.equal(answer.checklists.joined.created, false);
      const order = await prisma.issueMember.findMany({
        where: { issueId: target },
        orderBy: [{ sortOrder: "asc" }, { stampId: "asc" }],
        select: { stampId: true },
      });
      assert.deepEqual(order.map((row) => row.stampId), [a, moving, b]);

      const tooFar = await refused(token, "POST", `/stamps/${b}/issue`, { issue_id: source, position: 5 });
      assert.match(tooFar.error.message, /"position" must be between 1 and 1/);
    });

    it("recomputes both issues' declared ranges when asked", async () => {
      const source = await newIssue("Ranges source");
      const target = await newIssue("Ranges target");
      const s1 = await addStamp(source, "700");
      const s2 = await addStamp(source, "701");
      const s3 = await addStamp(source, "702");
      const t1 = await addStamp(target, "703");
      await checklist(source, "Ranges source", [s1, s2, s3]);
      await checklist(target, "Ranges target", [t1]);
      await prisma.issueCatalogNumber.create({ data: { issueId: source, catalogVendorId: michelId, firstNumber: "700", lastNumber: "702" } });
      await prisma.issueCatalogNumber.create({ data: { issueId: target, catalogVendorId: michelId, firstNumber: "703", lastNumber: null } });

      const answer = await ok<Moved>(token, "POST", `/stamps/${s3}/issue`, { issue_id: target, update_ranges: true });
      assert.deepEqual(answer.ranges, [
        { issueId: source, catalogue: "Mi", before: "700-702", after: "700-701" },
        { issueId: target, catalogue: "Mi", before: "703", after: "702-703" },
      ]);
    });

    it("refuses a number that clashes under the target's own prefix, naming both stamps", async () => {
      const source = await newIssue("Prefix source");
      const target = await newIssue("Prefix target");
      const elsewhere = await newIssue("Prefix holder");
      await prisma.issueCatalogPrefix.createMany({
        data: [
          { issueId: target, catalogVendorId: michelId, areaPrefix: "GG" },
          { issueId: elsewhere, catalogVendorId: michelId, areaPrefix: "GG" },
        ],
      });
      const moving = await addStamp(source, "805");
      const holder = await addStamp(elsewhere, "805");

      const clash = await refused(token, "POST", `/stamps/${moving}/issue`, { issue_id: target });
      assert.equal(clash.error.code, "invalid_request");
      assert.match(clash.error.message, /Mi 805 \(st \d+\) would read as Mi·GG 805 under iss \d+ "Prefix target"/);
      assert.match(clash.error.message, new RegExp(`id ${holder}`));
      assert.deepEqual(clash.error.accepted, [holder]);
      assert.deepEqual(await membersOf(source), [moving]);
    });

    it("refuses another area, a lone variant, a stamp already there, and a read-only token", async () => {
      const source = await newIssue("Refuse source");
      const sameArea = await newIssue("Refuse target");
      const abroad = await newIssue("Abroad", otherAreaId);
      const base = await addStamp(source, "900");
      const variant = await addStamp(source, "900a", base);

      assert.match((await refused(token, "POST", `/stamps/${base}/issue`, { issue_id: abroad })).error.message, /another area/);
      assert.match((await refused(token, "POST", `/stamps/${variant}/issue`, { issue_id: sameArea })).error.message, /is a variant of/);
      assert.match((await refused(token, "POST", `/stamps/${base}/issue`, { issue_id: source })).error.message, /already filed under that issue/);
      assert.equal((await refused(readOnlyToken, "POST", `/stamps/${base}/issue`, { issue_id: sameArea })).status, 403);
      assert.deepEqual(await membersOf(source), [base, variant].sort());
    });
  });

  describe("delete_stamp (#2171)", () => {
    it("deletes a base stamp nothing holds, off its checklists, and names them", async () => {
      const issueId = await newIssue("Delete base");
      const keep = await addStamp(issueId, "1000");
      const mistake = await addStamp(issueId, "1001");
      const set = await checklist(issueId, "Delete base", [keep, mistake]);

      const answer = await ok<{
        deleted: { stampId: string; issueIds: string[] };
        checklistsLeft: { checklistId: string; name: string }[];
      }>(token, "DELETE", `/stamps/st ${await stampNo(mistake)}/base`);
      assert.equal(answer.deleted.stampId, mistake);
      assert.deepEqual(answer.deleted.issueIds, [issueId]);
      assert.deepEqual(answer.checklistsLeft, [{ checklistId: set, name: "Delete base", issueId }]);
      assert.equal(await prisma.stamp.count({ where: { id: mistake } }), 0);
      assert.deepEqual(await onChecklist(set), [keep]);
    });

    it("refuses a base stamp something holds, and a variant, with nothing changed", async () => {
      const issueId = await newIssue("Held base");
      const withCopy = await addStamp(issueId, "1100");
      const copy = await createItem(userId, collectionId, { stampId: withCopy, conditionId, inCollection: true, deliveryState: "delivered" });
      const withVariant = await addStamp(issueId, "1101");
      const variant = await addStamp(issueId, "1101a", withVariant);

      const byCopy = await refused(token, "DELETE", `/stamps/${withCopy}/base`);
      const itemNo = (await prisma.item.findUniqueOrThrow({ where: { id: copy.id } })).itemNo;
      assert.match(byCopy.error.message, new RegExp(`1 copy \\(#${itemNo}\\)`));
      assert.match((await refused(token, "DELETE", `/stamps/${withVariant}/base`)).error.message, /variant of its own/);
      assert.match((await refused(token, "DELETE", `/stamps/${variant}/base`)).error.message, /delete_stamp_variant/);
      assert.match((await refused(token, "DELETE", `/stamps/${withCopy}`)).error.message, /delete_stamp`/);
      assert.equal((await refused(readOnlyToken, "DELETE", `/stamps/${withCopy}/base`)).status, 403);
      assert.equal(await prisma.stamp.count({ where: { id: { in: [withCopy, withVariant, variant] } } }), 3);
    });
  });

  describe("delete_issue (#2172)", () => {
    it("deletes an empty issue with its empty checklists", async () => {
      const issueId = await newIssue("Empty");
      await checklist(issueId, "Empty", []);
      const answer = await ok<{ deleted: { issueId: string; area: string }; removedWithIt: { checklists: string[] } }>(
        token,
        "DELETE",
        `/issues/${issueId}`
      );
      assert.equal(answer.deleted.issueId, issueId);
      assert.equal(answer.deleted.area, "Poland");
      assert.deepEqual(answer.removedWithIt.checklists, ["Empty"]);
      assert.equal(await prisma.issue.count({ where: { id: issueId } }), 0);
      assert.equal(await prisma.checklist.count({ where: { issueId } }), 0);
    });

    it("refuses an issue with stamps, saying how many, and one whose checklist an album prints", async () => {
      const full = await newIssue("Full");
      const base = await addStamp(full, "1200");
      await addStamp(full, "1200a", base);
      const withStamps = await refused(token, "DELETE", `/issues/${full}`);
      assert.match(withStamps.error.message, /it has 2 stamps \(1 at the top level and 1 variant\)/);

      // The album first, so its first gathering does not already take the checklist in.
      const albumId = await createAlbum(userId, collectionId, { name: "Binder", collectionAreaId: areaId, language: "en" }, null);
      const printed = await newIssue("Printed");
      const set = await checklist(printed, "Printed", []);
      await addAlbumEntry(userId, albumId, set);
      assert.match((await refused(token, "DELETE", `/issues/${printed}`)).error.message, /"Printed" is printed in "Binder"/);

      assert.equal((await refused(readOnlyToken, "DELETE", `/issues/${printed}`)).status, 403);
      assert.equal(await prisma.issue.count({ where: { id: { in: [full, printed] } } }), 2);
      assert.equal(await prisma.stamp.count({ where: { id: base } }), 1);
    });
  });

  it("publishes the three operations as writes in the registry and the document", () => {
    const document = buildOpenApiDocument(OPERATIONS, { appVersion: "test" }) as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    const published = new Set(
      Object.values(document.paths).flatMap((methods) => Object.values(methods).map((entry) => entry.operationId))
    );
    for (const [name, path, method] of [
      ["move_stamp_to_issue", "/stamps/{stamp_id}/issue", "POST"],
      ["delete_stamp", "/stamps/{stamp_id}/base", "DELETE"],
      ["delete_issue", "/issues/{issue_id}", "DELETE"],
    ] as const) {
      const operation = OPERATIONS.find((op) => op.name === name);
      assert.equal(operation?.writes, true, name);
      assert.equal(operation?.path, path, name);
      assert.equal(operation?.method, method, name);
      assert.ok(published.has(name), `${name} is not in the document`);
    }
  });
});
