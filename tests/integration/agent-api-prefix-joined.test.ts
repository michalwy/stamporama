import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentArea } from "../../src/lib/agent-api/area-reads";
import type { AgentIssueDetail } from "../../src/lib/agent-api/collection-reads";
import type { AgentIssueListRow } from "../../src/lib/agent-api/issue-list-reads";
import type { AgentPrefixChange } from "../../src/lib/agent-api/operations/catalog-edits";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **A prefix joined to its number, through the agent API (#2658)**, driven through the real route.
// #2657 lets a prefix join its number with no space (`DR D` + `12` → `DR D12`); this file holds
// #2658's *Done when* as calls: an agent reads the setting on an area and sees its stamps' numbers
// joined, ticks and unticks it on an area, an area's catalogue and an issue's own prefix, and resolves
// `DR D12` to the stamp. A write that says nothing of the joining keeps it.

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

async function refused(token: string, method: Method, path: string, body?: unknown) {
  const answer = await call(token, method, path, body);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  return (answer.body as { error: { code: string; message: string } }).error;
}

type Created = AgentIssueDetail & { createdStamps: { stampId: string; catalogNumbers: string[] }[] };
type Updated = AgentIssueDetail & { prefixChange?: AgentPrefixChange };
type Resolution = { input: string; verdict: string; stamps: { stampId: string; matchedNumber: string }[] };

describe("a prefix joined to its number through the agent API (#2658)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let reich: AgentArea;
  let issue: Created;

  before(async () => {
    userId = `test-user-prefix-joined-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User prefix-joined-${ts}`,
        email: `test-prefix-joined-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-prefix-joined-${ts}`, name: "Prefix joined", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const michelId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    await prisma.catalogVendor.create({ data: { collectionId, name: "Fischer", abbreviation: "Fi" } });
    await prisma.catalogName.create({ data: { vendorId: michelId, name: "Michel Deutschland", currency: "EUR" } });
    token = (await createAssistantToken(userId, collectionId, { label: "prefix agent", scope: "read_write", kind: "agent" })).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    for (let depth = 0; depth < 5; depth++) {
      await prisma.collectionArea.deleteMany({ where: { collectionId, children: { none: {} } } });
    }
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("creates an area whose prefix joins its numbers, and reads the setting back", async () => {
    reich = await ok<AgentArea>(token, "POST", "/areas", {
      name: "Deutsches Reich",
      prefix: "DR D",
      prefix_joined: true,
      catalogues: ["Mi", "Fi"],
      price_books: ["Michel Deutschland"],
      valuing_book: "Michel Deutschland",
    });
    assert.equal(reich.own.prefix, "DR D");
    assert.equal(reich.own.prefixJoined, true);
    assert.deepEqual(reich.resolved.catalogues, ["Fi·DR D", "Mi·DR D"]);
    assert.deepEqual(reich.resolved.joinedPrefixes, ["Fi", "Mi"]);
  });

  it("refuses a joining with no prefix to join, and writes nothing", async () => {
    const error = await refused(token, "POST", "/areas", { name: "Nowhere", prefix_joined: true, assignable: false });
    assert.match(error.message, /no prefix to join/);
    assert.equal(await prisma.collectionArea.count({ where: { collectionId, name: "Nowhere" } }), 0);
  });

  it("shows the area's stamps with the prefix joined, and resolves the joined number to the stamp", async () => {
    issue = await ok<Created>(token, "POST", "/issues", { area: reich.areaId, year: 1920, catalog_numbers: ["Mi: 12-13"], stamps_from: ["Mi"] });
    assert.ok(issue.catalogRanges.some((range) => range.startsWith("Mi·DR D12")), JSON.stringify(issue.catalogRanges));
    assert.deepEqual(issue.catalogues.resolvedJoinedPrefixes, ["Fi", "Mi"]);
    const twelve = issue.createdStamps[0];
    const stamp = await ok<{ catalogNumbers: string[] }>(token, "GET", `/stamps/${twelve.stampId}`);
    assert.deepEqual(stamp.catalogNumbers, ["Mi·DR D12"]);

    const resolved = await ok<ListResponse<Resolution>>(
      token,
      "GET",
      `/catalog/resolve?numbers=${encodeURIComponent("DR D12")}&numbers=${encodeURIComponent("Mi DR D12")}`
    );
    for (const row of resolved.items) {
      assert.equal(row.verdict, "resolved", JSON.stringify(row));
      assert.equal(row.stamps[0].stampId, twelve.stampId);
      assert.equal(row.stamps[0].matchedNumber, "Mi·DR D12");
    }
  });

  it("unticks and ticks the area's prefix, and keeps the joining when the prefix changes without a word on it", async () => {
    const spaced = await ok<AgentArea>(token, "PATCH", `/areas/${reich.areaId}`, { prefix_joined: false });
    assert.equal(spaced.own.prefixJoined, false);
    assert.equal(spaced.resolved.joinedPrefixes, undefined);
    const stamp = await ok<{ catalogNumbers: string[] }>(token, "GET", `/stamps/${issue.createdStamps[0].stampId}`);
    assert.deepEqual(stamp.catalogNumbers, ["Mi·DR D 12"]);

    await ok<AgentArea>(token, "PATCH", `/areas/${reich.areaId}`, { prefix_joined: true });
    const renamed = await ok<AgentArea>(token, "PATCH", `/areas/${reich.areaId}`, { prefix: "DR E" });
    assert.equal(renamed.own.prefix, "DR E");
    assert.equal(renamed.own.prefixJoined, true);
  });

  it("ticks and unticks a catalogue's own prefix on the area", async () => {
    const own = await ok<AgentArea>(token, "PATCH", `/areas/${reich.areaId}`, {
      catalogues: ["Mi", "Fi: PL TP W"],
      joined_prefixes: ["Fi: true"],
    });
    assert.deepEqual(own.own.catalogues, ["Fi: PL TP W", "Mi"]);
    assert.deepEqual(own.own.joinedPrefixes, ["Fi"]);

    // The catalogue list restated without a word on the joining keeps it.
    const restated = await ok<AgentArea>(token, "PATCH", `/areas/${reich.areaId}`, { catalogues: ["Mi", "Fi: PL TP W"] });
    assert.deepEqual(restated.own.joinedPrefixes, ["Fi"]);

    const unticked = await ok<AgentArea>(token, "PATCH", `/areas/${reich.areaId}`, { joined_prefixes: ["Fi: false"] });
    assert.equal(unticked.own.joinedPrefixes, undefined);
    assert.deepEqual(unticked.own.catalogues, ["Fi: PL TP W", "Mi"]);
    assert.deepEqual(unticked.resolved.joinedPrefixes, ["Mi"]);

    const inherited = await refused(token, "PATCH", `/areas/${reich.areaId}`, { joined_prefixes: ["Mi: true"] });
    assert.match(inherited.message, /no prefix to join/);
  });

  it("ticks and unticks an issue's own prefix, and states it on get_issue and list_issues", async () => {
    const ticked = await ok<Updated>(token, "PATCH", `/issues/${issue.issueId}`, {
      prefixes: ["Mi: DR S"],
      joined_prefixes: ["Mi: true"],
    });
    assert.deepEqual(ticked.catalogues.own, ["Fi", "Mi: DR S"]);
    assert.deepEqual(ticked.catalogues.ownJoinedPrefixes, ["Mi"]);
    assert.ok(ticked.prefixChange?.changed);
    assert.deepEqual(ticked.prefixChange?.joinedAfter, ["Mi"]);
    const stamp = await ok<{ catalogNumbers: string[] }>(token, "GET", `/stamps/${issue.createdStamps[0].stampId}`);
    assert.deepEqual(stamp.catalogNumbers, ["Mi·DR S12"]);

    const listed = await ok<ListResponse<AgentIssueListRow>>(token, "GET", `/issues?area=${reich.areaId}`);
    const row = listed.items.find((item) => item.issueId === issue.issueId)!;
    assert.deepEqual(row.prefixes, ["Mi: DR S"]);
    assert.deepEqual(row.joinedPrefixes, ["Mi"]);

    // A prefix changed without a word on its joining keeps it.
    const renamed = await ok<Updated>(token, "PATCH", `/issues/${issue.issueId}`, { prefixes: ["Mi: DR T"] });
    assert.deepEqual(renamed.catalogues.ownJoinedPrefixes, ["Mi"]);

    // The joining alone is a change, and the answer says so.
    const unticked = await ok<Updated>(token, "PATCH", `/issues/${issue.issueId}`, { joined_prefixes: ["Mi: false"] });
    assert.equal(unticked.catalogues.ownJoinedPrefixes, undefined);
    assert.equal(unticked.prefixChange?.changed, true);
    assert.deepEqual(unticked.prefixChange?.joinedBefore, ["Mi"]);
    assert.equal(unticked.prefixChange?.joinedAfter, undefined);
    const read = await ok<AgentIssueDetail>(token, "GET", `/issues/${issue.issueId}`);
    assert.deepEqual(read.catalogues.own, ["Fi", "Mi: DR T"]);
    assert.equal(read.catalogues.resolvedJoinedPrefixes, undefined);

    const following = await refused(token, "PATCH", `/issues/${issue.issueId}`, { joined_prefixes: ["Fi: true"] });
    assert.match(following.message, /no prefix to join/);
  });

  it("creates an issue with an own prefix joined to its numbers", async () => {
    const created = await ok<Created>(token, "POST", "/issues", {
      area: reich.areaId,
      year: 1921,
      catalog_numbers: ["Mi: 40"],
      prefixes: ["Mi: DR P"],
      joined_prefixes: ["Mi: true"],
    });
    assert.deepEqual(created.catalogues.ownJoinedPrefixes, ["Mi"]);
    assert.deepEqual(created.createdStamps[0].catalogNumbers, ["Mi·DR P40"]);
  });
});
