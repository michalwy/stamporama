import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { getLotIntakePage, getLotIntakeSummary } from "../../src/lib/items";
import { markPurchaseArrived } from "../../src/lib/lots";
import { confirmCopyApiReviews } from "../../src/lib/lot-copies-api";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/v1/[...path]/route";
import type { AgentLotCopy, AgentPurchase } from "../../src/lib/agent-api/purchase-reads";

// **A purchase lot filled through the agent API (#2551), driven through the real route.**
//
// The *Done when*, as a sequence of calls: an order email listing "Mi 1234–1236 MNH, Fi 500 used ×2"
// becomes an order, a lot and five copies, shown ordered on the purchase screen's own read and marked
// for review; a whole issue adds one copy of each of its stamps; an ambiguous number is refused with
// its candidates; a copy is corrected and another removed while ordered; an arrived copy and a closed
// lot refuse every change; and a read-only token is refused naming the scope.

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

interface Added {
  added: AgentLotCopy[];
  lotCopies: number;
}

describe("filling a purchase lot through the agent API (#2551)", () => {
  let userId: string;
  let collectionId: string;
  let token: string;
  let readOnlyToken: string;
  let issueId: string;
  let twoChecklistIssueId: string;
  const stamps: Record<string, string> = {};
  let purchaseId: string;
  let lotId: string;

  before(async () => {
    userId = `test-user-lotcopies-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User lotcopies-${ts}`,
        email: `test-lotcopies-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-lotcopies-${ts}`, name: "Lot copies", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    await prisma.contact.create({ data: { collectionId, name: "Philkam", seller: true } });

    for (const [name, abbreviation, sortOrder, priceOnly] of [
      ["Mint Never Hinged", "MNH", 0, false],
      ["Mint Hinged", "MH", 1, false],
      ["Used", "used", 2, false],
      ["FDC price", "FP", 3, true],
    ] as const) {
      await prisma.stampCondition.create({ data: { collectionId, name, abbreviation, sortOrder, priceOnly } });
    }
    await prisma.stampFormat.create({ data: { collectionId, name: "Pair", abbreviation: "pr", sortOrder: 0 } });

    const michel = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const fischer = await prisma.catalogVendor.create({ data: { collectionId, name: "Fischer", abbreviation: "Fi" } });
    const catalogName = await prisma.catalogName.create({
      data: { vendorId: michel.id, name: "Michel Polen", currency: "EUR" },
    });
    const areaId = (
      await prisma.collectionArea.create({ data: { collectionId, name: "Poland", primaryCatalogNameId: catalogName.id } })
    ).id;
    const issue = await prisma.issue.create({
      data: { collectionId, issueNo: 2551, collectionAreaId: areaId, name: "Castles", year: 1970 },
    });
    issueId = issue.id;
    const other = await prisma.issue.create({
      data: { collectionId, issueNo: 2552, collectionAreaId: areaId, name: "Birds", year: 1971 },
    });
    twoChecklistIssueId = other.id;

    const stamp = async (key: string, issueRef: string, mi: string, fi?: string) => {
      const row = await prisma.stamp.create({ data: { collectionId, name: key, issuedYear: 1970 } });
      await prisma.stampCollectionArea.create({ data: { stampId: row.id, collectionAreaId: areaId, isPrimary: true } });
      await prisma.issueMember.create({ data: { issueId: issueRef, stampId: row.id } });
      await prisma.stampCatalogNumber.create({ data: { stampId: row.id, catalogVendorId: michel.id, number: mi } });
      if (fi) {
        await prisma.stampCatalogNumber.create({ data: { stampId: row.id, catalogVendorId: fischer.id, number: fi } });
      }
      stamps[key] = row.id;
      return row.id;
    };
    await stamp("Wawel", issueId, "1234");
    await stamp("Malbork", issueId, "1235");
    await stamp("Niedzica", issueId, "1236", "500");
    // Two stamps sharing one number — the ambiguity the refusal must name.
    await stamp("Eagle", other.id, "1300");
    await stamp("Eagle imperf", other.id, "1300");

    const castles = await prisma.checklist.create({
      data: { collectionId, issueId, name: "Castles", kind: "standard" },
    });
    for (const [i, key] of ["Wawel", "Malbork", "Niedzica"].entries()) {
      await prisma.checklistStamp.create({ data: { checklistId: castles.id, stampId: stamps[key], sortOrder: i } });
    }
    for (const name of ["Perforated", "Imperforate"]) {
      const checklist = await prisma.checklist.create({
        data: { collectionId, issueId: other.id, name, kind: "standard" },
      });
      await prisma.checklistStamp.create({
        data: { checklistId: checklist.id, stampId: stamps[name === "Perforated" ? "Eagle" : "Eagle imperf"] },
      });
    }

    token = (
      await createAssistantToken(userId, collectionId, { label: "lot agent", scope: "read_write", kind: "agent" })
    ).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "lot agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("enters the email's order, a lot, and its five copies — ordered and marked for review", async () => {
    const purchase = await ok<AgentPurchase>(token, "POST", "/purchases", {
      seller: "Philkam",
      purchased_at: "2026-11-16",
    });
    purchaseId = purchase.purchaseId;
    const lot = await ok<{ lot: { lotId: string } }>(token, "POST", `/purchases/${purchaseId}/lots`, {
      title: "Castles + Fi 500",
      price: "30.00",
    });
    lotId = lot.lot.lotId;

    for (const number of ["Mi 1234", "Mi 1235", "Mi 1236"]) {
      const answer = await ok<Added>(token, "POST", `/purchase-lots/${lotId}/copies`, {
        stamp: number,
        condition: "MNH",
      });
      assert.equal(answer.added.length, 1);
      assert.equal(answer.added[0].condition, "Mint Never Hinged");
      assert.equal(answer.added[0].state, "ordered");
      assert.equal(answer.added[0].toReview?.created, true);
    }
    const used = await ok<Added>(token, "POST", `/purchase-lots/${lotId}/copies`, {
      stamp: "Fi 500",
      condition: "used",
      quantity: 2,
    });
    assert.deepEqual(
      used.added.map((copy) => [copy.stampId, copy.condition]),
      [
        [stamps.Niedzica, "Used"],
        [stamps.Niedzica, "Used"],
      ]
    );
    assert.equal(used.lotCopies, 5);

    // The purchase screen's own read: five copies, every one ordered and carrying the marker.
    const page = await getLotIntakePage(userId, collectionId, lotId);
    assert.equal(page.items.length, 5);
    assert.ok(page.items.every((item) => item.deliveryState === "ordered" && item.apiReview?.created));
    const summary = await getLotIntakeSummary(userId, collectionId, lotId);
    assert.equal(summary.apiReviewCount, 5);
    const rows = await prisma.item.findMany({ where: { lotId }, select: { deliveryState: true, inCollection: true, costBasis: true } });
    assert.ok(rows.every((row) => row.deliveryState === "ordered" && !row.inCollection && row.costBasis === null));

    // `get_purchase` lists them under the lot.
    const read = await ok<AgentPurchase>(token, "GET", `/purchases/${purchaseId}`);
    const listed = read.lots.find((candidate) => candidate.lotId === lotId)!;
    assert.equal(listed.copies, 5);
    assert.equal(listed.copyList?.length, 5);
    assert.deepEqual(listed.copyList?.[0].catalogNumbers.includes("Mi 1234"), true);
  });

  it("adds a whole issue as one copy of each of its stamps", async () => {
    const lot = await ok<{ lot: { lotId: string } }>(token, "POST", `/purchases/${purchaseId}/lots`, {
      title: "Castles set",
      price: "10.00",
    });
    const answer = await ok<Added>(token, "POST", `/purchase-lots/${lot.lot.lotId}/copies`, {
      issue: issueId,
      condition: "MH",
    });
    assert.deepEqual(
      answer.added.map((copy) => copy.stampId),
      [stamps.Wawel, stamps.Malbork, stamps.Niedzica]
    );
    // An issue with two checklists names them rather than choosing.
    const { error } = await refused(token, "POST", `/purchase-lots/${lot.lot.lotId}/copies`, {
      issue: twoChecklistIssueId,
      condition: "MH",
    });
    assert.match(error.message, /2 checklists/);
    assert.equal(error.accepted?.length, 2);
    const chosen = await ok<Added>(token, "POST", `/purchase-lots/${lot.lot.lotId}/copies`, {
      issue: twoChecklistIssueId,
      checklist: error.accepted![1],
      condition: "MH",
    });
    assert.deepEqual(chosen.added.map((copy) => copy.stampId), [stamps["Eagle imperf"]]);
  });

  it("refuses an ambiguous number with the candidates, and a price-only condition", async () => {
    const before = await prisma.item.count({ where: { lotId } });
    const { status, error } = await refused(token, "POST", `/purchase-lots/${lotId}/copies`, {
      stamp: "Mi 1300",
      condition: "MNH",
    });
    assert.equal(status, 400);
    assert.deepEqual([...(error.accepted ?? [])].sort(), [stamps.Eagle, stamps["Eagle imperf"]].sort());
    const priceOnly = await refused(token, "POST", `/purchase-lots/${lotId}/copies`, {
      stamp: "Mi 1234",
      condition: "FP",
    });
    assert.match(priceOnly.error.message, /price column only/);
    const both = await refused(token, "POST", `/purchase-lots/${lotId}/copies`, {
      stamp: "Mi 1234",
      issue: issueId,
      condition: "MNH",
    });
    assert.equal(both.status, 400);
    assert.equal(await prisma.item.count({ where: { lotId } }), before, "nothing was written");
  });

  it("corrects one copy's condition and removes another while they are ordered", async () => {
    const [first, second] = (await ok<AgentPurchase>(token, "GET", `/purchases/${purchaseId}`)).lots.find(
      (candidate) => candidate.lotId === lotId
    )!.copyList!;
    const corrected = await ok<{ copy: AgentLotCopy; changed: string[] }>(
      token,
      "PATCH",
      `/purchase-lot-copies/${first.copyId}`,
      { condition: "MH", format: "Pair" }
    );
    assert.deepEqual(corrected.changed, ["condition", "format"]);
    assert.equal(corrected.copy.condition, "Mint Hinged");
    assert.equal(corrected.copy.format, "Pair");
    assert.deepEqual(corrected.copy.toReview?.changed, ["condition", "format"]);
    assert.equal(corrected.copy.toReview?.created, true, "a correction adds to the marker, never replaces it");

    const restamped = await ok<{ copy: AgentLotCopy; changed: string[] }>(
      token,
      "PATCH",
      `/purchase-lot-copies/${first.copyId}`,
      { stamp: "Mi 1235", format: "single" }
    );
    assert.deepEqual(restamped.changed, ["stamp", "format"]);
    assert.equal(restamped.copy.stampId, stamps.Malbork);
    assert.equal(restamped.copy.format, undefined);

    const removed = await ok<{ removed: number; lotCopies: number }>(
      token,
      "DELETE",
      `/purchase-lot-copies/${second.copyId}`
    );
    assert.deepEqual(removed, { removed: 1, lotCopies: 4 });
    assert.equal(await prisma.item.count({ where: { id: second.copyId } }), 0);
  });

  it("keeps the marker until the collector confirms it", async () => {
    const [copy] = (await ok<AgentPurchase>(token, "GET", `/purchases/${purchaseId}`)).lots.find(
      (candidate) => candidate.lotId === lotId
    )!.copyList!;
    assert.equal(await confirmCopyApiReviews(userId, { itemIds: [copy.copyId] }), 1);
    const after = await ok<AgentPurchase>(token, "GET", `/purchases/${purchaseId}`);
    const listed = after.lots.find((candidate) => candidate.lotId === lotId)!.copyList!;
    assert.equal(listed.find((row) => row.copyId === copy.copyId)?.toReview, undefined);
    assert.equal(listed.filter((row) => row.toReview).length, 3);
    // A correction after the confirm starts the marker afresh: changed, not created.
    const again = await ok<{ copy: AgentLotCopy }>(token, "PATCH", `/purchase-lot-copies/${copy.copyId}`, {
      condition: "used",
    });
    assert.deepEqual(again.copy.toReview && { created: again.copy.toReview.created, changed: again.copy.toReview.changed }, {
      created: false,
      changed: ["condition"],
    });
  });

  it("refuses every change to a copy that has arrived, and any copy of a closed lot", async () => {
    const [arrivedCopy] = (await ok<AgentPurchase>(token, "GET", `/purchases/${purchaseId}`)).lots.find(
      (candidate) => candidate.lotId === lotId
    )!.copyList!;
    await prisma.item.update({ where: { id: arrivedCopy.copyId }, data: { deliveryState: "to_sort" } });
    for (const [method, body] of [
      ["PATCH", { condition: "MNH" }],
      ["DELETE", undefined],
    ] as const) {
      const { status, error } = await refused(token, method, `/purchase-lot-copies/${arrivedCopy.copyId}`, body);
      assert.equal(status, 400);
      assert.match(error.message, /no longer ordered/);
    }

    // A closed lot: its own copies are refused, and so is adding to it.
    const closedLot = await prisma.purchaseLot.create({
      data: { purchaseId, price: "5.00", status: "closed" },
    });
    const onClosed = await prisma.item.create({
      data: {
        collectionId,
        itemNo: 99001,
        stampId: stamps.Wawel,
        lotId: closedLot.id,
        deliveryState: "ordered",
        inCollection: false,
      },
    });
    for (const [method, path, body] of [
      ["POST", `/purchase-lots/${closedLot.id}/copies`, { stamp: "Mi 1234", condition: "MNH" }],
      ["PATCH", `/purchase-lot-copies/${onClosed.id}`, { condition: "MNH" }],
      ["DELETE", `/purchase-lot-copies/${onClosed.id}`, undefined],
    ] as const) {
      const { status, error } = await refused(token, method, path, body);
      assert.equal(status, 400, `${method} ${path}`);
      assert.match(error.message, /closed/);
    }
    assert.equal(await prisma.item.count({ where: { id: onClosed.id } }), 1);
  });

  it("adds nothing to an order that has arrived, nor to a trade's incoming half", async () => {
    const arrived = await ok<AgentPurchase>(token, "POST", "/purchases", { seller: "Philkam", purchased_at: "2026-11-10" });
    const lot = await ok<{ lot: { lotId: string } }>(token, "POST", `/purchases/${arrived.purchaseId}/lots`, { price: "4.00" });
    await markPurchaseArrived(userId, arrived.purchaseId);
    const { error } = await refused(token, "POST", `/purchase-lots/${lot.lot.lotId}/copies`, {
      stamp: "Mi 1234",
      condition: "MNH",
    });
    assert.match(error.message, /has arrived/);

    const partner = await prisma.contact.findFirstOrThrow({ where: { collectionId, name: "Philkam" } });
    const trade = await prisma.trade.create({ data: { collectionId, tradeNo: 1, partnerId: partner.id, currency: "EUR" } });
    const incoming = await prisma.purchase.create({
      data: { collectionId, purchaseNo: 9901, tradeId: trade.id, purchasedAt: new Date("2026-11-01T00:00:00Z"), currency: "EUR" },
    });
    const tradeLot = await prisma.purchaseLot.create({ data: { purchaseId: incoming.id, price: "0.00" } });
    const fromTrade = await refused(token, "POST", `/purchase-lots/${tradeLot.id}/copies`, {
      stamp: "Mi 1234",
      condition: "MNH",
    });
    assert.match(fromTrade.error.message, /incoming half of a trade/);
  });

  it("refuses a read-only token on every lot-copy write, naming the scope needed", async () => {
    const [copy] = (await ok<AgentPurchase>(readOnlyToken, "GET", `/purchases/${purchaseId}`)).lots[0].copyList!;
    for (const [method, path, body] of [
      ["POST", `/purchase-lots/${lotId}/copies`, { stamp: "Mi 1234", condition: "MNH" }],
      ["PATCH", `/purchase-lot-copies/${copy.copyId}`, { condition: "MNH" }],
      ["DELETE", `/purchase-lot-copies/${copy.copyId}`, undefined],
    ] as const) {
      const { status, error } = await refused(readOnlyToken, method, path, body);
      assert.equal(status, 403, `${method} ${path}`);
      assert.ok(error.accepted?.includes("read_write"), `${method} ${path} names the scope`);
    }
  });
});
