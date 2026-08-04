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

import { allegroApiBase, allegroUploadBase } from "./allegro-oauth";

/** Allegro versions its API through the `Accept` header rather than the path — and takes the same
 *  media type as the `Content-Type` of a JSON write (#485), which is why one constant serves both. */
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
  /** True when Allegro accepted the token and refused the *permission* (#485) — the application the
   *  collector registered does not carry the scope this call needs. Deliberately not `unauthorized`:
   *  reconnecting the same application changes nothing, and the fix is to widen the registration and
   *  only then reconnect. */
  readonly insufficientScope: boolean;

  constructor(message: string, status: number | null, insufficientScope = false) {
    super(message);
    this.name = "AllegroApiError";
    this.status = status;
    this.insufficientScope = insufficientScope;
    // A scope refusal that arrives as a 401 must not latch "needs reconnecting": it is the one 401
    // reconnecting does not fix.
    this.unauthorized = status === 401 && !insufficientScope;
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

/** OAuth's own way of saying *the token is fine, the permission is not*: a `WWW-Authenticate` header
 *  naming `insufficient_scope`. It is the one signal that separates "this application was never
 *  registered for that" from every other refusal, and Allegro's own error body does not carry it —
 *  a missing scope arrives as an ordinary access-denied message. */
function isInsufficientScope(res: Response): boolean {
  const header = res.headers.get("www-authenticate");
  return header !== null && header.toLowerCase().includes("insufficient_scope");
}

/** The error one refusal becomes. A scope refusal is **named as one** (#485): the collector's next
 *  step is to widen the application's registration and reconnect, and "Access is denied" sends them
 *  looking at the token instead. */
async function failureFrom(res: Response): Promise<AllegroApiError> {
  const detail = await describeFailure(res);
  if (isInsufficientScope(res)) {
    return new AllegroApiError(
      `The connected Allegro application does not have permission for this (${detail}). Add the access it needs to your application at apps.developer.allegro.pl, then reconnect under Settings → Allegro.`,
      res.status,
      true
    );
  }
  return new AllegroApiError(detail, res.status);
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

/** Query parameters, in the one shape every caller here uses. */
type AllegroQuery = Record<string, string | number | string[] | undefined>;

function buildUrl(base: string, path: string, query?: AllegroQuery): URL {
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const one of value) url.searchParams.append(key, one);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

/**
 * One authenticated request, retried according to the policy the caller states.
 *
 * The **policy is the caller's** and not this function's, because it is not the same conversation on
 * a read and on a write — see {@link RETRY_READS} and {@link RETRY_WRITES} below. Everything else —
 * the bearer, the versioned accept header, the identifying `User-Agent`, the backoff, and what a
 * refusal becomes — is shared, which is the whole reason this module exists.
 */
async function send(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  path: string;
  query?: AllegroQuery;
  method: string;
  body?: BodyInit;
  /** The image's own media type on an upload (#487), the versioned Allegro one on a JSON write, and
   *  omitted on a read. */
  contentType?: string;
  /** Which Allegro host this call belongs to. The API's, unless the endpoint lives on the upload
   *  host — which `POST /sale/images` does, and nothing else here does. */
  host?: "api" | "upload";
  /** Which *answered* failures are worth repeating. */
  retryOn: (res: Response) => boolean;
  /** Whether a failure with no answer at all — a dropped connection, a restarting proxy — is
   *  repeated. False on a write, where a request that never answered may still have been carried
   *  out. */
  retryNetworkFailure: boolean;
  signal?: AbortSignal;
}): Promise<Response> {
  const base =
    opts.host === "upload" ? allegroUploadBase(opts.sandbox) : allegroApiBase(opts.sandbox);
  const url = buildUrl(base, opts.path, opts.query);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.accessToken}`,
    Accept: ACCEPT,
    "User-Agent": opts.userAgent,
  };
  if (opts.contentType) headers["Content-Type"] = opts.contentType;

  let lastError: AllegroApiError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method,
        headers,
        body: opts.body,
        signal: opts.signal,
        cache: "no-store",
      });
    } catch (err) {
      lastError = new AllegroApiError(
        err instanceof Error ? err.message : "Could not reach Allegro.",
        null
      );
      if (opts.retryNetworkFailure && attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(new Response(null), attempt));
        continue;
      }
      throw lastError;
    }

    if (res.ok) return res;

    const retryable = opts.retryOn(res);
    lastError = await failureFrom(res);
    if (!retryable || attempt === MAX_ATTEMPTS - 1) throw lastError;
    await sleep(retryDelayMs(res, attempt));
  }

  throw lastError ?? new AllegroApiError("Could not reach Allegro.", null);
}

/** A read repeats a rate limit and a server fault alike: re-running a GET costs nothing but the
 *  request, and a restarting proxy looks exactly like a dropped connection — which is why a read
 *  repeats those too. */
const RETRY_READS = (res: Response): boolean => res.status === 429 || res.status >= 500;

/**
 * A write repeats a **rate limit and nothing else** (#485).
 *
 * A 429 is Allegro refusing the request *before* it does anything with it — it is rejected, not
 * half-done — so repeating it cannot create a second listing. A 5xx is the opposite: Allegro may
 * well have created the offer and then failed to say so, and `POST /sale/product-offers` carries no
 * idempotency key to make that safe. Repeating it would put two listings on a live selling account
 * for one press of Publish, which is far worse than a failure the collector can see and repeat by
 * hand. A request that never answered at all is the same case and is not repeated either.
 */
const RETRY_WRITES = (res: Response): boolean => res.status === 429;

/**
 * One authenticated GET against Allegro's API, parsed as JSON.
 *
 * The access token is passed in rather than resolved here, so this module holds no secrets and the
 * store above it stays the only thing that decrypts anything.
 */
export async function allegroGet<T>(opts: {
  sandbox: boolean;
  accessToken: string;
  /** How this instance identifies itself, built by `allegroUserAgent` — required by Allegro on
   *  every request, and carried by every call in this module for that reason. */
  userAgent: string;
  /** Path with a leading slash, e.g. `/me`. */
  path: string;
  /** An array value is repeated rather than joined — Allegro's own convention for the parameters
   *  that take several values (`type`, `publication.status`), and a comma-joined one is read as a
   *  single unknown value rather than as a list. */
  query?: AllegroQuery;
  signal?: AbortSignal;
}): Promise<T> {
  const res = await send({
    ...opts,
    method: "GET",
    retryOn: RETRY_READS,
    retryNetworkFailure: true,
  });
  return (await res.json()) as T;
}

// --- The write half (#485) ---------------------------------------------------------------------
//
// Same base URL, same accept header, same bearer, same identifying header, same error parsing — and
// a retry policy of its own, stated above. What is written is #477's, #486's and #487's; this module
// ends at "the request can be made and its answer can be told apart from a different one".

/**
 * What a write answered.
 *
 * The interesting member is {@link accepted}. Allegro answers a create with **201 or 202**, and the
 * two are not the same thing: 201 is the listing existing, while 202 is the work having been
 * *accepted* — an operation still running, which the caller polls at {@link location} before it may
 * claim anything was published. Collapsing the two into "created" is how an offer that Allegro later
 * refused ends up recorded here as live.
 */
export interface AllegroWriteResult<T> {
  /** Allegro's own status, for a caller that cares which of 200/201/202/204 it was. */
  status: number;
  /** True on a 202 only: accepted, not finished. */
  accepted: boolean;
  /** The parsed body, or null where there was none — a 204, or an answer that is not JSON. */
  body: T | null;
  /** Where the accepted work is followed up: the `Location` header, or the `location` a body states.
   *  Null when Allegro named nowhere, which a caller reports rather than silently polls for. */
  location: string | null;
}

async function writeResult<T>(res: Response): Promise<AllegroWriteResult<T>> {
  let body: T | null = null;
  try {
    const text = await res.text();
    body = text.length > 0 ? (JSON.parse(text) as T) : null;
  } catch {
    // A 2xx that is not JSON is still a success — the status is what the caller acted on, and a
    // parse failure here would turn a published listing into a reported error.
    body = null;
  }
  const stated = (body as { location?: unknown } | null)?.location;
  return {
    status: res.status,
    accepted: res.status === 202,
    body,
    location: res.headers.get("location") ?? (typeof stated === "string" ? stated : null),
  };
}

/** One authenticated JSON POST. Retries a rate limit and nothing else — see {@link RETRY_WRITES}. */
export async function allegroPost<T>(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  path: string;
  query?: AllegroQuery;
  /** Serialised here rather than by the caller, so that the one content type this client sends is
   *  stated in one place. */
  json: unknown;
  signal?: AbortSignal;
}): Promise<AllegroWriteResult<T>> {
  const res = await send({
    ...opts,
    method: "POST",
    body: JSON.stringify(opts.json),
    contentType: ACCEPT,
    retryOn: RETRY_WRITES,
    retryNetworkFailure: false,
  });
  return writeResult<T>(res);
}

/** One authenticated JSON PATCH — Allegro's shape for editing a listing already published. Same
 *  policy as the POST beside it: a PATCH is idempotent in HTTP's own terms, but one repeated over a
 *  5xx would still be a second edit of a live listing decided by this app rather than by the
 *  collector, and one policy for every write is one thing to reason about. */
export async function allegroPatch<T>(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  path: string;
  query?: AllegroQuery;
  json: unknown;
  signal?: AbortSignal;
}): Promise<AllegroWriteResult<T>> {
  const res = await send({
    ...opts,
    method: "PATCH",
    body: JSON.stringify(opts.json),
    contentType: ACCEPT,
    retryOn: RETRY_WRITES,
    retryNetworkFailure: false,
  });
  return writeResult<T>(res);
}

/** What `POST /sale/images` answers with (#487): where the image now lives, and when Allegro will
 *  remove it again if no listing has used it by then. */
export interface AllegroUploadedImage {
  location: string;
  /** Allegro's own expiry, as it stated it. Null where it stated none — which is reported rather
   *  than replaced with a guess, an invented expiry being worse than no expiry at all. */
  expiresAt: string | null;
}

/**
 * Upload one image's **bytes** to Allegro's image store (#487).
 *
 * Three things about this endpoint are not like every other call in this module, and all three come
 * from Allegro's own specification rather than from a choice made here:
 *
 * - It lives on a **separate host** (`upload.allegro.pl`), so it is the one call that does not go to
 *   the API base.
 * - The body is the **raw image**, not a form: the `Content-Type` is the picture's own media type,
 *   one of `image/jpeg`, `image/png` and `image/webp`. #485 built this as a `multipart/form-data`
 *   POST, which Allegro answers with a 415 — it was corrected here, before it had a caller.
 * - Its refusals are per-image and specific: **413** the picture is too large, **415** the format is
 *   not one of the three, **422** Allegro's image server could not process it. The caller names the
 *   image rather than reporting a failed publication, which is what `allegro-images.ts` does with
 *   the {@link AllegroApiError} this throws.
 *
 * The retry policy is the write half's, unchanged: a 429 only. A picture is small and re-uploading
 * one after a 5xx would be harmless in itself, but an image the store did accept and then failed to
 * report is an orphan on Allegro's servers, and the honest answer is the failure the collector can
 * repeat.
 */
export async function allegroUploadImage(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  /** The picture, whole. Images here are bounded by the platform's own per-file limit (#308), so
   *  they are held in memory exactly as the plan's ZIP holds them. */
  bytes: Uint8Array;
  /** The image's media type, which is this request's `Content-Type`. */
  contentType: string;
  signal?: AbortSignal;
}): Promise<AllegroWriteResult<AllegroUploadedImage>> {
  const res = await send({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
    host: "upload",
    path: "/sale/images",
    method: "POST",
    // Copied into an array of its own, never handed over as `.buffer`: a small `Buffer` is a window
    // into a pooled allocation, whose underlying `ArrayBuffer` holds other pictures' bytes too.
    body: new Uint8Array(opts.bytes),
    contentType: opts.contentType,
    retryOn: RETRY_WRITES,
    retryNetworkFailure: false,
    signal: opts.signal,
  });
  return writeResult<AllegroUploadedImage>(res);
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
  userAgent: string;
}): Promise<AllegroAccount> {
  const me = await allegroGet<{ id?: unknown; login?: unknown }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
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
  userAgent: string;
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
    userAgent: opts.userAgent,
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
  userAgent: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const body = await allegroGet<{ latestEvent?: { id?: unknown } }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
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

/** How the buyer chose to have it sent, as the order states it (#463). The **name** is what matters
 *  here rather than Allegro's method id: it is matched against the platform's own shipping
 *  dictionary (#468), which is the collector's list of services and not Allegro's. */
export interface AllegroOrderDelivery {
  methodName: string | null;
  /** What the buyer paid for delivery, as a string. Not the collector's postage cost — it is part of
   *  what changed hands, and so already inside `totalPaid`. */
  cost: string | null;
  currency: string | null;
}

/**
 * An order, narrowed to what the worklist and the sale are about.
 *
 * The worklist's half is read down to **who bought it**, not how to reach them: the login and the
 * name or company on the order. The two fields below it — the buyer's email and the delivery method
 * — are the **sale's** (#463), which is why the sync stores neither: it fetches the order again by
 * id at the moment the collector confirms the sale, rather than keeping contact details in a table
 * answering "what has sold". The phone number and the delivery address stay unread altogether: the
 * sale has nowhere to put them, and reading a buyer's address to discard it is not a thing to do.
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
  /** The buyer's email, where the order states one — what a `Contact` created from this order
   *  carries (#463). Read at confirmation time only; never stored by the sync. */
  buyerEmail: string | null;
  /** `summary.totalToPay` — what actually changed hands, delivery included, as a string so the
   *  decimal never goes through a float. */
  totalPaid: string | null;
  currency: string | null;
  /** Null where the order carries no delivery at all — Allegro's own "collect in person" and the
   *  digital-only forms both do. */
  delivery: AllegroOrderDelivery | null;
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

/** The delivery block, or null where the order has none. A method with no name is no method: the
 *  name is the whole of what the sale matches on, so a cost on its own would be a shipping line the
 *  collector could not identify. */
function parseDelivery(raw: unknown): AllegroOrderDelivery | null {
  const delivery = raw as
    | { method?: { name?: unknown }; cost?: { amount?: unknown; currency?: unknown } }
    | undefined;
  if (!delivery) return null;
  const methodName = str(delivery.method?.name);
  const cost = str(delivery.cost?.amount);
  if (!methodName && !cost) return null;
  return {
    methodName,
    cost,
    // Only beside an amount, as everywhere else in this module.
    currency: cost ? str(delivery.cost?.currency) : null,
  };
}

function parseOrder(raw: unknown): AllegroOrder | null {
  const order = raw as {
    id?: unknown;
    status?: unknown;
    updatedAt?: unknown;
    payment?: { finishedAt?: unknown };
    buyer?: {
      login?: unknown;
      email?: unknown;
      firstName?: unknown;
      lastName?: unknown;
      companyName?: unknown;
    };
    summary?: { totalToPay?: { amount?: unknown; currency?: unknown } };
    delivery?: unknown;
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
    buyerEmail: str(order.buyer?.email),
    totalPaid: str(order.summary?.totalToPay?.amount),
    // Only meaningful beside an amount — a currency on its own describes nothing.
    currency: str(order.summary?.totalToPay?.amount) ? str(order.summary?.totalToPay?.currency) : null,
    delivery: parseDelivery(order.delivery),
    lineItems,
  };
}

/** One order by id — how the event stream is followed up, since an event names an order and carries
 *  none of its detail. */
export async function getAllegroOrder(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  orderId: string;
  signal?: AbortSignal;
}): Promise<AllegroOrder | null> {
  const body = await allegroGet<unknown>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
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
  userAgent: string;
  boughtAtGte: Date;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<AllegroOrder[]> {
  const body = await allegroGet<{ checkoutForms?: unknown }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
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

// --- The seller's own dictionaries a listing profile is built from (#486) ----------------------
//
// Three reads of the same shape: a named thing defined in the collector's Allegro account, which a
// profile then points at by id. None of them can be *created* from here — a shipping rate set is a
// table of carriers and prices, a return policy is a legal document — so the honest answer for an
// account with none is to say so and point at Allegro, which is what the settings panel does.
//
// They are read live whenever the editor is opened rather than cached: a rate set added five minutes
// ago should be selectable, and a list this app remembers is a list that is wrong the first time the
// collector changes anything on Allegro.

/** One entry of a seller dictionary — the id a listing is published with, and what it is called. */
export interface AllegroNamedOption {
  id: string;
  name: string;
}

/** The shared parse: every one of these answers `{ <key>: [{ id, name }] }`. An entry missing either
 *  half is dropped — an option with no id cannot be published with, and one with no name is
 *  something the collector cannot recognise in a select. */
async function listNamedOptions(
  opts: { sandbox: boolean; accessToken: string; userAgent: string; signal?: AbortSignal },
  path: string,
  key: string
): Promise<AllegroNamedOption[]> {
  const body = await allegroGet<Record<string, unknown>>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
    path,
    signal: opts.signal,
  });
  const rows = Array.isArray(body[key]) ? (body[key] as unknown[]) : [];
  return rows.flatMap((raw) => {
    const row = raw as { id?: unknown; name?: unknown };
    const id = str(row.id);
    const name = str(row.name);
    if (!id || !name) return [];
    return [{ id, name }];
  });
}

/** The account's shipping rate sets — Allegro's own table of what a listing offers its buyers, and
 *  the one dictionary a listing cannot be published without. */
export async function listAllegroShippingRates(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  signal?: AbortSignal;
}): Promise<AllegroNamedOption[]> {
  return listNamedOptions(opts, "/sale/shipping-rates", "shippingRates");
}

/** The account's return policies. Empty on a private account that has defined none, which is a
 *  legitimate state rather than a failure. */
export async function listAllegroReturnPolicies(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  signal?: AbortSignal;
}): Promise<AllegroNamedOption[]> {
  return listNamedOptions(
    opts,
    "/after-sales-service-conditions/return-policies",
    "returnPolicies"
  );
}

/** The account's implied-warranty conditions. Same reading as the return policies above. */
export async function listAllegroImpliedWarranties(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  signal?: AbortSignal;
}): Promise<AllegroNamedOption[]> {
  return listNamedOptions(
    opts,
    "/after-sales-service-conditions/implied-warranties",
    "impliedWarranties"
  );
}

// --- The offer event stream the bidding poll follows (#481) ------------------------------------

/** One entry of Allegro's **offer** event stream. Same shape of contract as the order stream: the
 *  event id is the cursor, and the event names an offer without carrying its detail. */
export interface AllegroOfferEvent {
  id: string;
  type: string;
  occurredAt: string | null;
  /** The seller's own listing the event is about, by Allegro's offer id. */
  offerId: string | null;
}

/**
 * A page of the offer event stream, from `after` (exclusive) onwards.
 *
 * Retained for **24 hours**, which is shorter than the order stream's window and is why a refused
 * cursor here is so ordinary: an instance that was down overnight comes back to a cursor Allegro no
 * longer holds, and the honest answer is to seek to the end and let the full sweep restate every
 * listing's bidding. Nothing is lost by that — the sweep reads the same fields.
 *
 * `types` is what makes this cheap: asked for the two bid events, a quiet account answers with an
 * empty page, and that one request is the whole cost of a poll where nothing happened.
 */
export async function listAllegroOfferEvents(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  after?: string | null;
  limit?: number;
  types?: string[];
  signal?: AbortSignal;
}): Promise<AllegroOfferEvent[]> {
  const body = await allegroGet<{ offerEvents?: unknown }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
    path: "/sale/offer-events",
    query: {
      from: opts.after ?? undefined,
      limit: opts.limit ?? 100,
      type: opts.types,
    },
    signal: opts.signal,
  });
  const events = Array.isArray(body.offerEvents) ? body.offerEvents : [];
  return events.flatMap((raw) => {
    const event = raw as { id?: unknown; type?: unknown; occurredAt?: unknown; offer?: unknown };
    const id = str(event.id);
    const type = str(event.type);
    if (!id || !type) return [];
    const offer = event.offer as { id?: unknown } | undefined;
    return [{ id, type, occurredAt: str(event.occurredAt), offerId: str(offer?.id) }];
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
  /** Allegro's selling mode — `AUCTION`, `BUY_NOW` or `ADVERTISEMENT`. The three fields below only
   *  mean anything on an auction, and this is what says whether it is one. Null where Allegro stated
   *  none, which reads as "not known to be an auction" and so as nothing to observe. */
  format: string | null;
  /** How many people have bid (#481). `0` is a live auction nobody has bid on — a fact — while null
   *  is Allegro not having said, which is not the same thing and must never be read as no bids. */
  biddersCount: number | null;
  /** The standing bid, as a string so the decimal never goes through a float, with the currency
   *  Allegro quoted it in. Both null together, a price without a currency being no price. */
  currentPrice: string | null;
  currentCurrency: string | null;
}

/**
 * A page of the seller's own listings — every active one, or exactly the ones named.
 *
 * The sweep asks for the **active** ones, deliberately: paging every listing the account has ever
 * ended is unbounded and answers a question nobody asked, while a live offer here whose listing is
 * no longer among these is exactly the signal the worklist's second section is about.
 *
 * The bidding poll asks by **id** instead (#481). It already knows which offers were bid on, and
 * reading those few is what lets it run every couple of minutes without re-reading the account.
 */
export async function listAllegroSellerOffers(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  /** The publication statuses to sweep. Omitted when `offerIds` names the listings outright — a bid
   *  that landed on an auction ending seconds later is exactly the one worth reading, and filtering
   *  it out by status would lose it. */
  publicationStatus?: string[];
  /** Specific listings, by Allegro's own offer id (`offer.id`, repeatable). This is what the bidding
   *  poll (#481) reads: the event stream says *which* offers changed, and only those are fetched. */
  offerIds?: string[];
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<{ offers: AllegroSellerOffer[]; totalCount: number | null }> {
  const body = await allegroGet<{ offers?: unknown; totalCount?: unknown }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
    path: "/sale/offers",
    query: {
      "publication.status": opts.publicationStatus,
      "offer.id": opts.offerIds,
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
      sellingMode?: { format?: unknown };
      saleInfo?: { currentPrice?: { amount?: unknown; currency?: unknown }; biddersCount?: unknown };
    };
    const id = str(offer.id);
    if (!id) return [];
    const currentPrice = str(offer.saleInfo?.currentPrice?.amount);
    return [
      {
        id,
        externalId: str(offer.external?.id),
        title: str(offer.name) ?? id,
        status: str(offer.publication?.status) ?? "UNKNOWN",
        endingAt: str(offer.publication?.endingAt),
        available: num(offer.stock?.available),
        sold: num(offer.stock?.sold),
        format: str(offer.sellingMode?.format),
        biddersCount: num(offer.saleInfo?.biddersCount),
        currentPrice,
        // Only beside an amount, exactly as an order's total is: a currency on its own describes
        // nothing, and a half-read price is the one thing a bid observation must never be.
        currentCurrency: currentPrice ? str(offer.saleInfo?.currentPrice?.currency) : null,
      },
    ];
  });
  return { offers, totalCount: num(body.totalCount) };
}

// --- The category tree and its parameters a listing is published into (#488) --------------------
//
// Same register as the dictionaries above: transport plus the narrowest honest parse. What any of it
// *means* — which category a kind of stamp belongs in, which value a parameter was last answered
// with — is `allegro-category.ts`'s, and the register it learns into is ADR-0026's.
//
// Nothing here is cached. Allegro's taxonomy changes rarely but it does change, and a tree this app
// remembered would be a tree that is wrong the first time a branch is restructured — with the
// failure landing on a publish rather than on a browse, where it is far more expensive.

/** One node of Allegro's category tree, narrowed to what browsing and publishing need. */
export interface AllegroCategory {
  id: string;
  name: string;
  /** The node above, or null at the top of the tree. */
  parentId: string | null;
  /** Whether a listing can be published into this node. Allegro refuses a non-leaf, so the picker
   *  keeps walking until this is true. */
  leaf: boolean;
}

function parseCategory(raw: unknown): AllegroCategory | null {
  const row = raw as { id?: unknown; name?: unknown; parent?: { id?: unknown }; leaf?: unknown };
  const id = str(row.id);
  const name = str(row.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    parentId: str(row.parent?.id),
    // A node Allegro did not describe is treated as **not** a leaf: walking one level further is a
    // click, while publishing into a branch is a refusal at the worst possible moment.
    leaf: row.leaf === true,
  };
}

/**
 * The children of one category, or the top of the tree when `parentId` is null.
 *
 * `GET /sale/categories` with no `parent.id` answers the roots, which is exactly what a picker opens
 * with — there is no separate endpoint for it and none is needed.
 */
export async function listAllegroCategories(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  parentId?: string | null;
  signal?: AbortSignal;
}): Promise<AllegroCategory[]> {
  const body = await allegroGet<{ categories?: unknown }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
    path: "/sale/categories",
    query: opts.parentId ? { "parent.id": opts.parentId } : undefined,
    signal: opts.signal,
  });
  const rows = Array.isArray(body.categories) ? body.categories : [];
  return rows.flatMap((raw) => {
    const category = parseCategory(raw);
    return category ? [category] : [];
  });
}

/** One category by id — what a stored `categoryId` is resolved through when a screen needs to name
 *  it for real rather than from the snapshot beside it. */
export async function getAllegroCategory(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  categoryId: string;
  signal?: AbortSignal;
}): Promise<AllegroCategory | null> {
  const body = await allegroGet<unknown>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
    path: `/sale/categories/${encodeURIComponent(opts.categoryId)}`,
    signal: opts.signal,
  });
  return parseCategory(body);
}

/**
 * Allegro's own guess at a category from a listing title (`GET /sale/matching-categories`).
 *
 * The fallback under the whole of ADR-0026's register: a key nothing has been learned for still
 * arrives with a suggestion, and the collector still sees where it came from before anything is
 * sent. Ordered as Allegro ordered it — its first answer is its best one.
 */
export async function matchAllegroCategories(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  /** The listing title, which is all Allegro takes. */
  name: string;
  signal?: AbortSignal;
}): Promise<AllegroCategory[]> {
  const body = await allegroGet<{ matchingCategories?: unknown }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
    path: "/sale/matching-categories",
    query: { name: opts.name },
    signal: opts.signal,
  });
  const rows = Array.isArray(body.matchingCategories) ? body.matchingCategories : [];
  return rows.flatMap((raw) => {
    const category = parseCategory(raw);
    return category ? [category] : [];
  });
}

/** One option of a dictionary parameter — the id a listing is published with, and its wording. */
export interface AllegroParameterOption {
  id: string;
  value: string;
}

/**
 * One parameter of a category, as the form that fills it in needs it.
 *
 * `type` is Allegro's own word — `dictionary`, `integer`, `float`, `string` — and is deliberately
 * carried as a string rather than narrowed to a union: a type Allegro adds should render as an
 * unhandled parameter the collector is told about, not crash a parse of the other nine.
 */
export interface AllegroCategoryParameter {
  id: string;
  name: string;
  type: string;
  required: boolean;
  /** Whether the parameter takes more than one value at once. */
  multipleChoices: boolean;
  /** Whether it is answered as a `from`/`to` pair rather than a value. */
  range: boolean;
  /** The unit Allegro states beside the field, where there is one — "mm", "g". */
  unit: string | null;
  /** The options of a `dictionary` parameter. Empty for every other type. */
  dictionary: AllegroParameterOption[];
  /** Numeric bounds, where Allegro stated them, so the form can refuse before the publish does. */
  min: number | null;
  max: number | null;
  minLength: number | null;
  maxLength: number | null;
}

/**
 * A category's parameters, in Allegro's own order.
 *
 * Read live whenever a category is chosen, never stored: what a category *asks* is Allegro's, and
 * the only thing worth remembering is what the collector **answered** (ADR-0026 §1), which is the
 * second register and is keyed by parameter id so a category gaining a field costs one blank rather
 * than a stale form.
 */
export async function listAllegroCategoryParameters(opts: {
  sandbox: boolean;
  accessToken: string;
  userAgent: string;
  categoryId: string;
  signal?: AbortSignal;
}): Promise<AllegroCategoryParameter[]> {
  const body = await allegroGet<{ parameters?: unknown }>({
    sandbox: opts.sandbox,
    accessToken: opts.accessToken,
    userAgent: opts.userAgent,
    path: `/sale/categories/${encodeURIComponent(opts.categoryId)}/parameters`,
    signal: opts.signal,
  });
  const rows = Array.isArray(body.parameters) ? body.parameters : [];
  return rows.flatMap((raw) => {
    const row = raw as {
      id?: unknown;
      name?: unknown;
      type?: unknown;
      required?: unknown;
      unit?: unknown;
      dictionary?: unknown;
      restrictions?: {
        multipleChoices?: unknown;
        range?: unknown;
        min?: unknown;
        max?: unknown;
        minLength?: unknown;
        maxLength?: unknown;
      };
    };
    const id = str(row.id);
    const name = str(row.name);
    const type = str(row.type);
    if (!id || !name || !type) return [];

    const dictionaryRows = Array.isArray(row.dictionary) ? row.dictionary : [];
    const dictionary = dictionaryRows.flatMap((entry) => {
      const option = entry as { id?: unknown; value?: unknown };
      const optionId = str(option.id);
      const value = str(option.value);
      // An option missing either half cannot be published with or recognised in a list — the same
      // rule the seller dictionaries above apply.
      return optionId && value ? [{ id: optionId, value }] : [];
    });

    return [
      {
        id,
        name,
        type,
        required: row.required === true,
        multipleChoices: row.restrictions?.multipleChoices === true,
        range: row.restrictions?.range === true,
        unit: str(row.unit),
        dictionary,
        min: num(row.restrictions?.min),
        max: num(row.restrictions?.max),
        minLength: num(row.restrictions?.minLength),
        maxLength: num(row.restrictions?.maxLength),
      },
    ];
  });
}
