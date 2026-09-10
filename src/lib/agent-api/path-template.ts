// Matching a request's path segments against an operation's path template (#706).
//
// Kept apart from the registry so that a unit test can hold it: the registry imports handlers, and a
// handler reaches Prisma, which `pnpm test:unit` forbids anywhere in its import graph
// (`tests/unit/unit-suite-purity.test.ts` walks it and names the chain). The matcher is the half
// worth testing and it has no reason to know what an operation is. **That became live with #708**
// rather than with #710 as this comment used to anticipate — `registry.ts` now imports
// `operations/vocabulary.ts`, which carries `server-only` and reads Prisma.

import { invalidRequest } from "./errors";

/** `{name}` for a path parameter; anything else is a literal segment. */
const PARAM_SEGMENT = /^\{([A-Za-z][A-Za-z0-9_]*)\}$/;

export interface PathTemplate {
  /** The template as written, e.g. `/items/{itemId}` — what the OpenAPI document publishes. */
  readonly source: string;
  readonly segments: readonly string[];
  /** The `{name}` names, in the order they appear. */
  readonly parameterNames: readonly string[];
}

/**
 * Split a template into segments. Throws on a malformed template, which is a **programming** error
 * rather than a request error: it can only be reached by a bad registry entry, so it should stop the
 * first request rather than be reported to an agent as though it had done something wrong.
 */
export function parsePathTemplate(source: string): PathTemplate {
  if (!source.startsWith("/")) {
    throw new Error(`Operation path must start with "/": ${source}`);
  }
  const segments = source.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`Operation path has an empty segment: ${source}`);
  }
  const parameterNames: string[] = [];
  for (const segment of segments) {
    const match = PARAM_SEGMENT.exec(segment);
    if (match) {
      if (parameterNames.includes(match[1])) {
        throw new Error(`Operation path repeats the parameter "${match[1]}": ${source}`);
      }
      parameterNames.push(match[1]);
    } else if (segment.includes("{") || segment.includes("}")) {
      throw new Error(`Operation path segment is neither a literal nor "{name}": ${source}`);
    }
  }
  return { source, segments, parameterNames };
}

/**
 * The path values when `segments` matches `template`, or `null` when it does not. A segment that
 * decodes to nothing does not match — `/items//x` is not `/items/{itemId}/x` with an empty id, and
 * an operation asked about the empty string would answer "not found" for a request that was
 * malformed.
 */
export function matchPathTemplate(
  template: PathTemplate,
  segments: readonly string[]
): Readonly<Record<string, string>> | null {
  if (segments.length !== template.segments.length) return null;
  const values: Record<string, string> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const expected = template.segments[i];
    const match = PARAM_SEGMENT.exec(expected);
    if (match) {
      const value = decodeSegment(segments[i]);
      if (value.length === 0) return null;
      values[match[1]] = value;
    } else if (decodeSegment(segments[i]) !== expected) {
      return null;
    }
  }
  return values;
}

/**
 * A percent-decoded segment. Next hands the catch-all its segments already decoded, but a hand-built
 * caller may not, and `decodeURIComponent` throws on a malformed escape — which is a request error
 * and gets an agent-readable sentence rather than a 500.
 */
function decodeSegment(segment: string): string {
  if (!segment.includes("%")) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    throw invalidRequest(
      `The path segment "${segment}" is not valid percent-encoding. Encode each path value with a standard URL encoder and retry.`
    );
  }
}
