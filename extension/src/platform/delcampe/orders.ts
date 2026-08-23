// Reading one of Delcampe's **My Sold Items** screens (#612).
//
// The collector is standing on the screen they pack from, and every question this module answers is
// one that screen already answers to a person: which order is this, what is in it, who bought it,
// what did they pay. What it never answers is what any of that *means* — the instance decides that
// (#409), so everything below is either an id off an address or text exactly as printed.
//
// **Anchored on addresses.** Delcampe's class names are not hashed per build the way Allegro's are
// (#355), but an address is what a page is *about* and a class is what it looked like the day this
// was written. So an order is `…/payment-request/<id>` or `…/bills/<id>/…`, an item is
// `…/item/<id>.html`, a buyer is `…/user/profile/<id>-<login>`, and the blocks are found by
// **containment**: the nearest ancestor of an item link that holds an order link is that item's
// order. One rule then covers every phase screen — `list`, `to-invoice`, `invoiced`, `to-send`,
// `sent` and `archived` differ only in which `bills/<id>/status/<transition>` links they offer,
// which is a fact about the order rather than about the page.
//
// Two things have no address and are read from **content** instead: an amount is a leaf whose whole
// text is a currency figure, and a date is a leaf that reads as one. Whole-leaf, deliberately: a
// stamp titled `USA $5 Liberty` contains something that looks like a price, and a title is never a
// leaf that is *only* a price. Everything the reader is unsure of comes back null, and the instance
// refuses the order by name rather than importing a sale built on a guess.
//
// Pure DOM, like every other half — unit-tested under `linkedom` against markup saved off the live
// screens.

import type { PlatformOrder, PlatformOrderLine } from "../orders";

/** The seller's own sold-order screens. `collectables` is the en_GB spelling and `collectibles` the
 *  en_US one; both are the same pages. */
const SOLD_ITEMS_URL = /\/collect(?:ables|ibles)\/sell\/sold-items(?:\/|$|\?)/i;

/** An order, wherever the block names it: the payment request the row leads with, or one of the
 *  `bills/<id>/…` actions beside it. Both name the same order and a block always carries several. */
const ORDER_HREF = /\/(?:payment-request|bills)\/(\d+)/;

/** The order's own page — the address the mark links to and the row's own identifier. Matched
 *  without a trailing path segment, so `…/payment-request/<id>/printBill` is not mistaken for it. */
const ORDER_PAGE_HREF = /\/payment-request\/(\d+)$/;

/** One listing, by Delcampe's own `id_auction` — the id #611 stored on `Offer.delcampeItemId`, which
 *  is what makes the instance's match exact. */
const ITEM_HREF = /\/item\/(\d+)\.html/;

/** A buyer's profile: Delcampe's own member id, then their login. */
const PROFILE_HREF = /\/user\/profile\/(\d+)-([^/?#]+)/;

/**
 * The currency symbols worth **recognising a price by**. Not a currency table — which code a symbol
 * means is the instance's decision, and it keeps its own list. This one only has to answer "is this
 * leaf a price?", which is why a bare `$` belongs here and does not belong there.
 */
const SYMBOLS = "(?:US\\$|CA\\$|AU\\$|C\\$|A\\$|CHF|kr|zł|€|£|\\$|¥)";

/** A leaf whose **whole** text is one printed amount, with or without the `±` Delcampe marks its own
 *  conversions with, and with the symbol on either side of the figure. */
const WHOLE_AMOUNT = new RegExp(
  `^\\s*[±~≈]?\\s*(?:${SYMBOLS}\\s*[\\d.,\\s]+|[\\d.,\\s]+\\s*${SYMBOLS})\\s*$`,
  "i"
);

/** A leaf that reads as a date — `Sun 22 Mar 2026`. Which day that is, and whether the month is one
 *  this app can read at all, is the instance's answer. */
const READS_AS_DATE = /\b\d{1,2}\s+[A-Za-z]{3,}\.?\s+\d{4}\b/;

/** Delcampe's label in front of the seller's own reference, in the languages the screens are read
 *  in here. Stripped so the instance receives the reference itself — after #610 an offer's own short
 *  URL, which is matched on its path. */
const REFERENCE_LABEL = /^\s*(?:ref|réf|rif)\.?\s*:?\s*/i;

export function matchesDelcampeSoldItemsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(^|\.)delcampe\.net$/i.test(parsed.hostname) && SOLD_ITEMS_URL.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Every element under `root` with no children of its own — where a page's text actually is. */
function leaves(root: Element): Element[] {
  return [...root.querySelectorAll("*")].filter((element) => element.children.length === 0);
}

function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The distinct order ids named anywhere inside `element`. */
function orderIdsIn(element: Element): string[] {
  const ids = new Set<string>();
  for (const anchor of element.querySelectorAll("a[href]")) {
    const match = ORDER_HREF.exec(anchor.getAttribute("href") ?? "");
    if (match) ids.add(match[1]);
  }
  return [...ids];
}

function itemAnchorsIn(root: Element | Document): Element[] {
  return [...root.querySelectorAll("a[href]")].filter((anchor) =>
    ITEM_HREF.test(anchor.getAttribute("href") ?? "")
  );
}

/**
 * The order block an item row belongs to: the nearest ancestor that names exactly one order.
 *
 * Nearest, so the whole page — which names every order on it — is never mistaken for a block; and
 * exactly one, so an ancestor that turns out to hold two orders is treated as no answer rather than
 * as an arbitrary one.
 */
function blockOf(itemAnchor: Element): { block: Element; orderId: string } | null {
  let element = itemAnchor.parentElement;
  while (element) {
    const ids = orderIdsIn(element);
    if (ids.length === 1) return { block: element, orderId: ids[0] };
    if (ids.length > 1) return null;
    element = element.parentElement;
  }
  return null;
}

/**
 * The row one item sits in: the highest ancestor that still holds this item and no order link.
 *
 * The second half is what keeps a **single-item** order honest. There the whole block holds exactly
 * one item link, so climbing on "one item link" alone would swallow the order header — and the row's
 * price would then be read off the order's total, which on a Delcampe screen is a different figure
 * in a different currency.
 */
function rowOf(itemAnchor: Element): Element {
  let row = itemAnchor;
  while (
    row.parentElement &&
    itemAnchorsIn(row.parentElement).length === 1 &&
    orderIdsIn(row.parentElement).length === 0
  ) {
    row = row.parentElement;
  }
  return row;
}

/** The amounts printed inside `root`, in document order, excluding anything inside `skip`. */
function amountsIn(root: Element, skip: readonly Element[] = []): string[] {
  return leaves(root)
    .filter((leaf) => !skip.some((area) => area.contains(leaf)))
    .map(textOf)
    .filter((text) => WHOLE_AMOUNT.test(text));
}

function readLine(itemAnchor: Element): PlatformOrderLine | null {
  const href = itemAnchor.getAttribute("href") ?? "";
  const id = ITEM_HREF.exec(href);
  if (!id) return null;
  const row = rowOf(itemAnchor);

  // The first whole-leaf amount in the row is what the buyer paid. A discounted row prints three —
  // the price paid, Delcampe's conversion of it, then the original struck through — and the paid one
  // leads, which is also the order a person reads them in.
  const [priceText] = amountsIn(row);
  const date = leaves(row).map(textOf).find((text) => READS_AS_DATE.test(text)) ?? null;

  const referenceLeaf =
    row.querySelector('[class*="personal-reference"]') ??
    leaves(row).find((leaf) => REFERENCE_LABEL.test(textOf(leaf))) ??
    null;
  const reference = referenceLeaf ? textOf(referenceLeaf).replace(REFERENCE_LABEL, "").trim() : "";

  return {
    platformItemId: id[1],
    title: textOf(itemAnchor),
    reference: reference || null,
    priceText: priceText ?? null,
    soldAtText: date,
    // Delcampe prints one row per copy, so a row is one item and there is no count to read (#698).
    quantityText: null,
  };
}

/**
 * Read every order block on a sold-items page.
 *
 * The buyer is **a login and a name**, and that is a rule rather than an omission: the same block
 * carries the shipping address and a link that opens Delcampe's message relay, and what is never
 * read can never be stored. The login comes off the profile address — the one form of it that is
 * not a display string — and the name is the line printed under it.
 */
export function readDelcampeOrders(doc: Document, pageUrl: string): PlatformOrder[] {
  const byBlock = new Map<Element, { orderId: string; anchors: Element[] }>();
  for (const anchor of itemAnchorsIn(doc)) {
    const found = blockOf(anchor);
    if (!found) continue;
    const entry = byBlock.get(found.block);
    if (entry) entry.anchors.push(anchor);
    else byBlock.set(found.block, { orderId: found.orderId, anchors: [anchor] });
  }

  const orders: PlatformOrder[] = [];
  for (const [block, { orderId, anchors }] of byBlock) {
    const orderAnchor = [...block.querySelectorAll("a[href]")].find((candidate) =>
      ORDER_PAGE_HREF.test((candidate.getAttribute("href") ?? "").split("?")[0])
    );
    if (!orderAnchor) continue;

    const lines = anchors.flatMap((anchor) => {
      const line = readLine(anchor);
      return line ? [line] : [];
    });
    if (lines.length === 0) continue;

    const profile = [...block.querySelectorAll("a[href]")]
      .map((anchor) => PROFILE_HREF.exec(anchor.getAttribute("href") ?? ""))
      .find((match): match is RegExpExecArray => match !== null);
    const profileAnchor = profile
      ? ([...block.querySelectorAll("a[href]")].find((anchor) =>
          (anchor.getAttribute("href") ?? "").includes(profile[0])
        ) ?? null)
      : null;

    // Every amount in the order's own header, none of them from a row: Delcampe prints the total
    // twice — once converted into the screen's display currency (`± €13.95`) and once in the
    // currency the listings were in (`US$16.15`) — and which of those a sale may be anchored on is
    // the instance's decision, so both are reported.
    const rows = anchors.map(rowOf);
    orders.push({
      orderId,
      orderUrl: absolute(orderAnchor.getAttribute("href") ?? "", pageUrl),
      buyerLogin: profile ? decodeLogin(profile[2]) : null,
      buyerName: profileAnchor ? nameBeside(profileAnchor) : null,
      totalTexts: amountsIn(block, rows),
      // Delcampe dates its **rows** and states no delivery method on any of them (ADR-0038 §6), so
      // both order-level fields are empty here and the sale's date comes from the rows.
      soldAtText: null,
      shippingMethodText: null,
      lines,
      // Every phase screen states the whole order — the six differ only in which status transitions
      // they offer — so there is no Delcampe screen that may only be marked and not imported.
      canImport: true,
      anchor: orderAnchor,
      // Beside the row's own order link, which is where the row already says which order it is.
      markPlacement: "after",
    });
  }
  return orders;
}

/** The order's own address, without the list filter Delcampe appends to it: `?list=seller-sent` says
 *  which screen the collector came from, which is not part of where the order is. */
function absolute(href: string, pageUrl: string): string {
  try {
    const url = new URL(href.split("?")[0], pageUrl);
    return url.toString();
  } catch {
    return href;
  }
}

function decodeLogin(login: string): string {
  try {
    return decodeURIComponent(login);
  } catch {
    return login;
  }
}

/**
 * The name printed beside the buyer's login.
 *
 * Found by climbing from the profile link to the first ancestor that holds a paragraph, which is
 * where Delcampe puts it — a rule about the *shape* of the block rather than about a class name, and
 * one that answers null rather than something else when the shape changes. A sale with no name is a
 * sale filed under the login, which is how buyers are filed here anyway (#463).
 */
function nameBeside(profileAnchor: Element): string | null {
  let box: Element | null = profileAnchor;
  for (let depth = 0; depth < 5 && box?.parentElement; depth += 1) {
    box = box.parentElement;
    const paragraph = box.querySelector("p");
    if (paragraph) {
      const name = textOf(paragraph);
      return name || null;
    }
  }
  return null;
}
