// **Writing list membership on Colnect** (#689) — the only place in this repo that builds a request
// which changes something in a Colnect account. ADR-0042 records the decision; this is the shape of
// it, kept pure so what is sent can be asserted in `test:unit` without a browser.
//
// Established by reading the site on 2026-08-22 (minified `https://colnect.com/s/m.115.js`,
// `Inventory.col_update` / `col_update_do`). **None of this is documented or supported by Colnect**,
// and it may change without notice — which is why the classification below has a *stop* branch
// rather than a retry loop.
//
// The list checkbox on an item row is not an `<input>`: it is `span.cb` inside
// `div.ibox_list[data-lt=N]`, itself inside `div.ibox[data-xid=<colnect item id>]`. Clicking it
// issues exactly the request {@link colnectListWriteBody} builds. Auth is **cookies only** — no CSRF
// token — the same shape as the already-known `POST /en/sell/close_sale`, which is why this can only
// ever run from a colnect.com page in the collector's own browser.

/** Where the write goes. Relative, because it is issued same-origin from a colnect.com page — a
 *  content script that built an absolute Colnect URL would be one edit away from posting somewhere
 *  else entirely. */
export const COLNECT_LIST_WRITE_PATH = "/item/col";

/** Colnect's category id for stamps, which every per-item call is keyed by. The same constant the
 *  sale form already uses (`listing.ts`), stated once per file rather than shared, since the two
 *  read it off different parts of the same site. */
const STAMPS_CATEGORY = "20";

/** Which way one item goes — Colnect's own `val`. */
export type ColnectListWriteDirection = "+" | "-";

/**
 * The form body for putting one item on a list, or taking it off.
 *
 * `URLSearchParams` rather than a hand-built string: an item id is digits and a list id is an
 * integer, so nothing here needs escaping today — and a body that quietly stopped escaping is how a
 * value that *does* need it gets through unnoticed later.
 */
export function colnectListWriteBody(input: {
  colnectId: string;
  lt: number;
  direction: ColnectListWriteDirection;
}): string {
  return new URLSearchParams({
    act: "check",
    id: input.colnectId,
    cat: STAMPS_CATEGORY,
    lt: String(input.lt),
    val: input.direction,
  }).toString();
}

/**
 * What one write turned out to be.
 *
 * - `applied` — it landed.
 * - `changed` — Colnect answered `410`: the catalogue item changed underneath, which is what its own
 *   handler responds to by reloading the page. One item's problem and not the run's, so it is
 *   reported and stepped over.
 * - `throttled` — `429`. The pace is too fast; the run backs off and comes back to this item.
 * - `unauthorized` — the collector is not signed in on this browser. The run stops: every following
 *   write would fail the same way, and retrying is just noise on somebody else's server.
 * - `stopped` — anything else. ADR-0042's rule: a response this build cannot classify ends the run
 *   rather than being retried blind.
 */
export type ColnectListWriteOutcome =
  | { status: "applied" }
  | { status: "changed" }
  | { status: "throttled"; retryAfterMs: number | null }
  | { status: "unauthorized" }
  | { status: "stopped"; reason: string };

/** How long Colnect asked us to wait, in milliseconds, or null. `Retry-After` is seconds or a date;
 *  both are read, and anything else is treated as "it did not say". */
export function retryAfterMs(header: string | null, now = 0): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - (now || Date.now()));
}

/**
 * Classify one response. Pure, so the whole decision table is asserted without a network.
 *
 * A `2xx` is taken at face value. Colnect answers the checkbox call with a small fragment rather
 * than a status document, and reading that fragment for confirmation would be inventing a contract
 * out of markup that is not part of one — the run's real check is the **next export**, which is the
 * loop this whole track is built on.
 */
export function classifyColnectListWrite(
  status: number,
  headers?: { get(name: string): string | null },
  now?: number
): ColnectListWriteOutcome {
  if (status >= 200 && status < 300) return { status: "applied" };
  if (status === 410) return { status: "changed" };
  if (status === 429) {
    return { status: "throttled", retryAfterMs: retryAfterMs(headers?.get("retry-after") ?? null, now) };
  }
  if (status === 401 || status === 403) return { status: "unauthorized" };
  return { status: "stopped", reason: `Colnect answered HTTP ${status}.` };
}

/**
 * The pace, and how it gives way when Colnect pushes back.
 *
 * **1600 ms** is the measured-safe rate: on the same site, during a bulk close of 3,070 offers,
 * ~4 req/s tripped HTTP 429 while ~0.6 req/s ran all 3,070 with none. A first Swap pass is therefore
 * about an hour and a half, which is the cost of being a polite guest on somebody else's server —
 * and the reason the run is resumable rather than something to sit and watch.
 */
export const COLNECT_WRITE_INTERVAL_MS = 1600;

/** The back-offs, in order, after consecutive `429`s. The run pauses rather than continuing once the
 *  last one has been used: at that point Colnect has said no four times, and the honest answer is to
 *  stop and let the collector start it again later. */
export const COLNECT_WRITE_BACKOFF_MS = [30_000, 60_000, 120_000] as const;

/**
 * How long to wait after a `429`, given how many in a row have now happened (1-based) and whatever
 * `Retry-After` said. Null means *stop*: the back-offs are exhausted.
 *
 * Colnect's own answer wins where it gives one and it is longer — a server saying "wait ninety
 * seconds" is better information than a constant in this file. Shorter is ignored: the whole point
 * of backing off is that the previous pace was too fast.
 */
export function colnectWriteBackoffMs(
  consecutive429s: number,
  serverRetryAfterMs: number | null
): number | null {
  const step = COLNECT_WRITE_BACKOFF_MS[consecutive429s - 1];
  if (step === undefined) return null;
  return serverRetryAfterMs !== null ? Math.max(step, serverRetryAfterMs) : step;
}
