import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createAssistantRegistrationCode,
  redeemAssistantRegistrationCode,
} from "../../src/lib/assistant-registration";
import { listAssistantTokens, verifyAssistantToken } from "../../src/lib/api-tokens";

describe("assistant registration codes", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-reg-${ts}`,
          name: "Test User Reg",
          email: `test-reg-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-reg-${ts}`, name: "Registered", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("redeems a code into a token scoped to the collection", async () => {
    const { code, expiresAt } = await createAssistantRegistrationCode(userId, collectionId);
    assert.ok(code.startsWith("stmpr_"));
    assert.ok(new Date(expiresAt).getTime() > Date.now());

    const redeemed = await redeemAssistantRegistrationCode(code);
    assert.ok(redeemed);
    assert.equal(redeemed.collectionId, collectionId);
    assert.equal(redeemed.collectionName, "Registered");

    const verified = await verifyAssistantToken(redeemed.token);
    assert.deepEqual(verified, { collectionId, ownerId: userId });
  });

  it("a redeemed token is listed and revocable like any other", async () => {
    const { code } = await createAssistantRegistrationCode(userId, collectionId);
    const redeemed = await redeemAssistantRegistrationCode(code);
    assert.ok(redeemed);

    const tokens = await listAssistantTokens(userId, collectionId);
    assert.ok(tokens.some((t) => t.label === "Stamporama Assistant (registered)"));
  });

  it("spends a code exactly once", async () => {
    const { code } = await createAssistantRegistrationCode(userId, collectionId);
    assert.ok(await redeemAssistantRegistrationCode(code));
    assert.equal(await redeemAssistantRegistrationCode(code), null);
  });

  it("rejects malformed, unknown, and expired codes", async () => {
    assert.equal(await redeemAssistantRegistrationCode(""), null);
    assert.equal(await redeemAssistantRegistrationCode("not-a-code"), null);
    assert.equal(await redeemAssistantRegistrationCode("stmpr_nope"), null);

    const { code } = await createAssistantRegistrationCode(userId, collectionId);
    await prisma.assistantRegistrationCode.updateMany({
      where: { collectionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    assert.equal(await redeemAssistantRegistrationCode(code), null);
  });

  it("minting supersedes the collection's previous code", async () => {
    const first = await createAssistantRegistrationCode(userId, collectionId);
    const second = await createAssistantRegistrationCode(userId, collectionId);
    assert.equal(await redeemAssistantRegistrationCode(first.code), null);
    assert.ok(await redeemAssistantRegistrationCode(second.code));
  });

  it("only the owner can mint", async () => {
    await assert.rejects(
      () => createAssistantRegistrationCode("wrong-user", collectionId),
      /access denied/i
    );
  });
});
