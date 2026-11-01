import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { createOffer } from "../../src/lib/offers";
import { getDirectPlatform, getProposalScreen, moveProposal } from "../../src/lib/proposals";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentProposal, AgentProposalRow, AgentProposalSaleOptions } from "../../src/lib/agent-api/proposal-reads";
import type { AgentProposalConversion, AgentProposalNewLots } from "../../src/lib/agent-api/operations/proposals";
import type { ListResponse } from "../../src/lib/agent-api/list";

// **Proposals through the agent API (#2303), driven through the real route with real tokens.**
//
// `tests/unit/agent-api-proposal-reads.test.ts` holds the grammar and the projections, and
// `tests/unit/agent-api-operation-boundary.test.ts` holds *no send, no decline, no link, always
// marked* as a fact about imports. This file holds the rest: that a proposal is put together, priced
// and sold through the API as on its screen (`getProposalScreen` reads what was written), that the
// refusals are the app's, and that reading the message hands nothing to the buyer.

const ts = Date.now();

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

interface ApiErrorBody {
  error: { code: string; message: string; accepted?: string[] };
}

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
  return { status: answer.status, message: (answer.body as ApiErrorBody).error.message };
}

describe("the proposal operations (#2303)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let directId: string;
  let colnectId: string;
  let conditionId: string;
  let nextStamp = 0;

  before(async () => {
    userId = `test-user-proposalops-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User proposalops-${ts}`,
        email: `test-proposalops-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-proposalops-${ts}`, name: "Proposal ops", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    directId = (await getDirectPlatform(collectionId)).id;
    colnectId = (await prisma.platform.create({ data: { collectionId, name: "Stamp shop", platformCurrency: "PLN" } })).id;
    // A contact holding private details the surface must not repeat.
    await prisma.contact.create({
      data: { collectionId, name: "Jan Kowalski", email: `jan-${ts}@example.com`, phone: "+48 500 600 700" },
    });
    token = (await createAssistantToken(userId, collectionId, { label: "proposal agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "proposal agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function copy(): Promise<string> {
    nextStamp += 1;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: `Stamp ${nextStamp}` } })).id;
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" })).id;
  }

  /** An offer of one fresh copy on `platformId`, at `price`. */
  async function offer(platformId: string, price: string): Promise<{ id: string; offerNo: number }> {
    const id = await createOffer(
      userId,
      collectionId,
      { platformId, url: null, price, startingPrice: null, currency: "PLN", listingDate: null, state: "preparing" },
      { seedItemIds: [await copy()], seedPerCopy: true }
    );
    const { offerNo } = await prisma.offer.findUniqueOrThrow({ where: { id }, select: { offerNo: true } });
    return { id, offerNo };
  }

  it("carries the nine operations, six of them writes", () => {
    const names = [
      "list_proposals",
      "get_proposal",
      "get_proposal_sale_options",
      "create_proposal",
      "add_proposal_lots",
      "make_proposal_lots",
      "set_proposal_lot_price",
      "remove_proposal_lot",
      "convert_proposal_to_sale",
    ];
    for (const name of names) assert.ok(OPERATIONS.some((operation) => operation.name === name), name);
    const writing = OPERATIONS.filter((operation) => names.includes(operation.name) && operation.writes).map((o) => o.name);
    assert.deepEqual(writing.sort(), [
      "add_proposal_lots",
      "convert_proposal_to_sale",
      "create_proposal",
      "make_proposal_lots",
      "remove_proposal_lot",
      "set_proposal_lot_price",
    ]);
    // No send, no decline, no link: handing a proposal to the buyer stays in the app.
    assert.ok(!OPERATIONS.some((operation) => /(send|sent|decline|share|link|document)/.test(operation.name) && operation.name.includes("proposal")));
  });

  it("puts a proposal together, prices it and sells what the buyer took", async () => {
    const proposal = await ok<AgentProposal>(token, "POST", "/proposals", { contact: "jan kowalski" });
    assert.equal(proposal.status, "preparing");
    assert.deepEqual(proposal.lots, []);
    assert.equal(proposal.platform.id, directId);
    assert.deepEqual(Object.keys(proposal.contact).sort(), ["id", "name"]);
    assert.doesNotMatch(JSON.stringify(proposal), /example\.com|\+48/);
    // Without a template on Direct nothing is generated (#1692).
    assert.equal(proposal.message, null);
    const p = `/proposals/${proposal.proposalNo}`;

    // An offer already on Direct, by its number; one elsewhere is refused by the app's reason.
    const direct = await offer(directId, "20.00");
    const elsewhere = await offer(colnectId, "5.00");
    const notDirect = await refused(token, "POST", `${p}/lots`, { offers: [`#${direct.offerNo}`, String(elsewhere.offerNo)] });
    assert.equal(notDirect.status, 400);
    assert.match(notDirect.message, new RegExp(`Offer #${elsewhere.offerNo} is not on the Direct platform`));
    assert.equal((await getProposalScreen(userId, proposal.id))!.lots.length, 0, "nothing is half added");
    let read = await ok<AgentProposal>(token, "POST", `${p}/lots`, { offers: [`#${direct.offerNo}`] });
    assert.deepEqual(read.lots.map((lot) => [lot.lotNo, lot.offerNo, lot.price]), [[1, direct.offerNo, "20.00"]]);

    // Two copies made into a lot each, numbered after it.
    const [a, b] = [await copy(), await copy()];
    const made = await ok<AgentProposalNewLots>(token, "POST", `${p}/lots/new`, { copy_ids: [a, b], packing: "each" });
    assert.equal(made.made, 2);
    assert.deepEqual(made.proposal.lots.map((lot) => lot.lotNo), [1, 2, 3]);
    const copyNos = await prisma.item.findMany({ where: { id: { in: [a, b] } }, select: { itemNo: true }, orderBy: { itemNo: "asc" } });
    assert.deepEqual(
      made.proposal.lots.slice(1).flatMap((lot) => lot.copies).sort(),
      copyNos.map((item) => `#${item.itemNo}`).sort()
    );
    assert.ok(made.proposal.lots.slice(1).every((lot) => lot.state === "preparing"));
    const packing = await refused(token, "POST", `${p}/lots/new`, { copy_ids: [await copy()], packing: "pile" });
    assert.equal(packing.status, 400);

    // Priced by lot number; the figure is the offer's own.
    read = await ok<AgentProposal>(token, "PATCH", `${p}/lots/2/price`, { price: "12.5" });
    assert.equal(read.lots[1]!.price, "12.50");
    const second = await prisma.offer.findUniqueOrThrow({ where: { id: read.lots[1]!.offerId }, select: { price: true } });
    assert.equal(second.price.toFixed(2), "12.50");
    assert.equal((await refused(token, "PATCH", `${p}/lots/9/price`, { price: "1.00" })).status, 404);

    // Taken out while preparing: the offer stays and the lots after it move up.
    const third = read.lots[2]!;
    read = await ok<AgentProposal>(token, "DELETE", `${p}/lots/3`);
    assert.equal(read.lots.length, 2);
    assert.ok(!read.lots.some((lot) => lot.offerId === third.offerId));
    read = await ok<AgentProposal>(token, "POST", `${p}/lots`, { offers: [third.offerId] });
    assert.equal(read.lots.length, 3);

    // Listed by contact and status, with the full total.
    const listed = await ok<ListResponse<AgentProposalRow>>(token, "GET", "/proposals?contact=Jan%20Kowalski&status=preparing");
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0]!.lots, 3);
    assert.equal((await ok<ListResponse<AgentProposalRow>>(token, "GET", "/proposals?status=sold")).total, 0);

    // What it can be sold as.
    const options = await ok<AgentProposalSaleOptions>(token, "GET", `${p}/sale-options`);
    assert.deepEqual(options.lots.map((lot) => [lot.lotNo, lot.setsToSell]), [[1, 1], [2, 1], [3, 1]]);
    assert.deepEqual(options.sales, []);

    // A lot named alone with no price is refused rather than sold at nought.
    const lot3 = read.lots[2]!;
    assert.equal(lot3.price, null, "a copy with no catalogue value has no estimate to be priced at");
    assert.match((await refused(token, "POST", `${p}/sale`, { lots: ["3"], sale: "new" })).message, /Lot 3 has no price/);

    // The buyer took 1 at its price and 2 haggled down; 3 is withdrawn.
    const sold = await ok<AgentProposalConversion>(token, "POST", `${p}/sale`, { lots: ["1", "2=10"], sale: "new" });
    assert.equal(sold.proposal.status, "sold");
    assert.equal(sold.proposal.sale?.id, sold.sale.id);
    assert.deepEqual(sold.proposal.lots.map((lot) => lot.state), ["sold", "sold", "withdrawn"]);
    assert.deepEqual(sold.sale.lines.map((line) => [line.offerNo, line.price]).sort(), [
      [direct.offerNo, "20.00"],
      [read.lots[1]!.offerNo, "10.00"],
    ].sort());
    assert.ok(sold.sale.toReview, "a sale the agent recorded waits for the collector");
    assert.equal(sold.sale.toReview!.created, true);
    assert.equal(sold.sale.toReview!.actions.length, 2);

    // Nothing changes once sold, with the app's reason.
    const closed = await refused(token, "PATCH", `${p}/lots/1/price`, { price: "1.00" });
    assert.match(closed.message, /sold — its lots do not change any more/);
    assert.equal((await refused(token, "POST", `${p}/sale`, { lots: ["3"], sale: "new" })).status, 400);
  });

  it("refuses every change to a sent proposal's lots with the app's reason, until it is reopened (#2307)", async () => {
    const proposal = await ok<AgentProposal>(token, "POST", "/proposals", { contact: "Jan Kowalski" });
    const p = `/proposals/${proposal.proposalNo}`;
    const first = await offer(directId, "5.00");
    await ok<AgentProposal>(token, "POST", `${p}/lots`, { offers: [first.id] });
    await moveProposal(userId, proposal.id, "send");

    const extra = await offer(directId, "6.00");
    for (const [method, path, body] of [
      ["POST", `${p}/lots`, { offers: [extra.id] }],
      ["POST", `${p}/lots/new`, { copy_ids: [await copy()], packing: "each" }],
      ["PATCH", `${p}/lots/1/price`, { price: "9.00" }],
      ["DELETE", `${p}/lots/1`, undefined],
      ["PATCH", `/offers/${first.id}/price`, { price: "9.00" }],
    ] as const) {
      const answer = await refused(token, method, path, body);
      assert.equal(answer.status, 400, `${method} ${path}`);
      assert.match(answer.message, /has been sent/, `${method} ${path}`);
    }
    const unchanged = await ok<AgentProposal>(token, "GET", p);
    assert.equal(unchanged.lots.length, 1);
    assert.equal(unchanged.lots[0]!.price, "5.00");

    await moveProposal(userId, proposal.id, "reopen");
    const priced = await ok<AgentProposal>(token, "PATCH", `${p}/lots/1/price`, { price: "9.00" });
    assert.equal(priced.lots[0]!.price, "9.00");
  });

  it("reads the message from Direct's template without marking the proposal sent", async () => {
    await prisma.platform.update({ where: { id: directId }, data: { proposalMessageTemplate: "Dzień dobry {buyer}!\n{lots}\nRazem {total}" } });
    const proposal = await ok<AgentProposal>(token, "POST", "/proposals", { contact: "Jan Kowalski" });
    const lot = await offer(directId, "8.00");
    await ok<AgentProposal>(token, "POST", `/proposals/${proposal.id}/lots`, { offers: [lot.id] });
    const read = await ok<AgentProposal>(token, "GET", `/proposals/p${proposal.proposalNo}`);
    assert.match(read.message ?? "", /^Dzień dobry Jan Kowalski!/);
    assert.equal(read.status, "preparing");
    assert.equal((await getProposalScreen(userId, proposal.id))!.status, "preparing");
  });

  it("refuses an unknown contact with the close ones, and every write to a read-only token", async () => {
    const unknown = await refused(token, "POST", "/proposals", { contact: "Jan Kowalsky" });
    assert.match(unknown.message, /These are close: Jan Kowalski/);
    assert.equal((await refused(token, "GET", "/proposals/999")).status, 404);

    const proposal = await ok<AgentProposal>(token, "POST", "/proposals", { contact: "Jan Kowalski" });
    const p = `/proposals/${proposal.proposalNo}`;
    for (const [method, path, body] of [
      ["POST", "/proposals", { contact: "Jan Kowalski" }],
      ["POST", `${p}/lots`, { offers: ["1"] }],
      ["POST", `${p}/lots/new`, { copy_ids: ["x"], packing: "each" }],
      ["PATCH", `${p}/lots/1/price`, { price: "1.00" }],
      ["DELETE", `${p}/lots/1`, undefined],
      ["POST", `${p}/sale`, { lots: ["1"], sale: "new" }],
    ] as const) {
      assert.equal((await refused(readOnlyToken, method, path, body)).status, 403, `${method} ${path}`);
    }
    await ok(readOnlyToken, "GET", p);
  });
});
