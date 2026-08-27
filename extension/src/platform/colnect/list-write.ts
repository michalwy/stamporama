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

// ── Quantity and grade (#704) ────────────────────────────────────────────────
//
// ADR-0042 wrote membership and nothing else, on the reasoning that a stamp with three copies of two
// grades has no single Colnect grade to send. That reasoning has two holes, and #704 is both of them.
//
// The first is that **Colnect holds several conditions per list entry** — a row per grade, up to one
// for each — so three copies of two grades do have an honest answer over there: two rows. The
// feature is recent enough that ADR-0042 was written as though it did not exist.
//
// The second is that **not writing a grade is not the same as leaving it alone.** On an entry that
// already exists, silence does preserve it. On one the run has just created there is nothing to
// preserve, and silence hands the decision to the list's own defaults — `1/MNH` on Collection, Swap
// and Wish, `1/U` on Sell — which is exactly the `1 × MNH` the collector reported.
//
// Read off `m.115.js` and then **verified live** on 2026-08-27 against one item, because one thing
// here could not be read out of the site's own code: whether `act=check` with `val=+` is a harmless
// re-assertion for an item already on the list. It is not. It **resets that entry to the list's
// defaults** — the probe turned `8 × MNH` into `1 × U`. So there is no safe read of an existing
// entry, and this file deliberately offers no way to build one: what it plans is the correction of
// an addition the run has just made, whose state came back in the `check` answer itself.
//
// Note also that `act=x_cond_qty`, which ADR-0042 named as the quantity-and-grade act, **removes** a
// condition row. The setters are `act=cond` and `act=quantity`, and `val` is a nested object jQuery
// serialises as `val[qty]` / `val[cond]`.

/** One `(grade, count)` row of a Colnect list entry. `cond` is Colnect's condition id — 1 MNH,
 *  2 MH, 3 MNG, 4 U, 5 CTO, and **0 meaning the row states no grade at all**. */
export interface ColnectCondQty {
  cond: number;
  qty: number;
}

/**
 * What Colnect said the entry holds, out of the answer to `act=check&val=+`.
 *
 * The body is an array of quantities **indexed by condition id** — `[0,0,0,0,1,0]` is one Used —
 * which is the shape Colnect's own handler reads it as (`toggleNoteEditControls` walks the keys and
 * takes the first non-zero). An object keyed the same way is read too, since `for…in` cannot tell
 * the two apart and this build should not either.
 *
 * `null` means *that was not an answer about an entry*: the string `"limit"` (the list is full), a
 * sign-in page, an empty body. The caller reports and stops rather than correcting a guess.
 */
export function readColnectEntryRows(body: string): ColnectCondQty[] | null {
  const text = body.trim();
  if (!text) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;

  const rows: ColnectCondQty[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const cond = Number(key);
    const qty = Number(value);
    if (!Number.isInteger(cond) || cond < 0 || !Number.isFinite(qty)) continue;
    if (qty > 0) rows.push({ cond, qty: Math.trunc(qty) });
  }
  return rows;
}

/**
 * One correction to an entry.
 *
 * - `cond` — give a row a grade. With `previousCond` it **re-grades that row**; without, it **adds**
 *   one, which is how a second grade gets onto an entry at all. `qtyOnly` carries Colnect's own
 *   `x_qty_only`, which marks the row it is replacing as one that stated a count and no grade.
 * - `quantity` — set the count of the row whose grade is `cond`.
 * - `x_cond_qty` — remove that grade's row entirely.
 */
export type ColnectCondQtyStep =
  | { act: "cond"; cond: number; qty: number; previousCond: number | null; qtyOnly: boolean }
  | { act: "quantity"; cond: number; qty: number }
  | { act: "x_cond_qty"; cond: number };

/**
 * How to get from what Colnect made of an addition to what this collection actually holds.
 *
 * **An empty `desired` plans nothing.** That is the case where this side has no grade it can state —
 * every copy is in a condition with no Colnect mapping (#404) — and the collector's rule for it is
 * *do not send, report it*. Writing a count against a grade nobody chose would be the same invention
 * this whole track refuses.
 *
 * A grade Colnect has and this collection does not is **re-targeted rather than removed and re-added**
 * where there is a grade waiting for a row: it is one request instead of two, and it is what the
 * site's own controls do. Only a surplus row is dropped.
 *
 * The counts come last, and only where Colnect did not already have that grade at that count. The
 * `cond` call carries a count too, but whether the server writes it is not knowable from the site's
 * code — so a row whose grade *and* count both had to change gets both calls, the collector's own
 * ruling, and a row that landed right costs nothing at all. That second part is what keeps a run's
 * length honest: on a Swap list whose default is already `1/MNH`, most additions plan no steps.
 */
export function planColnectCondQty(
  current: readonly ColnectCondQty[],
  desired: readonly ColnectCondQty[]
): ColnectCondQtyStep[] {
  if (desired.length === 0) return [];

  const held = new Map(current.filter((row) => row.qty > 0).map((row) => [row.cond, row.qty]));
  const wanted = new Map(desired.filter((row) => row.qty > 0).map((row) => [row.cond, row.qty]));
  if (wanted.size === 0) return [];

  const surplus = [...held.keys()].filter((cond) => !wanted.has(cond));
  const missing = [...wanted.keys()].filter((cond) => !held.has(cond));

  const steps: ColnectCondQtyStep[] = [];
  for (const cond of missing) {
    // A row this entry no longer needs is the row this grade goes on. A `0` there is Colnect's
    // "no grade stated", which its own controls re-grade with `x_qty_only` instead of `x_prev_cond`.
    const replaces = surplus.shift();
    steps.push({
      act: "cond",
      cond,
      qty: wanted.get(cond) as number,
      previousCond: replaces !== undefined && replaces > 0 ? replaces : null,
      qtyOnly: replaces === 0,
    });
  }
  for (const cond of surplus) steps.push({ act: "x_cond_qty", cond });

  for (const [cond, qty] of wanted) {
    if (held.get(cond) !== qty) steps.push({ act: "quantity", cond, qty });
  }
  return steps;
}

/** The form body for one {@link ColnectCondQtyStep}. Same endpoint as membership, same category, and
 *  the same rule that it is only ever issued same-origin from a colnect.com page. */
export function colnectCondQtyBody(input: {
  colnectId: string;
  lt: number;
  step: ColnectCondQtyStep;
}): string {
  const params = new URLSearchParams({
    act: input.step.act,
    id: input.colnectId,
    cat: STAMPS_CATEGORY,
    lt: String(input.lt),
  });
  if (input.step.act === "x_cond_qty") {
    // The odd one out: a scalar `val`, exactly as the membership call takes one.
    params.set("val", String(input.step.cond));
    return params.toString();
  }
  // jQuery serialises the nested `val` object as `val[qty]` / `val[cond]`, and Colnect's handler
  // reads it back that way. Written out rather than run through a serialiser, so what goes on the
  // wire is legible in one place.
  params.set("val[qty]", String(input.step.qty));
  params.set("val[cond]", String(input.step.cond));
  if (input.step.act === "cond") {
    if (input.step.previousCond !== null) {
      params.set("val[x_prev_cond]", String(input.step.previousCond));
    }
    if (input.step.qtyOnly) params.set("val[x_qty_only]", "true");
  }
  return params.toString();
}
