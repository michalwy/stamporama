import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { createSale, getSaleDetail, listFreeExtraCandidates } from "../../src/lib/sales";
import { proposeFreeExtras as proposeInDialog, toCents } from "../../src/lib/free-extra-rules";
import { formatItemNo } from "../../src/lib/item-number";
import { GET, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentSale } from "../../src/lib/agent-api/sale-reads";
import type { AgentFreeExtraProposal } from "../../src/lib/agent-api/free-extra-reads";

// **A sale's free extras through the agent API (#2532), driven through the real route.**
//
// The proposal's rules are pinned in `tests/unit/free-extra-rules.test.ts` and its projection in
// `tests/unit/agent-api-free-extra-reads.test.ts`; `tests/integration/sale-free-extras-series.test.ts`
// holds the complete-set rule against a database. What this file holds is the issue's *Done when*:
// the read proposes what *Add free extras* proposes, within the budget the sale's terms give, the write
// puts two of the copies on the sale's free-extras line at 0 marked *to review*, and a copy that would
// break a complete set is refused with the app's sentence.
//
// The stock is a series A B C held A×2, B×3, C×2 — two complete sets and one B above them — and a D on
// no checklist. The order is worth 100.00 EUR and the marketplace gives 1.5% of it: a budget of 1.50,
// which takes one set (1.00), then D (0.10) and the loose B (0.30).

const ts = Date.now();

type Method = "GET" | "POST";
const HANDLERS = { GET, POST };

async function call(token: string, method: Method, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const [pathname, search] = path.split("?");
  const request = new NextRequest(`http://localhost/api/v1${pathname}${search ? `?${search}` : ""}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await HANDLERS[method](request, {
    params: Promise.resolve({ path: pathname.split("/").filter(Boolean) }),
  });
  return { status: response.status, body: await response.json() };
}

async function ok<T>(token: string, method: Method, path: string, body?: unknown): Promise<T> {
  const answer = await call(token, method, path, body);
  assert.equal(answer.status, 200, `${method} ${path} → ${JSON.stringify(answer.body)}`);
  return answer.body as T;
}

async function refused(token: string, method: Method, path: string, body?: unknown): Promise<{ status: number; message: string }> {
  const answer = await call(token, method, path, body);
  assert.ok(answer.status >= 400, `expected a refusal, got ${JSON.stringify(answer.body)}`);
  return { status: answer.status, message: (answer.body as { error: { message: string } }).error.message };
}

describe("free extras through the agent API (#2532)", () => {
  let userId: string;
  let collectionId: string;
  let saleId: string;
  let token: string;
  let readOnlyToken: string;
  const copies: Record<string, { id: string; no: string }[]> = { A: [], B: [], C: [], D: [] };
  const nameOf = (copyId: string) => Object.keys(copies).find((name) => copies[name].some((c) => c.id === copyId));

  before(async () => {
    userId = `test-user-api-free-extras-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-api-free-extras-${ts}`, name: "API free extras", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const vendorId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    const catalogName = await prisma.catalogName.create({ data: { vendorId, name: "Michel Europa", currency: "EUR" } });
    const editionId = (await prisma.catalogEdition.create({ data: { catalogNameId: catalogName.id, year: 2026 } })).id;
    const areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id } })
    ).id;
    await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: areaId, catalogNameId: catalogName.id } });
    const conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    const platformId = (
      await prisma.platform.create({
        data: { collectionId, name: "Fair", platformCurrency: "EUR", freeExtrasBudgetPercent: "1.5" },
      })
    ).id;

    const stamp: Record<string, string> = {};
    const held: [string, string, number][] = [
      ["A", "0.50", 2],
      ["B", "0.30", 3],
      ["C", "0.20", 2],
      ["D", "0.10", 1],
    ];
    for (const [name, price, count] of held) {
      stamp[name] = (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Stamp ${name}`,
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
      await prisma.stampCatalogPrice.create({
        data: {
          stampId: stamp[name],
          catalogEditionId: editionId,
          conditionId,
          certificateStatusId: null,
          formatId: null,
          price,
          currency: "EUR",
        },
      });
      for (let i = 0; i < count; i++) {
        const id = (
          await createItem(userId, collectionId, {
            stampId: stamp[name],
            conditionId,
            inCollection: false,
            forSale: true,
            forTrade: false,
          })
        ).id;
        const { itemNo } = await prisma.item.findUniqueOrThrow({ where: { id }, select: { itemNo: true } });
        copies[name].push({ id, no: formatItemNo(itemNo) });
      }
    }
    await prisma.checklist.create({
      data: {
        collectionId,
        name: "Definitives",
        stamps: { create: ["A", "B", "C"].map((name, sortOrder) => ({ stampId: stamp[name], sortOrder })) },
      },
    });

    saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-11-15"),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    // What the buyer bought: one paid set of 100.00, on no offer and holding none of the stock above.
    await prisma.saleLine.create({ data: { saleId, offerId: null, offerSetId: null, price: "100.00" } });

    token = (await createAssistantToken(userId, collectionId, { label: "extras agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "extras agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("proposes what Add free extras proposes, within the budget the marketplace's terms give the order", async () => {
    const proposal = await ok<AgentFreeExtraProposal>(token, "GET", `/sales/${saleId}/free-extras`);
    assert.equal(proposal.orderValue, "100.00");
    assert.equal(proposal.terms.due, "due");
    assert.equal(proposal.terms.budget, "1.50");
    assert.deepEqual(proposal.limits, { count: null, budget: "1.50" });
    assert.deepEqual(
      proposal.series.map((s) => [s.title, s.copies.map((c) => nameOf(c.copyId))]),
      [["Definitives", ["A", "B", "C"]]]
    );
    assert.deepEqual(
      proposal.copies.map((c) => nameOf(c.copyId)),
      ["D", "B"]
    );
    assert.equal(proposal.count, 5);
    assert.equal(proposal.value, "1.40");

    // The dialog's own proposal over the dialog's own read, within the same budget: the same copies.
    const read = await listFreeExtraCandidates(userId, saleId);
    const asCandidate = (row: (typeof read.candidates)[number]) => ({
      itemId: row.item.id,
      itemNo: row.item.itemNo,
      valueCents: toCents(row.value),
      listed: row.listed,
    });
    const dialog = proposeInDialog(
      read.candidates.map(asCandidate),
      { count: null, budgetCents: 150 },
      read.series.map((s) => ({ key: s.key, copies: s.copies.map(asCandidate) }))
    );
    assert.deepEqual(
      [...proposal.series.flatMap((s) => s.copies), ...proposal.copies].map((c) => c.copyId).sort(),
      [...dialog].sort()
    );
  });

  it("takes a count and a budget from the call in place of the terms'", async () => {
    const counted = await ok<AgentFreeExtraProposal>(token, "GET", `/sales/${saleId}/free-extras?count=2&budget=none`);
    assert.deepEqual(counted.limits, { count: 2, budget: null });
    assert.deepEqual(counted.series, []);
    assert.deepEqual(
      counted.copies.map((c) => nameOf(c.copyId)),
      ["D", "B"]
    );
    const wider = await ok<AgentFreeExtraProposal>(token, "GET", `/sales/${saleId}/free-extras?budget_percent=2.1`);
    assert.equal(wider.limits?.budget, "2.10");
    assert.equal(wider.series.length, 2);
    const both = await refused(token, "GET", `/sales/${saleId}/free-extras?budget=1&budget_percent=1`);
    assert.equal(both.status, 400);
  });

  it("refuses a copy that would break a complete set, with the app's sentence, and writes nothing", async () => {
    const answer = await refused(token, "POST", `/sales/${saleId}/free-extras`, { copies: [copies.A[0].no] });
    assert.equal(answer.status, 400);
    assert.match(answer.message, /would break a complete series/);
    assert.equal(await prisma.saleLine.count({ where: { saleId, freeExtra: true } }), 0);
  });

  it("refuses the write to a read-only token", async () => {
    const answer = await refused(readOnlyToken, "POST", `/sales/${saleId}/free-extras`, { copies: [copies.D[0].id] });
    assert.equal(answer.status, 403);
  });

  it("adds two of them to the sale's free-extras line at 0, marked to review", async () => {
    const proposal = await ok<AgentFreeExtraProposal>(token, "GET", `/sales/${saleId}/free-extras`);
    const [d, b] = proposal.copies;
    // One by its copy number, one by its id, as every copy write takes them.
    const sale = await ok<AgentSale>(token, "POST", `/sales/${saleId}/free-extras`, { copies: [d.copyNo, b.copyId] });
    const extras = sale.lines.filter((line) => line.freeExtra);
    assert.equal(extras.length, 1);
    assert.equal(Number(extras[0].price), 0);
    assert.equal(extras[0].copies.length, 2);
    const byNumber = [d.copyNo, b.copyNo].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
    assert.deepEqual(sale.toReview?.actions, [`added free extras ${byNumber.join(", ")}`]);

    // Where the sale screen reads it.
    const detail = await getSaleDetail(userId, saleId);
    const line = detail?.lines.find((l) => l.freeExtra);
    assert.equal(line?.copyCount, 2);

    // A later addition joins the same line.
    const [set] = (await ok<AgentFreeExtraProposal>(token, "GET", `/sales/${saleId}/free-extras`)).series;
    const after = await ok<AgentSale>(token, "POST", `/sales/${saleId}/free-extras`, {
      copies: set.copies.map((c) => c.copyId),
    });
    const grown = after.lines.filter((l) => l.freeExtra);
    assert.equal(grown.length, 1);
    assert.equal(grown[0].copies.length, 5);
  });

  it("refuses a sent sale unless the call says so, and a cancelled one always", async () => {
    await prisma.sale.update({ where: { id: saleId }, data: { status: "sent" } });
    const sent = await refused(token, "POST", `/sales/${saleId}/free-extras`, { copies: [copies.A[0].id] });
    assert.match(sent.message, /already been sent/);

    await prisma.sale.update({ where: { id: saleId }, data: { status: "cancelled" } });
    const cancelled = await refused(token, "GET", `/sales/${saleId}/free-extras`);
    assert.match(cancelled.message, /cancelled/);
    await prisma.sale.update({ where: { id: saleId }, data: { status: "ordered" } });
  });
});
