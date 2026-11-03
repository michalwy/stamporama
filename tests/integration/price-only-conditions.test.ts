import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { GET, POST } from "../../src/app/api/v1/[...path]/route";
import {
  ConditionUsedByRecordsError,
  createStampCondition,
  getStampConditions,
  updateStampCondition,
} from "../../src/lib/conditions";
import { createItem } from "../../src/lib/items";
import { validateAcceptance } from "../../src/lib/acceptance";
import { getColnectConditionMappings, setColnectConditionMapping } from "../../src/lib/colnect";
import type { AgentPriceWrite } from "../../src/lib/agent-api/catalog-prices";
import type { CollectionVocabulary } from "../../src/lib/agent-api/vocabulary";

// **A condition can be a price column only (#2374)** — a cover's FP / FW / FM: on every price surface,
// in no picker that sets what a copy or a record is. This file holds the *Done when* as calls: the
// condition listed only when a price surface asks, refused as a copy's, a want's and a Colnect
// mapping's, marking one in use refused with what uses it, and the agent API naming the flag and
// writing a price in it.

const ts = Date.now();

async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const request = new NextRequest(`http://localhost/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const handler = method === "GET" ? GET : POST;
  const response = await handler(request, {
    params: Promise.resolve({ path: path.split("?")[0].split("/").filter(Boolean) }),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

describe("price-column-only conditions (#2374)", () => {
  let userId: string;
  let collectionId: string;
  let stampId: string;
  let usedId: string;
  let fpId: string;
  let token: string;

  before(async () => {
    userId = `test-user-price-only-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User price-only-${ts}`,
        email: `test-price-only-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-price-only-${ts}`, name: "Price columns", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;

    const fischer = await prisma.catalogVendor.create({ data: { collectionId, name: "Fischer", abbreviation: "Fi" } });
    const book = await prisma.catalogName.create({ data: { vendorId: fischer.id, name: "Fischer", currency: "PLN" } });
    await prisma.catalogEdition.create({ data: { catalogNameId: book.id, year: 2024 } });
    const poland = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Poland",
        primaryCatalogNameId: book.id,
        primaryCatalogVendorId: fischer.id,
        collectionAreaVendors: { create: [{ catalogVendorId: fischer.id, areaPrefix: null }] },
      },
    });
    await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: poland.id, catalogNameId: book.id } });
    usedId = (await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })).id;
    await createStampCondition(userId, collectionId, { name: "Single franking", abbreviation: "FP", symbol: "⊠", priceOnly: true });
    fpId = (await prisma.stampCondition.findFirstOrThrow({ where: { collectionId, abbreviation: "FP" } })).id;
    await prisma.stampCondition.create({ data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 2 } });

    const issueId = (
      await prisma.issue.create({ data: { collectionId, issueNo: 1, collectionAreaId: poland.id, name: "Definitives", year: 1960 } })
    ).id;
    stampId = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: "Stamp 1000",
          catalogNumbers: { create: [{ catalogVendorId: fischer.id, number: "1000" }] },
          stampAreaLinks: { create: [{ collectionAreaId: poland.id, isPrimary: true }] },
        },
      })
    ).id;
    await prisma.issueMember.create({ data: { issueId, stampId, sortOrder: 0 } });
    token = (await createAssistantToken(userId, collectionId, { label: "price-only agent", scope: "read_write", kind: "agent" })).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.stampCatalogPrice.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("lists it only where a price surface asks, in its place in the order", async () => {
    const copy = await getStampConditions(userId, collectionId);
    assert.deepEqual(copy.map((c) => c.abbreviation), ["U", "MNH"]);
    const prices = await getStampConditions(userId, collectionId, { withPriceOnly: true });
    assert.deepEqual(prices.map((c) => [c.abbreviation, c.priceOnly, c.symbol]), [
      ["U", false, null],
      ["FP", true, "⊠"],
      ["MNH", false, null],
    ]);
  });

  it("refuses it as a copy's, a want's and a Colnect mapping's condition", async () => {
    await assert.rejects(() => createItem(userId, collectionId, { stampId, conditionId: fpId }), /Condition not found/);
    assert.equal(await prisma.item.count({ where: { collectionId } }), 0);
    await assert.rejects(
      () => validateAcceptance(collectionId, { conditionIds: [fpId], certificateStatusIds: [], formatIds: [] }),
      /condition is not in this collection/
    );
    await assert.rejects(() => setColnectConditionMapping(userId, fpId, "MNH"), /not found/);
    const mappings = await getColnectConditionMappings(userId, collectionId);
    assert.deepEqual(mappings.map((m) => m.conditionAbbreviation), ["U", "MNH"]);
  });

  it("refuses to mark a condition in use, saying what uses it, and marks it once nothing does", async () => {
    await createItem(userId, collectionId, { stampId, conditionId: usedId });
    const fields = { name: "Used", abbreviation: "U", priceOnly: true };
    await assert.rejects(
      () => updateStampCondition(userId, usedId, fields),
      (err: unknown) =>
        err instanceof ConditionUsedByRecordsError &&
        err.message === "This condition cannot be a price column only while it is used by 1 copy."
    );
    assert.equal((await prisma.stampCondition.findUniqueOrThrow({ where: { id: usedId } })).priceOnly, false);

    await prisma.item.deleteMany({ where: { collectionId } });
    await updateStampCondition(userId, usedId, fields);
    assert.equal((await prisma.stampCondition.findUniqueOrThrow({ where: { id: usedId } })).priceOnly, true);
    await updateStampCondition(userId, usedId, { ...fields, priceOnly: false });
  });

  it("is named by the agent API's vocabulary and taken by its catalogue price tools", async () => {
    const vocabulary = await call(token, "GET", "/vocabulary");
    assert.equal(vocabulary.status, 200, JSON.stringify(vocabulary.body));
    const conditions = (vocabulary.body as CollectionVocabulary).conditions;
    assert.deepEqual(
      conditions.map((c) => [c.abbreviation, c.priceOnly ?? false]),
      [
        ["U", false],
        ["FP", true],
        ["MNH", false],
      ]
    );

    const written = await call(token, "POST", "/catalog-prices", {
      edition: "Fi 2024",
      prices: ["stamp=Fi 1000; condition=FP; price=12"],
    });
    assert.equal(written.status, 200, JSON.stringify(written.body));
    assert.equal((written.body as AgentPriceWrite).written, 1, JSON.stringify(written.body));
  });
});
