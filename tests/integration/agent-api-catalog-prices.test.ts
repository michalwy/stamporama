import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentCatalogEdition, AgentPriceWrite } from "../../src/lib/agent-api/catalog-prices";
import type { AgentCatalogPriceRow } from "../../src/lib/agent-api/operations/catalog-prices";

// **Catalogue prices through the agent API (#1540), driven through the real route with real tokens.**
// `tests/unit/agent-api-catalog-prices.test.ts` holds the cell grammar, the edition names and the
// grid's arithmetic over fixture rows; `tests/unit/agent-api-operation-boundary.test.ts` holds *the
// one catalogue delete is the grid's clear* as a fact about imports. This file holds the *Done when*
// as calls: the editions listed, a batch answered cell by cell with refused cells not stopping the
// rest, an umbrella read as rolled up until a price is recorded on it and as recorded after, a clear
// that empties the cell and nothing else, and a read-only token refused on both writes.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

interface ListBody<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
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

describe("catalogue prices through the agent API (#1540)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let issueId: string;
  let editionId: string;
  const stampIds: Record<string, string> = {};

  const priceCount = () => prisma.stampCatalogPrice.count({ where: { stamp: { collectionId } } });
  const set = (prices: string[], edition = "Mi 2024") =>
    ok<AgentPriceWrite>(token, "POST", "/catalog-prices", { edition, prices });
  const clear = (cells: string[], edition = "Mi 2024") =>
    ok<AgentPriceWrite>(token, "POST", "/catalog-prices/clear", { edition, cells });
  const read = async (query: string) => (await ok<ListBody<AgentCatalogPriceRow>>(token, "GET", `/catalog-prices?${query}`)).items;
  const row = (rows: AgentCatalogPriceRow[], label: string) => {
    const found = rows.find((r) => r.label === label);
    assert.ok(found, `no row ${label} in ${JSON.stringify(rows.map((r) => r.label))}`);
    return found;
  };

  before(async () => {
    userId = `test-user-catprice-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User catprice-${ts}`,
        email: `test-catprice-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-catprice-${ts}`, name: "Catalogue prices", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const michel = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const fischer = await prisma.catalogVendor.create({ data: { collectionId, name: "Fischer", abbreviation: "Fi" } });
    const polen = await prisma.catalogName.create({ data: { vendorId: michel.id, name: "Michel Polen", currency: "EUR" } });
    editionId = (await prisma.catalogEdition.create({ data: { catalogNameId: polen.id, year: 2024 } })).id;
    await prisma.catalogEdition.create({ data: { catalogNameId: polen.id, year: 2020 } });
    // A book the collection keeps and Poland does not price in.
    const fischerBook = await prisma.catalogName.create({ data: { vendorId: fischer.id, name: "Fischer", currency: "PLN" } });
    await prisma.catalogEdition.create({ data: { catalogNameId: fischerBook.id, year: 2024 } });

    const poland = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Poland",
        primaryCatalogNameId: polen.id,
        primaryCatalogVendorId: michel.id,
        collectionAreaVendors: { create: [{ catalogVendorId: michel.id, areaPrefix: null }] },
      },
    });
    await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: poland.id, catalogNameId: polen.id } });

    await prisma.stampCondition.create({ data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 } });
    await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 } });
    await prisma.certificateStatus.create({ data: { collectionId, name: "Expertised", abbreviation: "Exp", sortOrder: 0 } });
    const pair = await prisma.stampFormat.create({ data: { collectionId, name: "Pair", abbreviation: "Pr", sortOrder: 0 } });
    // Any area, any issue, any condition: a pair is twice the single.
    await prisma.stampFormatFactor.create({ data: { collectionId, formatId: pair.id, factor: 2 } });
    const color = await prisma.stampSubtype.create({
      data: { collectionId, name: "Color", actsAsVariant: true, isDefault: true, sortOrder: 0 },
    });

    issueId = (await prisma.issue.create({ data: { collectionId, issueNo: 1, collectionAreaId: poland.id, name: "Definitives", year: 1960 } })).id;
    // Mi 309 is an umbrella over the colour variants 309A and 309B; Mi 310 stands beside it.
    const tree: [string, string | null][] = [
      ["309", null],
      ["309A", "309"],
      ["309B", "309"],
      ["310", null],
    ];
    for (const [i, [number, parent]] of tree.entries()) {
      const stamp = await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${number}`,
          parentId: parent ? stampIds[parent] : null,
          subtypeId: parent ? color.id : null,
          catalogNumbers: { create: [{ catalogVendorId: michel.id, number }] },
          stampAreaLinks: { create: [{ collectionAreaId: poland.id, isPrimary: true }] },
        },
      });
      stampIds[number] = stamp.id;
      await prisma.issueMember.create({ data: { issueId, stampId: stamp.id, sortOrder: i } });
    }

    token = (await createAssistantToken(userId, collectionId, { label: "price agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "price agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.stampCatalogPrice.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId, parentId: { not: null } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stampFormatFactor.deleteMany({ where: { collectionId } });
    await prisma.stampFormat.deleteMany({ where: { collectionId } });
    await prisma.certificateStatus.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.stampSubtype.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  describe("the editions", () => {
    it("lists every edition with its currency, and an area's the grid's way, primary first", async () => {
      const all = await ok<ListBody<AgentCatalogEdition>>(token, "GET", "/catalog-editions");
      assert.equal(all.total, 3);
      assert.deepEqual(
        all.items.map((e) => [e.name, e.currency]),
        [
          ["Fischer 2024", "PLN"],
          ["Michel Polen 2024", "EUR"],
          ["Michel Polen 2020", "EUR"],
        ]
      );
      const poland = await ok<ListBody<AgentCatalogEdition>>(token, "GET", "/catalog-editions?area=Poland");
      assert.deepEqual(
        poland.items.map((e) => [e.name, e.primary ?? false]),
        [
          ["Michel Polen 2024", true],
          ["Michel Polen 2020", true],
        ]
      );
    });
  });

  describe("a batch write", () => {
    it("answers per cell, and refused cells do not stop the others", async () => {
      const answer = await set([
        "stamp=Mi 309A; condition=MNH; price=4,00",
        "stamp=Mi 309B; condition=MNH; price=2.5",
        "stamp=Mi 999; condition=MNH; price=1",
        "stamp=Mi 310; condition=Mint; price=1",
        "stamp=Mi 310; condition=Used; price=-1",
        "stamp=Mi 309A; condition=MNH; price=5",
        `stamp=${stampIds["310"]}; condition=MNH; certificate=Expertised; format=Pair; price=7`,
        "nothing here",
      ]);
      assert.deepEqual(answer.cells.map((c) => c.outcome), [
        "written",
        "written",
        "refused",
        "refused",
        "refused",
        "refused",
        "written",
        "refused",
      ]);
      assert.deepEqual([answer.edition, answer.currency, answer.written, answer.refused], ["Michel Polen 2024", "EUR", 3, 5]);
      assert.deepEqual(
        [answer.cells[1].stamp, answer.cells[1].condition, answer.cells[1].amount, answer.cells[1].format],
        ["Mi 309B", "Mint Never Hinged", "2.50", undefined]
      );
      assert.match(answer.cells[2].reason ?? "", /Mi 999/);
      assert.match(answer.cells[3].reason ?? "", /not a condition/);
      assert.match(answer.cells[5].reason ?? "", /same cell as entry 1/);
      assert.deepEqual([answer.cells[6].certificate, answer.cells[6].format], ["Expertised", "Pair"]);

      const rows = await prisma.stampCatalogPrice.findMany({
        where: { stamp: { collectionId } },
        select: { stampId: true, price: true, currency: true, catalogEditionId: true },
        orderBy: { price: "asc" },
      });
      assert.deepEqual(
        rows.map((r) => [r.stampId, r.price!.toFixed(2), r.currency, r.catalogEditionId]),
        [
          [stampIds["309B"], "2.50", "EUR", editionId],
          [stampIds["309A"], "4.00", "EUR", editionId],
          [stampIds["310"], "7.00", "EUR", editionId],
        ]
      );
    });

    it("reports a figure already recorded as unchanged and a new one with what it replaced", async () => {
      const answer = await set(["stamp=Mi 309A; condition=MNH; price=4", "stamp=Mi 309A; condition=MNH; format=single; price=4.50"]);
      assert.deepEqual(
        answer.cells.map((c) => [c.outcome, c.amount, c.replaced]),
        [
          ["unchanged", "4.00", undefined],
          ["refused", undefined, undefined],
        ],
        "a cell named twice is refused even when the two spellings differ"
      );
      const changed = await set(["stamp=Mi 309A; condition=MNH; price=4.50"]);
      assert.deepEqual([changed.cells[0].outcome, changed.cells[0].amount, changed.cells[0].replaced], ["written", "4.50", "4.00"]);
    });

    it("refuses the whole call over an edition it cannot name, writing nothing", async () => {
      const before = await priceCount();
      const answer = await call(token, "POST", "/catalog-prices", { edition: "Scott 2024", prices: ["stamp=Mi 310; condition=MNH; price=1"] });
      assert.equal(answer.status, 400);
      assert.match((answer.body as ApiErrorBody).error.message, /list_catalog_editions/);
      assert.equal(await priceCount(), before);
    });
  });

  describe("the read", () => {
    it("reads an issue's tree with the umbrella rolled up, and derived format figures marked", async () => {
      const rows = await read(`issue=${issueId}`);
      assert.deepEqual(rows.map((r) => [r.label, r.depth, r.umbrella ?? false]), [
        ["Mi 309", 0, true],
        ["Mi 309A", 1, false],
        ["Mi 309B", 1, false],
        ["Mi 310", 0, false],
      ]);
      const single = (r: AgentCatalogPriceRow) => r.prices.filter((p) => !p.format && !p.certificate);
      assert.deepEqual(single(row(rows, "Mi 309")), [
        { edition: "Michel Polen 2024", condition: "Mint Never Hinged", amount: "2.50", currency: "EUR", rolledUp: true },
      ]);
      assert.deepEqual(single(row(rows, "Mi 309A")).map((p) => [p.amount, p.rolledUp, p.derived]), [["4.50", undefined, undefined]]);
      // A pair is twice the single: 9.00 and 5.00 derived, and the umbrella rolls the derived up.
      const pairs = (r: AgentCatalogPriceRow) => r.prices.filter((p) => p.format === "Pair" && !p.certificate).map((p) => [p.amount, p.derived ?? false, p.rolledUp ?? false]);
      assert.deepEqual(pairs(row(rows, "Mi 309A")), [["9.00", true, false]]);
      assert.deepEqual(pairs(row(rows, "Mi 309B")), [["5.00", true, false]]);
      assert.deepEqual(pairs(row(rows, "Mi 309")), [["5.00", false, true]]);
      assert.deepEqual(row(rows, "Mi 310").prices, [
        { edition: "Michel Polen 2024", condition: "Mint Never Hinged", certificate: "Expertised", format: "Pair", amount: "7.00", currency: "EUR" },
      ]);
    });

    it("reads a stamp's whole tree, narrowed by the axes", async () => {
      const rows = await read(`stamp=${encodeURIComponent("Mi 309B")}&format=single&certificate=none&condition=MNH&edition=${encodeURIComponent("Michel Polen 2024")}`);
      assert.deepEqual(rows.map((r) => r.label), ["Mi 309", "Mi 309A", "Mi 309B"]);
      assert.ok(rows.every((r) => r.prices.every((p) => !p.format && !p.certificate)));
    });

    it("refuses a read naming both an issue and a stamp, or neither", async () => {
      assert.equal((await call(token, "GET", "/catalog-prices")).status, 400);
      assert.equal((await call(token, "GET", `/catalog-prices?issue=${issueId}&stamp=Mi%20309`)).status, 400);
    });
  });

  describe("an umbrella's own price, and clearing", () => {
    it("records a price on the umbrella, read as recorded rather than rolled up", async () => {
      const answer = await set(["stamp=Mi 309; condition=MNH; price=3"]);
      assert.deepEqual([answer.cells[0].outcome, answer.cells[0].umbrella], ["written", true]);
      const rows = await read(`stamp=${stampIds["309A"]}&format=single&condition=MNH`);
      assert.deepEqual(row(rows, "Mi 309").prices.map((p) => [p.amount, p.rolledUp ?? false]), [["3.00", false]]);
    });

    it("clears the cell and nothing else, answers per cell, and the umbrella rolls up again", async () => {
      const before = await priceCount();
      const answer = await clear([
        "stamp=Mi 309; condition=MNH",
        "stamp=Mi 309; condition=Used",
        "stamp=Mi 310; condition=MNH; price=1",
      ]);
      assert.deepEqual(answer.cells.map((c) => [c.outcome, c.replaced]), [
        ["cleared", "3.00"],
        ["unchanged", undefined],
        ["refused", undefined],
      ]);
      assert.deepEqual([answer.cleared, answer.unchanged, answer.refused], [1, 1, 1]);
      assert.equal(await priceCount(), before - 1);
      const rows = await read(`issue=${issueId}&format=single&condition=MNH`);
      assert.deepEqual(row(rows, "Mi 309").prices.map((p) => [p.amount, p.rolledUp ?? false]), [["2.50", true]]);
    });
  });

  describe("a cell the catalogue gives no price for (#1615)", () => {
    const usedCells = ["stamp=Mi 309A; condition=Used", "stamp=Mi 309B; condition=Used", "stamp=Mi 310; condition=Used"];

    it("records - and ?, reads them back as marks, and rolls an all-marked umbrella up to their state", async () => {
      await clear(usedCells);
      const answer = await set([
        "stamp=Mi 309A; condition=Used; price=-",
        "stamp=Mi 309B; condition=Used; price=?",
        "stamp=Mi 310; condition=Used; price=nonexistent",
      ]);
      assert.deepEqual(answer.cells.map((c) => [c.outcome, c.mark, c.amount]), [
        ["written", "nonexistent", undefined],
        ["written", "undeterminable", undefined],
        ["written", "nonexistent", undefined],
      ]);
      assert.equal((await set(["stamp=Mi 309A; condition=Used; price=-"])).cells[0].outcome, "unchanged");

      const rows = await read(`issue=${issueId}&format=single&condition=Used`);
      assert.deepEqual(row(rows, "Mi 309A").prices.map((p) => [p.mark, p.amount]), [["nonexistent", undefined]]);
      // No variant priced, every one marked, one of them not determinable: the umbrella cannot be.
      assert.deepEqual(row(rows, "Mi 309").prices.map((p) => [p.mark, p.rolledUp ?? false]), [["undeterminable", true]]);
    });

    it("replaces a mark with a figure as an ordinary edit, and clears either back to empty", async () => {
      const replaced = await set(["stamp=Mi 309B; condition=Used; price=3"]);
      assert.deepEqual(replaced.cells.map((c) => [c.outcome, c.amount, c.replaced]), [["written", "3.00", "undeterminable"]]);
      const rows = await read(`issue=${issueId}&format=single&condition=Used`);
      // A marked variant does not stand in the way of the roll-up.
      assert.deepEqual(row(rows, "Mi 309").prices.map((p) => [p.amount, p.rolledUp ?? false]), [["3.00", true]]);

      const cleared = await clear(usedCells);
      assert.deepEqual(cleared.cells.map((c) => [c.outcome, c.replaced]), [
        ["cleared", "nonexistent"],
        ["cleared", "3.00"],
        ["cleared", "nonexistent"],
      ]);
    });
  });

  describe("the boundary", () => {
    it("refuses a read-only token on both writes and serves it the reads", async () => {
      const before = await priceCount();
      for (const [path, body] of [
        ["/catalog-prices", { edition: "Mi 2024", prices: ["stamp=Mi 310; condition=Used; price=1"] }],
        ["/catalog-prices/clear", { edition: "Mi 2024", cells: ["stamp=Mi 309A; condition=MNH"] }],
      ] as const) {
        const answer = await call(readOnlyToken, "POST", path, body);
        assert.equal(answer.status, 403, path);
      }
      assert.equal(await priceCount(), before);
      await ok(readOnlyToken, "GET", "/catalog-editions");
      await ok(readOnlyToken, "GET", `/catalog-prices?issue=${issueId}`);
    });

    it("pins the price writes, and clearing a price is the one price delete there is", () => {
      const writes = OPERATIONS.filter((op) => /^\/catalog-(prices|editions)(\/|$)/.test(op.path) && op.writes).map(
        (op) => `${op.method} ${op.path} ${op.name}`
      );
      assert.deepEqual(writes.sort(), ["POST /catalog-prices set_catalog_prices", "POST /catalog-prices/clear clear_catalog_prices"]);
      // A price observation (#1635) is a realised price, not a catalogue's, and deleting one recorded by
      // mistake is allowed by design (`agent-api.md`, *What is deliberately absent*).
      const removing = OPERATIONS.filter(
        (op) =>
          /catalog|price|edition/.test(op.name) &&
          !/observation/.test(op.name) &&
          (op.method === "DELETE" || /^(delete|remove|clear)_/.test(op.name))
      ).map((op) => op.name);
      assert.deepEqual(removing, ["clear_catalog_prices"]);
    });
  });
});
