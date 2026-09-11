// The MCP wrapper over the operation registry (#709).
//
// **REST is the contract and MCP is a thin wrapper.** One domain layer, one set of operations, two
// ways of reaching them — and the tools are **generated** from `OPERATIONS`, never hand-listed. A
// hand-maintained tool list is exactly how MCP and REST drift, silently, with the document going on
// describing an operation whose parameters moved; drift is the failure this whole design exists to
// prevent, and it is the whole of this issue. Everything else here is transport.
//
// **Pure, and deliberately so** (`agent-api.md`, *The module layout is the Prisma-free split*).
// That file names registry-to-tool generation as belonging on the pure side, so this module imports
// no registry and no Prisma: the operations arrive as an argument, exactly as they do for
// `buildOpenApiDocument`, and the caller's context and scope check arrive the same way. What that
// buys is that `pnpm test:unit` holds the entire protocol layer — the handshake, the tool schemas,
// the error mapping — rather than only the half an integration test can reach.
//
// **No SDK.** `@modelcontextprotocol/sdk` writes its HTTP transport against Node's
// `IncomingMessage`/`ServerResponse`, and an App Router route handler is handed a Web `Request` and
// must return a Web `Response`; bridging the two is more code than what is below, with a failure
// mode no suite here can see. Streamable HTTP for a stateless server is one `POST` carrying
// JSON-RPC 2.0 and four methods, which is a pure function from a message to a message.
//
// ## Which failures are protocol errors and which are tool errors
//
// This is the one judgement in the file worth stating rather than inferring, and it is what
// *"errors surfaced as tool errors the agent can act on, keeping the shape from #706"* comes to:
//
// - **A malformed message, an unknown method, an unknown tool** is a **JSON-RPC error**. The client
//   built the call from a list this server gave it, so the fault is in the client rather than in
//   the model's reasoning, and MCP's own guidance puts them there.
// - **Anything an agent could act on** — a rejected parameter, a refused scope, a domain refusal —
//   is a **tool error**: an ordinary result carrying `isError: true` and the sentence. That is not
//   a technicality about status codes. A JSON-RPC error is handled by the client's transport and
//   may never reach the model at all; an `isError` result always does, and the whole point of
//   #706's error convention is that the agent reads the sentence and corrects itself. A `read`
//   token refused on a writing tool is the sharpest case: what the refusal buys is that the agent
//   stops retrying and can say which scope the collector has to grant, and it can only do that if
//   it sees it.
//
// Nothing runs in either case, so this is a choice about who reads the refusal and not about
// whether it is enforced.

import { isApiError } from "./errors";
import { LIST_PARAMETERS } from "./list";
import { parameterSchema, validateOperations } from "./openapi";
import { parseParameters } from "./params";
import type { ScopedOperation } from "./scope";
import type { Operation, OperationContext, ParameterSpec } from "./types";

/**
 * The MCP revision this server speaks. A client that asks for one of the others gets that one back;
 * anything else is answered with this one, which is what the specification asks a server to do —
 * the client then decides whether it can proceed.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Revisions this server will echo back to a client that asks for them. */
export const SUPPORTED_MCP_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

/** The server's own identity in the handshake. */
export const MCP_SERVER_NAME = "stamporama";

/**
 * What the agent is told once, at connect time, instead of on every turn.
 *
 * The binding constraint on this surface is the agent's context window (`agent-api.md`), and
 * `instructions` is the one field paid for exactly once per session — so the conventions that would
 * otherwise have to be repeated in every tool description go here. It is the same argument
 * `get_collection_vocabulary` is built on: fetch it once, hold it.
 */
export const MCP_INSTRUCTIONS = [
  "These tools act on exactly one stamp collection — the one this token is pinned to. No tool takes a collection id, and there is nothing to choose between.",
  "",
  "Call `get_collection_vocabulary` once at the start and keep the answer. Conditions, formats, areas, locations, catalogs and platforms are per-collection and id-keyed, and every tool that takes one also accepts the name from that answer.",
  "",
  "A list result states the full `total` alongside its rows, so a trimmed page is visible as one; send the `nextCursor` back as `cursor` for the rest.",
  "",
  "A tool that fails answers with `isError` and one sentence saying what to do next, plus the accepted values where a value was rejected against a closed set. Read it rather than retrying the same call.",
].join("\n");

/** JSON-RPC 2.0 ids: a string, a number, or absent on a notification. */
export type JsonRpcId = string | number | null;

export interface JsonRpcErrorBody {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: JsonRpcErrorBody;
}

/**
 * The JSON-RPC error codes this server produces. Named rather than spelled inline, because two of
 * them are easy to confuse and the difference is what a client branches on.
 */
export const JSON_RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

/**
 * What the transport should do with a message.
 *
 * A JSON-RPC **notification** carries no `id` and gets no reply at all — `accepted` is the
 * transport's cue to answer `202` with an empty body, which is what the specification asks for and
 * what `notifications/initialized` needs.
 */
export type McpOutcome =
  | { readonly kind: "response"; readonly body: JsonRpcResponse }
  | { readonly kind: "accepted" };

/** One tool, as `tools/list` renders it. */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: Record<string, unknown>;
}

export interface McpDispatchOptions {
  /** The registry. Passed in rather than imported — that is what keeps this module pure. */
  readonly operations: readonly Operation[];
  readonly appVersion: string;
  /** Who the call acts as, derived from the token by `resolveAgentApiCaller`. */
  readonly context: OperationContext;
  /**
   * The scope check, supplied by the route as `assertAgentApiScope` bound to the caller.
   *
   * **It is the same function the REST dispatcher calls and there is no second check here.** The
   * scope came off the token, `writes` is the operation's own declaration, and #707 put the meeting
   * point in `route-auth.ts` beside the collection pinning. A wrapper that re-derived either half
   * would be a second thing to keep right.
   */
  readonly assertScope: (operation: ScopedOperation) => void;
}

/** Every parameter a tool accepts: the operation's own, plus the shared window on a list. */
function toolParameters(operation: Operation): readonly ParameterSpec[] {
  return operation.result.kind === "list"
    ? [...operation.parameters, ...LIST_PARAMETERS]
    : operation.parameters;
}

/**
 * One tool from one operation — the whole of the generation, and the property to preserve.
 *
 * **MCP takes a single `arguments` object**, so an operation's path, query and body parameters are
 * flattened into one schema. Nothing is lost: `callOperationTool` puts each value back where its
 * declaration says it came from before the shared parser sees it, so the parsing, the coercion and
 * every rejection message are the REST surface's, not a second implementation of them.
 *
 * `additionalProperties: false` is honest rather than decorative: an undeclared argument really is
 * refused, for the reason #706 gives about an undeclared query parameter — an agent that guessed a
 * name and was silently ignored receives a plausible answer to a question it did not ask.
 */
export function operationTool(operation: Operation): McpTool {
  const specs = toolParameters(operation);
  const properties: Record<string, unknown> = {};
  for (const spec of specs) {
    properties[spec.name] = { ...parameterSchema(spec), description: spec.description };
  }
  const required = specs
    .filter((spec) => spec.required || spec.in === "path")
    .map((spec) => spec.name);

  const description =
    operation.result.kind === "list"
      ? `${operation.description}\n\n${operation.result.description} The response states the full \`total\`, so a trimmed page is visible as one; follow \`nextCursor\` for the rest.`
      : `${operation.description}\n\n${operation.result.description}`;

  return {
    name: operation.name,
    description,
    inputSchema: {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    },
    // A hint rather than a permission: what a token may do is `scope`, checked in one place
    // (#707). This tells a client which tools are safe to offer without confirmation.
    annotations: { readOnlyHint: !operation.writes },
  };
}

/**
 * The tool list, generated from the operation list and from nothing else.
 *
 * `validateOperations` runs here for the same reason `buildOpenApiDocument` runs it: a malformed
 * registry entry should fail the first `tools/list` rather than produce a tool that describes
 * itself wrongly. It is the same validator, so the two wrappers cannot come to disagree about what
 * a publishable entry is.
 */
export function buildToolList(operations: readonly Operation[]): readonly McpTool[] {
  validateOperations(operations);
  return operations.map(operationTool);
}

/** The `initialize` result: what this server is and what it can do. */
export function buildInitializeResult(options: {
  readonly appVersion: string;
  readonly requestedProtocolVersion?: unknown;
}): Record<string, unknown> {
  const requested = options.requestedProtocolVersion;
  const protocolVersion =
    typeof requested === "string" && SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : MCP_PROTOCOL_VERSION;

  return {
    protocolVersion,
    // `listChanged: false` is the honest declaration: the tool list is generated from a registry
    // compiled into the build, so it cannot change while a session is open.
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: MCP_SERVER_NAME, version: options.appVersion },
    instructions: MCP_INSTRUCTIONS,
  };
}

/**
 * Split one MCP `arguments` object back into the request shapes the declarations describe, so that
 * `parseParameters` — the REST surface's own parser — does the rest.
 *
 * **Unknown keys go into the query bucket on purpose.** That is what makes them refused with the
 * accepted names beside them, by the rejection #706 already wrote, instead of being dropped here
 * with a second sentence saying the same thing.
 *
 * A body parameter keeps its JSON type, because a body is JSON. A path or query value is rendered
 * as text, because that is what a URL can carry — and the parser coerces `"25"` and `25` alike, so
 * an agent that sent a real number is not punished for it.
 */
function splitArguments(
  specs: readonly ParameterSpec[],
  args: Record<string, unknown>
): { path: Record<string, string>; query: URLSearchParams; body: Record<string, unknown> } {
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const path: Record<string, string> = {};
  const query = new URLSearchParams();
  const body: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    const spec = byName.get(name);
    if (spec?.in === "body") {
      body[name] = value;
      continue;
    }
    if (spec?.in === "path") {
      path[name] = String(value);
      continue;
    }
    // Declared query parameters and everything undeclared. An array is spelled the way a query
    // string spells one — repeated — which is one of the two forms `params.ts` already reads.
    if (Array.isArray(value)) {
      for (const item of value) query.append(name, String(item));
    } else {
      query.append(name, String(value));
    }
  }

  return { path, query, body };
}

/** A tool result carrying the answer. Text, because the registry declares no output schema. */
function toolResult(value: unknown): Record<string, unknown> {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/**
 * A tool result carrying a refusal the agent can act on: the sentence, and the #706 body beside it
 * so a client that wants to branch on the code has it without parsing English.
 */
function toolError(body: unknown, message: string): Record<string, unknown> {
  return {
    isError: true,
    content: [{ type: "text", text: `${message}\n\n${JSON.stringify(body)}` }],
  };
}

/**
 * Run one tool. The ordering is the REST dispatcher's, and for its reasons: the scope check comes
 * **after** the operation is resolved, because the answer depends on which one was picked, and
 * **before** any parameter is parsed, because there is no point validating inputs for a call that
 * will not be made (#707).
 */
export async function callOperationTool(
  options: McpDispatchOptions,
  toolName: unknown,
  rawArguments: unknown
): Promise<Record<string, unknown>> {
  if (typeof toolName !== "string" || toolName.length === 0) {
    throw jsonRpcFailure(
      JSON_RPC.invalidParams,
      'A tools/call needs a "name". Send the name of a tool from tools/list.'
    );
  }
  const operation = options.operations.find((candidate) => candidate.name === toolName);
  if (!operation) {
    throw jsonRpcFailure(
      JSON_RPC.invalidParams,
      `This instance has no tool named "${toolName}". Call tools/list for the tools it offers.`,
      { accepted: options.operations.map((candidate) => candidate.name) }
    );
  }
  if (rawArguments !== undefined && (typeof rawArguments !== "object" || Array.isArray(rawArguments))) {
    throw jsonRpcFailure(
      JSON_RPC.invalidParams,
      'The "arguments" of a tools/call must be a JSON object of named values.'
    );
  }

  try {
    options.assertScope(operation);
    const specs = toolParameters(operation);
    const raw = splitArguments(specs, (rawArguments ?? {}) as Record<string, unknown>);
    const params = parseParameters(specs, {
      path: raw.path,
      query: raw.query,
      body: operation.method === "GET" ? undefined : raw.body,
    });
    return toolResult(await operation.handler(options.context, params));
  } catch (error) {
    if (isApiError(error)) return toolError(error.toBody(), error.message);
    throw error;
  }
}

/**
 * A JSON-RPC-shaped failure, thrown so that `handleMcpMessage` can attach the request's own id.
 *
 * It is deliberately not an `ApiError`: those are the agent's to read and become tool errors, and
 * these are the client's.
 */
class JsonRpcFailure extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "JsonRpcFailure";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

function jsonRpcFailure(code: number, message: string, data?: unknown): JsonRpcFailure {
  return new JsonRpcFailure(code, message, data);
}

function respond(id: JsonRpcId, result: unknown): McpOutcome {
  return { kind: "response", body: { jsonrpc: "2.0", id, result } };
}

export function jsonRpcErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readId(message: Record<string, unknown>): JsonRpcId | undefined {
  const id = message.id;
  if (typeof id === "string" || typeof id === "number") return id;
  if (id === null) return null;
  return undefined;
}

/**
 * The id of a message that has already been parsed as JSON, for a caller that needs to answer one
 * it could not dispatch — the route rendering an unexpected throw as an internal error.
 *
 * `null` for anything without a usable id, which is what JSON-RPC asks a server to answer with when
 * it cannot tell which request failed.
 */
export function readRequestId(message: unknown): JsonRpcId {
  return (isRecord(message) ? readId(message) : undefined) ?? null;
}

/**
 * Handle one JSON-RPC message.
 *
 * **Batching is not supported, and that is the current specification rather than a shortcut**: the
 * 2025-06-18 revision removed JSON-RPC batching from MCP. An array arrives with a sentence saying
 * so, rather than being half-handled.
 */
export async function handleMcpMessage(
  message: unknown,
  options: McpDispatchOptions
): Promise<McpOutcome> {
  if (Array.isArray(message)) {
    return {
      kind: "response",
      body: jsonRpcErrorResponse(
        null,
        JSON_RPC.invalidRequest,
        "This server does not accept batched JSON-RPC. Send one message per request."
      ),
    };
  }
  if (!isRecord(message) || typeof message.method !== "string") {
    return {
      kind: "response",
      body: jsonRpcErrorResponse(
        null,
        JSON_RPC.invalidRequest,
        'Send one JSON-RPC 2.0 message: an object with "jsonrpc", "method" and, for a request, "id".'
      ),
    };
  }

  const id = readId(message);
  const method = message.method;

  // A notification carries no id and is answered with nothing at all. `notifications/initialized`
  // is the one every client sends; the rest are accepted and dropped rather than refused, because
  // a notification a server does not act on is not an error.
  if (id === undefined) return { kind: "accepted" };

  const params = isRecord(message.params) ? message.params : {};

  try {
    switch (method) {
      case "initialize":
        return respond(
          id,
          buildInitializeResult({
            appVersion: options.appVersion,
            requestedProtocolVersion: params.protocolVersion,
          })
        );
      case "ping":
        return respond(id, {});
      case "tools/list":
        // Every tool, in one page. The registry is a compiled-in array of a size a person maintains,
        // so paging it would be machinery with nothing behind it — and a client that receives no
        // `nextCursor` knows it has the whole list.
        return respond(id, { tools: buildToolList(options.operations) });
      case "tools/call":
        return respond(id, await callOperationTool(options, params.name, params.arguments));
      default:
        return {
          kind: "response",
          body: jsonRpcErrorResponse(
            id,
            JSON_RPC.methodNotFound,
            `This server does not implement "${method}". It offers tools only: initialize, tools/list, tools/call and ping.`
          ),
        };
    }
  } catch (error) {
    if (error instanceof JsonRpcFailure) {
      return {
        kind: "response",
        body: jsonRpcErrorResponse(id, error.code, error.message, error.data),
      };
    }
    throw error;
  }
}
