import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentArea, AgentAreaResolvedCatalogues } from "../../src/lib/agent-api/area-reads";
import type { AgentAreaCatalogueChange } from "../../src/lib/agent-api/operations/areas";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **Areas through the agent API (#1539), driven through the real route with real tokens.**
// `tests/unit/agent-api-areas.test.ts` holds the tree order, the catalogue spelling and the
// resolution; `tests/unit/agent-api-operation-boundary.test.ts` holds *exactly these area writes and
// no delete* as a fact about imports. This file holds the *Done when* as calls: the tree read, an
// area created under a parent with its catalogues, edited, moved with what changed for its issues,
// ordered among its siblings, an issue moved between areas — and the screen's refusals: an area under
// itself or its own sub-area, a grouping-only area holding issues, an area holding issues with no
// valuing book anywhere above it, and a read-only token on every write.

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

type Moved = { area: AgentArea; previousPath: string; moved: boolean; catalogueChanges: AgentAreaCatalogueChange[] };
type Ordered = { parent?: { areaId: string; areaPath: string }; areas: { areaId: string; name: string; position: number }[]; placed: number; keptAfter: number };
type IssueMoved = {
  issueId: string;
  moved: boolean;
  from: { areaId: string; areaPath: string };
  to: { areaId: string; areaPath: string };
  catalogues: { changed: boolean; before: AgentAreaResolvedCatalogues; after: AgentAreaResolvedCatalogues };
  numbersOutsideArea?: string[];
};

const AREA_OPERATIONS = [
  "GET /areas list_areas",
  "POST /areas create_area",
  "PATCH /areas/{area_id} update_area",
  "POST /areas/{area_id}/move move_area",
  "POST /areas/order set_area_order",
];

describe("areas through the agent API (#1539)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let europeId: string;
  let poland: AgentArea;
  let gg: AgentArea;
  let germany: AgentArea;
  let asia: AgentArea;
  let ggIssueId: string;
  let polandIssueId: string;

  const areaCount = () => prisma.collectionArea.count({ where: { collectionId } });

  before(async () => {
    userId = `test-user-areas-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User areas-${ts}`,
        email: `test-areas-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-areas-${ts}`, name: "Areas", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const michelId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    await prisma.catalogVendor.create({ data: { collectionId, name: "Fischer", abbreviation: "Fi" } });
    await prisma.catalogVendor.create({ data: { collectionId, name: "Scott", abbreviation: "Sc" } });
    await prisma.catalogName.create({ data: { vendorId: michelId, name: "Michel Europa", currency: "EUR" } });
    // A grouping-only area with no catalogue configuration at all.
    europeId = (await prisma.collectionArea.create({ data: { collectionId, name: "Europe", assignable: false } })).id;
    // A marketplace listing in German is what makes German a title language (#293).
    await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true, titleLanguage: "de" } });

    token = (await createAssistantToken(userId, collectionId, { label: "area agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (await createAssistantToken(userId, collectionId, { label: "area agent, read", scope: "read", kind: "agent" })).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.checklist.deleteMany({ where: { collectionId } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.contact.deleteMany({ where: { collectionId } });
    for (let depth = 0; depth < 5; depth++) {
      await prisma.collectionArea.deleteMany({ where: { collectionId, children: { none: {} } } });
    }
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("creating an area", () => {
    it("refuses one that holds issues with no valuing book on it or above it, and creates nothing", async () => {
      const before = await areaCount();
      const err = await refused(token, "POST", "/areas", { name: "Poland", parent: "Europe", catalogues: ["Mi"] });
      assert.equal(err.error.code, "invalid_request");
      assert.match(err.error.message, /valuing book/);
      assert.equal(await areaCount(), before);
    });

    it("creates one under a parent with its catalogues, prefixes, books and title names", async () => {
      poland = await ok<AgentArea>(token, "POST", "/areas", {
        name: "Poland",
        parent: "Europe",
        prefix: "PL",
        catalogues: ["Mi", "Fi: -"],
        leading_catalogue: "Mi",
        price_books: ["Michel Europa"],
        valuing_book: "Michel Europa",
        title_names: ["de: Polen"],
      });
      assert.equal(poland.areaPath, "Europe › Poland");
      assert.equal(poland.parentId, europeId);
      assert.equal(poland.assignable, true);
      // The form fills the title name with the name.
      assert.equal(poland.titleName, "Poland");
      assert.deepEqual(poland.translatedTitleNames, { de: "Polen" });
      assert.deepEqual(poland.own, {
        prefix: "PL",
        catalogues: ["Fi: -", "Mi"],
        leadingCatalogue: "Mi",
        priceBooks: ["Michel Europa"],
        valuingBook: "Michel Europa",
      });
      assert.deepEqual(poland.resolved, { leadingCatalogue: "Mi", catalogues: ["Fi", "Mi·PL"], valuingBook: "Michel Europa" });
    });

    it("lets a sub-area inherit what it does not set", async () => {
      gg = await ok<AgentArea>(token, "POST", "/areas", { name: "General Government", parent: poland.areaId, prefix: "GG" });
      assert.deepEqual(gg.own, { prefix: "GG", catalogues: [], priceBooks: [] });
      assert.deepEqual(gg.resolved, { leadingCatalogue: "Mi", catalogues: ["Fi·GG", "Mi·GG"], valuingBook: "Michel Europa" });
    });

    it("creates a grouping-only area, which needs no valuing book", async () => {
      asia = await ok<AgentArea>(token, "POST", "/areas", { name: "Asia", assignable: false, description: "Later" });
      assert.equal(asia.assignable, false);
      assert.equal(asia.description, "Later");
      assert.equal(asia.position, 2);
    });

    it("keeps the form's choices: the valuing book among its books, the leading catalogue among its catalogues", async () => {
      const book = await refused(token, "POST", "/areas", { name: "Japan", parent: "Asia", valuing_book: "Michel Europa" });
      assert.match(book.error.message, /not one of this area's price books/);
      const leading = await refused(token, "POST", "/areas", {
        name: "Japan",
        parent: "Asia",
        price_books: ["Michel Europa"],
        valuing_book: "Michel Europa",
        leading_catalogue: "Sc",
      });
      assert.match(leading.error.message, /not one of this area's own catalogues/);
      assert.deepEqual(leading.error.accepted, ["Mi"]);
    });
  });

  describe("reading the tree", () => {
    it("lists every area depth first, and narrows to a branch", async () => {
      const all = await ok<ListResponse<AgentArea>>(token, "GET", "/areas");
      assert.equal(all.total, 4);
      assert.deepEqual(all.items.map((area) => area.areaPath), ["Europe", "Europe › Poland", "Europe › Poland › General Government", "Asia"]);
      const branch = await ok<ListResponse<AgentArea>>(token, "GET", "/areas?under=Poland");
      assert.deepEqual(branch.items.map((area) => area.name), ["Poland", "General Government"]);
    });
  });

  describe("editing an area", () => {
    before(async () => {
      ggIssueId = (await ok<{ issueId: string }>(token, "POST", "/issues", { area: "General Government", name: "Krakow", catalog_numbers: ["Mi: 1-2"] })).issueId;
    });

    it("changes only what is sent, keeping the title name in step with the name", async () => {
      const renamed = await ok<AgentArea>(token, "PATCH", `/areas/${poland.areaId}`, { name: "Polska" });
      assert.equal(renamed.name, "Polska");
      assert.equal(renamed.titleName, "Polska");
      assert.deepEqual(renamed.own, poland.own);
      assert.deepEqual(renamed.translatedTitleNames, { de: "Polen" });
      const titled = await ok<AgentArea>(token, "PATCH", `/areas/${poland.areaId}`, { title_name: "Poland", clear_title_names: ["de"] });
      assert.equal(titled.name, "Polska");
      assert.equal(titled.titleName, "Poland");
      assert.equal(titled.translatedTitleNames, undefined);
    });

    it("rewrites the catalogues it is sent, and inherits what it clears", async () => {
      const edited = await ok<AgentArea>(token, "PATCH", `/areas/${gg.areaId}`, { catalogues: ["Sc: GGS"] });
      assert.deepEqual(edited.own.catalogues, ["Sc: GGS"]);
      assert.deepEqual(edited.resolved.catalogues, ["Fi·GG", "Mi·GG", "Sc·GGS"]);
      const cleared = await ok<AgentArea>(token, "PATCH", `/areas/${gg.areaId}`, { clear: ["catalogues"] });
      assert.deepEqual(cleared.own.catalogues, []);
      assert.deepEqual(cleared.resolved, gg.resolved);
      assert.equal(cleared.issueCount, 1);
    });

    it("refuses making an area grouping-only while an issue is filed under it", async () => {
      const err = await refused(token, "PATCH", `/areas/${gg.areaId}`, { assignable: false });
      assert.match(err.error.message, /holds 1 issue/);
      assert.equal((await prisma.collectionArea.findUniqueOrThrow({ where: { id: gg.areaId } })).assignable, true);
    });

    it("refuses an edit that changes nothing", async () => {
      const err = await refused(token, "PATCH", `/areas/${gg.areaId}`, {});
      assert.match(err.error.message, /Nothing to change/);
    });
  });

  describe("moving an area", () => {
    it("refuses moving an area under itself or its own sub-area, as on the screen", async () => {
      const self = await refused(token, "POST", `/areas/${poland.areaId}/move`, { parent: poland.areaId });
      assert.match(self.error.message, /under itself/);
      const descendant = await refused(token, "POST", `/areas/${poland.areaId}/move`, { parent: gg.areaId });
      assert.match(descendant.error.message, /cannot sit inside its own sub-area/);
      assert.equal((await prisma.collectionArea.findUniqueOrThrow({ where: { id: poland.areaId } })).parentId, europeId);
    });

    it("refuses moving an area holding issues where no valuing book reaches it", async () => {
      const err = await refused(token, "POST", `/areas/${gg.areaId}/move`, { parent: "Asia" });
      assert.match(err.error.message, /valuing book/);
    });

    it("moves a branch with its issues and says how their catalogues changed", async () => {
      germany = await ok<AgentArea>(token, "POST", "/areas", {
        name: "Germany",
        parent: "Europe",
        prefix: "D",
        price_books: ["Michel Europa"],
        valuing_book: "Michel Europa",
      });
      const moved = await ok<Moved>(token, "POST", `/areas/${gg.areaId}/move`, { parent: "Germany" });
      assert.equal(moved.moved, true);
      assert.equal(moved.previousPath, "Europe › Polska › General Government");
      assert.equal(moved.area.areaPath, "Europe › Germany › General Government");
      assert.equal(moved.area.position, 1);
      assert.deepEqual(moved.catalogueChanges, [
        {
          areaId: gg.areaId,
          areaPath: "Europe › Germany › General Government",
          issueCount: 1,
          before: { leadingCatalogue: "Mi", catalogues: ["Fi·GG", "Mi·GG"], valuingBook: "Michel Europa" },
          after: { catalogues: ["Mi·GG"], valuingBook: "Michel Europa" },
        },
      ]);
      const issue = await prisma.issue.findUniqueOrThrow({ where: { id: ggIssueId } });
      assert.equal(issue.collectionAreaId, gg.areaId);
    });

    it("answers a move to where it already is as no move", async () => {
      const same = await ok<Moved>(token, "POST", `/areas/${gg.areaId}/move`, { parent: "Germany" });
      assert.deepEqual([same.moved, same.catalogueChanges], [false, []]);
    });
  });

  describe("ordering areas", () => {
    it("puts the areas sent first among their siblings, the rest after", async () => {
      const ordered = await ok<Ordered>(token, "POST", "/areas/order", { areas: ["Germany"] });
      assert.equal(ordered.parent?.areaId, europeId);
      assert.deepEqual(ordered.areas.map((area) => [area.name, area.position]), [["Germany", 1], ["Polska", 2]]);
      assert.deepEqual([ordered.placed, ordered.keptAfter], [1, 1]);
    });

    it("refuses areas of different parents", async () => {
      const err = await refused(token, "POST", "/areas/order", { areas: ["Germany", "Asia"] });
      assert.match(err.error.message, /different parents/);
    });
  });

  describe("moving an issue", () => {
    it("files it under another area and states its catalogues before and after", async () => {
      const moved = await ok<IssueMoved>(token, "POST", `/issues/${ggIssueId}/move`, { area: "Polska" });
      assert.equal(moved.moved, true);
      assert.equal(moved.from.areaPath, "Europe › Germany › General Government");
      assert.equal(moved.to.areaPath, "Europe › Polska");
      assert.deepEqual(moved.catalogues, {
        changed: true,
        before: { catalogues: ["Mi·GG"], valuingBook: "Michel Europa" },
        after: { leadingCatalogue: "Mi", catalogues: ["Fi", "Mi·PL"], valuingBook: "Michel Europa" },
      });
      const links = await prisma.stampCollectionArea.findMany({ where: { stamp: { issueMemberships: { some: { issueId: ggIssueId } } } } });
      assert.ok(links.length > 0 && links.every((link) => link.collectionAreaId === poland.areaId));
    });

    it("names the catalogues its stamps are numbered in that the new area does not keep", async () => {
      polandIssueId = (await ok<{ issueId: string }>(token, "POST", "/issues", { area: "Polska", name: "Ships", catalog_numbers: ["Mi: 10-11", "Fi: 20-21"] })).issueId;
      const moved = await ok<IssueMoved>(token, "POST", `/issues/${polandIssueId}/move`, { area: "Germany" });
      assert.deepEqual(moved.numbersOutsideArea, ["Fi"]);
    });

    it("refuses a grouping-only area", async () => {
      const err = await refused(token, "POST", `/issues/${polandIssueId}/move`, { area: "Asia" });
      assert.match(err.error.message, /grouping-only/);
      assert.equal((await prisma.issue.findUniqueOrThrow({ where: { id: polandIssueId } })).collectionAreaId, germany.areaId);
    });
  });

  describe("the boundary", () => {
    it("refuses a read-only token on every area write, and writes nothing", async () => {
      const before = await areaCount();
      const calls: [Method, string][] = [
        ["POST", "/areas"],
        ["PATCH", `/areas/${gg.areaId}`],
        ["POST", `/areas/${gg.areaId}/move`],
        ["POST", "/areas/order"],
        ["POST", `/issues/${polandIssueId}/move`],
      ];
      for (const [method, path] of calls) {
        const err = await refused(readOnlyToken, method, path, { name: "x", top_level: true, areas: ["Asia"], area: "Polska" });
        assert.equal(err.status, 403, `${method} ${path}`);
        assert.equal(err.error.code, "forbidden");
      }
      assert.equal(await areaCount(), before);
      await ok<ListResponse<AgentArea>>(readOnlyToken, "GET", "/areas");
    });

    it("publishes exactly these area operations, and none that deletes an area", () => {
      const areas = OPERATIONS.filter((op) => /^\/areas(\/|$)/.test(op.path)).map((op) => `${op.method} ${op.path} ${op.name}`);
      assert.deepEqual(areas.sort(), [...AREA_OPERATIONS].sort());
      assert.equal(OPERATIONS.find((op) => op.name === "move_issue_to_area")?.writes, true);
      const deleting = OPERATIONS.filter((op) => /area/.test(op.name) && (op.method === "DELETE" || /^(delete|remove)_/.test(op.name)));
      assert.deepEqual(deleting.map((op) => op.name), []);
    });
  });
});
