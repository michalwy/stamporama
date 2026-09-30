import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { addAlbumEntry, createAlbum } from "../../src/lib/albums";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentChecklist, AgentChecklistStamp, AgentNamedStamp, AgentUnfoundStamp } from "../../src/lib/agent-api/checklist-reads";
import type { ListResponse } from "../../src/lib/agent-api/list";
import type { AgentIssueDetail } from "../../src/lib/agent-api/collection-reads";
import type { AgentCreatedStamp } from "../../src/lib/agent-api/operations/catalog-edits";

// **Checklists through the agent API (#1512), driven through the real route with real tokens.**
// `tests/unit/agent-api-checklist-reads.test.ts` holds the order they are listed in and the refusals'
// wording; `tests/unit/agent-api-operation-boundary.test.ts` holds *these checklist writes and no
// other catalogue delete, move or reorder* as a fact about imports. This file holds the *Done when*
// as calls: a checklist created on an issue and one spanning issues, renamed and translated, stamps
// added, removed and put in order and read back, a stamp of another issue refused on an issue's own
// checklist, removing and ordering idempotent over entries they cannot place, a checklist an album
// prints refused a delete naming the album, an unused one deleted with its stamps kept, a read-only
// token refused on every write, and the exact list of checklist operations.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

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
    params: Promise.resolve({ path: path.split("?")[0].split("/").filter(Boolean) }),
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

type Named = { checklist: AgentChecklist };
type StampsPage = ListResponse<AgentChecklistStamp> & Named;
type Added = Named & { added: AgentNamedStamp[]; alreadyOn: AgentNamedStamp[] };
type Removed = Named & { removed: AgentNamedStamp[]; notOnChecklist: AgentNamedStamp[]; notFound: AgentUnfoundStamp[] };
type Ordered = Named & { placed: number; keptAfter: number; notOnChecklist: AgentNamedStamp[]; notFound: AgentUnfoundStamp[] };

const CHECKLIST_OPERATIONS = [
  "GET /checklists list_checklists",
  "GET /checklists/{checklist_id}/stamps list_checklist_stamps",
  "POST /checklists create_checklist",
  "PATCH /checklists/{checklist_id} update_checklist",
  "POST /checklists/{checklist_id}/stamps add_checklist_stamps",
  "POST /checklists/{checklist_id}/stamps/remove remove_checklist_stamps",
  "POST /checklists/{checklist_id}/order set_checklist_order",
  "DELETE /checklists/{checklist_id} delete_checklist",
];

describe("checklists through the agent API (#1512)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let polandId: string;
  /** Grosik, 1928: Mi 100–103. */
  let grosik: CreatedIssue;
  /** Later, 1930: Mi 200–201. */
  let later: CreatedIssue;
  const stamp: Record<string, string> = {};
  let imperforateId: string;
  let spanningId: string;

  type CreatedIssue = AgentIssueDetail & { createdStamps: AgentCreatedStamp[] };

  const stampCount = () => prisma.stamp.count({ where: { collectionId } });
  const readStamps = async (checklistId: string) =>
    (await ok<StampsPage>(token, "GET", `/checklists/${checklistId}/stamps`)).items.map((row) => row.catalogNumbers[0]);

  before(async () => {
    userId = `test-user-checklists-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User checklists-${ts}`,
        email: `test-checklists-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-checklists-${ts}`, name: "Checklists", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const michelId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    polandId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          catalogPrefix: "PL",
          primaryCatalogVendorId: michelId,
          collectionAreaVendors: { create: [{ catalogVendorId: michelId, areaPrefix: null }] },
        },
      })
    ).id;
    // A marketplace listing in German is what makes German a translation language (#293).
    await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true, titleLanguage: "de" } });
    token = (await createAssistantToken(userId, collectionId, { label: "checklist agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "checklist agent, read", scope: "read", kind: "agent" })
    ).token;

    grosik = await ok<CreatedIssue>(token, "POST", "/issues", {
      area: "Poland",
      year: 1928,
      name: "Grosik",
      catalog_numbers: ["Mi: 100-103"],
    });
    later = await ok<CreatedIssue>(token, "POST", "/issues", {
      area: "Poland",
      year: 1930,
      name: "Later",
      catalog_numbers: ["Mi: 200-201"],
    });
    for (const created of [...grosik.createdStamps, ...later.createdStamps]) {
      stamp[created.catalogNumbers[0]] = created.stampId;
    }
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.album.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.contact.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("reading", () => {
    it("lists each issue's own checklist, by year, with its issue", async () => {
      const list = await ok<ListResponse<AgentChecklist>>(token, "GET", "/checklists");
      assert.equal(list.total, 2);
      assert.deepEqual(
        list.items.map((row) => [row.name, row.spansIssues, row.issue?.name, row.stampCount]),
        [
          ["Grosik", false, "Grosik", 4],
          ["Later", false, "Later", 2],
        ]
      );
    });

    it("reads a checklist's stamps in order, a page at a time, with the full total", async () => {
      const checklistId = grosik.checklists[0].checklistId;
      const page = await ok<StampsPage>(token, "GET", `/checklists/${checklistId}/stamps?limit=2`);
      assert.equal(page.total, 4);
      assert.deepEqual(page.items.map((row) => [row.position, row.catalogNumbers[0]]), [
        [1, "Mi·PL 100"],
        [2, "Mi·PL 101"],
      ]);
      assert.equal(page.checklist.checklistId, checklistId);
      const next = await ok<StampsPage>(token, "GET", `/checklists/${checklistId}/stamps?limit=2&cursor=${page.nextCursor}`);
      assert.deepEqual(next.items.map((row) => row.position), [3, 4]);
      assert.equal(next.nextCursor, null);
    });

    it("refuses a checklist id that is not in the collection", async () => {
      const err = await refused(token, "GET", "/checklists/nope/stamps");
      assert.equal(err.status, 404);
      assert.equal(err.error.code, "not_found");
    });
  });

  describe("an issue's own checklist", () => {
    it("is created on the issue with its translated name", async () => {
      const created = await ok<AgentChecklist>(token, "POST", "/checklists", {
        name: "Imperforate",
        names: ["de: Geschnitten"],
        issue_id: grosik.issueId,
      });
      imperforateId = created.checklistId;
      assert.equal(created.spansIssues, false);
      assert.equal(created.issue?.issueId, grosik.issueId);
      assert.deepEqual(created.translatedNames, { de: "Geschnitten" });
      assert.equal(created.stampCount, 0);
    });

    it("takes the issue's stamps, in the order sent, and reports one already on it", async () => {
      const first = await ok<Added>(token, "POST", `/checklists/${imperforateId}/stamps`, { stamps: ["Mi 102", stamp["Mi·PL 100"]] });
      assert.deepEqual(first.added.map((row) => row.catalogNumbers[0]), ["Mi·PL 102", "Mi·PL 100"]);
      const again = await ok<Added>(token, "POST", `/checklists/${imperforateId}/stamps`, { stamps: ["Mi 100", "Mi 103"] });
      assert.deepEqual(again.added.map((row) => row.catalogNumbers[0]), ["Mi·PL 103"]);
      assert.deepEqual(again.alreadyOn.map((row) => row.catalogNumbers[0]), ["Mi·PL 100"]);
      assert.deepEqual(await readStamps(imperforateId), ["Mi·PL 102", "Mi·PL 100", "Mi·PL 103"]);
    });

    it("refuses a stamp of another issue, naming it, and adds nothing", async () => {
      const err = await refused(token, "POST", `/checklists/${imperforateId}/stamps`, { stamps: ["Mi 101", "Mi 200"] });
      assert.equal(err.error.code, "invalid_request");
      assert.match(err.error.message, /Mi·PL 200 is not/);
      assert.deepEqual(await readStamps(imperforateId), ["Mi·PL 102", "Mi·PL 100", "Mi·PL 103"]);
    });

    it("refuses a stamp the call cannot name, and adds nothing", async () => {
      const err = await refused(token, "POST", `/checklists/${imperforateId}/stamps`, { stamps: ["Mi 101", "Mi 999"] });
      assert.equal(err.error.code, "invalid_request");
      assert.equal((await readStamps(imperforateId)).length, 3);
    });
  });

  describe("a checklist spanning issues", () => {
    it("is created with no issue and reaches every issue its stamps are filed under", async () => {
      const created = await ok<AgentChecklist>(token, "POST", "/checklists", { name: "Grosik 1928–1932" });
      spanningId = created.checklistId;
      assert.equal(created.spansIssues, true);
      assert.equal(created.issue, undefined);
      const added = await ok<Added>(token, "POST", `/checklists/${spanningId}/stamps`, { stamps: ["Mi 201", "Mi 100"] });
      assert.equal(added.added.length, 2);
      assert.deepEqual(added.checklist.coversIssues?.map((issue) => issue.name), ["Grosik", "Later"]);
      assert.deepEqual(await readStamps(spanningId), ["Mi·PL 201", "Mi·PL 100"]);
    });

    it("says when another spanning checklist already has the name, and keeps it", async () => {
      const twin = await ok<AgentChecklist & { sameNameAs?: string[] }>(token, "POST", "/checklists", { name: "grosik 1928–1932" });
      assert.deepEqual(twin.sameNameAs, [spanningId]);
      await ok(token, "DELETE", `/checklists/${twin.checklistId}`);
    });

    it("is listed first, and narrowed by kind, issue and name", async () => {
      const all = await ok<ListResponse<AgentChecklist>>(token, "GET", "/checklists");
      assert.deepEqual(all.items.map((row) => row.name), ["Grosik 1928–1932", "Grosik", "Imperforate", "Later"]);
      const spanning = await ok<ListResponse<AgentChecklist>>(token, "GET", "/checklists?spanning=true");
      assert.deepEqual(spanning.items.map((row) => row.checklistId), [spanningId]);
      const onIssue = await ok<ListResponse<AgentChecklist>>(token, "GET", `/checklists?issue_id=${grosik.issueId}`);
      assert.deepEqual(onIssue.items.map((row) => row.name), ["Grosik", "Imperforate"]);
      const named = await ok<ListResponse<AgentChecklist>>(token, "GET", "/checklists?name=IMPERF");
      assert.deepEqual(named.items.map((row) => row.checklistId), [imperforateId]);
      const both = await refused(token, "GET", `/checklists?issue_id=${grosik.issueId}&spanning=true`);
      assert.equal(both.error.code, "invalid_request");
    });
  });

  describe("the order", () => {
    it("puts the stamps sent first, keeps the rest after them, and reports what it could not place", async () => {
      const ordered = await ok<Ordered>(token, "POST", `/checklists/${spanningId}/order`, {
        stamps: ["Mi 100", "Mi 999", stamp["Mi·PL 103"]],
      });
      assert.equal(ordered.placed, 1);
      assert.equal(ordered.keptAfter, 1);
      assert.deepEqual(ordered.notOnChecklist.map((row) => row.catalogNumbers[0]), ["Mi·PL 103"]);
      assert.deepEqual(ordered.notFound.map((row) => row.input), ["Mi 999"]);
      assert.deepEqual(await readStamps(spanningId), ["Mi·PL 100", "Mi·PL 201"]);
    });

    it("sets a whole order, and sending it again changes nothing", async () => {
      const body = { stamps: ["Mi 103", "Mi 100", "Mi 102"] };
      await ok<Ordered>(token, "POST", `/checklists/${imperforateId}/order`, body);
      assert.deepEqual(await readStamps(imperforateId), ["Mi·PL 103", "Mi·PL 100", "Mi·PL 102"]);
      const again = await ok<Ordered>(token, "POST", `/checklists/${imperforateId}/order`, body);
      assert.deepEqual([again.placed, again.keptAfter], [3, 0]);
      assert.deepEqual(await readStamps(imperforateId), ["Mi·PL 103", "Mi·PL 100", "Mi·PL 102"]);
    });
  });

  describe("removing stamps", () => {
    it("takes stamps off, keeps them in the catalogue and the rest in order, and reports what it could not", async () => {
      const before = await stampCount();
      const removed = await ok<Removed>(token, "POST", `/checklists/${imperforateId}/stamps/remove`, {
        stamps: ["Mi 100", "Mi 101", "bogus"],
      });
      assert.deepEqual(removed.removed.map((row) => row.catalogNumbers[0]), ["Mi·PL 100"]);
      assert.deepEqual(removed.notOnChecklist.map((row) => row.catalogNumbers[0]), ["Mi·PL 101"]);
      assert.deepEqual(removed.notFound.map((row) => row.input), ["bogus"]);
      assert.deepEqual(await readStamps(imperforateId), ["Mi·PL 103", "Mi·PL 102"]);
      assert.equal(await stampCount(), before);
    });

    it("is idempotent: removing the same stamp again removes nothing and refuses nothing", async () => {
      const again = await ok<Removed>(token, "POST", `/checklists/${imperforateId}/stamps/remove`, { stamps: ["Mi 100"] });
      assert.deepEqual(again.removed, []);
      assert.equal(again.notOnChecklist.length, 1);
      assert.deepEqual(await readStamps(imperforateId), ["Mi·PL 103", "Mi·PL 102"]);
    });
  });

  describe("renaming", () => {
    it("renames, sets a translation and clears another, changing only what was sent", async () => {
      const renamed = await ok<AgentChecklist>(token, "PATCH", `/checklists/${imperforateId}`, {
        name: "Imperforate set",
        clear_names: ["de"],
      });
      assert.equal(renamed.name, "Imperforate set");
      assert.equal(renamed.translatedNames, undefined);
      const translated = await ok<AgentChecklist>(token, "PATCH", `/checklists/${imperforateId}`, { names: ["de: Ungezähnt"] });
      assert.equal(translated.name, "Imperforate set");
      assert.deepEqual(translated.translatedNames, { de: "Ungezähnt" });
    });

    it("refuses an edit that changes nothing, and a language the collection does not keep", async () => {
      assert.equal((await refused(token, "PATCH", `/checklists/${imperforateId}`, {})).error.code, "invalid_request");
      const err = await refused(token, "PATCH", `/checklists/${imperforateId}`, { names: ["fr: Non dentelé"] });
      assert.deepEqual(err.error.accepted, ["de"]);
    });
  });

  describe("deleting", () => {
    it("refuses a checklist an album prints, naming the album, and deletes nothing", async () => {
      const albumId = await createAlbum(userId, collectionId, { name: "Binder", collectionAreaId: polandId, language: "en" }, null);
      await addAlbumEntry(userId, albumId, imperforateId);
      const listed = await ok<ListResponse<AgentChecklist>>(token, "GET", "/checklists?name=Imperforate");
      assert.deepEqual(listed.items[0].albums, ["Binder"]);
      const err = await refused(token, "DELETE", `/checklists/${imperforateId}`);
      assert.equal(err.error.code, "invalid_request");
      assert.match(err.error.message, /printed in the album "Binder"/);
      assert.ok(await prisma.checklist.findUnique({ where: { id: imperforateId } }));
    });

    it("deletes one nothing prints, keeping its stamps", async () => {
      const before = await stampCount();
      const deleted = await ok<{ deleted: { checklistId: string }; stampsKept: number }>(token, "DELETE", `/checklists/${spanningId}`);
      assert.deepEqual([deleted.deleted.checklistId, deleted.stampsKept], [spanningId, 2]);
      assert.equal(await prisma.checklist.findUnique({ where: { id: spanningId } }), null);
      assert.equal(await stampCount(), before);
    });
  });

  describe("the boundary", () => {
    it("refuses a read-only token on every checklist write, and writes nothing", async () => {
      const before = await prisma.checklist.count({ where: { collectionId } });
      const calls: [Method, string][] = [
        ["POST", "/checklists"],
        ["PATCH", `/checklists/${imperforateId}`],
        ["POST", `/checklists/${imperforateId}/stamps`],
        ["POST", `/checklists/${imperforateId}/stamps/remove`],
        ["POST", `/checklists/${imperforateId}/order`],
        ["DELETE", `/checklists/${imperforateId}`],
      ];
      for (const [method, path] of calls) {
        const err = await refused(readOnlyToken, method, path, method === "DELETE" ? undefined : { name: "x", stamps: ["Mi 101"] });
        assert.equal(err.status, 403, `${method} ${path}`);
        assert.equal(err.error.code, "forbidden");
      }
      assert.equal(await prisma.checklist.count({ where: { collectionId } }), before);
      await ok<ListResponse<AgentChecklist>>(readOnlyToken, "GET", "/checklists");
    });

    it("publishes exactly these checklist operations, six of them writing", () => {
      const checklist = OPERATIONS.filter((op) => /^\/checklists(\/|$)/.test(op.path)).map(
        (op) => `${op.method} ${op.path} ${op.name}`
      );
      assert.deepEqual(checklist.sort(), [...CHECKLIST_OPERATIONS].sort());
      assert.deepEqual(
        OPERATIONS.filter((op) => /^\/checklists(\/|$)/.test(op.path) && op.writes).map((op) => op.name).sort(),
        ["add_checklist_stamps", "create_checklist", "delete_checklist", "remove_checklist_stamps", "set_checklist_order", "update_checklist"]
      );
    });
  });
});
