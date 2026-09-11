// The OpenAPI document, generated from the operation registry (#706).
//
// **This is one half of the reason the registry exists.** The other is #709's MCP tool list, and
// both are generated from the same array of `Operation` objects: an operation is added in one place
// and appears in both, because there is no second place to edit. Hand-maintaining either one is how
// REST and MCP drift apart within months, and the drift is silent — the document keeps describing
// an operation whose parameters moved, and the agent keeps believing it.
//
// `buildOpenApiDocument` is a **pure function of the operation list**. That is what makes the
// criterion checkable while this issue ships no operations of its own: a unit test builds a document
// from a fixture operation and asserts that every part of it came from the declaration.
//
// No `server-only`, no Prisma, no `next/server` — see `types.ts` for why the whole layer is built
// that way.

import { API_ERROR_CODES } from "./errors";
import { DEFAULT_LIST_LIMIT, LIST_PARAMETERS, MAX_LIST_LIMIT } from "./list";
import { parsePathTemplate } from "./path-template";
import type { Operation, ParameterSpec } from "./types";

/** Where the operations live. Path keys in the document are absolute, so no `servers` entry is
 *  needed and a client resolves them against whatever origin it reached this instance at. */
export const API_BASE_PATH = "/api/v1";

/** The published contract version. `/api/v1` only ever grows; a break is `/api/v2`. */
export const API_VERSION = "1";

const SECURITY_SCHEME = "assistantToken";

/**
 * A JSON Schema for one parameter, as OpenAPI 3.1 wants it (JSON Schema 2020-12).
 *
 * **Exported because #709's tool generation reads it too.** An MCP tool's `inputSchema` is JSON
 * Schema as well, so two wrappers that each spelled a `ParameterSpec` out for themselves would be
 * two places for a parameter type to be described differently — which is the drift the registry
 * exists to prevent, one level below the operation.
 */
export function parameterSchema(spec: ParameterSpec): Record<string, unknown> {
  switch (spec.type) {
    case "string":
      return spec.values ? { type: "string", enum: [...spec.values] } : { type: "string" };
    case "integer":
      return { type: "integer" };
    case "boolean":
      return { type: "boolean" };
    case "string[]":
      return {
        type: "array",
        items: spec.values ? { type: "string", enum: [...spec.values] } : { type: "string" },
      };
  }
}

function parameterObject(spec: ParameterSpec): Record<string, unknown> {
  return {
    name: spec.name,
    in: spec.in,
    required: spec.in === "path" ? true : spec.required,
    description: spec.description,
    schema: parameterSchema(spec),
  };
}

function requestBody(specs: readonly ParameterSpec[]): Record<string, unknown> | undefined {
  const bodySpecs = specs.filter((spec) => spec.in === "body");
  if (bodySpecs.length === 0) return undefined;
  const properties: Record<string, unknown> = {};
  for (const spec of bodySpecs) {
    properties[spec.name] = { ...parameterSchema(spec), description: spec.description };
  }
  const required = bodySpecs.filter((spec) => spec.required).map((spec) => spec.name);
  return {
    required: required.length > 0,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
          additionalProperties: false,
        },
      },
    },
  };
}

/** The error responses every operation can produce, keyed by status. */
function errorResponses(): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  for (const [status, description] of [
    ["400", "A parameter is missing, malformed, or outside its accepted values."],
    ["401", "The bearer token is missing, malformed or revoked."],
    ["403", "The token is not allowed to perform this operation."],
    ["404", "No such operation, or the thing asked about is not in this collection."],
    ["405", "This path exists under a different method."],
    ["500", "The request failed inside Stamporama."],
  ] as const) {
    responses[status] = {
      description,
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    };
  }
  return responses;
}

function operationObject(operation: Operation): Record<string, unknown> {
  const isList = operation.result.kind === "list";
  const specs = isList ? [...operation.parameters, ...LIST_PARAMETERS] : operation.parameters;
  const body = requestBody(specs);
  const description = isList
    ? `${operation.result.description} The response states the full \`total\`, so a trimmed page is visible as one; follow \`nextCursor\` for the rest.`
    : operation.result.description;

  return {
    operationId: operation.name,
    summary: operation.description,
    description,
    ...(operation.writes ? { "x-stamporama-writes": true } : {}),
    parameters: specs.filter((spec) => spec.in !== "body").map(parameterObject),
    ...(body ? { requestBody: body } : {}),
    responses: {
      "200": {
        description: operation.result.description,
        content: {
          "application/json": {
            schema: isList
              ? { $ref: "#/components/schemas/ListResponse" }
              : { type: "object" },
          },
        },
      },
      ...errorResponses(),
    },
  };
}

/**
 * Everything a registry entry must satisfy before it can be published. Run from
 * `buildOpenApiDocument`, so it cannot be skipped and cannot be forgotten: a malformed operation
 * fails the first request for the document rather than producing a document that describes it
 * wrongly.
 *
 * These are **programming** errors — only a bad registry entry reaches them — so they throw a plain
 * `Error` and are never rendered to an agent.
 */
export function validateOperations(operations: readonly Operation[]): void {
  const names = new Set<string>();
  const bindings = new Set<string>();
  for (const operation of operations) {
    if (!/^[a-z][a-z0-9_]*$/.test(operation.name)) {
      throw new Error(`Operation name must be snake_case: "${operation.name}"`);
    }
    if (names.has(operation.name)) {
      throw new Error(`Two operations are named "${operation.name}"`);
    }
    names.add(operation.name);

    const binding = `${operation.method} ${operation.path}`;
    if (bindings.has(binding)) {
      throw new Error(`Two operations are bound to "${binding}"`);
    }
    bindings.add(binding);

    const template = parsePathTemplate(operation.path);
    const declared = new Set<string>();
    for (const spec of operation.parameters) {
      if (declared.has(spec.name)) {
        throw new Error(`Operation "${operation.name}" declares "${spec.name}" twice`);
      }
      declared.add(spec.name);
      if (spec.in === "body" && operation.method === "GET") {
        throw new Error(`Operation "${operation.name}" declares a body parameter on GET`);
      }
      if (spec.in === "path" && !template.parameterNames.includes(spec.name)) {
        throw new Error(
          `Operation "${operation.name}" declares path parameter "${spec.name}", which its path does not carry`
        );
      }
    }
    for (const name of template.parameterNames) {
      if (!declared.has(name)) {
        throw new Error(
          `Operation "${operation.name}" has "{${name}}" in its path with no matching parameter`
        );
      }
    }
    if (operation.result.kind === "list") {
      for (const reserved of LIST_PARAMETERS) {
        if (declared.has(reserved.name)) {
          throw new Error(
            `Operation "${operation.name}" redeclares the shared list parameter "${reserved.name}"`
          );
        }
      }
    }
  }
}

/**
 * The document. Adding an entry to `operations` is the only edit needed for it to appear here —
 * which is the criterion this issue is built to satisfy.
 */
export function buildOpenApiDocument(
  operations: readonly Operation[],
  options: { readonly appVersion: string }
): Record<string, unknown> {
  validateOperations(operations);

  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operations) {
    const key = `${API_BASE_PATH}${operation.path}`;
    const entry = paths[key] ?? (paths[key] = {});
    entry[operation.method.toLowerCase()] = operationObject(operation);
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Stamporama agent API",
      version: API_VERSION,
      description: [
        "A stable, task-shaped surface over one stamp collection, for an agentic client.",
        "",
        `Authenticate with \`Authorization: Bearer stmpa_…\`. The token is pinned to exactly one collection, so no path here carries a collection id — every operation acts on the token's own collection.`,
        "",
        `Lists return at most ${MAX_LIST_LIMIT} rows (${DEFAULT_LIST_LIMIT} by default) and always state the full \`total\`, so a trimmed answer is visible as one.`,
        "",
        "A token carries a scope. An operation marked `x-stamporama-writes` needs a `read_write` token; a `read` token is refused on one with `403 forbidden`, and the refusal names the scope that would have worked. Nothing here can widen a token — the collector mints one in Settings → Assistant.",
        "",
        `Running build: ${options.appVersion}.`,
      ].join("\n"),
    },
    security: [{ [SECURITY_SCHEME]: [] }],
    components: {
      securitySchemes: {
        [SECURITY_SCHEME]: {
          type: "http",
          scheme: "bearer",
          description: "An Assistant token, minted in Settings → Assistant.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          additionalProperties: false,
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              additionalProperties: false,
              properties: {
                code: { type: "string", enum: [...API_ERROR_CODES] },
                message: {
                  type: "string",
                  description: "One English sentence saying what to do next.",
                },
                accepted: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "The values that would have been accepted, when a value was rejected against a closed set.",
                },
              },
            },
          },
        },
        ListResponse: {
          type: "object",
          required: ["items", "total", "nextCursor"],
          properties: {
            items: { type: "array", items: { type: "object" } },
            total: {
              type: "integer",
              description: "How many rows match in total, whatever this page holds.",
            },
            nextCursor: {
              type: ["string", "null"],
              description: "Send back as `cursor` for the next page; `null` on the last page.",
            },
          },
        },
      },
    },
    paths,
  };
}
