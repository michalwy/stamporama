import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken } from "../../src/lib/api-tokens";
import { GET, POST } from "../../src/app/api/v1/[...path]/route";
import {
  deleteStampFormat,
  getStampFormats,
  reorderStampFormats,
  seedDefaultFormats,
  updateStampFormat,
  DEFAULT_FORMATS,
} from "../../src/lib/stamp-formats";
import { COVER_FORMATS } from "../../src/lib/cover-kind";
import { getStampFormatPricing } from "../../src/lib/format-pricing";
import { formatFactorKey } from "../../src/lib/format-factor";
import { createItem } from "../../src/lib/items";
import type { AgentPriceWrite } from "../../src/lib/agent-api/catalog-prices";
import type { AgentCatalogPriceRow } from "../../src/lib/agent-api/operations/catalog-prices";

// **A stamp's prices on cover and on piece (#2356).** The four are reserved rows of the format
// dictionary: every price path reads them as formats — the grid's tabs, the multipliers, the agent
// API — and nothing a copy is described by may name one. This file holds the *Done when* as calls:
// the rows seeded and ordered after a copy's formats, out of the dictionary's editors, a multiplier
// deriving them, refused as a copy's format, and written and read through the agent API by name.

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

describe("prices on cover and on piece (#2356)", () => {
  let userId: string;
  let collectionId: string;
  let stampId: string;
  let usedId: string;
  let token: string;

  before(async () => {
    userId = `test-user-cover-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User cover-${ts}`,
        email: `test-cover-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-cover-${ts}`, name: "Cover prices", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    await seedDefaultFormats(collectionId, prisma as never);

    const michel = await prisma.catalogVendor.create({ data: { collectionId, name: "Michel", abbreviation: "Mi" } });
    const book = await prisma.catalogName.create({ data: { vendorId: michel.id, name: "Michel Polen", currency: "EUR" } });
    await prisma.catalogEdition.create({ data: { catalogNameId: book.id, year: 2024 } });
    const poland = await prisma.collectionArea.create({
      data: {
        collectionId,
        name: "Poland",
        primaryCatalogNameId: book.id,
        primaryCatalogVendorId: michel.id,
        collectionAreaVendors: { create: [{ catalogVendorId: michel.id, areaPrefix: null }] },
      },
    });
    await prisma.collectionAreaCatalog.create({ data: { collectionAreaId: poland.id, catalogNameId: book.id } });
    usedId = (await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })).id;
    const issueId = (
      await prisma.issue.create({ data: { collectionId, issueNo: 1, collectionAreaId: poland.id, name: "Definitives", year: 1960 } })
    ).id;
    stampId = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: "Stamp 309",
          catalogNumbers: { create: [{ catalogVendorId: michel.id, number: "309" }] },
          stampAreaLinks: { create: [{ collectionAreaId: poland.id, isPrimary: true }] },
        },
      })
    ).id;
    await prisma.issueMember.create({ data: { issueId, stampId, sortOrder: 0 } });
    token = (await createAssistantToken(userId, collectionId, { label: "cover agent", scope: "read_write", kind: "agent" })).token;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.stampCatalogPrice.deleteMany({ where: { stamp: { collectionId } } });
    await prisma.issueMember.deleteMany({ where: { issue: { collectionId } } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.issue.deleteMany({ where: { collectionId } });
    await prisma.stampFormatFactor.deleteMany({ where: { collectionId } });
    await prisma.stampFormat.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collectionArea.deleteMany({ where: { collectionId } });
    await prisma.catalogVendor.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const coverFormat = async (name: string) => {
    const all = await getStampFormats(userId, collectionId, { withCoverPrices: true });
    const found = all.find((f) => f.name === name);
    assert.ok(found, `no format ${name}`);
    return found;
  };

  it("seeds the four with a new collection, after a copy's formats and only when asked for", async () => {
    const copyFormats = await getStampFormats(userId, collectionId);
    assert.deepEqual(copyFormats.map((f) => f.name), DEFAULT_FORMATS.map((f) => f.name));
    assert.ok(copyFormats.every((f) => f.coverKind === null));

    const priceFormats = await getStampFormats(userId, collectionId, { withCoverPrices: true });
    assert.deepEqual(
      priceFormats.map((f) => [f.name, f.coverKind]),
      [...DEFAULT_FORMATS.map((f) => [f.name, null]), ...COVER_FORMATS.map((f) => [f.name, f.coverKind])]
    );
  });

  it("keeps them out of the dictionary's editors", async () => {
    const mif = await coverFormat("Cover MiF");
    await assert.rejects(() => updateStampFormat(userId, mif.id, { name: "Mixed", abbreviation: "Mx" }));
    await assert.rejects(() => deleteStampFormat(userId, mif.id));
    // Reordering names a copy's formats only, and the cover rows stay where they were.
    const copyIds = (await getStampFormats(userId, collectionId)).map((f) => f.id);
    await reorderStampFormats(userId, collectionId, [...copyIds].reverse());
    const after = await getStampFormats(userId, collectionId, { withCoverPrices: true });
    assert.deepEqual(after.slice(-4).map((f) => f.name), COVER_FORMATS.map((f) => f.name));
  });

  it("derives one from a multiplier, as a format's price is", async () => {
    const mif = await coverFormat("Cover MiF");
    await prisma.stampFormatFactor.create({ data: { collectionId, formatId: mif.id, factor: 3 } });
    const pricing = await getStampFormatPricing(userId, stampId);
    assert.ok(pricing.formats.some((f) => f.id === mif.id), "the grid has a Cover MiF tab");
    assert.equal(pricing.factors[formatFactorKey(mif.id, usedId)], 3);
  });

  it("refuses one as a copy's format", async () => {
    const ef = await coverFormat("Cover EF");
    await assert.rejects(() => createItem(userId, collectionId, { stampId, conditionId: usedId, formatId: ef.id }), /Format not found/);
    assert.equal(await prisma.item.count({ where: { collectionId } }), 0);
  });

  it("writes and reads them through the agent API by name", async () => {
    const written = await call(token, "POST", "/catalog-prices", {
      edition: "Mi 2024",
      prices: [
        "stamp=Mi 309; condition=Used; format=Cover MiF; price=40",
        "stamp=Mi 309; condition=Used; format=On piece; price=-",
      ],
    });
    assert.equal(written.status, 200, JSON.stringify(written.body));
    assert.ok((written.body as AgentPriceWrite).written === 2, JSON.stringify(written.body));

    const read = await call(token, "GET", `/catalog-prices?stamp=${stampId}`);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    const prices = (read.body as { items: AgentCatalogPriceRow[] }).items[0].prices;
    assert.deepEqual(
      prices.filter((p) => p.format).map((p) => [p.format, p.amount ?? p.mark]),
      [
        ["Cover MiF", "40.00"],
        ["On piece", "nonexistent"],
      ]
    );
  });
});
