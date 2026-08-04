// The link from a marketplace listing back to the offer it is here (#466).
//
// The collector is standing on an Allegro page that is **their own** listing — reached from a sale
// notification, or simply while checking on it — and what they want next is that offer's screen:
// the copies it holds, the sell flow (#166), the price. Without this the only route is reading the
// title off Allegro and hunting for it in the offers list.
//
// It is a **link drawn into the page**, exactly as #417 turns the Stamporama address in a Colnect
// private note into a real one, rather than something the toolbar click offers. Two reasons: the
// toolbar click on an Allegro listing already means *capture this as an auction lot* (#355) and
// silently changing what a gesture does is worse than adding a second, separate affordance; and the
// answer is worth having **before** any click, since knowing "this one is mine" is most of the value.
//
// Two shapes, because there are two questions. A **listing page** is one offer, so it gets a chip in
// the corner. A **list** of the collector's own listings gets a small link beside each row's own
// title instead — the question there is asked once per row, and the answer belongs on the row.
//
// Neither is anchored to a class name. Every class on an Allegro page is hashed per build
// (`mli8_k4`) — which is why the capture module reads the page's own JSON and never its markup
// (#355) — so the chip floats in a corner that needs no selector at all, and the inline link is
// placed beside an anchor found by its **address**. An address is what a page is about; a hashed
// class is what it looked like on the day it was written.
//
// Pure DOM work: no `chrome.*`, so it is unit-tested against `linkedom` like the platform modules.

/** Marks the chip, so a re-run replaces it instead of stacking a second one on the page. */
const MARKER_ATTR = "data-stamporama-offer";

/** Records **which listing** an anchor has already been answered for. It carries the id rather than
 *  being a bare flag, and it goes on the marketplace's own anchor rather than on ours, because a
 *  client-rendered list reuses its row elements: paging a table rewrites the `href` of an anchor we
 *  have already linked, and a flag would leave that row pointing at the previous page's offer. */
const LINKED_ATTR = "data-stamporama-linked";

/** Marks the inline link itself, so a caller can find, count or clear them. */
const LINK_ATTR = "data-stamporama-offer-link";

/** The offer as the page should name it. Every field comes from the instance's own answer — the
 *  page is told what its listing is, and states none of it itself. */
export interface OfferMarkerTarget {
  /** Absolute address of the offer's screen on the instance the extension is connected to. */
  url: string;
  /** The offer's short number (#416) — what the chip leads with, because it is what the collector
   *  quotes and what the quick-jump box (#431) takes. */
  offerNo: number;
  title: string;
  /** The offer's lifecycle state, shown because a listing that is up while the offer here says
   *  `sold` or `withdrawn` is precisely the disagreement worth seeing. */
  state: string;
}

/** Remove the chip, if this document carries one. Exported for the re-render path and for a page
 *  whose listing stops matching. */
export function removeOfferMarker(doc: Document): void {
  for (const existing of Array.from(doc.querySelectorAll(`[${MARKER_ATTR}]`))) existing.remove();
}

/**
 * Draw the chip into `doc`, replacing any previous one, and return it.
 *
 * Styling is inline and starts from `all: initial`: this element lives inside somebody else's
 * stylesheet, and a chip that inherits Allegro's own `font-size` or `color` reads as part of their
 * page — which is the one thing it must never look like. Returns null when there is no body to
 * attach to, a document being parsed being a normal thing to be handed.
 */
export function renderOfferMarker(
  doc: Document,
  target: OfferMarkerTarget,
  iconUrl: string | null
): HTMLAnchorElement | null {
  const body = doc.body;
  if (!body) return null;
  removeOfferMarker(doc);

  const a = doc.createElement("a");
  a.setAttribute(MARKER_ATTR, "");
  a.href = target.url;
  a.title = `${target.title} — open in Stamporama`;
  // A new tab, always: the listing the collector is reading is the page they came from and will go
  // back to, and navigating it away to answer "which offer is this?" loses their place.
  a.target = "_blank";
  a.rel = "noreferrer noopener";
  a.style.cssText = [
    "all: initial",
    "position: fixed",
    "right: 16px",
    "bottom: 16px",
    // Above Allegro's own sticky buy-box and cookie bar, below nothing that matters: this is the
    // collector's own overlay on a page they are only reading.
    "z-index: 2147483000",
    "display: flex",
    "align-items: center",
    "gap: 8px",
    "max-width: 320px",
    "padding: 8px 12px",
    "border-radius: 8px",
    "border: 1px solid rgba(0, 0, 0, 0.12)",
    "background: #ffffff",
    "box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18)",
    "font-family: system-ui, sans-serif",
    "font-size: 13px",
    "line-height: 1.35",
    "color: #111827",
    "text-decoration: none",
    "cursor: pointer",
  ].join("; ");

  if (iconUrl) {
    const img = doc.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    img.width = 16;
    img.height = 16;
    img.style.cssText = "flex: none; width: 16px; height: 16px";
    a.appendChild(img);
  }

  const text = doc.createElement("span");
  text.style.cssText = "display: block; min-width: 0";

  const head = doc.createElement("span");
  head.style.cssText = "display: block; font-weight: 600";
  head.textContent = `Offer #${target.offerNo} · ${target.state}`;

  // The title says *which* listing this is, and is the reason the chip is trusted: a collector with
  // several similar auctions up should not have to follow the link to find out it is the right one.
  const name = doc.createElement("span");
  name.style.cssText =
    "display: block; color: #4b5563; overflow: hidden; text-overflow: ellipsis; white-space: nowrap";
  name.textContent = target.title;

  text.appendChild(head);
  text.appendChild(name);
  a.appendChild(text);
  body.appendChild(a);
  return a;
}

// ── The same link, inline beside the marketplace's own number ────────────────
//
// The corner chip answers "what is the page I am on". A **list** of the collector's own listings —
// Allegro's *Mój asortyment* — asks the question once per row instead, and the honest place for the
// answer is beside the row's own identifier: the line that already reads `nr: 18799199246`. That is
// where a row states which listing it is, so it is where it should also state which offer that is.
//
// Which listing a row is about is read from its **address** (a link to `/oferta/<id>`) and never
// from a class, for the reason the whole module exists: Allegro hashes every class name per build.
// The number is then found by *being that id* — an element whose whole text is the listing id —
// which is a fact about the row's content rather than about the day its markup was written. A row
// that prints no number falls back to the anchor it was recognised by.
//
// It is a **plain link**, not a chip: it lives inside a table cell laid out by somebody else, and a
// bordered box with a background of its own pushes that cell around. Text the width of the words in
// it changes no layout.

/** Every anchor with an address, in document order. The caller reads each one through its own
 *  platform module — this only narrows the page down to links, which is what keeps re-scanning a
 *  thousand-row table cheap. */
export function offerAnchors(doc: Document): HTMLAnchorElement[] {
  return Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"));
}

/**
 * True when this anchor is a **row of a list** — the only place the inline link belongs.
 *
 * A page links to a listing in more places than a list of them: the search box above *Mój
 * asortyment* drops a panel of matching offers as you type, a listing page links to the seller's
 * other auctions. Writing into those is wrong twice over. It answers a question nobody asked —
 * a suggestion panel is a thing being *typed into*, not a list being worked through — and it writes
 * into markup the site rebuilds on every keystroke, so the link is torn out and redrawn again and
 * again, moving the page under the collector's hands each time.
 *
 * A table row is the test because a table row is what a list of listings is made of, and because it
 * is a fact about structure rather than about a class name (every class here is hashed per build).
 * A listing page has no such row and needs none: it gets the corner chip instead.
 */
export function anchorIsListRow(anchor: Element): boolean {
  return anchor.closest("tr") !== null;
}

/** True for markup this module drew — the chip, an inline link, or anything inside one.
 *
 *  The caller watches the page for changes so its links survive a redraw, and its own writing is a
 *  change like any other. Without this the first link drawn schedules the scan that draws the next,
 *  and a page the site is also rebuilding never settles. */
export function isAssistantNode(node: Node): boolean {
  const element =
    node.nodeType === 1 ? (node as Element) : (node.parentElement as Element | null) ?? null;
  return element?.closest(`[${MARKER_ATTR}], [${LINK_ATTR}]`) != null;
}

/** True when this anchor has not been answered for *this* listing yet — either never, or for the
 *  listing it pointed at before a re-render moved it to another one. */
export function anchorNeedsLink(anchor: Element, platformOfferId: string): boolean {
  return anchor.getAttribute(LINKED_ATTR) !== platformOfferId;
}

/** The row an anchor belongs to — its table row, or, off a table, the anchor itself. This is the
 *  area the number is looked for in, and the area a stale link is cleared from. */
function rowOf(anchor: Element): Element {
  return anchor.closest("tr") ?? anchor.parentElement ?? anchor;
}

/**
 * Where the link goes: after the element that prints the listing id, or after the anchor when the
 * row prints no number.
 *
 * The number is matched **exactly** and only on a leaf, so the cell that contains it — and the row,
 * and the page — are never mistaken for it.
 */
function insertionPoint(anchor: Element, platformOfferId: string): Element {
  const row = rowOf(anchor);
  if (row === anchor) return anchor;
  for (const element of Array.from(row.querySelectorAll("*"))) {
    if (element.children.length === 0 && element.textContent?.trim() === platformOfferId) {
      return element;
    }
  }
  return anchor;
}

/**
 * Record that `anchor` has been answered for `platformOfferId`, and draw the offer's link into its
 * row when there is an offer to draw.
 *
 * `target` of null is a full answer, not a no-op: it records that this listing is somebody else's,
 * which is what stops a table of stranger's offers being re-tested on every re-render. Either way
 * any link the row carried for a **previous** listing is removed first, so a reused row never keeps
 * the last page's offer.
 *
 * It reads `Offer #42`, with the offer's title and state on hover: the row already says what the
 * listing is — what it does not say is which offer here that is.
 */
export function renderInlineOfferLink(
  anchor: Element,
  platformOfferId: string,
  target: OfferMarkerTarget | null,
  iconUrl: string | null
): HTMLAnchorElement | null {
  const doc = anchor.ownerDocument;
  if (!doc) return null;

  for (const stale of Array.from(rowOf(anchor).querySelectorAll(`[${LINK_ATTR}]`))) stale.remove();
  anchor.setAttribute(LINKED_ATTR, platformOfferId);
  if (!target) return null;

  const after = insertionPoint(anchor, platformOfferId);
  const parent = after.parentNode;
  if (!parent) return null;

  const a = doc.createElement("a");
  a.setAttribute(LINK_ATTR, "");
  a.href = target.url;
  a.title = `${target.title} — ${target.state} — open in Stamporama`;
  // A new tab, always: the list the collector is working through is the page they are coming back
  // to, and navigating it away to look at one offer loses their place in it.
  a.target = "_blank";
  a.rel = "noreferrer noopener";
  // `all: initial` still, because this sits inside somebody else's stylesheet — but what it is reset
  // *to* is a plain link: no box, no background, nothing that occupies width of its own.
  a.style.cssText = [
    "all: initial",
    "margin-left: 6px",
    "font-family: system-ui, sans-serif",
    "font-size: 12px",
    "line-height: 16px",
    "white-space: nowrap",
    "color: #2563eb",
    "text-decoration: underline",
    "cursor: pointer",
  ].join("; ");

  if (iconUrl) {
    const img = doc.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    img.width = 11;
    img.height = 11;
    img.style.cssText = "width: 11px; height: 11px; vertical-align: -1px; margin-right: 3px";
    a.appendChild(img);
  }
  a.appendChild(doc.createTextNode(`Offer #${target.offerNo}`));

  parent.insertBefore(a, after.nextSibling);
  return a;
}
