// The error an agent can act on (#706).
//
// The binding constraint on this surface is the agent's context window, not bandwidth, and an error
// is where that shows most sharply: a 400 with no body costs a retry that will fail the same way. So
// every error here carries three things — a **stable code** the agent can branch on, **one English
// sentence saying what to do next**, and, where a value was rejected against a closed vocabulary,
// **the values that would have been accepted**.
//
// The third is the one worth the machinery. An agent told `"unknown condition"` guesses again; an
// agent handed the collection's actual condition names corrects itself in one turn. #708 extends the
// same field to the collection's configurable vocabularies, which is why it lives in this shared
// helper rather than being reinvented in each handler.
//
// Pure: no Prisma, no `next/server`, no `server-only`. The route turns an `ApiError` into a
// response; nothing here knows what a response is.

/**
 * The codes, with the status each maps to. The map **is** the enumeration — an agent branching on a
 * code and a maintainer choosing a status read the same line, and a code cannot be added without a
 * status being chosen for it.
 */
export const API_ERROR_STATUS = {
  /** The credential is missing, malformed or revoked. */
  unauthorized: 401,
  /** The credential is valid but not allowed to do this. #707 uses it for a `read` token. */
  forbidden: 403,
  /** No operation is bound to this path. */
  unknown_operation: 404,
  /** The operation ran and the thing it was asked about is not in this collection. */
  not_found: 404,
  /** The path is an operation's, but not under this method. */
  method_not_allowed: 405,
  /** A parameter was missing, malformed, or outside its declared vocabulary. */
  invalid_request: 400,
  /** A defect on our side. Never carries an internal message — see `errorResponseBody`. */
  internal_error: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

/** Every code, for the OpenAPI document and for anything that wants to enumerate them. */
export const API_ERROR_CODES = Object.keys(API_ERROR_STATUS) as readonly ApiErrorCode[];

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    /** Present only when a value was rejected against a closed set. */
    readonly accepted?: readonly string[];
  };
}

/**
 * An error with a code and a status. Thrown by the parsers and by handlers; caught once, in the
 * route, and rendered by `errorResponseBody`.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly accepted?: readonly string[];

  constructor(code: ApiErrorCode, message: string, accepted?: readonly string[]) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    if (accepted) this.accepted = accepted;
  }

  get status(): number {
    return API_ERROR_STATUS[this.code];
  }

  toBody(): ApiErrorBody {
    return {
      error: this.accepted
        ? { code: this.code, message: this.message, accepted: this.accepted }
        : { code: this.code, message: this.message },
    };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * What to send for anything thrown out of a handler. An `ApiError` is the author saying what the
 * agent should do; anything else is a defect, and its message is deliberately **not** relayed — an
 * internal message is written for a maintainer reading a log, and putting it in front of an agent
 * spends context on a sentence it cannot act on and may carry an internal identifier besides.
 */
export function errorResponseBody(error: unknown): { status: number; body: ApiErrorBody } {
  if (isApiError(error)) return { status: error.status, body: error.toBody() };
  return {
    status: API_ERROR_STATUS.internal_error,
    body: {
      error: {
        code: "internal_error",
        message: "The request failed inside Stamporama. Retry once; if it fails again, report it.",
      },
    },
  };
}

/** A parameter was missing, malformed, or outside its declared vocabulary. */
export function invalidRequest(message: string, accepted?: readonly string[]): ApiError {
  return new ApiError("invalid_request", message, accepted);
}

/** No operation is bound to this path. */
export function unknownOperation(message: string): ApiError {
  return new ApiError("unknown_operation", message);
}

/** The path matched an operation, but not under this method; `accepted` carries the methods. */
export function methodNotAllowed(message: string, accepted: readonly string[]): ApiError {
  return new ApiError("method_not_allowed", message, accepted);
}

/** The credential is missing, malformed or revoked. */
export function unauthorized(message: string): ApiError {
  return new ApiError("unauthorized", message);
}

/** The operation ran and the thing it was asked about is not in this collection. */
export function notFound(message: string): ApiError {
  return new ApiError("not_found", message);
}
