import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { addStampToIssue } from "../../src/lib/issues";
import { createItem } from "../../src/lib/items";
import { OPERATIONS } from "../../src/lib/agent-api/registry";
import { DELETE, POST } from "../../src/app/api/v1/[...path]/route";
import { buildOpenApiDocument } from "../../src/lib/agent-api/openapi";

// **The variant tree through the agent API (#2140), driven through the real route with real
// tokens.** `tests/unit/agent-api-variant-tree.test.ts` holds the refusal sentence and
// `tests/unit/agent-api-operation-boundary.test.ts` holds *only this module moves or deletes a
// stamp*. This file holds the *Done when* as calls: a variant moved under another stamp of the same
// issue keeping its numbers, prices and copies, a variant brought up, a parent from another issue and
// a stamp's own variant refused, a variant nothing names deleted with its answer naming what went,
// and a variant something names — or a base stamp — refused with nothing changed.

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

interface TreeStamp {
  stampId: string;
  stampNo: number;
  catalogNumbers: string[];
}
interface Moved {
  stamp: TreeStamp;
  from: TreeStamp | null;
  to: TreeStamp | null;
  moved: boolean;
  issueId: string;
  ownPricesKept: { priceCount: number } | null;
}
interface Deleted {
  deleted: TreeStamp & { parent: TreeStamp; issueIds: string[] };
  removedWithIt: { cataloguePrices: number; translations: number; checklistPlaces: number; photos: number };
}

let nextIssueNo = 9801;

describe("the variant tree through the agent API (#2140)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let michelId: string;
  let conditionId: string;
  let editionId: string;
  let token: string;
  let readOnlyToken: string;

  before(async () => {
    userId = `test-user-vtree-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User vtree-${ts}`,
        email: `test-vtree-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-vtree-${ts}`, name: "Variant tree", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    michelId = (await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } })).id;
    areaId = (
      await prisma.collectionArea.create({
        data: {
          collectionId,
          name: "Poland",
          primaryCatalogVendorId: michelId,
          collectionAreaVendors: { create: [{ catalogVendorId: michelId, areaPrefix: null }] },
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    await prisma.stampSubtype.create({ data: { collectionId, name: "Color", actsAsVariant: true, isDefault: true, sortOrder: 0 } });
    const book = await prisma.catalogName.create({ data: { vendorId: michelId, name: "Michel Polen", currency: "EUR" } });
    editionId = (await prisma.catalogEdition.create({ data: { catalogNameId: book.id, year: 2024 } })).id;
    token = (await createAssistantToken(userId, collectionId, { label: "tree agent", scope: "read_write", kind: "agent" })).token;
    readOnlyToken = (
      await createAssistantToken(userId, collectionId, { label: "tree agent, read", scope: "read", kind: "agent" })
    ).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function newIssue(name: string) {
    return (
      await prisma.issue.create({ data: { collectionId, issueNo: nextIssueNo++, collectionAreaId: areaId, name } })
    ).id;
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

  const parentOf = async (stampId: string) =>
    (await prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: { parentId: true } })).parentId;

  it("moves a variant under another stamp of the issue, keeping its numbers, prices and copies", async () => {
    const issueId = await newIssue("Move");
    const a = await addStamp(issueId, "240");
    const b = await addStamp(issueId, "241");
    const variant = await addStamp(issueId, "240a", a);
    await prisma.stampCatalogPrice.create({
      data: { stampId: variant, catalogEditionId: editionId, conditionId, price: "4.00", currency: "EUR" },
    });
    const copy = await createItem(userId, collectionId, { stampId: variant, conditionId, inCollection: true, deliveryState: "delivered" });
    // `b` is priced and has no variants, so the moved stamp makes it an umbrella with its prices kept.
    await prisma.stampCatalogPrice.create({ data: { stampId: b, catalogEditionId: editionId, conditionId, price: "2.00", currency: "EUR" } });

    const answer = await ok<Moved>(token, "POST", `/stamps/${variant}/parent`, { parent: "Mi 241" });
    assert.equal(answer.moved, true);
    assert.equal(answer.from?.stampId, a);
    assert.equal(answer.to?.stampId, b);
    assert.equal(answer.issueId, issueId);
    assert.equal(answer.ownPricesKept?.priceCount, 1);
    assert.equal(await parentOf(variant), b);
    assert.deepEqual(
      (await prisma.stampCatalogNumber.findMany({ where: { stampId: variant }, select: { number: true } })).map((row) => row.number),
      ["240a"]
    );
    assert.equal(await prisma.stampCatalogPrice.count({ where: { stampId: variant } }), 1);
    assert.equal(await prisma.stampCatalogPrice.count({ where: { stampId: b } }), 1);
    assert.equal((await prisma.item.findUniqueOrThrow({ where: { id: copy.id } })).stampId, variant);
  });

  it("brings a variant up to stand on its own, and a second call says it was already there", async () => {
    const issueId = await newIssue("Up");
    const base = await addStamp(issueId, "300");
    const variant = await addStamp(issueId, "300a", base);
    const up = await ok<Moved>(token, "POST", `/stamps/${variant}/parent`, { top_level: true });
    assert.equal(up.to, null);
    assert.equal(up.from?.stampId, base);
    assert.equal(await parentOf(variant), null);
    const again = await ok<Moved>(token, "POST", `/stamps/${variant}/parent`, { top_level: true });
    assert.equal(again.moved, false);
  });

  it("refuses a parent from another issue, the stamp's own variant, and an ambiguous request", async () => {
    const issueId = await newIssue("Refusals");
    const other = await newIssue("Elsewhere");
    const base = await addStamp(issueId, "400");
    const child = await addStamp(issueId, "400a", base);
    const outsider = await addStamp(other, "500");

    const cross = await refused(token, "POST", `/stamps/${base}/parent`, { parent: outsider });
    assert.match(cross.error.message, /only within its issue/);
    const cycle = await refused(token, "POST", `/stamps/${base}/parent`, { parent: child });
    assert.match(cycle.error.message, /own variant/);
    const both = await refused(token, "POST", `/stamps/${child}/parent`, { parent: base, top_level: true });
    assert.match(both.error.message, /exactly one/);
    const neither = await refused(token, "POST", `/stamps/${child}/parent`, {});
    assert.match(neither.error.message, /exactly one/);
    assert.equal(await parentOf(base), null);
    assert.equal(await parentOf(child), base);
  });

  it("deletes a variant nothing names, and names what went with it", async () => {
    const issueId = await newIssue("Delete");
    const base = await addStamp(issueId, "600");
    const variant = await addStamp(issueId, "600a", base);
    await prisma.stampCatalogPrice.create({ data: { stampId: variant, catalogEditionId: editionId, conditionId, price: "1.00", currency: "EUR" } });

    const answer = await ok<Deleted>(token, "DELETE", `/stamps/st ${(await prisma.stamp.findUniqueOrThrow({ where: { id: variant } })).stampNo}`);
    assert.equal(answer.deleted.stampId, variant);
    assert.equal(answer.deleted.parent.stampId, base);
    assert.deepEqual(answer.deleted.catalogNumbers.map((label) => label.replace(/\s+/g, " ")), ["Mi 600a"]);
    assert.deepEqual(answer.deleted.issueIds, [issueId]);
    assert.equal(answer.removedWithIt.cataloguePrices, 1);
    assert.equal(await prisma.stamp.count({ where: { id: variant } }), 0);
    assert.equal(await prisma.stamp.count({ where: { id: base } }), 1);
  });

  it("refuses a variant something names, and a base stamp, with nothing changed", async () => {
    const issueId = await newIssue("Held");
    const base = await addStamp(issueId, "700");
    const withCopy = await addStamp(issueId, "700a", base);
    const copy = await createItem(userId, collectionId, { stampId: withCopy, conditionId, inCollection: true, deliveryState: "delivered" });
    const wanted = await addStamp(issueId, "700b", base);
    await prisma.want.create({ data: { collectionId, stampId: wanted } });
    const withVariants = await addStamp(issueId, "700c", base);
    await addStamp(issueId, "700cI", withVariants);

    const byCopy = await refused(token, "DELETE", `/stamps/${withCopy}`);
    assert.equal(byCopy.error.code, "invalid_request");
    const itemNo = (await prisma.item.findUniqueOrThrow({ where: { id: copy.id } })).itemNo;
    assert.match(byCopy.error.message, new RegExp(`1 copy \\(#${itemNo}\\)`));
    assert.match((await refused(token, "DELETE", `/stamps/${wanted}`)).error.message, /1 want/);
    assert.match((await refused(token, "DELETE", `/stamps/${withVariants}`)).error.message, /variant of its own/);
    assert.match((await refused(token, "DELETE", `/stamps/${base}`)).error.message, /base stamp/);
    assert.equal(await prisma.stamp.count({ where: { id: { in: [base, withCopy, wanted, withVariants] } } }), 4);
    assert.equal(await prisma.item.count({ where: { id: copy.id } }), 1);
  });

  it("refuses a read-only token on both writes", async () => {
    const issueId = await newIssue("Read only");
    const base = await addStamp(issueId, "800");
    const variant = await addStamp(issueId, "800a", base);
    assert.equal((await refused(readOnlyToken, "POST", `/stamps/${variant}/parent`, { top_level: true })).status, 403);
    assert.equal((await refused(readOnlyToken, "DELETE", `/stamps/${variant}`)).status, 403);
    assert.equal(await parentOf(variant), base);
  });

  it("publishes both operations as writes in the registry and the document", () => {
    const document = buildOpenApiDocument(OPERATIONS, { appVersion: "test" }) as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    const published = new Set(
      Object.values(document.paths).flatMap((methods) => Object.values(methods).map((entry) => entry.operationId))
    );
    for (const [name, path, method] of [
      ["move_stamp_variant", "/stamps/{stamp_id}/parent", "POST"],
      ["delete_stamp_variant", "/stamps/{stamp_id}", "DELETE"],
    ] as const) {
      const operation = OPERATIONS.find((op) => op.name === name);
      assert.equal(operation?.writes, true, name);
      assert.equal(operation?.path, path, name);
      assert.equal(operation?.method, method, name);
      assert.ok(published.has(name), `${name} is not in the document`);
    }
  });
});
