// The vocabulary of the versioned agent API (#706): what an *operation* is, and what an operation
// may take as input. Everything downstream — the REST dispatcher, the OpenAPI document, and the MCP
// tool list (#709) — reads these declarations and nothing else, which is the whole point of the
// registry: one place to add an operation, two wrappers generated from it.
//
// **This module imports nothing.** It is the base of the agent-api layer, and it stays that way so
// that a handler may import it without the registry importing the handler back — the `src/lib`
// cycle that typechecks, passes every test, and then throws at module-init in the real app
// (`platform.md`). The direction is fixed: handlers import these types and the helpers beside them;
// only `registry.ts` imports handlers.
//
// It also carries no `server-only`, deliberately. `pnpm test:unit` forbids Prisma anywhere in its
// import graph and `tests/unit/unit-suite-purity.test.ts` walks that graph to prove it, so the parts
// of this layer worth unit-testing — the parsers, the list window, the path matcher, the document
// generator — have to be reachable from a test. Only `registry.ts` and the route handlers are
// server-side.

/** The HTTP methods an operation may bind to. Kept closed so the dispatcher can enumerate them. */
export const HTTP_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** The types a parameter may declare. Deliberately small — see `params.ts` for why. */
export type ParameterType = "string" | "integer" | "boolean" | "string[]";

/**
 * Where a parameter is read from. `path` values come out of the matched route template, `query` out
 * of the query string, and `body` out of a JSON object — which only a writing method has.
 */
export type ParameterLocation = "path" | "query" | "body";

export interface ParameterSpec {
  /** The name the agent uses, in `snake_case`. */
  readonly name: string;
  readonly in: ParameterLocation;
  readonly type: ParameterType;
  readonly required: boolean;
  /**
   * One English sentence, written for a model rather than for a changelog. It is what the agent
   * reads in the OpenAPI document and, through #709, as the MCP tool's parameter description.
   */
  readonly description: string;
  /**
   * The accepted values, where the parameter has a closed vocabulary. A rejected value comes back
   * carrying this list, which is what lets an agent correct itself instead of retrying blind
   * (#708 extends the same shape to the collection's own configurable vocabularies).
   */
  readonly values?: readonly string[];
}

/** A parameter value after parsing. `undefined` means an optional parameter was not supplied. */
export type ParamValue = string | number | boolean | readonly string[];

/** The validated inputs handed to a handler: declared names only, already typed. */
export type ParsedParams = Readonly<Record<string, ParamValue | undefined>>;

/**
 * Who the call is acting as. There is no collection id in any `/api/v1` path, because an Assistant
 * token is pinned to exactly one collection — so the collection is resolved *from* the credential
 * and arrives here rather than being restated by the caller.
 */
export interface OperationContext {
  readonly ownerId: string;
  readonly collectionId: string;
}

/**
 * What an operation answers with. `list` is not decoration: it makes the response conventions
 * visible in the generated document, so an agent reading the spec can see that a list states its
 * full `total` and may be trimmed, rather than having to discover it from a truncated answer.
 */
export type OperationResult =
  | { readonly kind: "object"; readonly description: string }
  | { readonly kind: "list"; readonly description: string };

export interface Operation {
  /**
   * The operation's identity, in `snake_case`, and a **task-shaped verb** rather than a resource:
   * `find_unlisted_copies`, not `GET /items` with eighteen filters. An agent resolves a wide
   * parameter surface by guessing and a named task by reading. It is the OpenAPI `operationId` and
   * the MCP tool name, so it is stable once published.
   */
  readonly name: string;
  readonly method: HttpMethod;
  /**
   * The path relative to `/api/v1`, leading slash included, with `{name}` for a path parameter:
   * `/items`, `/items/{itemId}`. Every `{name}` needs a matching `in: "path"` parameter.
   */
  readonly path: string;
  /**
   * What the operation does, in English, written for a model to read. #709 surfaces it verbatim as
   * the MCP tool description.
   */
  readonly description: string;
  /**
   * Whether the operation writes. Declared here so that one place decides it: #707 reads it to
   * refuse a `read` token, and the OpenAPI document says so to the agent.
   */
  readonly writes: boolean;
  readonly parameters: readonly ParameterSpec[];
  readonly result: OperationResult;
  readonly handler: (context: OperationContext, params: ParsedParams) => Promise<unknown>;
}
