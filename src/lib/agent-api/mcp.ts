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
// JSON-RPC 2.0 and a handful of methods, which is a pure function from a message to a message.
//
// ## Two eras on one endpoint (#1222)
//
// **Revision 2026-07-28 removed the handshake**, so this endpoint serves two shapes of client and
// picks between them per request, which is what the specification calls a *dual-era* server:
//
// - **Modern** (2026-07-28): no `initialize` and no `ping`. Every request carries its revision and
//   the client's capabilities in `params._meta`, mirrors its method and tool name into
//   `Mcp-Method` / `Mcp-Name` headers, and gets a result carrying `resultType`. `server/discover`
//   is the one new method, and the specification makes it a `MUST`.
// - **Legacy** (2025-06-18, 2025-03-26, 2024-11-05): exactly what #709 built — `initialize`,
//   `tools/list`, `tools/call` and `ping`, answered byte for byte as before, so a client that works
//   today keeps working.
//
// A request is modern when its `MCP-Protocol-Version` header names a modern revision **or** its body
// declares a revision in `_meta`. The second half matters: a body that declares 2026-07-28 while its
// header says something else, or says nothing, is refused as a header mismatch rather than quietly
// served under legacy rules it did not ask for.
//
// ## Which failures are protocol errors and which are tool errors
//
// This is the one judgement in the file worth stating rather than inferring, and it is what
// *"errors surfaced as tool errors the agent can act on, keeping the shape from #706"* comes to:
//
// - **A malformed message, an unknown method, an unknown tool** is a **JSON-RPC error**. The client
//   built the call from a list this server gave it, so the fault is in the client rather than in
//   the model's reasoning. The specification agrees and even fixes the code: an unknown tool is
//   `-32602`.
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
//
// **The specification has since come round to this division** (#1222, read against the published
// 2026-07-28 text). This paragraph used to record a deliberate deviation: 2025-06-18's *Tools*
// §Error Handling lists **invalid arguments** under protocol errors, so a missing required parameter
// or a wrong type landed on its protocol side, and here they came back as tool errors because
// #706's `accepted` reaches the model inside a tool error and may never reach it from `error.data`.
// Revision 2025-11-25 (SEP-1303) moved **input validation errors** to the tool-execution side for
// exactly that reason, and 2026-07-28 keeps it there — so for a modern client this is the
// specification's own split, and it stays a deviation only towards a client still on 2025-06-18.
// ADR-0051 §5 carries both halves.

import { isApiError } from "./errors";
import { LIST_PARAMETERS } from "./list";
import { parameterSchema, validateOperations } from "./openapi";
import { parseParameters } from "./params";
import type { ScopedOperation } from "./scope";
import type { Operation, OperationContext, ParameterSpec } from "./types";

/**
 * **The MCP revision this implementation was written against, pinned deliberately.**
 *
 * This is hand-rolled against a moving specification (ADR-0051), and the failure mode of that is
 * **silent**: a client stops connecting months from now with nothing in this repository having
 * changed. So the revision is named here, in the ADR and in the user guide, and it is the one to
 * check a new revision's changelog against:
 * <https://modelcontextprotocol.io/specification/2026-07-28/>
 *
 * It was `2025-06-18` from #709 until #1222, when the collector's own client began asking for
 * 2026-07-28 and the alarm below fired exactly as designed.
 *
 * **What would say it has gone stale**, in the order it will actually be noticed:
 *
 * 1. **The endpoint says so itself.** A client sending `MCP-Protocol-Version` for a revision not in
 *    the list below is refused with `400` and the route logs it — so the first client newer than
 *    this build announces the drift in the server log rather than as an unexplained failure. That
 *    refusal is the specification's own requirement, and it doubles as the alarm.
 * 2. A revision appears at the URL above whose changelog touches the Streamable HTTP transport,
 *    `server/discover`, `tools/list`, `tools/call` or the per-request `_meta` fields — the things
 *    implemented here.
 * 3. A legacy client negotiates down: `initialize` answered with `LATEST_LEGACY_MCP_PROTOCOL_VERSION`
 *    rather than with what the client asked for means the client is older, which is fine.
 */
export const MCP_PROTOCOL_VERSION = "2026-07-28";

/** Revisions with no handshake: version, identity and capabilities ride in every request's `_meta`. */
export const MODERN_MCP_PROTOCOL_VERSIONS: readonly string[] = ["2026-07-28"];

/** Revisions that open with `initialize`. Still answered, so a client that works today keeps working. */
export const LEGACY_MCP_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

/**
 * The newest revision that has an `initialize` handshake, and so the one a legacy client is answered
 * with when it asks for a revision this build does not know. **Never `MCP_PROTOCOL_VERSION`**:
 * telling a client mid-handshake to proceed in a revision that has no handshake would be an answer
 * it cannot act on.
 */
export const LATEST_LEGACY_MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * Every revision this server answers, newest first — what `server/discover` advertises and what a
 * refused request is told.
 *
 * `2025-03-26` is on the list for a second reason beyond politeness: the specification says that a
 * server receiving **no** `MCP-Protocol-Version` header may assume that revision, so it has to be
 * one this build accepts or every header-less request would be refused.
 */
export const SUPPORTED_MCP_PROTOCOL_VERSIONS: readonly string[] = [
  ...MODERN_MCP_PROTOCOL_VERSIONS,
  ...LEGACY_MCP_PROTOCOL_VERSIONS,
];

/**
 * The revision to assume when a client sends no `MCP-Protocol-Version` header. The specification
 * names this one for backwards compatibility; it is not a default we chose.
 */
export const ASSUMED_MCP_PROTOCOL_VERSION = "2025-03-26";

/** Whether this build speaks a revision. Used by the handshake and by the header check. */
export function isSupportedProtocolVersion(value: unknown): value is string {
  return typeof value === "string" && SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(value);
}

/** Whether a revision is one of the handshake-free ones. */
export function isModernProtocolVersion(value: unknown): value is string {
  return typeof value === "string" && MODERN_MCP_PROTOCOL_VERSIONS.includes(value);
}

/** The `_meta` keys a modern request carries. Spelled once, because a typo here refuses every call. */
export const MCP_META = {
  protocolVersion: "io.modelcontextprotocol/protocolVersion",
  clientCapabilities: "io.modelcontextprotocol/clientCapabilities",
  serverInfo: "io.modelcontextprotocol/serverInfo",
} as const;

/**
 * The caching hints 2026-07-28 requires on `server/discover` and `tools/list`.
 *
 * **`private`, for the reason `/api/v1/openapi.json` requires a token** (`agent-api.md`, *The
 * document*): the tool list carries no collection data, but it is the list of things a valid token
 * could do, and `public` would let a shared cache hand it to a caller without one.
 *
 * **`ttlMs: 0`, because this build cannot know when the next one replaces it.** The list is compiled
 * in and changes only with a deploy, and a positive TTL would be a promise about a deploy nobody has
 * scheduled. Zero tells the client to fetch again when it needs the list, which costs one `POST`.
 */
export const MCP_CACHE_HINTS = { ttlMs: 0, cacheScope: "private" } as const;

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
  /** 2026-07-28: a mirrored header is missing or disagrees with the body. Always HTTP `400`. */
  headerMismatch: -32020,
  /** 2026-07-28: a revision this build does not speak. Always HTTP `400`, answered to every era. */
  unsupportedProtocolVersion: -32022,
} as const;

/**
 * What the transport should do with a message.
 *
 * A JSON-RPC **notification** carries no `id` and gets no reply at all — `accepted` is the
 * transport's cue to answer `202` with an empty body, which is what the specification asks for and
 * what `notifications/initialized` needs.
 *
 * `status` is the HTTP status, because 2026-07-28 names one for several refusals (`400` for a header
 * or `_meta` fault, `404` for an unknown method). Everything else stays `200`: the transport worked.
 * `refusedRevision` is set only on the unsupported-revision refusal, so the route can log it — that
 * log line is the staleness alarm (ADR-0051 §4).
 */
export type McpOutcome =
  | {
      readonly kind: "response";
      readonly status: number;
      readonly body: JsonRpcResponse;
      readonly refusedRevision?: string;
    }
  | { readonly kind: "accepted" };

/**
 * The request headers the protocol reads. The route copies them off the `Request`; a test writes
 * them by hand. `null` is an absent header.
 */
export interface McpRequestHeaders {
  readonly protocolVersion: string | null;
  readonly method: string | null;
  readonly name: string | null;
}

const NO_HEADERS: McpRequestHeaders = { protocolVersion: null, method: null, name: null };

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

/** The legacy `initialize` result: what this server is and what it can do. */
export function buildInitializeResult(options: {
  readonly appVersion: string;
  readonly requestedProtocolVersion?: unknown;
}): Record<string, unknown> {
  // The legacy revisions' own rule: answer with the requested revision where it is supported, and
  // otherwise with another one this server supports — which should be the latest. It is not an
  // error; the client reads the answer and decides whether it can proceed. **Only a legacy revision
  // can be the answer**: a client that sent `initialize` is speaking a revision with a handshake, so
  // one that asks for 2026-07-28 here is answered with the newest revision that has one.
  const protocolVersion =
    typeof options.requestedProtocolVersion === "string" &&
    LEGACY_MCP_PROTOCOL_VERSIONS.includes(options.requestedProtocolVersion)
      ? options.requestedProtocolVersion
      : LATEST_LEGACY_MCP_PROTOCOL_VERSION;

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
  return { kind: "response", status: 200, body: { jsonrpc: "2.0", id, result } };
}

function refuse(
  status: number,
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): McpOutcome {
  return { kind: "response", status, body: jsonRpcErrorResponse(id, code, message, data) };
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
 * Handle one JSON-RPC message, in whichever era it arrived in.
 *
 * **Batching is not supported, and that is the current specification rather than a shortcut**: the
 * 2025-06-18 revision removed JSON-RPC batching from MCP, and 2026-07-28 keeps the body of a POST to
 * a single message. An array arrives with a sentence saying so, rather than being half-handled.
 *
 * `headers` defaults to none, which is a legacy client that sent no `MCP-Protocol-Version` — the
 * shape every call made before #1222 had.
 */
export async function handleMcpMessage(
  message: unknown,
  options: McpDispatchOptions,
  headers: McpRequestHeaders = NO_HEADERS
): Promise<McpOutcome> {
  const declared = headers.protocolVersion;
  if (declared !== null && !isSupportedProtocolVersion(declared)) {
    // **The specification requires this `400`, and it is also this build's staleness alarm**
    // (ADR-0051 §4). 2026-07-28 fixes the code and the shape of `data`, and a dual-era client
    // reads exactly that to tell a modern server that wants another revision from a legacy one —
    // so every era is answered with it, which the legacy revisions (a `400`, code unspecified) allow.
    return {
      kind: "response",
      status: 400,
      body: jsonRpcErrorResponse(
        readRequestId(message),
        JSON_RPC.unsupportedProtocolVersion,
        `This instance does not speak MCP revision ${declared}; it speaks ${SUPPORTED_MCP_PROTOCOL_VERSIONS.join(", ")}.`,
        { supported: [...SUPPORTED_MCP_PROTOCOL_VERSIONS], requested: declared }
      ),
      refusedRevision: declared,
    };
  }

  if (Array.isArray(message)) {
    return refuse(
      200,
      null,
      JSON_RPC.invalidRequest,
      "This server does not accept batched JSON-RPC. Send one message per request."
    );
  }
  if (!isRecord(message) || typeof message.method !== "string") {
    return refuse(
      200,
      null,
      JSON_RPC.invalidRequest,
      'Send one JSON-RPC 2.0 message: an object with "jsonrpc", "method" and, for a request, "id".'
    );
  }

  const params = isRecord(message.params) ? message.params : {};
  const meta = isRecord(params._meta) ? params._meta : {};
  const modern = isModernProtocolVersion(declared) || meta[MCP_META.protocolVersion] !== undefined;

  try {
    return modern
      ? await handleModernMessage(message, message.method, params, meta, options, headers)
      : await handleLegacyMessage(message, message.method, params, options);
  } catch (error) {
    if (error instanceof JsonRpcFailure) {
      return refuse(200, readId(message) ?? null, error.code, error.message, error.data);
    }
    throw error;
  }
}

/** The dispatch #709 built, unchanged: `initialize`, `ping`, and results without `resultType`. */
async function handleLegacyMessage(
  message: Record<string, unknown>,
  method: string,
  params: Record<string, unknown>,
  options: McpDispatchOptions
): Promise<McpOutcome> {
  const id = readId(message);

  // A notification carries no id and is answered with nothing at all. `notifications/initialized`
  // is the one every client sends; the rest are accepted and dropped rather than refused, because
  // a notification a server does not act on is not an error.
  if (id === undefined) return { kind: "accepted" };

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
      return refuse(
        200,
        id,
        JSON_RPC.methodNotFound,
        `This server does not implement "${method}". It offers tools only: initialize, tools/list, tools/call and ping.`
      );
  }
}

/**
 * The methods that mirror a body value into `Mcp-Name`, and which value. Only the one this server
 * implements is checked; the other two are answered `404` before a header would matter.
 */
const MCP_NAME_SOURCE: Readonly<Record<string, string>> = { "tools/call": "name" };

/**
 * An `Mcp-Name` value as the client meant it. A value that is not plain header-safe ASCII arrives as
 * `=?base64?…?=`, and the specification makes the server decode it before comparing. `null` for a
 * sentinel that does not decode — which can match no body value, and so is refused as a mismatch.
 */
export function decodeMcpHeaderValue(value: string): string | null {
  const sentinel = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  if (!sentinel) return value.startsWith("=?base64?") && value.endsWith("?=") ? null : value;
  try {
    const bytes = Uint8Array.from(atob(sentinel[1]), (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Revision 2026-07-28: every request self-describing, no handshake, no `ping`.
 *
 * **The order of the checks is the order a client can act on them**: first the revision, which
 * decides whether anything else in the request means what it seems to; then the `_meta` fields the
 * specification makes required; then the mirrored headers, which only mean anything once the body
 * they mirror is known to be well-formed.
 */
async function handleModernMessage(
  message: Record<string, unknown>,
  method: string,
  params: Record<string, unknown>,
  meta: Record<string, unknown>,
  options: McpDispatchOptions,
  headers: McpRequestHeaders
): Promise<McpOutcome> {
  const id = readId(message);

  // 2026-07-28 defines no client-to-server notification over Streamable HTTP and no header rules for
  // one, so a notification is accepted and dropped exactly as a legacy one is.
  if (id === undefined) return { kind: "accepted" };

  const bodyRevision = meta[MCP_META.protocolVersion];
  if (headers.protocolVersion === null) {
    return refuse(
      400,
      id,
      JSON_RPC.headerMismatch,
      `A request declaring MCP revision ${String(bodyRevision)} in _meta must send the same revision in the MCP-Protocol-Version header.`
    );
  }
  if (typeof bodyRevision !== "string") {
    return refuse(
      400,
      id,
      JSON_RPC.invalidParams,
      `A request in MCP revision ${headers.protocolVersion} must carry params._meta["${MCP_META.protocolVersion}"].`
    );
  }
  if (bodyRevision !== headers.protocolVersion) {
    return refuse(
      400,
      id,
      JSON_RPC.headerMismatch,
      `The MCP-Protocol-Version header says ${headers.protocolVersion} and params._meta says ${bodyRevision}; send the same revision in both.`
    );
  }
  if (!isRecord(meta[MCP_META.clientCapabilities])) {
    return refuse(
      400,
      id,
      JSON_RPC.invalidParams,
      `A request in MCP revision ${bodyRevision} must carry params._meta["${MCP_META.clientCapabilities}"], an object ({} when the client offers none).`
    );
  }
  if (headers.method !== method) {
    return refuse(
      400,
      id,
      JSON_RPC.headerMismatch,
      headers.method === null
        ? `A request in MCP revision ${bodyRevision} must send its method in the Mcp-Method header.`
        : `The Mcp-Method header says "${headers.method}" and the body says "${method}"; send the same method in both.`
    );
  }
  const nameSource = MCP_NAME_SOURCE[method];
  if (nameSource !== undefined) {
    const bodyName = params[nameSource];
    const headerName = headers.name === null ? null : decodeMcpHeaderValue(headers.name);
    if (headerName === null || headerName !== bodyName) {
      return refuse(
        400,
        id,
        JSON_RPC.headerMismatch,
        headers.name === null
          ? `A ${method} in MCP revision ${bodyRevision} must send params.${nameSource} in the Mcp-Name header.`
          : `The Mcp-Name header does not match params.${nameSource}; send the same value in both.`
      );
    }
  }

  switch (method) {
    case "server/discover":
      return respond(id, complete(options, buildDiscoverResult()));
    case "tools/list":
      return respond(
        id,
        complete(options, { tools: buildToolList(options.operations), ...MCP_CACHE_HINTS })
      );
    case "tools/call":
      return respond(
        id,
        complete(options, await callOperationTool(options, params.name, params.arguments))
      );
    default:
      // `404` is the specification's own status for an unknown method in this revision, and the
      // JSON-RPC body is what tells it apart from a server that has no MCP endpoint here at all.
      // `initialize` and `ping` land here on purpose: neither exists in 2026-07-28.
      return refuse(
        404,
        id,
        JSON_RPC.methodNotFound,
        `This server does not implement "${method}" in MCP revision ${bodyRevision}. It offers server/discover, tools/list and tools/call.`
      );
  }
}

/**
 * The `server/discover` result, less what every modern result carries (`complete` adds those).
 * What `initialize` said once per session, said on request instead: the revisions, the capability,
 * and the instructions an agent is meant to read once.
 */
export function buildDiscoverResult(): Record<string, unknown> {
  return {
    supportedVersions: [...SUPPORTED_MCP_PROTOCOL_VERSIONS],
    // `listChanged: false` for the reason the handshake gives it: the list is compiled into the build.
    capabilities: { tools: { listChanged: false } },
    instructions: MCP_INSTRUCTIONS,
    ...MCP_CACHE_HINTS,
  };
}

/**
 * A modern result: `resultType` first, which 2026-07-28 makes required on every result, and the
 * server's identity in `_meta`, which it asks for on every result because there is no longer a
 * handshake to have said it in.
 */
function complete(options: McpDispatchOptions, result: Record<string, unknown>): Record<string, unknown> {
  return {
    resultType: "complete",
    ...result,
    _meta: { [MCP_META.serverInfo]: { name: MCP_SERVER_NAME, version: options.appVersion } },
  };
}
