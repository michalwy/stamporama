// **Reading Colnect's marketplace for one item** (#2454) — what the other sellers are asking for a
// stamp, in every condition, so the offer's screen can show where the offers sit instead of the
// collector clicking through each condition and remembering the cheapest.
//
// Mapped from the live site on 2026-11-05, signed in, on item 60512 (69 listings, four conditions, one
// lot) and on the country lists. **None of it is documented or supported by Colnect**, so the shape is
// stated here, pure and unit-tested, and a page that is not the list this expects is a refusal rather
// than an empty strip — "no offers" read off a page that changed shape is a lie about the market.
//
// ```
// GET /en/stamps/marketplace/item/<id>/sort/by_price[/page/<n>]   (200 listings a page)
//   div.sales-list > div._sl-entry                       one listing each
//     a._sl-title[href=/<lang>/market/sale/<code>]       the sale
//     span._t-cond[data-tip=condition_20_<grade>]        its condition; a lot has one per item
//     div._sl-subtitle                                   the seller's own note, often empty
//     div._sl-price span._tip[data-orig-val]             present when Colnect converted the price
//       span._sl-price-currency[content=EUR]             the currency it is shown in (the viewer's)
//       span._sl-price-val[content=0.01]                 the figure
//     a[href=/<lang>/collectors/collector/<login>]       who sells it
//   "The list is empty!"                                 no listings at all
// a.collector_link[href=/<lang>/collectors/collector/<login>]   the signed-in collector, in the header
// ```
//
// The grade is read off `data-tip` and never off the label: the number is the sale form's own option
// value (`COLNECT_CONDITIONS` on the instance), the label is whatever language the page is in.
//
// It **reads only**. The page is fetched same-origin from a colnect.com tab because Colnect's anti-bot
// interstitial refuses anything else (#419), and on the collector's own session because that is the
// view they price against — the currency Colnect shows prices in is theirs.

/** Colnect's own language for the request. English, so the labels carried back (a grade's name, a
 *  converted price's original) read the same whatever language the collector browses Colnect in. */
const MARKET_LANG = "en";

/** How many pages of one item's listings are read at most. Two hundred listings a page; an item with
 *  more than two thousand on sale is not one whose price is decided by the tail. */
export const COLNECT_MARKET_MAX_PAGES = 10;

/** The pause between two pages, or two items, of one read — a person paging through, not a burst. */
export const COLNECT_MARKET_INTERVAL_MS = 1_000;

/**
 * Where one page of an item's listings is. Relative, for `list-write.ts`'s reason: a content script
 * that built an absolute address would be one edit away from asking some other site. Throws on an id
 * that is not a plain Colnect item id, which would otherwise put an arbitrary string into a path.
 */
export function colnectMarketPath(colnectId: string, page = 1): string {
  const id = colnectId.trim();
  if (!/^\d+$/.test(id)) throw new Error(`Not a Colnect item id: ${colnectId}`);
  const base = `/${MARKET_LANG}/stamps/marketplace/item/${id}/sort/by_price`;
  return page > 1 ? `${base}/page/${page}` : base;
}

/** One listing of the item, as the page printed it. */
export interface ColnectMarketOfferRead {
  /** Colnect's code for the sale, off `/market/sale/<code>` — what an offer here stores as
   *  `colnectSaleId`, which is how the instance knows a listing is the collector's own. */
  saleCode: string | null;
  /** The sale form's option value for the condition (`"4"` for Used), or null where the page named
   *  one this reader could not place. */
  grade: string | null;
  /** The condition as the page names it (`U - Used`), for a grade the instance has no name for. */
  gradeLabel: string | null;
  /** The figure, as a plain decimal string (`0.01`). */
  amount: string;
  /** ISO 4217 code of the currency the figure is in — the one Colnect shows the viewer prices in. */
  currency: string;
  /** What the seller actually asks, where Colnect converted it (`A$ 0.01`); null when it did not. */
  originalPrice: string | null;
  /** The seller's login, off their profile link. */
  seller: string | null;
  /** The seller's own words about the piece, where they wrote any. */
  note: string | null;
}

/** One page of an item's listings. */
export interface ColnectMarketPageRead {
  /** The login Colnect greets in its header — whose own listings these may include. */
  signedInAs: string | null;
  offers: ColnectMarketOfferRead[];
  /** Listings of several items — a lot's price is not this item's, so they are counted, not read. */
  lots: number;
  /** Listings whose price could not be read. Counted so a strip with holes in it says so. */
  unreadable: number;
  /** The highest page number the page links to — 1 when it has no paging. */
  lastPage: number;
}

/** A page that is not the list this reader knows — a sign-in, an interstitial, a redesign. */
export class ColnectMarketPageError extends Error {}

/** The ISO code for the few currency signs Colnect prints, for a price whose `content` attribute is
 *  missing. Only unambiguous signs: a bare `$` is several currencies, and a wrong one is a wrong
 *  price. */
const CURRENCY_SIGNS: Readonly<Record<string, string>> = {
  "€": "EUR",
  "£": "GBP",
  "zł": "PLN",
  "US$": "USD",
  "A$": "AUD",
  "C$": "CAD",
  "CHF": "CHF",
};

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function loginOf(href: string | null | undefined): string | null {
  const m = /\/collectors\/collector\/([^/?#]+)/.exec(href ?? "");
  return m ? decodeURIComponent(m[1]) : null;
}

function saleCodeOf(href: string | null | undefined): string | null {
  const m = /\/market\/sale\/([^/?#]+)/.exec(href ?? "");
  return m ? decodeURIComponent(m[1]) : null;
}

/** A figure as a plain decimal, or null — Colnect prints `0.01`, but a thousands separator or a
 *  decimal comma must not turn `1,200.00` into 1.2. */
function amountOf(raw: string | null | undefined): string | null {
  let s = (raw ?? "").replace(/\s| /g, "");
  if (!s) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? s : null;
}

function readOffer(entry: Element): ColnectMarketOfferRead | "lot" | null {
  const conditions = [...entry.querySelectorAll('[data-tip^="condition_"]')];
  // A lot lists one condition per item it holds, under "Items in this listing:". Its price is for all
  // of them, so it says nothing about what this one stamp is being asked.
  if (conditions.length > 1 || /Items in this listing/i.test(text(entry))) return "lot";

  const priceBox = entry.querySelector('[class~="_sl-price"]');
  const valueEl = priceBox?.querySelector('[class~="_sl-price-val"]');
  const currencyEl = priceBox?.querySelector('[class~="_sl-price-currency"]');
  const amount = amountOf(valueEl?.getAttribute("content")) ?? amountOf(text(valueEl));
  const sign = text(currencyEl);
  const currency =
    (currencyEl?.getAttribute("content") ?? "").trim().toUpperCase() || CURRENCY_SIGNS[sign] || "";
  if (!amount || !/^[A-Z]{3}$/.test(currency)) return null;

  const cond = conditions[0] ?? null;
  const grade = /^condition_\d+_(\d+)$/.exec(cond?.getAttribute("data-tip") ?? "")?.[1] ?? null;

  const converted = priceBox?.querySelector("[data-orig-val]") ?? null;
  let originalPrice: string | null = null;
  if (converted) {
    const tip = (converted.getAttribute("data-tip-text") ?? "").replace(/<[^>]*>/g, " ");
    originalPrice = tip.replace(/\s+/g, " ").replace(/^.*?Original price:\s*/i, "").trim() || null;
  }

  const saleLink =
    entry.querySelector('a[class~="_sl-title"][href*="/market/sale/"]') ??
    entry.querySelector('a[href*="/market/sale/"]');
  const sellerLink = entry.querySelector('a[href*="/collectors/collector/"]');
  const note = text(entry.querySelector('[class~="_sl-subtitle"]'));

  return {
    saleCode: saleCodeOf(saleLink?.getAttribute("href")),
    grade,
    gradeLabel: text(cond) || null,
    amount,
    currency,
    originalPrice,
    seller: loginOf(sellerLink?.getAttribute("href")),
    note: note || null,
  };
}

/**
 * Read one page of an item's market list.
 *
 * Throws {@link ColnectMarketPageError} on a page that is neither a list of listings nor Colnect's
 * own "The list is empty!" — the one answer that must never come back from a page this cannot read
 * is *nobody is selling it*.
 */
export function readColnectMarketPage(doc: Document): ColnectMarketPageRead {
  const list = doc.querySelector('[class~="sales-list"]');
  const empty = /The list is empty/i.test(doc.body?.textContent ?? "");
  if (!list && !empty) {
    throw new ColnectMarketPageError(
      "The Colnect page did not show a market list. Check that you are signed in to Colnect in this browser."
    );
  }

  const signedInAs = loginOf(doc.querySelector('a[class~="collector_link"]')?.getAttribute("href"));

  const offers: ColnectMarketOfferRead[] = [];
  const seen = new Set<string>();
  let lots = 0;
  let unreadable = 0;
  // Direct children only: Colnect also draws "Sale listings you might like" with the same entry
  // markup, and those are other stamps.
  for (const entry of list ? [...list.children] : []) {
    if (!entry.matches('[class~="_sl-entry"]')) continue;
    const read = readOffer(entry);
    if (read === "lot") lots += 1;
    else if (read === null) unreadable += 1;
    else {
      // A featured listing is drawn at the head of the list as well as in its place.
      if (read.saleCode) {
        if (seen.has(read.saleCode)) continue;
        seen.add(read.saleCode);
      }
      offers.push(read);
    }
  }

  let lastPage = 1;
  for (const a of doc.querySelectorAll('a[href*="/marketplace/"][href*="/page/"]')) {
    const n = Number(/\/page\/(\d+)/.exec(a.getAttribute("href") ?? "")?.[1]);
    if (Number.isInteger(n) && n > lastPage) lastPage = n;
  }

  return { signedInAs, offers, lots, unreadable, lastPage };
}
