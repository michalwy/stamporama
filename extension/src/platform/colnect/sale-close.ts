// **Closing a Colnect sale** (#729) — the request behind taking one of the collector's own listings
// down, so withdrawing an offer in Stamporama does not leave its Colnect entry up and selling.
//
// ADR-0042 records the authority this runs under; this is the shape of the request, kept pure so what
// is sent — and what an answer is taken to mean — can be asserted in `test:unit` without a browser.
//
// Known since the bulk close of 2026-07-30 (3,070 of this account's own listings closed through it)
// and **not documented or supported by Colnect**:
//
// ```
// POST /<lang>/sell/close_sale
// application/x-www-form-urlencoded: sale_id=<sale code>
// → 200, body starting "OK"   closed
// → 404                       no sale by that code
// ```
//
// Auth is **cookies only** — no CSRF token — which is why it can only ever be issued same-origin from
// a colnect.com page in the collector's own browser, exactly as `list-write.ts` is. The code is the
// one `/<lang>/market/sale/<code>` carries (`listing.ts`), which the instance stores as
// `Offer.colnectSaleId` (#696).
//
// A closed sale is **not gone**: its own page offers to reopen it. That is what makes one request on
// the collector's confirmation a proportionate way to do it, rather than a form for them to submit.

/** Colnect's fallback language, and the one every address in `listing.ts` is built in. */
const DEFAULT_LANG = "en";

/**
 * Where the request goes. Relative for `list-write.ts`'s reason: a content script that built an
 * absolute Colnect URL would be one edit away from posting somewhere else entirely.
 *
 * The language is the page's own (`list-export.ts`'s `colnectLangFromPath`), and anything that is not
 * a two-letter code lands on `en` rather than in the path.
 */
export function colnectCloseSalePath(lang: string): string {
  const code = /^[a-z]{2}$/i.test(lang) ? lang.toLowerCase() : DEFAULT_LANG;
  return `/${code}/sell/close_sale`;
}

/**
 * The form body for closing one sale.
 *
 * Throws on a blank code: `sale_id=` is a request about no listing at all, and the one outcome worth
 * ruling out before anything is sent is a write whose target nobody chose.
 */
export function colnectCloseSaleBody(saleId: string): string {
  const code = saleId.trim();
  if (!code) throw new Error("No Colnect sale code to close.");
  return new URLSearchParams({ sale_id: code }).toString();
}

/**
 * What one close turned out to be.
 *
 * - `closed` — Colnect answered `OK`. The only answer that lets the offer be withdrawn.
 * - `missing` — `404`: no sale by that code, or not one this account can see. Nothing was closed, and
 *   the offer's recorded listing is what is wrong.
 * - `refused` — anything else, including a `200` that does not say `OK`. Colnect's own screens answer
 *   a page that is not signed in, a sale that is paused, and an anti-bot interstitial all with
 *   something other than `OK`, and none of those closed anything — so ADR-0042's rule holds: an answer
 *   this build cannot read is a refusal, never a hopeful success.
 */
export type ColnectCloseSaleOutcome =
  | { status: "closed" }
  | { status: "missing" }
  | { status: "refused"; reason: string };

/** How much of a refusal's body is worth quoting. Colnect answers these with a short sentence; a whole
 *  HTML page is not a sentence, and is summarised instead. */
const QUOTABLE_LENGTH = 200;

/** Read Colnect's answer to one close. */
export function readColnectCloseSaleAnswer(status: number, body: string): ColnectCloseSaleOutcome {
  const text = body.trim();
  // A body *starting* with `OK`, as the bulk close recorded it — not `OK` as a word. A real close of
  // one listing answered `OKKO` (#1292), and reading that as a refusal left an offer Active over a
  // listing Colnect had already taken down.
  if (status === 200 && text.startsWith("OK")) return { status: "closed" };
  if (status === 404) return { status: "missing" };

  const quotable = text.length > 0 && text.length <= QUOTABLE_LENGTH && !/^</.test(text);
  if (status === 200) {
    return {
      status: "refused",
      reason: quotable
        ? `Colnect did not close the listing: ${text}`
        : "Colnect did not confirm the listing was closed. Check that you are signed in to Colnect in this browser.",
    };
  }
  return {
    status: "refused",
    reason: quotable
      ? `Colnect answered HTTP ${status}: ${text}`
      : `Colnect answered HTTP ${status} and did not close the listing.`,
  };
}
