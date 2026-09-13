import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ASSUMED_MCP_PROTOCOL_VERSION,
  JSON_RPC,
  LATEST_LEGACY_MCP_PROTOCOL_VERSION,
  LEGACY_MCP_PROTOCOL_VERSIONS,
  MCP_META,
  MCP_PROTOCOL_VERSION,
  MODERN_MCP_PROTOCOL_VERSIONS,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  buildToolList,
  decodeMcpHeaderValue,
  handleMcpMessage,
  isModernProtocolVersion,
  isSupportedProtocolVersion,
  operationTool,
  readRequestId,
  type McpRequestHeaders,
} from "../../src/lib/agent-api/mcp";
import { assertOperationScope } from "../../src/lib/agent-api/scope";
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  listResponse,
  parseListWindow,
} from "../../src/lib/agent-api/list";
import { notFound } from "../../src/lib/agent-api/errors";
import type { Operation, OperationContext, ParsedParams } from "../../src/lib/agent-api/types";

// The whole of #709's protocol layer, held here rather than in the integration suite.
//
// **The tools are generated from the operation list and the operation list is an argument**, so
// everything below runs over fixtures — which is what makes the criterion *adding an operation to
// the registry makes it appear as a tool with no MCP-side edit* checkable at all. It is #706's
// generator criterion in the second wrapper, demonstrated the same way and for the same reason:
// **nothing in `tests/unit/` may import `registry.ts`**, because it carries handlers and a handler
// reaches Prisma (`agent-api.md`).
//
// The scope half is not a fixture in the same sense: `assertOperationScope` is the **real**
// decision, imported from the pure `scope.ts`, so what is exercised here is #707's own function
// reached through this wrapper rather than a stand-in for it. What a unit test cannot supply is a
// scope that came off a real hashed token row, and `tests/integration/agent-api-mcp.test.ts` is
// where that half is made.

const CONTEXT: OperationContext = { ownerId: "owner-1", collectionId: "collection-1" };

/** A reading operation with one of every parameter shape, so the schema has something to say. */
const READING: Operation = {
  name: "find_unlisted_copies",
  method: "GET",
  path: "/copies/unlisted",
  description: "Find copies that are not listed in any offer.",
  writes: false,
  parameters: [
    {
      name: "condition",
      in: "query",
      type: "string",
      required: false,
      description: "The condition to filter by.",
      values: ["MNH", "MH"],
    },
    {
      name: "minimum_value",
      in: "query",
      type: "integer",
      required: false,
      description: "The lowest value to include.",
    },
  ],
  result: { kind: "list", description: "The copies with no offer against them." },
  // What a real list operation does: the window is read handler-side, which is where the hard cap
  // is enforced — so a fixture that ignored it could not exercise that convention at all.
  handler: async (_context, params) => listResponse([], 0, parseListWindow(params)),
};

/** A writing operation the refusal can bite on. It stays a **fixture** now that #711 has put three
 *  real ones in the registry, and for the reason it always was one: `tests/unit/` may not import
 *  `registry.ts`, which carries handlers and so reaches Prisma. What changed is that the claim this
 *  file could not make — *the binding in the route is the thing being called* — is now made against
 *  the real operations in `tests/integration/agent-api-offers.test.ts`. */
const WRITING: Operation = {
  name: "set_offer_price",
  method: "PATCH",
  path: "/offers/{offerId}/price",
  description: "Set the asking price on one offer.",
  writes: true,
  parameters: [
    {
      name: "offerId",
      in: "path",
      type: "string",
      required: true,
      description: "The offer to price.",
    },
    {
      name: "price",
      in: "body",
      type: "integer",
      required: true,
      description: "The asking price, in minor units.",
    },
  ],
  result: { kind: "object", description: "The offer as it now stands." },
  handler: async () => ({ ok: true }),
};

/** The options a dispatch needs, with the scope check the case is about. */
function options(overrides: {
  operations?: readonly Operation[];
  assertScope?: (operation: { name: string; writes: boolean }) => void;
  appVersion?: string;
} = {}) {
  return {
    operations: overrides.operations ?? [READING, WRITING],
    appVersion: overrides.appVersion ?? "1.2.3",
    context: CONTEXT,
    assertScope: overrides.assertScope ?? (() => {}),
  };
}

function request(method: string, params?: unknown, id: string | number = 1) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

/** The `result` of a response, asserted to be one rather than an error. */
async function resultOf(message: unknown, opts = options()): Promise<Record<string, unknown>> {
  const outcome = await handleMcpMessage(message, opts);
  assert.equal(outcome.kind, "response");
  assert.ok(outcome.kind === "response");
  assert.equal(outcome.body.error, undefined, `expected a result, got ${JSON.stringify(outcome.body.error)}`);
  return outcome.body.result as Record<string, unknown>;
}

async function errorOf(message: unknown, opts = options()) {
  const outcome = await handleMcpMessage(message, opts);
  assert.ok(outcome.kind === "response");
  assert.ok(outcome.body.error, "expected a JSON-RPC error");
  return outcome.body.error;
}

/** The text a tool result carries, whether it is an answer or a refusal. */
function toolText(result: Record<string, unknown>): string {
  const content = result.content as readonly { type: string; text: string }[];
  assert.equal(content[0].type, "text");
  return content[0].text;
}

describe("registry-to-tool generation", () => {
  it("generates one tool per operation, from the declaration and nothing else", () => {
    const tools = buildToolList([READING, WRITING]);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["find_unlisted_copies", "set_offer_price"]
    );
    assert.ok(tools[0].description.startsWith("Find copies that are not listed in any offer."));
    assert.match(tools[0].description, /The copies with no offer against them\./);
  });

  it("adding an operation adds a tool, with no edit on this side", () => {
    // The criterion, stated as an experiment: the only thing that changes between these two calls
    // is the operation list, and nothing in this file names `set_offer_price`'s parameters.
    const before = buildToolList([READING]);
    const after = buildToolList([READING, WRITING]);
    assert.equal(before.length, 1);
    assert.equal(after.length, 2);

    const added = after.find((tool) => tool.name === WRITING.name);
    assert.ok(added);
    assert.ok(added.description.startsWith(WRITING.description));
    const properties = added.inputSchema.properties as Record<string, { description: string }>;
    for (const spec of WRITING.parameters) {
      assert.ok(properties[spec.name], `${spec.name} reached the schema`);
      assert.equal(properties[spec.name].description, spec.description);
    }
  });

  it("flattens path, query and body into one arguments object, as MCP takes them", () => {
    const tool = operationTool(WRITING);
    const properties = tool.inputSchema.properties as Record<string, unknown>;
    assert.deepEqual(Object.keys(properties).sort(), ["offerId", "price"]);
    assert.deepEqual(tool.inputSchema.required, ["offerId", "price"]);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.inputSchema.type, "object");
  });

  it("carries a closed vocabulary through as an enum", () => {
    const properties = operationTool(READING).inputSchema.properties as Record<
      string,
      { type: string; enum?: string[] }
    >;
    assert.equal(properties.condition.type, "string");
    assert.deepEqual(properties.condition.enum, ["MNH", "MH"]);
    assert.equal(properties.minimum_value.type, "integer");
    assert.equal(properties.minimum_value.enum, undefined);
  });

  it("appends the shared window parameters to a list operation and to no other", () => {
    const list = operationTool(READING).inputSchema.properties as Record<string, unknown>;
    assert.ok(list.limit, "a list tool accepts limit");
    assert.ok(list.cursor, "a list tool accepts cursor");
    const object = operationTool(WRITING).inputSchema.properties as Record<string, unknown>;
    assert.equal(object.limit, undefined);
    assert.equal(object.cursor, undefined);
  });

  it("tells the client which tools only read, from the operation's own `writes`", () => {
    assert.equal(operationTool(READING).annotations?.readOnlyHint, true);
    assert.equal(operationTool(WRITING).annotations?.readOnlyHint, false);
  });

  it("refuses to publish a malformed registry entry rather than describing it wrongly", () => {
    // The same validator the OpenAPI document runs, so the two wrappers cannot come to disagree
    // about what a publishable entry is.
    assert.throws(
      () => buildToolList([{ ...READING, name: "NotSnakeCase" }]),
      /snake_case/
    );
    assert.throws(() => buildToolList([READING, READING]), /Two operations are named/);
  });
});

describe("the legacy MCP handshake", () => {
  it("answers initialize with the tools capability and the running build", async () => {
    const result = await resultOf(
      request("initialize", { protocolVersion: LATEST_LEGACY_MCP_PROTOCOL_VERSION })
    );
    assert.equal(result.protocolVersion, LATEST_LEGACY_MCP_PROTOCOL_VERSION);
    assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
    assert.deepEqual(result.serverInfo, { name: "stamporama", version: "1.2.3" });
    assert.match(String(result.instructions), /get_collection_vocabulary/);
  });

  it("echoes an older revision it supports, and answers an unknown one with its newest legacy one", async () => {
    const older = await resultOf(request("initialize", { protocolVersion: "2024-11-05" }));
    assert.equal(older.protocolVersion, "2024-11-05");
    const unknown = await resultOf(request("initialize", { protocolVersion: "1999-01-01" }));
    assert.equal(unknown.protocolVersion, LATEST_LEGACY_MCP_PROTOCOL_VERSION);
    const absent = await resultOf(request("initialize", {}));
    assert.equal(absent.protocolVersion, LATEST_LEGACY_MCP_PROTOCOL_VERSION);
  });

  it("never tells a client mid-handshake to proceed in a revision that has no handshake", async () => {
    // A client that sent `initialize` is speaking a legacy revision whatever it wrote in it, and
    // 2026-07-28 has no `initialize` to have negotiated. Echoing it back would be an answer the client
    // cannot act on.
    const result = await resultOf(request("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }));
    assert.equal(result.protocolVersion, LATEST_LEGACY_MCP_PROTOCOL_VERSION);
  });

  it("answers a legacy client exactly as before, with none of 2026-07-28's result fields", async () => {
    // The control for the modern block below: `resultType` and the cache hints must come from the
    // era a request arrived in, not from every result. A legacy client that works today must see
    // the same bytes tomorrow.
    const list = await resultOf(request("tools/list"));
    assert.deepEqual(Object.keys(list), ["tools"]);
    const call = await resultOf(request("tools/call", { name: READING.name, arguments: {} }));
    assert.deepEqual(Object.keys(call), ["content"]);
  });

  it("answers a notification with nothing at all", async () => {
    const outcome = await handleMcpMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      options()
    );
    assert.equal(outcome.kind, "accepted");
  });

  it("answers ping, so a client can keep the connection honest", async () => {
    assert.deepEqual(await resultOf(request("ping")), {});
  });

  it("lists every tool in one page, with no cursor to follow", async () => {
    const result = await resultOf(request("tools/list"));
    const tools = result.tools as readonly { name: string }[];
    assert.deepEqual(tools.map((tool) => tool.name), [READING.name, WRITING.name]);
    assert.equal(result.nextCursor, undefined);
  });
});

describe("what is a protocol error and what is a tool error", () => {
  it("refuses a batch, which the current revision removed", async () => {
    const error = await errorOf([request("ping"), request("ping", undefined, 2)]);
    assert.equal(error.code, JSON_RPC.invalidRequest);
    assert.match(error.message, /batched/i);
  });

  it("refuses anything that is not a JSON-RPC message", async () => {
    assert.equal((await errorOf({ hello: "world" })).code, JSON_RPC.invalidRequest);
    assert.equal((await errorOf("not a message")).code, JSON_RPC.invalidRequest);
    assert.equal((await errorOf(null)).code, JSON_RPC.invalidRequest);
  });

  it("names an unimplemented method rather than failing silently", async () => {
    const error = await errorOf(request("resources/list"));
    assert.equal(error.code, JSON_RPC.methodNotFound);
    assert.match(error.message, /resources\/list/);
  });

  it("answers an unknown tool with the names it does offer", async () => {
    const error = await errorOf(request("tools/call", { name: "find_the_cheese", arguments: {} }));
    assert.equal(error.code, JSON_RPC.invalidParams);
    assert.deepEqual((error.data as { accepted: string[] }).accepted, [READING.name, WRITING.name]);
  });

  it("puts a rejected parameter in front of the agent, not in the transport", async () => {
    // The distinction this whole file turns on: a JSON-RPC error is handled by the client and may
    // never reach the model, and a rejected parameter is exactly what the model has to read in
    // order to correct itself. So it comes back as an ordinary result carrying `isError`.
    const result = await resultOf(
      request("tools/call", { name: READING.name, arguments: { conditon: "MNH" } })
    );
    assert.equal(result.isError, true);
    const text = toolText(result);
    assert.match(text, /no query parameter "conditon"/);
    assert.match(text, /invalid_request/);
    assert.match(text, /condition/, "the accepted names come back with it");
  });

  it("relays a domain refusal the same way, with its code intact", async () => {
    const failing: Operation = {
      ...READING,
      handler: async () => {
        throw notFound("That copy is not in this collection.");
      },
    };
    const result = await resultOf(
      request("tools/call", { name: READING.name, arguments: {} }),
      options({ operations: [failing] })
    );
    assert.equal(result.isError, true);
    assert.match(toolText(result), /not_found/);
  });

  it("does not relay an internal message, and does not swallow the defect either", async () => {
    const broken: Operation = {
      ...READING,
      handler: async () => {
        throw new Error("connection string leaked into the message");
      },
    };
    await assert.rejects(
      () =>
        handleMcpMessage(
          request("tools/call", { name: READING.name, arguments: {} }),
          options({ operations: [broken] })
        ),
      /connection string/
    );
  });
});

describe("calling a tool", () => {
  it("hands the handler the token's own context and the parsed parameters", async () => {
    let seen: { context: OperationContext; params: ParsedParams } | null = null;
    const recording: Operation = {
      ...READING,
      handler: async (context, params) => {
        seen = { context, params };
        return { items: [{ id: "copy-1" }], total: 1, nextCursor: null };
      },
    };
    const result = await resultOf(
      request("tools/call", {
        name: READING.name,
        arguments: { condition: "MNH", minimum_value: 250, limit: 10 },
      }),
      options({ operations: [recording] })
    );

    assert.ok(seen);
    const call = seen as { context: OperationContext; params: ParsedParams };
    assert.deepEqual(call.context, CONTEXT);
    assert.equal(call.params.condition, "MNH");
    // A real JSON number arrives as one and is coerced by the same parser a query string goes
    // through, so an agent is not punished for sending the honest type.
    assert.equal(call.params.minimum_value, 250);
    assert.equal(call.params.limit, 10);
    assert.deepEqual(JSON.parse(toolText(result)), {
      items: [{ id: "copy-1" }],
      total: 1,
      nextCursor: null,
    });
    assert.equal(result.isError, undefined);
  });

  it("routes a path value and a body value to the places their declarations name", async () => {
    let seen: ParsedParams | null = null;
    const recording: Operation = {
      ...WRITING,
      handler: async (_context, params) => {
        seen = params;
        return { ok: true };
      },
    };
    await resultOf(
      request("tools/call", {
        name: WRITING.name,
        arguments: { offerId: "offer-7", price: 1250 },
      }),
      options({ operations: [recording] })
    );
    assert.ok(seen);
    const params = seen as ParsedParams;
    assert.equal(params.offerId, "offer-7");
    assert.equal(params.price, 1250);
  });

  it("takes no arguments at all where the operation declares none", async () => {
    const bare: Operation = {
      ...READING,
      parameters: [],
      result: { kind: "object", description: "The vocabularies." },
      handler: async () => ({ conditions: [] }),
    };
    const result = await resultOf(
      request("tools/call", { name: bare.name }),
      options({ operations: [bare] })
    );
    assert.deepEqual(JSON.parse(toolText(result)), { conditions: [] });
  });

  it("refuses arguments that are not an object", async () => {
    const error = await errorOf(
      request("tools/call", { name: READING.name, arguments: ["MNH"] })
    );
    assert.equal(error.code, JSON_RPC.invalidParams);
  });

  it("refuses a tools/call with no name", async () => {
    assert.equal((await errorOf(request("tools/call", {}))).code, JSON_RPC.invalidParams);
  });
});

describe("a read token on a writing tool (#707, through this wrapper)", () => {
  /** The real decision from `scope.ts`, bound to a scope, exactly as the route binds it. */
  const withScope = (scope: "read" | "read_write") =>
    options({ assertScope: (operation) => assertOperationScope(scope, operation) });

  it("refuses it, and says which scope would have worked", async () => {
    const result = await resultOf(
      request("tools/call", { name: WRITING.name, arguments: { offerId: "o1", price: 1 } }),
      withScope("read")
    );
    assert.equal(result.isError, true);
    const text = toolText(result);
    assert.match(text, /forbidden/);
    assert.match(text, /read_write/);
    assert.match(text, /set_offer_price/);
  });

  it("lets the same token through on a reading tool", async () => {
    // The control. A check that refused everything would pass the assertion above for a reason
    // unrelated to the mechanism it claims to test, and it would be green either way.
    const result = await resultOf(
      request("tools/call", { name: READING.name, arguments: {} }),
      withScope("read")
    );
    assert.equal(result.isError, undefined);
  });

  it("lets a read_write token through on both", async () => {
    const write = await resultOf(
      request("tools/call", { name: WRITING.name, arguments: { offerId: "o1", price: 1 } }),
      withScope("read_write")
    );
    assert.equal(write.isError, undefined);
    const read = await resultOf(
      request("tools/call", { name: READING.name, arguments: {} }),
      withScope("read_write")
    );
    assert.equal(read.isError, undefined);
  });

  it("checks the scope before it parses a parameter, as the REST dispatcher does", async () => {
    // Both faults at once, and only one answer is right: there is no point telling a caller its
    // parameters are wrong for a call it was never going to be allowed to make. This is what
    // separates *the check runs* from *the check runs in the right place* — the ordering is
    // invisible unless something is wrong on both sides at the same time.
    const result = await resultOf(
      request("tools/call", { name: WRITING.name, arguments: { offerId: "o1", nonsense: true } }),
      withScope("read")
    );
    assert.equal(result.isError, true);
    const text = toolText(result);
    assert.match(text, /forbidden/);
    assert.doesNotMatch(text, /nonsense/);
  });

  it("does not read `writes` off the tool's name", async () => {
    // #707 says a verb in an operation's name buys no protection at all, and the mirror of that is
    // that it costs none either: a tool called `set_…` that declares `writes: false` is a reading
    // tool, because `writes` is the only thing the check reads.
    const misleading: Operation = { ...WRITING, writes: false };
    const result = await resultOf(
      request("tools/call", { name: WRITING.name, arguments: { offerId: "o1", price: 1 } }),
      {
        ...withScope("read"),
        operations: [misleading],
      }
    );
    assert.equal(result.isError, undefined);
  });
});

describe("the window conventions survive the wrapper", () => {
  it("states the limits in the tool's own schema description", () => {
    const properties = operationTool(READING).inputSchema.properties as Record<
      string,
      { description: string }
    >;
    assert.match(properties.limit.description, new RegExp(String(MAX_LIST_LIMIT)));
    assert.match(properties.limit.description, new RegExp(String(DEFAULT_LIST_LIMIT)));
  });

  it("refuses a page larger than the cap rather than trimming it", async () => {
    const result = await resultOf(
      request("tools/call", { name: READING.name, arguments: { limit: MAX_LIST_LIMIT + 1 } })
    );
    assert.equal(result.isError, true);
    assert.match(toolText(result), /between 1 and 100/);
  });
});

describe("the pinned protocol revision", () => {
  it("speaks the revision it was written against, newest first", () => {
    // Pinned deliberately: this is hand-rolled against a moving specification, and the drift is
    // silent (ADR-0051). If this constant is edited, the ADR and the user guide say so too.
    // `2025-06-18` from #709 until #1222.
    assert.equal(MCP_PROTOCOL_VERSION, "2026-07-28");
    assert.equal(SUPPORTED_MCP_PROTOCOL_VERSIONS[0], MCP_PROTOCOL_VERSION);
  });

  it("still answers every revision it answered before 2026-07-28", () => {
    // #1222's *Done when*: a client on any of these keeps working.
    assert.deepEqual([...LEGACY_MCP_PROTOCOL_VERSIONS], ["2025-06-18", "2025-03-26", "2024-11-05"]);
    assert.deepEqual([...MODERN_MCP_PROTOCOL_VERSIONS], ["2026-07-28"]);
    assert.equal(LATEST_LEGACY_MCP_PROTOCOL_VERSION, LEGACY_MCP_PROTOCOL_VERSIONS[0]);
    for (const revision of LEGACY_MCP_PROTOCOL_VERSIONS) {
      assert.equal(isModernProtocolVersion(revision), false, revision);
    }
    assert.equal(isModernProtocolVersion(MCP_PROTOCOL_VERSION), true);
  });

  it("speaks the revision a client with no version header is assumed to be on", () => {
    // The specification says a server receiving no `MCP-Protocol-Version` should assume this one,
    // so it has to be one this build accepts — otherwise every header-less request is refused.
    assert.ok(
      SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(ASSUMED_MCP_PROTOCOL_VERSION),
      "the assumed revision must be one this build speaks"
    );
  });

  it("recognises what it speaks and nothing else", () => {
    for (const revision of SUPPORTED_MCP_PROTOCOL_VERSIONS) {
      assert.equal(isSupportedProtocolVersion(revision), true, revision);
    }
    // The control: a plausible future revision, which is what the staleness alarm fires on.
    assert.equal(isSupportedProtocolVersion("2027-01-01"), false);
    assert.equal(isSupportedProtocolVersion(""), false);
    assert.equal(isSupportedProtocolVersion(undefined), false);
    assert.equal(isSupportedProtocolVersion(20250618), false);
  });
});

describe("revision 2026-07-28: no handshake, every request self-describing (#1222)", () => {
  /** A modern request body: the method, its params, and the `_meta` 2026-07-28 makes required. */
  function modern(method: string, params: Record<string, unknown> = {}, id: string | number = 1) {
    return {
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          [MCP_META.protocolVersion]: MCP_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "0" },
          [MCP_META.clientCapabilities]: {},
        },
      },
    };
  }

  /** The headers a conforming client sends with that body. */
  function headersFor(method: string, name: string | null = null): McpRequestHeaders {
    return { protocolVersion: MCP_PROTOCOL_VERSION, method, name };
  }

  async function modernOutcome(
    message: unknown,
    headers: McpRequestHeaders,
    opts = options()
  ) {
    const outcome = await handleMcpMessage(message, opts, headers);
    assert.ok(outcome.kind === "response");
    return outcome;
  }

  async function modernResult(message: unknown, headers: McpRequestHeaders, opts = options()) {
    const outcome = await modernOutcome(message, headers, opts);
    assert.equal(outcome.status, 200);
    assert.equal(outcome.body.error, undefined, `expected a result, got ${JSON.stringify(outcome.body.error)}`);
    return outcome.body.result as Record<string, unknown>;
  }

  /** A refusal, with the HTTP status the specification names for it. */
  async function modernRefusal(message: unknown, headers: McpRequestHeaders, status: number, code: number) {
    const outcome = await modernOutcome(message, headers);
    assert.equal(outcome.status, status, JSON.stringify(outcome.body));
    assert.ok(outcome.body.error, "expected a JSON-RPC error");
    assert.equal(outcome.body.error.code, code, outcome.body.error.message);
    return outcome.body.error;
  }

  const SERVER_INFO = { [MCP_META.serverInfo]: { name: "stamporama", version: "1.2.3" } };

  it("answers server/discover, which the revision makes a MUST, with what initialize used to say", async () => {
    const result = await modernResult(modern("server/discover"), headersFor("server/discover"));
    assert.equal(result.resultType, "complete");
    assert.deepEqual(result.supportedVersions, [...SUPPORTED_MCP_PROTOCOL_VERSIONS]);
    assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
    assert.match(String(result.instructions), /get_collection_vocabulary/);
    assert.equal(result.ttlMs, 0);
    assert.equal(result.cacheScope, "private");
    assert.deepEqual(result._meta, SERVER_INFO);
  });

  it("lists the same tools as a legacy client sees, with resultType and the required cache hints", async () => {
    const result = await modernResult(modern("tools/list"), headersFor("tools/list"));
    assert.equal(result.resultType, "complete");
    assert.deepEqual(result.tools, buildToolList([READING, WRITING]));
    assert.equal(result.nextCursor, undefined);
    assert.equal(result.ttlMs, 0);
    assert.equal(result.cacheScope, "private");
    assert.deepEqual(result._meta, SERVER_INFO);
  });

  it("calls a tool and marks the result complete, a refusal included", async () => {
    const answer = await modernResult(
      modern("tools/call", { name: READING.name, arguments: {} }),
      headersFor("tools/call", READING.name)
    );
    assert.equal(answer.resultType, "complete");
    assert.equal(answer.isError, undefined);
    assert.deepEqual(answer._meta, SERVER_INFO);
    assert.deepEqual(JSON.parse(toolText(answer)), { items: [], total: 0, nextCursor: null });

    // An input validation error is a tool execution error in this revision by the specification's
    // own division, not only by #706's choice (ADR-0051 §5).
    const refusal = await modernResult(
      modern("tools/call", { name: READING.name, arguments: { conditon: "MNH" } }),
      headersFor("tools/call", READING.name)
    );
    assert.equal(refusal.resultType, "complete");
    assert.equal(refusal.isError, true);
    assert.match(toolText(refusal), /conditon/);
  });

  it("does not offer initialize or ping, which the revision removed, and says what it does offer", async () => {
    for (const method of ["initialize", "ping", "resources/list"]) {
      const error = await modernRefusal(modern(method), headersFor(method), 404, JSON_RPC.methodNotFound);
      assert.match(error.message, /server\/discover, tools\/list and tools\/call/);
    }
  });

  it("answers an unknown tool with a JSON-RPC error, as before", async () => {
    const error = await modernRefusal(
      modern("tools/call", { name: "find_the_cheese", arguments: {} }),
      headersFor("tools/call", "find_the_cheese"),
      200,
      JSON_RPC.invalidParams
    );
    assert.deepEqual((error.data as { accepted: string[] }).accepted, [READING.name, WRITING.name]);
  });

  it("accepts a notification and answers nothing", async () => {
    const outcome = await handleMcpMessage(
      { jsonrpc: "2.0", method: "notifications/cancelled", params: {} },
      options(),
      headersFor("notifications/cancelled")
    );
    assert.equal(outcome.kind, "accepted");
  });

  describe("the per-request _meta fields", () => {
    it("refuses a request that declares the revision in its header but not in _meta", async () => {
      const message = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
      const error = await modernRefusal(message, headersFor("tools/list"), 400, JSON_RPC.invalidParams);
      assert.match(error.message, /io\.modelcontextprotocol\/protocolVersion/);
    });

    it("refuses a request with no clientCapabilities, which the revision requires even when empty", async () => {
      const message = modern("tools/list");
      delete (message.params._meta as Record<string, unknown>)[MCP_META.clientCapabilities];
      const error = await modernRefusal(message, headersFor("tools/list"), 400, JSON_RPC.invalidParams);
      assert.match(error.message, /clientCapabilities/);
    });
  });

  describe("the mirrored headers", () => {
    it("refuses a body declaring 2026-07-28 that sent no MCP-Protocol-Version header", async () => {
      // Without this, the missing header would read as a header-less legacy client and the request
      // would be served under rules it never asked for.
      await modernRefusal(
        modern("tools/list"),
        { protocolVersion: null, method: "tools/list", name: null },
        400,
        JSON_RPC.headerMismatch
      );
    });

    it("refuses a header and a body that name different revisions", async () => {
      const error = await modernRefusal(
        modern("tools/list"),
        { ...headersFor("tools/list"), protocolVersion: LATEST_LEGACY_MCP_PROTOCOL_VERSION },
        400,
        JSON_RPC.headerMismatch
      );
      assert.match(error.message, /2025-06-18/);
    });

    it("refuses a missing or mismatched Mcp-Method", async () => {
      await modernRefusal(
        modern("tools/list"),
        { ...headersFor("tools/list"), method: null },
        400,
        JSON_RPC.headerMismatch
      );
      await modernRefusal(modern("tools/list"), headersFor("tools/call"), 400, JSON_RPC.headerMismatch);
    });

    it("refuses a tools/call whose Mcp-Name is missing or names another tool", async () => {
      const body = modern("tools/call", { name: READING.name, arguments: {} });
      await modernRefusal(body, headersFor("tools/call", null), 400, JSON_RPC.headerMismatch);
      // The one that matters: a gateway routing on the header and this server executing the body
      // must not be able to disagree about which tool ran.
      await modernRefusal(body, headersFor("tools/call", WRITING.name), 400, JSON_RPC.headerMismatch);
    });

    it("decodes a Base64 Mcp-Name before comparing it, as the transport requires", async () => {
      const encoded = `=?base64?${btoa(READING.name)}?=`;
      const result = await modernResult(
        modern("tools/call", { name: READING.name, arguments: {} }),
        headersFor("tools/call", encoded)
      );
      assert.equal(result.isError, undefined);
    });

    it("decodes the sentinel and nothing else", () => {
      assert.equal(decodeMcpHeaderValue("get_stamp"), "get_stamp");
      assert.equal(decodeMcpHeaderValue("=?base64?SGVsbG8sIOS4lueVjA==?="), "Hello, 世界");
      // A sentinel that does not decode can match no body value.
      assert.equal(decodeMcpHeaderValue("=?base64?not base64!?="), null);
      assert.equal(decodeMcpHeaderValue("=?base64?/w==?="), null, "bytes that are not UTF-8");
    });
  });

  describe("the unsupported-revision refusal, which is also the staleness alarm", () => {
    it("refuses a revision newer than this build with the code and data 2026-07-28 fixes", async () => {
      const outcome = await modernOutcome(modern("tools/list", {}, 42), {
        ...headersFor("tools/list"),
        protocolVersion: "2027-01-01",
      });
      assert.equal(outcome.status, 400);
      assert.equal(outcome.refusedRevision, "2027-01-01", "the route logs the alarm off this");
      assert.equal(outcome.body.id, 42);
      assert.equal(outcome.body.error?.code, JSON_RPC.unsupportedProtocolVersion);
      assert.deepEqual(outcome.body.error?.data, {
        supported: [...SUPPORTED_MCP_PROTOCOL_VERSIONS],
        requested: "2027-01-01",
      });
    });

    it("refuses it for a legacy-shaped request too, since the header alone decides", async () => {
      const outcome = await handleMcpMessage(request("ping"), options(), {
        protocolVersion: "2027-01-01",
        method: null,
        name: null,
      });
      assert.ok(outcome.kind === "response");
      assert.equal(outcome.status, 400);
      assert.equal(outcome.refusedRevision, "2027-01-01");
    });

    it("raises no alarm for any revision it speaks", async () => {
      // The control: an alarm that fired on everything would pass the two cases above.
      const current = await modernOutcome(modern("tools/list"), headersFor("tools/list"));
      assert.equal(current.refusedRevision, undefined);
      for (const revision of LEGACY_MCP_PROTOCOL_VERSIONS) {
        const outcome = await handleMcpMessage(request("ping"), options(), {
          protocolVersion: revision,
          method: null,
          name: null,
        });
        assert.ok(outcome.kind === "response");
        assert.equal(outcome.status, 200, revision);
        assert.equal(outcome.refusedRevision, undefined, revision);
      }
    });
  });
});

describe("readRequestId", () => {
  it("finds the id a failed dispatch has to answer with", () => {
    assert.equal(readRequestId({ jsonrpc: "2.0", id: 7, method: "ping" }), 7);
    assert.equal(readRequestId({ jsonrpc: "2.0", id: "abc", method: "ping" }), "abc");
    assert.equal(readRequestId({ jsonrpc: "2.0", method: "ping" }), null);
    assert.equal(readRequestId("nonsense"), null);
  });
});
