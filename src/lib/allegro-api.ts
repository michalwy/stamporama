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
  /** An array value is repeated rather than joined — Allegro's own convention for the parameters
   *  that take several values (`type`, `publication.status`), and a comma-joined one is read as a
   *  single unknown value rather than as a list. */
  query?: Record<string, string | number | string[] | undefined>;
  signal?: AbortSignal;
}): Promise<T> {
  const url = new URL(`${allegroApiBase(opts.sandbox)}${opts.path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const one of value) url.searchParams.append(key, one);
    } else {
      url.searchParams.set(key, String(value));
    }
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

// --- The reads the sold-listing sync is built on (#467) ---------------------------------------
//
// All four stay in this module's register: transport plus the narrowest honest parse of what came
// back. What any of it *means* — whether a line is still waiting to be recorded, which local offer
// it belongs to — is `allegro-sync.ts`'s, and the shapes below are deliberately small so that a
// field Allegro adds tomorrow is not a field this app silently starts depending on.
//
// Everything is parsed defensively. A marketplace answering with one unexpected null is not a reason
// to abandon a sync of three hundred orders, so a value that is not what it should be reads as
// absent and the caller decides.

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** One entry of Allegro's order event stream. The event *id* is the cursor — a timestamp is not, two
 *  events sharing an instant being ordinary. */
export interface AllegroOrderEvent {
  id: string;
  type: string;
  occurredAt: string | null;
  /** The checkout form the event is about — Allegro's word for the order. */
  orderId: string | null;
}

/**
 * A page of the order event stream, from `after` (exclusive) onwards. Allegro retains the stream for
 * a limited window, so a cursor it no longer accepts is answered with a 4xx — which the sync reads
 * as "start again from a dated window" rather than as a failure.
 */
export async function listAllegroOrderEvents(opts: {
  sandbox: boolean;
  accessToken: string;
  /** Event id to resume after. Omitted on a stream read that starts wherever Allegro starts it. */
  after?: string | null;
  limit?: number;
  /** Event types to ask for; omitted means every type. */
  types?: string[];
  signal?: AbortSignal;
}): Promise<AllegroOrderEvent[]> {
  const body = await allegroGet<{ events?: unknown }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    path: "/order/events",
    query: {
      from: opts.after ?? undefined,
      limit: opts.limit ?? 100,
      type: opts.types,
    },
    signal: opts.signal,
  });
  const events = Array.isArray(body.events) ? body.events : [];
  return events.flatMap((raw) => {
    const event = raw as { id?: unknown; type?: unknown; occurredAt?: unknown; order?: unknown };
    const id = str(event.id);
    const type = str(event.type);
    if (!id || !type) return [];
    const order = event.order as { checkoutForm?: { id?: unknown } } | undefined;
    return [
      {
        id,
        type,
        occurredAt: str(event.occurredAt),
        orderId: str(order?.checkoutForm?.id),
      },
    ];
  });
}

/** The newest event Allegro currently holds. Read *before* a window import, so events that land
 *  during it are picked up by the next pass rather than skipped. */
export async function getAllegroLatestOrderEventId(opts: {
  sandbox: boolean;
  accessToken: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const body = await allegroGet<{ latestEvent?: { id?: unknown } }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    path: "/order/event-stats",
    signal: opts.signal,
  });
  return str(body.latestEvent?.id);
}

/** One ordered line, as the sync records it. */
export interface AllegroOrderLineItem {
  id: string;
  /** Allegro's offer id — the listing's identity, and what the local offer is matched on. */
  offerId: string;
  /** The listing's own external id, which is the Stamporama offer number where the listing was
   *  published through the API. Null on everything posted by hand. */
  externalId: string | null;
  title: string;
  quantity: number;
  /** Per item, as Allegro states it — a string, so the decimal never goes through a float. */
  unitPrice: string;
  currency: string;
  boughtAt: string | null;
}

/**
 * An order, narrowed to what the worklist is about.
 *
 * The buyer is read down to **who they are**, not how to reach them: the login and the name or
 * company on the order. Allegro also states an email, a phone number and a delivery address, and
 * those are deliberately left unread — they belong to the sale #463 writes, which fetches the order
 * again at the moment the collector confirms it, rather than to a list answering "what has sold".
 */
export interface AllegroOrder {
  id: string;
  /** Allegro's own status: `BOUGHT` | `FILLED_IN` | `READY_FOR_PROCESSING` | `CANCELLED`. */
  status: string;
  /** When the payment completed, where it has. */
  paymentFinishedAt: string | null;
  updatedAt: string | null;
  buyerLogin: string | null;
  /** The buyer's own name, or the company's where the order is a company's. Null on an order that
   *  states neither, which the delivery-less ones routinely do. */
  buyerName: string | null;
  /** `summary.totalToPay` — what actually changed hands, delivery included, as a string so the
   *  decimal never goes through a float. */
  totalPaid: string | null;
  currency: string | null;
  lineItems: AllegroOrderLineItem[];
}

/** The buyer's name as one line: a person's two names, or the company's. Trimmed to null rather than
 *  to an empty string, so "no name recorded" has one representation. */
function buyerNameOf(buyer: {
  firstName?: unknown;
  lastName?: unknown;
  companyName?: unknown;
}): string | null {
  const company = str(buyer.companyName);
  if (company) return company;
  const person = [str(buyer.firstName), str(buyer.lastName)].filter(Boolean).join(" ").trim();
  return person.length > 0 ? person : null;
}

function parseOrder(raw: unknown): AllegroOrder | null {
  const order = raw as {
    id?: unknown;
    status?: unknown;
    updatedAt?: unknown;
    payment?: { finishedAt?: unknown };
    buyer?: { login?: unknown; firstName?: unknown; lastName?: unknown; companyName?: unknown };
    summary?: { totalToPay?: { amount?: unknown; currency?: unknown } };
    lineItems?: unknown;
  };
  const id = str(order.id);
  if (!id) return null;

  const lineItems = (Array.isArray(order.lineItems) ? order.lineItems : []).flatMap((rawLine) => {
    const line = rawLine as {
      id?: unknown;
      offer?: { id?: unknown; name?: unknown; external?: { id?: unknown } };
      quantity?: unknown;
      price?: { amount?: unknown; currency?: unknown };
      boughtAt?: unknown;
    };
    const lineId = str(line.id);
    const offerId = str(line.offer?.id);
    const amount = str(line.price?.amount);
    const currency = str(line.price?.currency);
    // A line with no id, no offer or no price is not a line this app can say anything about, and
    // storing it half-read would put an unexplainable row in front of the collector.
    if (!lineId || !offerId || !amount || !currency) return [];
    return [
      {
        id: lineId,
        offerId,
        externalId: str(line.offer?.external?.id),
        title: str(line.offer?.name) ?? offerId,
        quantity: num(line.quantity) ?? 1,
        unitPrice: amount,
        currency,
        boughtAt: str(line.boughtAt),
      },
    ];
  });

  return {
    id,
    status: str(order.status) ?? "UNKNOWN",
    paymentFinishedAt: str(order.payment?.finishedAt),
    updatedAt: str(order.updatedAt),
    buyerLogin: str(order.buyer?.login),
    buyerName: order.buyer ? buyerNameOf(order.buyer) : null,
    totalPaid: str(order.summary?.totalToPay?.amount),
    // Only meaningful beside an amount — a currency on its own describes nothing.
    currency: str(order.summary?.totalToPay?.amount) ? str(order.summary?.totalToPay?.currency) : null,
    lineItems,
  };
}

/** One order by id — how the event stream is followed up, since an event names an order and carries
 *  none of its detail. */
export async function getAllegroOrder(opts: {
  sandbox: boolean;
  accessToken: string;
  orderId: string;
  signal?: AbortSignal;
}): Promise<AllegroOrder | null> {
  const body = await allegroGet<unknown>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    path: `/order/checkout-forms/${encodeURIComponent(opts.orderId)}`,
    signal: opts.signal,
  });
  return parseOrder(body);
}

/**
 * A page of orders bought since `boughtAtGte`. This is the *first* sync's read and the fallback for
 * a cursor Allegro no longer accepts — the event stream is what every later pass follows, because a
 * dated read cannot see an order whose only change was a payment landing.
 */
export async function listAllegroOrders(opts: {
  sandbox: boolean;
  accessToken: string;
  boughtAtGte: Date;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<AllegroOrder[]> {
  const body = await allegroGet<{ checkoutForms?: unknown }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    path: "/order/checkout-forms",
    query: {
      "lineItems.boughtAt.gte": opts.boughtAtGte.toISOString(),
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
      sort: "lineItems.boughtAt",
    },
    signal: opts.signal,
  });
  const forms = Array.isArray(body.checkoutForms) ? body.checkoutForms : [];
  return forms.flatMap((form) => {
    const parsed = parseOrder(form);
    return parsed ? [parsed] : [];
  });
}

/** One of the seller's own listings, narrowed to what the sweep records. */
export interface AllegroSellerOffer {
  id: string;
  externalId: string | null;
  title: string;
  status: string;
  endingAt: string | null;
  available: number | null;
  sold: number | null;
}

/**
 * A page of the seller's own listings at one publication status.
 *
 * The sweep asks for the **active** ones, deliberately: paging every listing the account has ever
 * ended is unbounded and answers a question nobody asked, while a live offer here whose listing is
 * no longer among these is exactly the signal the worklist's second section is about.
 */
export async function listAllegroSellerOffers(opts: {
  sandbox: boolean;
  accessToken: string;
  publicationStatus: string[];
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<{ offers: AllegroSellerOffer[]; totalCount: number | null }> {
  const body = await allegroGet<{ offers?: unknown; totalCount?: unknown }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    path: "/sale/offers",
    query: {
      "publication.status": opts.publicationStatus,
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
    },
    signal: opts.signal,
  });
  const rows = Array.isArray(body.offers) ? body.offers : [];
  const offers = rows.flatMap((raw) => {
    const offer = raw as {
      id?: unknown;
      name?: unknown;
      external?: { id?: unknown };
      publication?: { status?: unknown; endingAt?: unknown };
      stock?: { available?: unknown; sold?: unknown };
    };
    const id = str(offer.id);
    if (!id) return [];
    return [
      {
        id,
        externalId: str(offer.external?.id),
        title: str(offer.name) ?? id,
        status: str(offer.publication?.status) ?? "UNKNOWN",
        endingAt: str(offer.publication?.endingAt),
        available: num(offer.stock?.available),
        sold: num(offer.stock?.sold),
      },
    ];
  });
  return { offers, totalCount: num(body.totalCount) };
}
