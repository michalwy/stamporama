// The thin Allegro REST client (#476; ADR-0023) — the single place that knows the base URL, the
// versioned accept header, the bearer header, and what a 429 or a 5xx means.
//
// Everything downstream of this issue (#467's sold-listing worklist, #463's order → Sale) goes
// through it and knows none of that. The same reasoning as the platform modules: a marketplace's
// own shape belongs in one file, so that when it changes there is one file to change.
//
// Deliberately transport-only, and it imports nothing from the token store: `allegro-connection.ts`
// is what turns a collection into an access token and then calls in here. That direction is what
// keeps the two from being a cycle, and it also means the retry/backoff rules are testable without
// a database.

import { allegroApiBase } from "./allegro-oauth";

/** Allegro versions its API through the `Accept` header rather than the path. */
const ACCEPT = "application/vnd.allegro.public.v1+json";

/** How many times a call is retried. Only rate limits and server faults are retried — a 4xx is the
 *  request being wrong, and repeating it just spends the collector's quota. */
const MAX_ATTEMPTS = 3;
/** Base backoff, doubled per attempt, when Allegro states no `Retry-After` of its own. */
const BACKOFF_MS = 1000;
/** Ceiling on an honoured `Retry-After`: a call made from a settings screen must not hold a request
 *  open for the minutes Allegro is entitled to ask for. Past this the honest answer is the error. */
const MAX_WAIT_MS = 10_000;

/** Raised for anything the caller cannot fix by retrying. `status` is Allegro's own where there was
 *  a response — `null` for a network failure, which is a different conversation with the collector
 *  than a refusal. */
export class AllegroApiError extends Error {
  readonly status: number | null;
  /** True when the token was rejected: the caller's cue to mark the connection as needing a
   *  reconnection rather than reporting a one-off failure. */
  readonly unauthorized: boolean;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "AllegroApiError";
    this.status = status;
    this.unauthorized = status === 401;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Allegro's error bodies are `{ errors: [{ userMessage, message, code }] }`; a gateway in front of
 *  it answers with something else entirely, hence the status fallback. */
async function describeFailure(res: Response): Promise<string> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return `Allegro returned HTTP ${res.status}.`;
  }
  const errors = (body as { errors?: unknown })?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as { userMessage?: unknown; message?: unknown };
    const text = typeof first.userMessage === "string" ? first.userMessage : first.message;
    if (typeof text === "string" && text.length > 0) return text;
  }
  const message = (body as { message?: unknown })?.message;
  if (typeof message === "string" && message.length > 0) return message;
  return `Allegro returned HTTP ${res.status}.`;
}

/** How long to wait before the next attempt. Allegro's own `Retry-After` wins where it stated one —
 *  guessing against a rate limiter is how a caller earns a longer ban — capped at {@link MAX_WAIT_MS}. */
function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_WAIT_MS);
  }
  return Math.min(BACKOFF_MS * 2 ** attempt, MAX_WAIT_MS);
}

/**
 * One authenticated GET against Allegro's API, parsed as JSON.
 *
 * The access token is passed in rather than resolved here, so this module holds no secrets and the
 * store above it stays the only thing that decrypts anything.
 */
export async function allegroGet<T>(opts: {
  sandbox: boolean;
  accessToken: string;
  /** Path with a leading slash, e.g. `/me`. */
  path: string;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}): Promise<T> {
  const url = new URL(`${allegroApiBase(opts.sandbox)}${opts.path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let lastError: AllegroApiError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          Accept: ACCEPT,
        },
        signal: opts.signal,
        cache: "no-store",
      });
    } catch (err) {
      // A network failure is worth one more try for the same reason a 5xx is — a restarting proxy
      // looks exactly like this — but it carries no status, so it can never be mistaken for a
      // refusal the collector should act on.
      lastError = new AllegroApiError(
        err instanceof Error ? err.message : "Could not reach Allegro.",
        null
      );
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(new Response(null), attempt));
        continue;
      }
      throw lastError;
    }

    if (res.ok) return (await res.json()) as T;

    const retryable = res.status === 429 || res.status >= 500;
    const message = await describeFailure(res);
    lastError = new AllegroApiError(message, res.status);
    if (!retryable || attempt === MAX_ATTEMPTS - 1) throw lastError;
    await sleep(retryDelayMs(res, attempt));
  }

  throw lastError ?? new AllegroApiError("Could not reach Allegro.", null);
}

/** Who the token belongs to — Allegro's `GET /me`. This is the whoami call #476 is *done when* it
 *  succeeds, and it is also what fills the connected-account line in Settings. */
export interface AllegroAccount {
  id: string;
  login: string;
}

export async function allegroWhoAmI(opts: {
  sandbox: boolean;
  accessToken: string;
}): Promise<AllegroAccount> {
  const me = await allegroGet<{ id?: unknown; login?: unknown }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    path: "/me",
  });
  return {
    id: typeof me.id === "string" ? me.id : "",
    // The login is what the status line names, so an account that somehow has none reads as the
    // honest placeholder rather than as an empty line the collector cannot interpret.
    login: typeof me.login === "string" && me.login.length > 0 ? me.login : "(unknown)",
  };
}
