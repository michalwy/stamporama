// Reading a request's inputs into an operation's declared parameters (#706).
//
// **No validation library.** This project uses none — no zod, no valibot — and introducing one to
// generate a spec is an ADR-level dependency for something four types and a hundred lines answer.
// The types are deliberately few: `string`, `integer`, `boolean` and `string[]`. Anything richer
// than that is a vocabulary, and a vocabulary is a `values` list on the parameter (#708 resolves the
// collection's own configurable ones by name through the same field).
//
// Every rejection here is an `ApiError` carrying a sentence that says what to do next, and — where
// the parameter has a closed set — the values that would have been accepted.
//
// Pure: no Prisma, no `next/server`. Unit-testable, and unit-tested.

import { invalidRequest } from "./errors";
import type { ParameterSpec, ParamValue, ParsedParams } from "./types";

/** The shared window parameters, accepted on every list operation. Declared in `list.ts`. */
const RESERVED_QUERY_NAMES = new Set(["limit", "cursor"]);

export interface RawInputs {
  /** Values pulled out of the matched path template. */
  readonly path: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  /** The parsed JSON body, or `undefined` when the request had none. */
  readonly body?: unknown;
}

/**
 * Validate `raw` against `specs` and return the declared names, typed.
 *
 * **An undeclared query parameter is rejected rather than ignored**, and that is the deliberate
 * half. An agent that guessed `filter=` and was silently ignored gets a plausible-looking answer to
 * a question it did not ask, and no way to tell; an agent that is handed the declared names corrects
 * itself in one turn. It is the same argument as `accepted` on a vocabulary error, applied one level
 * up. The window parameters (`limit`, `cursor`) are always allowed, because `list.ts` reads them
 * beside this and they are not part of any operation's own declaration.
 */
export function parseParameters(specs: readonly ParameterSpec[], raw: RawInputs): ParsedParams {
  const body = readBodyObject(raw.body);
  const declaredQuery = new Set(
    specs.filter((spec) => spec.in === "query").map((spec) => spec.name)
  );
  for (const name of raw.query.keys()) {
    if (declaredQuery.has(name) || RESERVED_QUERY_NAMES.has(name)) continue;
    throw invalidRequest(
      `This operation has no query parameter "${name}". Use one of the accepted names, or drop it.`,
      [...declaredQuery, ...RESERVED_QUERY_NAMES].sort()
    );
  }

  const parsed: Record<string, ParamValue | undefined> = {};
  for (const spec of specs) {
    const supplied = readRaw(spec, raw, body);
    if (supplied === undefined) {
      if (spec.required) {
        throw invalidRequest(
          `"${spec.name}" is required: ${spec.description} Supply it in the ${spec.in} and retry.`,
          spec.values
        );
      }
      parsed[spec.name] = undefined;
      continue;
    }
    parsed[spec.name] = coerce(spec, supplied);
  }
  return Object.freeze(parsed);
}

/** The raw, uncoerced value for one spec, or `undefined` when it was not supplied. */
function readRaw(spec: ParameterSpec, raw: RawInputs, body: Record<string, unknown>): unknown {
  if (spec.in === "path") {
    const value = raw.path[spec.name];
    return value === undefined || value === "" ? undefined : value;
  }
  if (spec.in === "body") {
    const value = body[spec.name];
    return value === null ? undefined : value;
  }
  if (spec.type === "string[]") {
    // Both spellings, because an agent will produce either and neither is wrong: repeated
    // `?area=PL&area=DE`, and comma-separated `?area=PL,DE`.
    const all = raw.query.getAll(spec.name).flatMap((value) => value.split(","));
    const values = all.map((value) => value.trim()).filter((value) => value.length > 0);
    return values.length > 0 ? values : undefined;
  }
  const value = raw.query.get(spec.name);
  return value === null || value.trim() === "" ? undefined : value.trim();
}

/** The body as an object. A body that is present and is not a JSON object is a request error. */
function readBodyObject(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw invalidRequest(
      "The request body must be a JSON object. Send the parameters as named fields of one object."
    );
  }
  return body as Record<string, unknown>;
}

function coerce(spec: ParameterSpec, supplied: unknown): ParamValue {
  switch (spec.type) {
    case "string":
      return checkVocabulary(spec, asString(spec, supplied));
    case "integer":
      return asInteger(spec, supplied);
    case "boolean":
      return asBoolean(spec, supplied);
    case "string[]":
      return asStringArray(spec, supplied).map((value) => checkVocabulary(spec, value));
  }
}

function asString(spec: ParameterSpec, supplied: unknown): string {
  if (typeof supplied === "string") {
    const trimmed = supplied.trim();
    if (trimmed.length > 0) return trimmed;
  }
  throw invalidRequest(
    `"${spec.name}" must be a non-empty string: ${spec.description} Send it as text and retry.`,
    spec.values
  );
}

function asInteger(spec: ParameterSpec, supplied: unknown): number {
  if (typeof supplied === "number" && Number.isSafeInteger(supplied)) return supplied;
  // A JSON body may carry a real number; a query string can only carry text. Both arrive here, and
  // `Number("")`/`Number(" ")` are 0, which is why the pattern comes before the conversion.
  if (typeof supplied === "string" && /^-?\d+$/.test(supplied)) {
    const parsed = Number(supplied);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw invalidRequest(
    `"${spec.name}" must be a whole number: ${spec.description} Send it as an integer and retry.`
  );
}

function asBoolean(spec: ParameterSpec, supplied: unknown): boolean {
  if (typeof supplied === "boolean") return supplied;
  if (supplied === "true" || supplied === "1") return true;
  if (supplied === "false" || supplied === "0") return false;
  throw invalidRequest(
    `"${spec.name}" must be true or false: ${spec.description} Send "true" or "false" and retry.`,
    ["true", "false"]
  );
}

function asStringArray(spec: ParameterSpec, supplied: unknown): string[] {
  if (Array.isArray(supplied)) {
    return supplied.map((value) => asString(spec, value));
  }
  throw invalidRequest(
    `"${spec.name}" must be a list of strings: ${spec.description} In a query string, repeat the parameter or separate the values with commas.`,
    spec.values
  );
}

function checkVocabulary(spec: ParameterSpec, value: string): string {
  if (!spec.values || spec.values.includes(value)) return value;
  throw invalidRequest(
    `"${value}" is not an accepted value for "${spec.name}". Use one of the accepted values and retry.`,
    spec.values
  );
}

/**
 * The readers a handler uses. They are total by construction — `parseParameters` has already proved
 * the type and, for a required parameter, the presence — so a missing name here is a registry bug
 * and throws a plain `Error` rather than an agent-facing one.
 */
export function requiredString(params: ParsedParams, name: string): string {
  const value = params[name];
  if (typeof value !== "string") throw wrongType(name, "string");
  return value;
}

export function optionalString(params: ParsedParams, name: string): string | null {
  const value = params[name];
  if (value === undefined) return null;
  if (typeof value !== "string") throw wrongType(name, "string");
  return value;
}

export function requiredInteger(params: ParsedParams, name: string): number {
  const value = params[name];
  if (typeof value !== "number") throw wrongType(name, "integer");
  return value;
}

export function optionalInteger(params: ParsedParams, name: string): number | null {
  const value = params[name];
  if (value === undefined) return null;
  if (typeof value !== "number") throw wrongType(name, "integer");
  return value;
}

export function optionalBoolean(params: ParsedParams, name: string): boolean | null {
  const value = params[name];
  if (value === undefined) return null;
  if (typeof value !== "boolean") throw wrongType(name, "boolean");
  return value;
}

/** An unsupplied list reads as empty, which is what every caller wants and none should restate. */
export function stringList(params: ParsedParams, name: string): readonly string[] {
  const value = params[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw wrongType(name, "string list");
  return value as readonly string[];
}

function wrongType(name: string, type: string): Error {
  return new Error(`Parameter "${name}" is not a ${type} — check the operation's declaration.`);
}
