// Reading one of Colnect's own **transaction** screens (#698).
//
// The second marketplace to carry the orders half (#612), and the second half Colnect's module
// carries: the collector is standing on the screen they pack from, and the question it cannot answer
// is whether this transaction is already written down here.
//
// Colnect prints a transaction in **two places** and only one of them completely. The detail
// (`/<locale>/transaction/show/id/<id>`) states the whole order — every listing, the buyer, the
// totals and the shipping method — while the list (`/<locale>/transaction/list`) truncates its items
// (`+ 12 more listings`). So the detail is read as an order that may be recorded and the list as one
// that may only be **answered** (`canImport`): a sale written from a truncated list would be missing
// lines it should have carried, which is exactly what ADR-0038 §3 refuses.
//
// **Anchored on addresses**, like Delcampe's reader and for its reasons: the order off
// `transaction/show/id/<id>` — accepted with *and without* a locale segment, since the list's own
// *Details* href carries none while every other address on the detail page does — each item off
// `market/sale/<code>` (which is `Offer.colnectSaleId`, #696, the only join the instance has), and
// the buyer off `collectors/collector/<login>`.
//
// What has no address is read from its **printed label** — `Item count:`, `Started:`,
// `Shipping method:`, and the four labelled figures of the totals block — and reported with the
// label still attached where the label is what tells two figures apart. That is reading, not
// deciding: `Items total € 9.97` and `Total with shipping € 12.00` are different claims and dropping
// the words would hand the instance four numbers and no way to tell which the buyer paid.
//
// It decides nothing else (#409). Which currency `€ 0.46` is, what day `August 23, 2026 2:21 PM`
// was, which offer each row is and whether the transaction may be recorded at all are the instance's
// answers, in `colnect-order-rules.ts` where they are unit-tested.
//
// Pure DOM, like every other half — tested under `linkedom`.

import type { PlatformOrder, PlatformOrderLine } from "../orders";

/** The transaction's own page: the one screen that states a whole order. The locale segment is
 *  optional because Colnect's own list links it without one. */
const TRANSACTION_DETAIL = /^(?:\/[a-z]{2})?\/transaction\/show\/id\/([^/?#]+)\/?$/i;

/** The seller's list of transactions — marked, never imported from: it truncates its items. */
const TRANSACTION_LIST = /^(?:\/[a-z]{2})?\/transaction\/list(?:\/|$)/i;

/** One listing, by the opaque sale code Colnect names it with — the code #696 stores on
 *  `Offer.colnectSaleId`, and the only thing a transaction row states about which offer it is. */
const SALE_HREF = /(?:^|\/)(?:[a-z]{2}\/)?market\/sale\/([^/?#]+)/i;

/** A collector's own page: their login, which is what a buyer is filed under here (#463). */
const COLLECTOR_HREF = /(?:^|\/)(?:[a-z]{2}\/)?collectors\/collector\/([^/?#]+)/i;

/** Currency symbols worth **recognising a figure by** — not a currency table, which is the
 *  instance's (`colnect-order-rules.ts`). This one only answers "is this leaf an amount?". */
const SYMBOLS = "(?:US\\$|CA\\$|AU\\$|C\\$|A\\$|CHF|kr|zł|€|£|\\$|¥)";

/** A leaf whose **whole** text is one printed figure, with the minus Colnect marks a discount with
 *  and the symbol on either side. Whole-leaf for Delcampe's reason: a stamp titled `USA $5 Liberty`
 *  contains something price-shaped, and a title is never a leaf that is *only* a price. */
const WHOLE_AMOUNT = new RegExp(
  `^\\s*[-−±~≈]?\\s*(?:${SYMBOLS}\\s*-?[\\d.,\\s]+|-?[\\d.,\\s]+\\s*${SYMBOLS})\\s*$`,
  "i"
);

/**
 * The labels this page prints, as a value's **right-hand boundary**.
 *
 * A value ends where the next label begins, and it has to be said explicitly because the smallest
 * element holding a label may hold the label after it too — Colnect writes the header as one flat
 * line of `<b>` labels and bare text, so "the text after `Buyer:`" is otherwise the buyer, the date
 * and everything below them.
 *
 * A label of the page, not any word with a colon after it: `Shipping method: Stamps→domestic:
 * Registered mail` carries a colon of its own inside the value, and cutting at that one would file
 * half a method name.
 */
const NEXT_LABEL =
  /\b(?:Buyer|Started|Shipping method|Shipping price|Item count|Item condition|Catalog codes|Sale status|Items total|Discount|Total with shipping)\s*[::]/i;

const ITEM_COUNT_LABEL = /^item count\b/i;
const STARTED_LABEL = /^started\b/i;
const SHIPPING_METHOD_LABEL = /^shipping method\b/i;
const BUYER_LABEL = /^\s*buyer\s*[::]?\s*/i;

/** How the totals block names itself. A class, and therefore a hint rather than the rule: it is
 *  tried first and the labels are what actually find the figures when it is gone. */
const TOTALS_CLASS = '[class~="_t-transaction-price"]';

/** How a row names its own price, on the same terms as the block above. */
const ROW_PRICE_CLASS = '[class~="_sl-price"]';

/** How a row names itself, likewise: preferred when present, and a climb from the listing's own link
 *  when it is not. */
const ROW_CLASS = '[class~="_sl-entry"]';

export function matchesColnectTransactionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)colnect\.com$/i.test(parsed.hostname)) return false;
    return TRANSACTION_DETAIL.test(parsed.pathname) || TRANSACTION_LIST.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * An element's own text, stopping at the **list** inside it.
 *
 * `Shipping method:` is why: Colnect prints the method's name and then its whole price ladder in one
 * block, and the smallest element holding the label holds the ladder with it — so the sale was
 * recorded with `Registered mail (Poczta Polska)1-100 items - € 2.40101-500 items…` as the method's
 * name. A value is the line the label introduces, and a list beneath it is the next thing on the
 * page rather than more of the value.
 */
function textUpToList(element: Element): string {
  let text = "";
  const walk = (node: Element): boolean => {
    for (const child of node.childNodes) {
      if (child.nodeType === 1) {
        const tag = (child as Element).tagName.toLowerCase();
        if (tag === "ul" || tag === "ol" || tag === "li" || tag === "table" || tag === "br") {
          return false;
        }
        if ((child as Element).matches(OWN_MARKUP)) continue;
        if (!walk(child as Element)) return false;
      } else {
        text += child.textContent ?? "";
      }
    }
    return true;
  };
  walk(element);
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Tags whose text a **reader never sees**: a script's source, a stylesheet, a template's contents.
 *
 * Excluded from every scan below, and that is not tidiness. `textContent` reports a script's source
 * as text, so an inline `<script>` mentioning the transaction id is a smaller "element naming this
 * order" than the heading is — and the mark went inside it, where nothing is drawn. The same trap is
 * open for every label: a script saying `Buyer:` would answer for the page.
 */
const UNRENDERED = new Set(["script", "style", "noscript", "template", "head", "title", "iframe"]);

/**
 * The Assistant's own markup, skipped by every read.
 *
 * The mark now sits **inside** the line it answers about, so a re-scan — a page rewrites itself and
 * the watcher looks again — would otherwise read `Started: August 23, 2026 2:21 PM Import` and hand
 * the instance a date with a word of ours on the end. Mirrored as a literal rather than imported
 * from the shell for the reason every other contract here is: a platform module knows the page, not
 * the extension around it.
 */
const OWN_MARKUP = "[data-stamporama-order], [data-stamporama-order-dialog]";

function isRendered(element: Element): boolean {
  return !UNRENDERED.has(element.tagName.toLowerCase());
}

/**
 * Whether the page actually **draws** `element` — asked of the document itself, and only where the
 * document can answer.
 *
 * A tag list catches a `<script>`; it does not catch the copy of the page's title that Colnect keeps
 * in its header under `visibility: hidden`, which is a *shorter* element naming this transaction
 * than the heading is — the mark went inside it, present in the DOM, findable by selector, and
 * invisible to the person it was drawn for.
 *
 * **Computed style, not the layout box.** `getClientRects()` reports a rectangle for a
 * `visibility: hidden` element, which is exactly the case that hid the mark; `display` and
 * `visibility` are the page's own answer. Both are read, and where the document has neither — the
 * `linkedom` documents these rules are tested against — every element passes, so the reading is the
 * same whether or not anyone is looking at it. Asked **after** the text has already narrowed the
 * candidates to a handful, since a computed style is a style recalculation and this runs on somebody
 * else's page.
 */
function isDrawn(element: Element): boolean {
  const inline = element.getAttribute("style") ?? "";
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(inline)) return false;

  const view = element.ownerDocument?.defaultView as
    | { getComputedStyle?: (element: Element) => { display?: string; visibility?: string } }
    | null
    | undefined;
  if (typeof view?.getComputedStyle !== "function") return true;
  const style = view.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

/** Every rendered element under `root`, itself included — what the scans below choose from. */
function elementsIn(root: Element): Element[] {
  return [root, ...root.querySelectorAll("*")].filter(
    (element) =>
      isRendered(element) &&
      !element.closest([...UNRENDERED].join(",")) &&
      !element.closest(OWN_MARKUP)
  );
}

/** Every rendered element under `root` with no children of its own — where a page's text actually is. */
function leaves(root: Element): Element[] {
  return elementsIn(root).filter((element) => element.children.length === 0);
}

function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function hrefOf(element: Element): string {
  return element.getAttribute("href") ?? "";
}

/** The sale codes named anywhere inside `element`, distinct and in document order. */
function saleCodesIn(element: Element): string[] {
  const codes = new Set<string>();
  for (const anchor of element.querySelectorAll("a[href]")) {
    const match = SALE_HREF.exec(hrefOf(anchor));
    if (match) codes.add(decodeSegment(match[1]));
  }
  return [...codes];
}

function saleAnchorsIn(root: Element, code: string): Element[] {
  return [...root.querySelectorAll("a[href]")].filter((anchor) => {
    const match = SALE_HREF.exec(hrefOf(anchor));
    return match !== null && decodeSegment(match[1]) === code;
  });
}

/**
 * A line the page printed behind a label, label and all — `Item count: 1`.
 *
 * Read off **elements' own text** rather than leaf by leaf, which is the correction the live page
 * forced: Colnect writes `<b>Started:</b> August 23, 2026 2:21 PM`, where the value is a bare text
 * node beside the label's element and a reader that walks elements sees the label and nothing else.
 * So the line is the **smallest** element whose text begins with the label and says more than it —
 * smallest, because every ancestor's text begins with the label too and the innermost one is the
 * line the page drew.
 *
 * Where no element holds both — Colnect's header is one flat line of `<b>` labels and bare text, so
 * every element containing the second label contains the first — the value is read **forward from
 * the label**, siblings and text nodes alike, up to the next label. Null when the label is not on the
 * page at all, which every rule downstream has an answer for.
 */
function labelledLine(
  root: Element,
  label: RegExp,
  accept: (line: string) => boolean = () => true
): string | null {
  const element = labelledElement(root, label, accept);
  if (element) return textUpToList(element);

  // No element holds both, which is the flat header: `<b>Buyer:</b> … <b>Started:</b> August 23,
  // 2026 2:21 PM`, where every element's text begins with the *first* label. So read **forward from
  // the label itself** through what follows it, stopping at the page's next label.
  const labelElement = leaves(root).find((leaf) => label.test(textOf(leaf)));
  if (!labelElement) return null;
  const value = textAfter(labelElement, root);
  return value ? `${textOf(labelElement)} ${value}`.replace(/\s+/g, " ").trim() : null;
}

/**
 * The text that follows `element` inside its parent, up to the next label.
 *
 * Text **nodes** included, which is the whole point: a value printed beside its label is not an
 * element and a reader walking elements cannot see it. Climbs while nothing follows, so a label
 * wrapped one level deeper than its value is still read, and stops at `root` so it never wanders
 * into the rest of the page.
 */
function textAfter(element: Element, root: Element): string {
  let from: Element | null = element;
  while (from && from !== root) {
    let text = "";
    for (let node = from.nextSibling; node; node = node.nextSibling) text += node.textContent ?? "";
    const value = text.replace(/\s+/g, " ").trim().split(NEXT_LABEL)[0].trim();
    if (value) return value;
    from = from.parentElement;
  }
  return "";
}

/**
 * The **smallest** element whose own text begins with `label` and says more than it — the line the
 * page drew, every one of its ancestors' texts beginning with the label as well.
 *
 * Returned as the element and not only as its text because it is also a **scope**: the buyer's link
 * is the one inside the buyer's own line, and the first `collectors/collector/<login>` link on the
 * page is the collector's *own* greeting in Colnect's site header — which is how the first cut filed
 * a sale under the seller and marked the page banner instead of the transaction.
 */
function labelledElement(
  root: Element,
  label: RegExp,
  accept: (line: string) => boolean = () => true
): Element | null {
  let found: Element | null = null;
  let length = Infinity;
  for (const element of elementsIn(root)) {
    // The cheap test first: an element whose whole text does not begin with the label cannot have a
    // line that does, since the line is a prefix of it. `textContent` is the browser's own and this
    // runs over every element on the page.
    if (!label.test(textOf(element))) continue;
    const text = textUpToList(element);
    if (!label.test(text)) continue;
    if (!valueAfter(text, label)) continue;
    // The smallest line the caller will *take*: one page's label can introduce two different facts,
    // and the shorter is not always the one asked for.
    if (!accept(text)) continue;
    if (text.length < length) {
      found = element;
      length = text.length;
    }
  }
  return found;
}

/** What a labelled line says once its **first** label is off and the **next** label is cut away.
 *  Only the first label goes, because a value may carry a colon of its own — `Shipping method:
 *  Stamps→domestic: Registered mail`. */
function valueAfter(text: string, label: RegExp): string {
  const rest = text.replace(label, "").replace(/^\s*[::]\s*/, "");
  return rest.split(NEXT_LABEL)[0].trim();
}

/**
 * The same line with its **first** label taken off — `Shipping method:` in front of
 * `Stamps→domestic: Registered mail (Poczta Polska)`, whose own colon is why only the first one goes.
 *
 * Used where the label is the page's furniture rather than part of the fact: what is written onto the
 * sale is the method's name, and `Started:` is not part of a date.
 */
function labelledValue(root: Element, label: RegExp): string | null {
  const line = labelledLine(root, label);
  return line === null ? null : valueAfter(line, label) || null;
}

/**
 * The row one listing sits in: the largest ancestor that still names only this listing and is not
 * the transaction itself.
 *
 * Colnect's own `_sl-entry` is tried first — a class is what the page looked like the day this was
 * written, so it is a shortcut and not the rule. The climb that follows stops at anything that
 * names a *second* listing (the next row) and at the transaction's own furniture: the buyer's link
 * and the totals block. That second stop is what keeps a **single-item** transaction honest — there
 * the whole page names one listing, and a row that swallowed the totals would read `Total with
 * shipping` as the stamp's price.
 */
function rowOf(anchor: Element, code: string, scope: readonly Element[]): Element {
  const known = anchor.closest(ROW_CLASS);
  if (known) return known;
  let row: Element = anchor;
  while (row.parentElement) {
    const parent = row.parentElement;
    if (parent.tagName.toLowerCase() === "body") break;
    if (saleCodesIn(parent).some((other) => other !== code)) break;
    if (scope.some((element) => parent.contains(element))) break;
    row = parent;
  }
  return row;
}

/** The amount a row states it sold at, as printed. */
function rowPrice(row: Element): string | null {
  const named = row.querySelector(ROW_PRICE_CLASS);
  const namedText = textOf(named);
  if (namedText && WHOLE_AMOUNT.test(namedText)) return namedText;
  return leaves(row).map(textOf).find((text) => WHOLE_AMOUNT.test(text)) ?? null;
}

/** The labels the transaction's header prints its four figures under. Read by name for the reason
 *  every other field is: the words are what tell one figure from another, and `Items total` and
 *  `Total with shipping` are the same number on a transaction with no postage. */
const TOTAL_LABELS: readonly RegExp[] = [
  /^items total\b/i,
  /^shipping price\b/i,
  /^discount\b/i,
  /^total with shipping\b/i,
];

/**
 * The figures the transaction's own header states, each with the words that say what it is.
 *
 * Read **by those words**, through the same labelled-line rule as `Started:` and `Item count:`, and
 * that is the correction the live page forced. Pairing a bare amount with the text before it —
 * which is what this did first — assumes the figure is one leaf, and Colnect prints
 * `<b>€</b> <b>12.00</b>`: neither half is an amount on its own, so the total the buyer actually
 * paid was never reported at all and the sale was recorded with no anchor (#205) and no handling.
 *
 * An element's text puts the halves back together, which is what a person reading the page sees.
 */
function readTotals(root: Element): string[] {
  return TOTAL_LABELS.flatMap((label) => {
    const line = labelledLine(root, label, statesAnAmount);
    return line ? [line] : [];
  });
}

/** A line that states a figure in money. What `Discount:` needs: Colnect prints the payment method's
 *  `Discount: 3%` as well as the order's own `Discount: -€ 0.37`, and the shorter of the two is the
 *  percentage — which is a rate and not an amount, and belongs to a different question entirely. */
function statesAnAmount(line: string): boolean {
  return readAmountIn(line);
}

/** True when a line states a figure at all — a label with nothing after it is not a total, and a
 *  page that prints one is reporting an empty row rather than an amount. */
function readAmountIn(line: string): boolean {
  return new RegExp(`(?:${SYMBOLS})\\s*-?[\\d.,]*\\d|\\d[\\d.,]*\\s*(?:${SYMBOLS})`, "i").test(line);
}

/**
 * Read the transaction screens for the orders on them.
 *
 * The detail page is one order and the list page is a row per order, and the difference between them
 * is `canImport`: the list states which transaction a row is and nothing about what is in it.
 */
export function readColnectOrders(doc: Document, pageUrl: string): PlatformOrder[] {
  let path: string;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    return [];
  }

  const detail = TRANSACTION_DETAIL.exec(path);
  if (detail) {
    const order = readTransaction(doc, pageUrl, decodeSegment(detail[1]));
    return order ? [order] : [];
  }
  if (TRANSACTION_LIST.test(path)) return readTransactionList(doc, pageUrl);
  return [];
}

/**
 * One transaction, whole, off its own page.
 *
 * The **address states which order this is** — the page carries no link to itself, which is why the
 * id comes from `pageUrl` rather than from an anchor — and the mark therefore hangs on the header,
 * beside the buyer, where a reader is already asking whose parcel this is.
 */
function readTransaction(doc: Document, pageUrl: string, orderId: string): PlatformOrder | null {
  const root = doc.body ?? doc.documentElement;
  if (!root) return null;

  // **Inside the buyer's own line**, and nowhere else. Colnect's site header greets the signed-in
  // collector with a link of exactly this shape, so "the first collector link on the page" is the
  // seller — which filed the first imported sale under its own owner and hung the mark on the
  // banner. No `Buyer:` line, no buyer: better anonymous than somebody else.
  const buyerLine = labelledElement(root, BUYER_LABEL);

  const buyerAnchor =
    [...(buyerLine?.querySelectorAll("a[href]") ?? [])].find((anchor) =>
      COLLECTOR_HREF.test(hrefOf(anchor))
    ) ?? null;
  const totalsBlock = root.querySelector(TOTALS_CLASS);
  // The transaction's own furniture, which a row must never climb into: the buyer's link and the
  // totals block. Both are elements rather than selectors so the climb can ask `contains`.
  const scope = [buyerAnchor, totalsBlock].filter((element): element is Element => element !== null);

  const rows = saleCodesIn(root).map((code) => {
    const anchors = saleAnchorsIn(root, code);
    const row = rowOf(anchors[0], code, scope);
    // Colnect links a row twice — the picture and the title — and only one of them prints the title.
    const title = anchors.map((anchor) => textOf(anchor)).find((text) => text.length > 0) ?? "";
    return { code, row, title };
  });

  const lines: PlatformOrderLine[] = rows.map(({ code, row, title }) => ({
    platformItemId: code,
    title,
    // Colnect prints no seller reference on a transaction row — which is the whole reason #696
    // exists, and why the sale code above is the only join the instance has.
    reference: null,
    priceText: rowPrice(row),
    // The transaction states one date for the whole order, so its rows state none.
    soldAtText: null,
    // As printed, label and all: what a count of more than one means for the price beside it is a
    // decision, and the instance is where decisions are made (#409).
    quantityText: labelledLine(row, ITEM_COUNT_LABEL),
  }));

  // Where the mark goes: the transaction's **own** block — the line saying when it started, or the
  // buyer's line beside it. Both are served in the page's markup, both state a fact about this
  // order, and neither moves: the page's heading turned out to be a worse place than it looks,
  // Colnect keeping a second copy of it in a sticky header that its own script hides *after* the
  // document settles, so a mark drawn at idle went into an element that was about to disappear. The
  // heading stays as the fallback for a page that states no such block.
  const startedLine = labelledElement(root, STARTED_LABEL);
  const inside = startedLine ?? buyerLine ?? headingOf(root, orderId);
  const anchor = inside ?? buyerAnchor ?? startedLeaf(root);
  if (!anchor) return null;

  return {
    orderId,
    // The page's own address, without the query: the detail page links to itself nowhere, so where
    // the collector is standing *is* the statement of which order this is.
    orderUrl: pageUrl.split("?")[0],
    buyerLogin: buyerLoginOf(buyerAnchor),
    buyerName: buyerNameBeside(root, buyerAnchor),
    totalTexts: readTotals(totalsBlock ?? root),
    soldAtText: labelledValue(root, STARTED_LABEL),
    shippingMethodText: shippingMethodOf(root),
    lines,
    canImport: true,
    anchor,
    // Inside, because each of those *states* its fact as text — there is no element to sit beside,
    // and after the line is the line below it.
    markPlacement: inside ? "inside" : "after",
  };
}

/**
 * The seller's list of transactions: one order per *Details* link, and nothing else read.
 *
 * Deliberately no items, no buyer and no totals even where the row prints some of them: the list
 * truncates its listings, so anything read here would be part of an order presented as the whole of
 * one. What the row can have is the answer — recorded or not — which is what `canImport: false`
 * asks the mark for.
 */
function readTransactionList(doc: Document, pageUrl: string): PlatformOrder[] {
  const root = doc.body ?? doc.documentElement;
  if (!root) return [];

  const orders: PlatformOrder[] = [];
  const seen = new Set<string>();
  for (const anchor of root.querySelectorAll("a[href]")) {
    const href = hrefOf(anchor);
    let path: string;
    try {
      path = new URL(href, pageUrl).pathname;
    } catch {
      continue;
    }
    const match = TRANSACTION_DETAIL.exec(path);
    if (!match) continue;
    const orderId = decodeSegment(match[1]);
    if (seen.has(orderId)) continue;
    seen.add(orderId);
    orders.push({
      orderId,
      orderUrl: absolute(href, pageUrl),
      buyerLogin: null,
      buyerName: null,
      totalTexts: [],
      soldAtText: null,
      shippingMethodText: null,
      lines: [],
      canImport: false,
      anchor,
      // Beside the row's own *Details* link, which is that row's answer to "which one is this?".
      markPlacement: "after",
    });
  }
  return orders;
}

/**
 * The delivery method the transaction names, as printed.
 *
 * A method's name is **not a price list**. Colnect prints the ladder (`1-100 items - € 2.40`, …) and
 * its two lead times directly under the name, and where the page runs them into the same block the
 * name ends at the first figure — the list boundary in {@link textUpToList} takes care of the case
 * where the ladder is a list, and this takes care of the case where it is not.
 */
function shippingMethodOf(root: Element): string | null {
  const value = labelledValue(root, SHIPPING_METHOD_LABEL);
  if (!value) return null;
  const ladder = new RegExp(`\\d+\\s*[-–—]\\s*\\d+\\s|(?:${SYMBOLS})\\s*\\d`, "i").exec(value);
  const name = (ladder ? value.slice(0, ladder.index) : value).trim();
  return name || null;
}

/** Tags that are a page **saying what this page is**. Preferred over any other element naming the
 *  transaction, and that preference is what makes the answer stable — see {@link headingOf}. */
const HEADING_TAGS = new Set(["h1", "h2", "h3"]);

/**
 * The heading naming this transaction — `Transactions › Transaction #hflVE`.
 *
 * **A heading element first**, and only then the smallest other element that names the order. The
 * smallest-element rule alone is right about the page and wrong about *time*: Colnect keeps a copy
 * of the page's title in its header, shorter than the breadcrumb, and its own script hides that copy
 * **after** the page settles — so a reading taken as the document goes idle picks the copy, and the
 * mark is drawn into an element that is about to be hidden. That is exactly what happened: the mark
 * appeared only after a scroll, whose mutations triggered a second reading against a page that had
 * finished making up its mind.
 *
 * A heading cannot be raced in that way. It is what the page calls itself, it is in the served
 * markup, and no later script demotes it to a duplicate.
 *
 * Named **and worded** in both passes: the id alone is carried by anything that mentions this
 * transaction, while `Transaction #hflVE` is the page saying which one the reader is looking at.
 */
function headingOf(root: Element, orderId: string): Element | null {
  const names = new RegExp(`(?:^|[^\\w-])#?${escapeForRegExp(orderId)}(?![\\w-])`);
  const candidates = elementsIn(root).filter((element) => {
    const text = textOf(element);
    return (
      names.test(text) &&
      /\btransaction\b/i.test(text) &&
      text.length <= 200 &&
      isDrawn(element)
    );
  });
  const headings = candidates.filter((element) =>
    HEADING_TAGS.has(element.tagName.toLowerCase())
  );
  return smallestByText(headings.length > 0 ? headings : candidates);
}

/** The one that says the least, which among elements naming the same thing is the innermost. */
function smallestByText(elements: readonly Element[]): Element | null {
  let found: Element | null = null;
  let length = Infinity;
  for (const element of elements) {
    const text = textOf(element);
    if (text.length < length) {
      found = element;
      length = text.length;
    }
  }
  return found;
}

/** The leaf that prints the transaction's own start, for a page whose buyer link has moved: the mark
 *  still belongs in the header, and this is the header's other statement. */
function startedLeaf(root: Element): Element | null {
  return leaves(root).find((leaf) => STARTED_LABEL.test(textOf(leaf))) ?? null;
}

function buyerLoginOf(buyerAnchor: Element | null): string | null {
  if (!buyerAnchor) return null;
  const match = COLLECTOR_HREF.exec(hrefOf(buyerAnchor));
  return match ? decodeSegment(match[1]) : null;
}

/**
 * The name printed beside the buyer's login — `Buyer: Andrzej Palacz [jedrus67]` reads as
 * `Andrzej Palacz`.
 *
 * The login is dropped from the words because Colnect prints it twice there, once as the link and
 * once in brackets, and the instance already has it from the address. Null when the label's line
 * says nothing but the login: a sale with no name is filed under the login, which is how buyers are
 * filed here anyway (#463).
 *
 * Found through the `Buyer:` label rather than through the link's parent, for the reason the labels
 * above are read that way: the name may be a bare text node, and the parent that holds both it and
 * the link may just as well be the whole header — which would file the buyer under the date as well.
 *
 * The **postal address printed further down the same page is not read**, and therefore cannot be
 * stored — ADR-0038 §4's rule, unchanged.
 */
function buyerNameBeside(root: Element, buyerAnchor: Element | null): string | null {
  const line =
    labelledValue(root, BUYER_LABEL) ??
    valueAfter(textOf(buyerAnchor?.parentElement), BUYER_LABEL);
  if (!line || line.length > 200) return null;
  const login = buyerLoginOf(buyerAnchor);
  const name = line
    .replace(/\[[^\]]*\]/g, " ")
    .replace(login ? new RegExp(`\\b${escapeForRegExp(login)}\\b`, "g") : /$^/, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || null;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function absolute(href: string, pageUrl: string): string {
  try {
    return new URL(href.split("?")[0], pageUrl).toString();
  } catch {
    return href;
  }
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
