import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createAssistantToken,
  verifyAssistantToken,
  listAssistantTokens,
  revokeAssistantToken,
} from "../../src/lib/api-tokens";
import { matchColnectItems } from "../../src/lib/colnect";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-token-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-token-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

describe("assistant tokens", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`${ts}`)).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-token-${ts}`, name: "Tokens", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-token-other-${ts}`, name: "Other", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a token and verifies it back to owner + collection", async () => {
    const { token, record } = await createAssistantToken(userId, collectionId, "Dev laptop");
    assert.ok(token.startsWith("stmpa_"));
    assert.equal(record.label, "Dev laptop");
    assert.equal(record.lastUsedAt, null);

    const verified = await verifyAssistantToken(token);
    assert.deepEqual(verified, { collectionId, ownerId: userId });
  });

  it("bumps lastUsedAt on verification", async () => {
    const { token, record } = await createAssistantToken(userId, collectionId);
    await verifyAssistantToken(token);
    const rows = await listAssistantTokens(userId, collectionId);
    const row = rows.find((r) => r.id === record.id);
    assert.ok(row?.lastUsedAt, "lastUsedAt should be set after use");
  });

  it("rejects malformed, unknown, and revoked tokens", async () => {
    assert.equal(await verifyAssistantToken(""), null);
    assert.equal(await verifyAssistantToken("not-a-token"), null);
    assert.equal(await verifyAssistantToken("stmpa_deadbeef"), null);

    const { token, record } = await createAssistantToken(userId, collectionId);
    assert.ok(await verifyAssistantToken(token));
    await revokeAssistantToken(userId, collectionId, record.id);
    assert.equal(await verifyAssistantToken(token), null);
  });

  it("only the owner can create/list/revoke", async () => {
    await assert.rejects(() => createAssistantToken("wrong-user", collectionId), /access denied/i);
    await assert.rejects(() => listAssistantTokens("wrong-user", collectionId), /access denied/i);
  });

  it("a token resolves the owner that drives the matcher (end-to-end auth path)", async () => {
    // Mirrors the route layer: verify a bearer token, then run the matcher as the resolved owner.
    const mi = await prisma.catalogVendor.create({
      data: { collectionId, name: "Michel", abbreviation: "Mi" },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Mi 10" } });
    await prisma.stampCatalogNumber.create({
      data: { stampId: stamp.id, catalogVendorId: mi.id, number: "10" },
    });

    const { token } = await createAssistantToken(userId, collectionId);
    const auth = await verifyAssistantToken(token);
    assert.ok(auth);

    const results = await matchColnectItems(auth.ownerId, auth.collectionId, [
      { colnectId: "900", catalogRefs: [{ catalog: "Mi", number: "10" }] },
    ]);
    assert.equal(results[0].status, "auto");
    const updated = await prisma.stamp.findUnique({ where: { id: stamp.id }, select: { colnectId: true } });
    assert.equal(updated?.colnectId, "900");
  });

  it("a token is scoped to its collection (route pins collectionId)", async () => {
    // The route helper requires the token's collectionId to equal the URL's; verify the raw token
    // carries the collection it was minted for so a mismatch can be rejected upstream.
    const { token } = await createAssistantToken(userId, otherCollectionId);
    const auth = await verifyAssistantToken(token);
    assert.equal(auth?.collectionId, otherCollectionId);
    assert.notEqual(auth?.collectionId, collectionId);
  });
});
