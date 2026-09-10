import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken, revokeAssistantToken } from "../../src/lib/api-tokens";
import { resolveAgentApiCaller } from "../../src/lib/route-auth";

// `/api/v1` carries **no collection id in any path** (#706, ADR-0050), and this is the function that
// makes that safe: the collection is derived from the token rather than supplied by the caller.
//
// It is worth an integration test rather than a unit one for the reason `api-tokens.test.ts` is —
// the whole claim is about a real row in a real database, hashed and looked up — and it is worth a
// test at all because it is the only thing standing between an agent token and a collection.
// #707 builds scope enforcement on top of it.

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-agentapi-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-agentapi-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/** A request carrying whatever `Authorization` header the case is about, and nothing else. */
function request(authorization?: string): NextRequest {
  return new NextRequest("http://localhost/api/v1/anything", {
    headers: authorization ? { authorization } : {},
  });
}

describe("agent API caller resolution", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;

  before(async () => {
    // Unique per run, like every other file here: the suite isolates by id, and a fixed one survives
    // a run whose `before` threw — leaving the *next* run failing on a unique constraint rather than
    // on whatever it was actually testing.
    const ts = Date.now();
    userId = (await createTestUser(`${ts}`)).id;
    collectionId = (
      await prisma.collection.create({
        data: { name: "Agent API", slug: `agent-api-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { name: "Other", slug: `agent-api-other-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
  });

  after(async () => {
    await prisma.assistantToken.deleteMany({
      where: { collectionId: { in: [collectionId, otherCollectionId] } },
    });
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("derives the collection from the token, so no path has to carry one", async () => {
    const { token } = await createAssistantToken(userId, collectionId, "agent");
    const caller = await resolveAgentApiCaller(request(`Bearer ${token}`));
    assert.ok(caller);
    assert.equal(caller.collectionId, collectionId);
    assert.equal(caller.ownerId, userId);
  });

  it("gives each token its own collection, and never the other one", async () => {
    // The point of removing the id from the path: two tokens of one owner still answer differently,
    // and neither can be pointed at the other's collection because there is nothing to point with.
    const mine = await createAssistantToken(userId, collectionId, "mine");
    const theirs = await createAssistantToken(userId, otherCollectionId, "theirs");
    const a = await resolveAgentApiCaller(request(`Bearer ${mine.token}`));
    const b = await resolveAgentApiCaller(request(`Bearer ${theirs.token}`));
    assert.equal(a?.collectionId, collectionId);
    assert.equal(b?.collectionId, otherCollectionId);
    assert.notEqual(a?.collectionId, b?.collectionId);
  });

  it("refuses a request with no Authorization header", async () => {
    assert.equal(await resolveAgentApiCaller(request()), null);
  });

  it("refuses anything that is not a bearer token, and an unknown one", async () => {
    assert.equal(await resolveAgentApiCaller(request("Basic dXNlcjpwYXNz")), null);
    assert.equal(await resolveAgentApiCaller(request("Bearer stmpa_not-a-real-token")), null);
    assert.equal(await resolveAgentApiCaller(request("Bearer without-the-prefix")), null);
  });

  it("takes the scheme case-insensitively, as HTTP requires", async () => {
    const { token } = await createAssistantToken(userId, collectionId, "case");
    assert.ok(await resolveAgentApiCaller(request(`bearer ${token}`)));
  });

  it("refuses a revoked token", async () => {
    const { token, record } = await createAssistantToken(userId, collectionId, "revoked");
    assert.ok(await resolveAgentApiCaller(request(`Bearer ${token}`)));
    await revokeAssistantToken(userId, collectionId, record.id);
    assert.equal(await resolveAgentApiCaller(request(`Bearer ${token}`)), null);
  });
});
