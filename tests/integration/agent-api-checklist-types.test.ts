import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentChecklist } from "../../src/lib/agent-api/checklist-reads";
import type { ListResponse } from "../../src/lib/agent-api/list";
import type { AgentIssueDetail, AgentStampDetail } from "../../src/lib/agent-api/collection-reads";
import type { AgentChecklistGaps } from "../../src/lib/agent-api/want-reads";
import type { AgentCreatedStamp } from "../../src/lib/agent-api/operations/catalog-edits";

// **A checklist's type through the agent API (#1617), driven through the real route.** The issue's
// *Done when* as calls: every returned checklist carries its `type`; `create_checklist` and
// `update_checklist` set it; `list_checklists` filters by it; every read that lists or counts
// checklists — `list_checklists`, `get_issue`, `get_stamp`, `find_checklist_gaps` — leaves the
// specialised ones out unless `include_specialised` is true; and a checklist named by id is answered
// whatever its type.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

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

type CreatedIssue = AgentIssueDetail & { createdStamps: AgentCreatedStamp[] };

describe("checklist types through the agent API (#1617)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let issue: CreatedIssue;
  let basicId: string;
  let shadesId: string;
  const stamp: Record<string, string> = {};

  before(async () => {
    userId = `test-user-cltypes-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User cltypes-${ts}`,
        email: `test-cltypes-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-cltypes-${ts}`, name: "Types", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const michelId = (
      await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })
    ).id;
    await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Poland",
        catalogPrefix: "PL",
        primaryCatalogVendorId: michelId,
        collectionAreaVendors: { create: [{ catalogVendorId: michelId, areaPrefix: null }] },
      },
    });
    token = (
      await createAssistantToken(userId, collectionId, {
        label: "types agent",
        scope: "read_write",
        kind: "agent",
      })
    ).token;

    // The issue's own checklist comes with it, standard — the one every existing checklist became.
    issue = await ok<CreatedIssue>(token, "POST", "/issues", {
      area: "Poland",
      year: 1928,
      name: "Grosik",
      catalog_numbers: ["Mi: 100-102"],
    });
    for (const created of issue.createdStamps) stamp[created.catalogNumbers[0]] = created.stampId;
    basicId = issue.checklists[0].checklistId;
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

  it("states the type of the checklist an issue is created with, standard", () => {
    assert.equal(issue.checklists[0].type, "standard");
  });

  it("creates a specialised checklist when asked, and a standard one by default", async () => {
    const shades = await ok<AgentChecklist>(token, "POST", "/checklists", {
      issue_id: issue.issueId,
      name: "Colour shades of Mi 100",
      type: "specialised",
    });
    assert.equal(shades.type, "specialised");
    shadesId = shades.checklistId;
    await ok(token, "POST", `/checklists/${shadesId}/stamps`, { stamps: [stamp["Mi·PL 100"]] });

    const plain = await ok<AgentChecklist>(token, "POST", "/checklists", { name: "Thematic" });
    assert.equal(plain.type, "standard");
    await ok(token, "DELETE", `/checklists/${plain.checklistId}`);
  });

  it("refuses a type it does not know", async () => {
    const answer = await call(token, "POST", "/checklists", { name: "X", type: "special" });
    assert.ok(answer.status >= 400, JSON.stringify(answer.body));
  });

  it("lists only the standard checklists unless the specialised are included or asked for", async () => {
    const names = async (query: string) =>
      (await ok<ListResponse<AgentChecklist>>(token, "GET", `/checklists${query}`)).items.map(
        (row) => [row.name, row.type]
      );
    assert.deepEqual(await names(""), [["Grosik", "standard"]]);
    assert.deepEqual(await names("?include_specialised=true"), [
      ["Grosik", "standard"],
      ["Colour shades of Mi 100", "specialised"],
    ]);
    // Asking for the type is itself asking for them.
    assert.deepEqual(await names("?type=specialised"), [["Colour shades of Mi 100", "specialised"]]);
    assert.deepEqual(await names("?type=standard&include_specialised=true"), [["Grosik", "standard"]]);
  });

  it("answers a specialised checklist named by id, whatever the default", async () => {
    const page = await ok<{ checklist: AgentChecklist; total: number }>(
      token,
      "GET",
      `/checklists/${shadesId}/stamps`
    );
    assert.equal(page.checklist.type, "specialised");
    assert.equal(page.total, 1);
  });

  it("leaves the specialised checklists out of get_issue unless they are included", async () => {
    const plain = await ok<AgentIssueDetail>(token, "GET", `/issues/${issue.issueId}`);
    assert.deepEqual(
      plain.checklists.map((row) => row.checklistId),
      [basicId]
    );
    const wide = await ok<AgentIssueDetail>(
      token,
      "GET",
      `/issues/${issue.issueId}?include_specialised=true`
    );
    assert.deepEqual(
      wide.checklists.map((row) => [row.checklistId, row.type]),
      [
        [basicId, "standard"],
        [shadesId, "specialised"],
      ]
    );
  });

  it("names a stamp's specialised checklists only when they are included, and says which they are", async () => {
    const id = stamp["Mi·PL 100"];
    const plain = await ok<AgentStampDetail>(token, "GET", `/stamps/${id}`);
    assert.deepEqual(plain.issues[0].checklists, ["Grosik"]);
    assert.equal("specialisedChecklists" in plain.issues[0], false);
    const wide = await ok<AgentStampDetail>(token, "GET", `/stamps/${id}?include_specialised=true`);
    assert.deepEqual(wide.issues[0].checklists, ["Grosik", "Colour shades of Mi 100"]);
    assert.deepEqual(wide.issues[0].specialisedChecklists, ["Colour shades of Mi 100"]);
  });

  it("reads the gaps of the standard checklists unless the specialised are included", async () => {
    const plain = await ok<AgentChecklistGaps>(
      token,
      "GET",
      `/issues/${issue.issueId}/checklist-gaps`
    );
    assert.deepEqual(
      plain.checklists.map((row) => [row.checklistId, row.type]),
      [[basicId, "standard"]]
    );
    const wide = await ok<AgentChecklistGaps>(
      token,
      "GET",
      `/issues/${issue.issueId}/checklist-gaps?include_specialised=true`
    );
    assert.deepEqual(
      wide.checklists.map((row) => [row.checklistId, row.type, row.required]),
      [
        [basicId, "standard", 3],
        [shadesId, "specialised", 1],
      ]
    );
  });

  it("changes a checklist's type through update_checklist, and nothing else about it", async () => {
    const made = await ok<AgentChecklist>(token, "PATCH", `/checklists/${shadesId}`, {
      type: "standard",
    });
    assert.equal(made.type, "standard");
    assert.equal(made.name, "Colour shades of Mi 100");
    assert.equal(made.stampCount, 1);
    const listed = await ok<ListResponse<AgentChecklist>>(token, "GET", "/checklists");
    assert.equal(listed.total, 2);

    const back = await ok<AgentChecklist>(token, "PATCH", `/checklists/${shadesId}`, {
      type: "specialised",
    });
    assert.equal(back.type, "specialised");
  });
});
