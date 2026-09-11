import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "../../src/lib/db";
import { createAssistantToken, revokeAssistantToken } from "../../src/lib/api-tokens";
import { DELETE, GET, POST } from "../../src/app/api/mcp/route";
import { JSON_RPC, MCP_PROTOCOL_VERSION, handleMcpMessage } from "../../src/lib/agent-api/mcp";
import { assertAgentApiScope, resolveAgentApiCaller } from "../../src/lib/route-auth";
import { OPERATIONS } from "../../src/lib/agent-api/registry";

// **#709's endpoint, driven the way a client drives it** (`agent-api.md`).
//
// `tests/unit/agent-api-mcp.test.ts` holds the whole protocol layer, because it is a pure function
// of an operation list. What it cannot hold is everything this file is about: that the **route**
// wires the pure half to the real one — that a real hashed `stmpa_…` row authenticates, that the
// collection is derived from it, that the scope on that row is what the wrapper enforces, and that
// `tools/call` returns an answer that came out of Postgres. Those are the claims a fixture cannot
// make, which is the same reason `agent-api-auth.test.ts` and `agent-api-vocabulary.test.ts` exist.
//
// **What it still does not establish, said rather than left to be assumed.** No third-party MCP
// client library has spoken to this endpoint over a socket. This calls the exported route handlers
// with real `Request` objects, so framing, header negotiation and whatever a particular client does
// at connect time are untested here — #709's *Done when* asks for a client to connect and list the
// tools, and that half needs a person with one. `docs/user-guide/agent-api.md` is the instructions
// for doing it.
//
// **And one line of the route is not covered by anything below, which was measured rather than
// guessed.** Replacing the route's `assertScope` binding with a no-op leaves every test in this
// file green, because nothing in `OPERATIONS` writes and no request can therefore be refused. The
// comment beside that line carries the whole of it; the gap goes when #711 lands.

const ts = Date.now();

/** One JSON-RPC request, as an MCP client would post it. */
function mcpRequest(token: string | null, body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

interface JsonRpcBody {
  jsonrpc: string;
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

async function post(token: string, body: unknown): Promise<{ status: number; body: JsonRpcBody }> {
  const response = await POST(mcpRequest(token, body));
  return { status: response.status, body: (await response.json()) as JsonRpcBody };
}

/** The `result` of a call, asserted to be one. */
async function resultOf(token: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await post(token, body);
  assert.equal(response.status, 200);
  assert.equal(
    response.body.error,
    undefined,
    `expected a result, got ${JSON.stringify(response.body.error)}`
  );
  assert.ok(response.body.result);
  return response.body.result;
}

function toolText(result: Record<string, unknown>): string {
  const content = result.content as readonly { type: string; text: string }[];
  assert.equal(content[0].type, "text");
  return content[0].text;
}

describe("the remote MCP endpoint", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let readWriteToken: string;
  let readToken: string;

  before(async () => {
    // Unique per run, like every other file here: the suite isolates by id, and a fixed one
    // survives a run whose `before` threw.
    userId = (
      await prisma.user.create({
        data: {
          id: `test-user-mcp-${ts}`,
          name: "MCP User",
          email: `test-mcp-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      })
    ).id;
    collectionId = (
      await prisma.collection.create({
        data: { name: "MCP", slug: `mcp-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { name: "Other", slug: `mcp-other-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    // Real vocabulary rows, so `tools/call` has something to answer with that could only have come
    // out of the database — and one row in the *other* collection, so that an answer scoped to the
    // wrong one is visible rather than merely unlikely.
    await prisma.stampCondition.create({
      data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
    });
    await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
    });
    await prisma.stampCondition.create({
      data: {
        collectionId: otherCollectionId,
        name: "Should Not Appear",
        abbreviation: "SNA",
        sortOrder: 0,
      },
    });

    readWriteToken = (
      await createAssistantToken(userId, collectionId, {
        label: "mcp agent",
        scope: "read_write",
        kind: "agent",
      })
    ).token;
    readToken = (
      await createAssistantToken(userId, collectionId, {
        label: "mcp agent, read only",
        scope: "read",
        kind: "agent",
      })
    ).token;
  });

  after(async () => {
    const ids = [collectionId, otherCollectionId];
    await prisma.assistantToken.deleteMany({ where: { collectionId: { in: ids } } });
    await prisma.stampCondition.deleteMany({ where: { collectionId: { in: ids } } });
    await prisma.collection.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("refuses a call with no token, and names the credential it wants", async () => {
    const response = await POST(mcpRequest(null, { jsonrpc: "2.0", id: 1, method: "ping" }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("WWW-Authenticate"), "Bearer");
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "unauthorized");
    assert.match(body.error.message, /Settings → Assistant/);
  });

  it("refuses a revoked token", async () => {
    const { token, record } = await createAssistantToken(userId, collectionId, {
      label: "revoked",
      scope: "read_write",
      kind: "agent",
    });
    assert.equal((await POST(mcpRequest(token, { jsonrpc: "2.0", id: 1, method: "ping" }))).status, 200);
    await revokeAssistantToken(userId, collectionId, record.id);
    assert.equal((await POST(mcpRequest(token, { jsonrpc: "2.0", id: 1, method: "ping" }))).status, 401);
  });

  it("completes the handshake a client opens with", async () => {
    const result = await resultOf(readWriteToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-client", version: "0" },
      },
    });
    assert.equal(result.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
    assert.equal((result.serverInfo as { name: string }).name, "stamporama");
  });

  it("answers the initialized notification with 202 and no body", async () => {
    const response = await POST(
      mcpRequest(readWriteToken, { jsonrpc: "2.0", method: "notifications/initialized" })
    );
    assert.equal(response.status, 202);
    assert.equal(await response.text(), "");
  });

  it("lists exactly the operations the registry carries, and nothing hand-written", async () => {
    // The criterion, against the real registry rather than a fixture: whatever `OPERATIONS` holds
    // is what a client sees, and this file names none of it.
    const result = await resultOf(readWriteToken, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = result.tools as readonly { name: string; description: string }[];
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      OPERATIONS.map((operation) => operation.name).sort()
    );
    for (const operation of OPERATIONS) {
      const tool = tools.find((candidate) => candidate.name === operation.name);
      assert.ok(tool, `${operation.name} is offered as a tool`);
      assert.ok(
        tool.description.startsWith(operation.description),
        "the tool description is the registry's own, written for a model"
      );
    }
  });

  it("calls a tool end to end and answers out of this collection's rows", async () => {
    const result = await resultOf(readWriteToken, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_collection_vocabulary", arguments: {} },
    });
    assert.equal(result.isError, undefined);

    const answer = JSON.parse(toolText(result)) as {
      baseCurrency: string;
      conditions: readonly { id: string; name: string; abbreviation?: string }[];
    };
    assert.equal(answer.baseCurrency, "PLN");
    assert.deepEqual(
      answer.conditions.map((condition) => condition.name),
      ["Mint Never Hinged", "Used"]
    );
    assert.ok(answer.conditions.every((condition) => condition.id.length > 0));
    assert.ok(
      !answer.conditions.some((condition) => condition.name === "Should Not Appear"),
      "the other collection's row is not in this token's answer"
    );
  });

  it("derives the collection from the token, so two tokens answer differently", async () => {
    // The no-collection-id rule reached through this wrapper: there is no argument that could have
    // pointed either call at the other collection, and they still differ.
    const otherToken = (
      await createAssistantToken(userId, otherCollectionId, {
        label: "other collection",
        scope: "read",
        kind: "agent",
      })
    ).token;
    const call = { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_collection_vocabulary", arguments: {} } };

    const mine = JSON.parse(toolText(await resultOf(readWriteToken, call))) as {
      conditions: readonly { name: string }[];
    };
    const theirs = JSON.parse(toolText(await resultOf(otherToken, call))) as {
      conditions: readonly { name: string }[];
    };
    assert.deepEqual(mine.conditions.map((c) => c.name), ["Mint Never Hinged", "Used"]);
    assert.deepEqual(theirs.conditions.map((c) => c.name), ["Should Not Appear"]);
  });

  it("refuses a read token on a writing tool, from the scope on the real row (#707)", async () => {
    // **Nothing in `OPERATIONS` writes**, so the refusal is exercised against an operation shaped
    // like the ones #711 and #712 will add — but the scope is not a fixture: it was minted as
    // `read`, hashed, stored, and read back through `resolveAgentApiCaller`, which is where a scope
    // actually comes from. The decision itself is held over both directions in the unit suite.
    const caller = await resolveAgentApiCaller(mcpRequest(readToken, {}));
    assert.ok(caller);
    assert.equal(caller.scope, "read");

    const writing = {
      ...OPERATIONS[0],
      name: "set_offer_price",
      method: "PATCH" as const,
      path: "/offers/price",
      description: "Set the asking price on one offer.",
      writes: true,
      parameters: [],
      result: { kind: "object" as const, description: "The offer as it now stands." },
      handler: async () => {
        throw new Error("a refused tool must not reach its handler");
      },
    };

    const outcome = await handleMcpMessage(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "set_offer_price", arguments: {} } },
      {
        operations: [writing],
        appVersion: "test",
        context: { ownerId: caller.ownerId, collectionId: caller.collectionId },
        assertScope: (operation) => assertAgentApiScope(caller, operation),
      }
    );
    assert.ok(outcome.kind === "response");
    const result = outcome.body.result as Record<string, unknown>;
    assert.equal(result.isError, true);
    assert.match(toolText(result), /read_write/);

    // The control, and it is the half that makes the assertion above mean anything: the same real
    // `read` token is an ordinary caller on the reading operation the registry actually carries.
    // A check that refused everything would pass the assertion above and be green either way.
    const reading = await resultOf(readToken, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "get_collection_vocabulary", arguments: {} },
    });
    assert.equal(reading.isError, undefined);
  });

  it("puts a rejected argument in front of the agent rather than in the transport", async () => {
    const result = await resultOf(readWriteToken, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "get_collection_vocabulary", arguments: { area: "Poland" } },
    });
    assert.equal(result.isError, true);
    assert.match(toolText(result), /invalid_request/);
  });

  it("answers an unknown tool with a JSON-RPC error naming the ones it has", async () => {
    const response = await post(readWriteToken, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "sell_everything", arguments: {} },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.error?.code, JSON_RPC.invalidParams);
    assert.deepEqual(
      (response.body.error?.data as { accepted: string[] }).accepted,
      OPERATIONS.map((operation) => operation.name)
    );
  });

  it("answers an unparseable body with a JSON-RPC parse error", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${readWriteToken}` },
        body: "{ not json",
      })
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as JsonRpcBody;
    assert.equal(body.error?.code, JSON_RPC.parseError);
  });

  it("refuses GET and DELETE, saying what this endpoint does offer", async () => {
    for (const handler of [GET, DELETE]) {
      const response = await handler();
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("Allow"), "POST");
      const body = (await response.json()) as JsonRpcBody;
      assert.match(String(body.error?.message), /POST/);
    }
  });
});
