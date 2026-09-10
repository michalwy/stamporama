import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken, revokeAssistantToken } from "../../src/lib/api-tokens";
import { assertAgentApiScope, resolveAgentApiCaller } from "../../src/lib/route-auth";
import { isApiError } from "../../src/lib/agent-api/errors";
import type { Operation } from "../../src/lib/agent-api/types";

// `/api/v1` carries **no collection id in any path** (#706, ADR-0050), and this is the function that
// makes that safe: the collection is derived from the token rather than supplied by the caller.
//
// It is worth an integration test rather than a unit one for the reason `api-tokens.test.ts` is —
// the whole claim is about a real row in a real database, hashed and looked up — and it is worth a
// test at all because it is the only thing standing between an agent token and a collection.
// #707 builds scope enforcement on top of it, and that half is here for the same reason: the scope
// is a column on a real hashed row, so the claim *a `read` token is refused on a writing operation*
// is only worth anything when the token was actually minted and read back through the database. The
// decision itself is pure and is exercised over both directions in
// `tests/unit/agent-api-scope.test.ts`; the operations here are fixtures because **nothing on
// `main` writes** — #706 shipped no operation at all and #708's one declares `writes: false` — and
// adding a writing one to make the test real would breach its issue's *Out of scope*. #711 and #712
// are where that stops being true.

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

/** Stand-ins for the operations #710 will add. `writes` is the only field the check reads. */
const READING: Pick<Operation, "name" | "writes"> = { name: "find_unlisted_copies", writes: false };
const WRITING: Pick<Operation, "name" | "writes"> = { name: "set_offer_price", writes: true };

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
    const { token } = await createAssistantToken(userId, collectionId, {
      label: "agent",
      scope: "read",
      kind: "agent",
    });
    const caller = await resolveAgentApiCaller(request(`Bearer ${token}`));
    assert.ok(caller);
    assert.equal(caller.collectionId, collectionId);
    assert.equal(caller.ownerId, userId);
  });

  it("gives each token its own collection, and never the other one", async () => {
    // The point of removing the id from the path: two tokens of one owner still answer differently,
    // and neither can be pointed at the other's collection because there is nothing to point with.
    const mine = await createAssistantToken(userId, collectionId, {
      label: "mine",
      scope: "read_write",
      kind: "agent",
    });
    const theirs = await createAssistantToken(userId, otherCollectionId, {
      label: "theirs",
      scope: "read_write",
      kind: "agent",
    });
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
    const { token } = await createAssistantToken(userId, collectionId, {
      label: "case",
      scope: "read_write",
      kind: "extension",
    });
    assert.ok(await resolveAgentApiCaller(request(`bearer ${token}`)));
  });

  it("refuses a revoked token", async () => {
    const { token, record } = await createAssistantToken(userId, collectionId, {
      label: "revoked",
      scope: "read_write",
      kind: "agent",
    });
    assert.ok(await resolveAgentApiCaller(request(`Bearer ${token}`)));
    await revokeAssistantToken(userId, collectionId, record.id);
    assert.equal(await resolveAgentApiCaller(request(`Bearer ${token}`)), null);
  });

  it("carries the token's own scope through to the caller (#707)", async () => {
    const read = await createAssistantToken(userId, collectionId, {
      label: "read",
      scope: "read",
      kind: "agent",
    });
    const write = await createAssistantToken(userId, collectionId, {
      label: "write",
      scope: "read_write",
      kind: "extension",
    });
    assert.equal((await resolveAgentApiCaller(request(`Bearer ${read.token}`)))?.scope, "read");
    assert.equal(
      (await resolveAgentApiCaller(request(`Bearer ${write.token}`)))?.scope,
      "read_write"
    );
  });

  it("refuses a read token on a writing operation, and accepts it on a reading one", async () => {
    const { token } = await createAssistantToken(userId, collectionId, {
      label: "read-only agent",
      scope: "read",
      kind: "agent",
    });
    const caller = await resolveAgentApiCaller(request(`Bearer ${token}`));
    assert.ok(caller);

    // The reading half first: a `read` token is an ordinary caller everywhere it is allowed, and a
    // scope check that refused everything would pass the other assertion for the wrong reason.
    assert.doesNotThrow(() => assertAgentApiScope(caller, READING));

    let thrown: unknown;
    try {
      assertAgentApiScope(caller, WRITING);
    } catch (error) {
      thrown = error;
    }
    assert.ok(isApiError(thrown), "the refusal is an ApiError the dispatcher renders");
    assert.equal(thrown.code, "forbidden");
    assert.equal(thrown.status, 403);
    assert.match(thrown.message, /read_write/);
  });

  it("lets a read_write token through on both", async () => {
    const { token } = await createAssistantToken(userId, collectionId, {
      label: "full agent",
      scope: "read_write",
      kind: "agent",
    });
    const caller = await resolveAgentApiCaller(request(`Bearer ${token}`));
    assert.ok(caller);
    assert.doesNotThrow(() => assertAgentApiScope(caller, READING));
    assert.doesNotThrow(() => assertAgentApiScope(caller, WRITING));
  });
});
