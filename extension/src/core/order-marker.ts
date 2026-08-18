// The mark on a sold order: the sale it is here, or the affordance that records it (#612).
//
// The collector is on Delcampe's **My Sold Items**, packing a parcel, and the question the screen
// cannot answer is the one they are about to act on: *have I written this one down yet?* Without it
// the answer is the sales list in another tab, searched by a buyer's login, once per parcel — which
// is how an order gets recorded twice and how one gets missed.
//
// It is #466's split, applied to a sale instead of a listing: **the page states which order it is**
// (its own `payment-request/<id>` address) and **the instance states what that order is here**. The
// page is never asked whether it is recorded, because it cannot know, and the instance is never
// asked what the page is, because it has not seen it.
//
// It is a **list**, so the mark is #466's inline shape rather than a corner chip: the question is
// asked once per row and the answer belongs on the row, beside the link that already states which
// order it is. Plain text and a plain link, because this sits in a cell Delcampe laid out and a
// bordered box with a background of its own would push that cell around.
//
// The one thing the offer and lot markers do not have is a **button**. Those two answer a question;
// this one also offers the act, because the act is what the collector came to the screen to do and
// sending them to another tab to repeat what the row already says is the whole thing this removes.
// It writes nothing itself: the click asks the instance, which decides (#409). And it needs no
// confirmation overlay — the button says *Import*, the row beside it says which order, and that is
// #515's rule: an overlay that restated the label just clicked is a step, not a safeguard.
//
// Pure DOM: no `chrome.*`, so it is unit-tested against `linkedom` like the platform modules.

import { ORDER_MARK_ATTR as MARK_ATTR } from "./marker-shell";

/** Records **which order** an anchor has already been answered for, on the marketplace's own
 *  element. It carries the id rather than being a bare flag for #466's reason: a row element reused
 *  by a re-render would otherwise keep the previous order's answer. */
const ANSWERED_ATTR = "data-stamporama-order-answered";

/** The sale one order is here, as the instance answered. */
export interface OrderSaleTarget {
  /** Absolute address of the sale's screen on the instance the extension is connected to. */
  url: string;
  /** The sale's own short number (#432) — what the collector quotes and what the quick-jump box
   *  takes, so it is what the mark leads with. */
  saleNo: number;
  /** Where the sale has got to in the collector's own fulfillment workflow (#191). Shown because
   *  Delcampe's phase and this one are two different things, and the row already states Delcampe's. */
  status: string;
}

/**
 * What is known about one order, and therefore what the row should offer.
 *
 * `unknown` is not a state the mark draws: an order the instance could not be asked about — no
 * profile, no instance, no answer — is left exactly as the page had it, because a row that offered
 * *Import* while nothing could be imported would be worse than an unmarked one.
 */
export type OrderMarkState =
  | { kind: "recorded"; sale: OrderSaleTarget }
  | { kind: "importable" }
  | { kind: "importing" }
  /** The instance refused, and said why — the sentence names the item to go and fix. */
  | { kind: "refused"; message: string };

/** Draw nothing and leave nothing behind: every mark this module put on `root`, removed. */
export function removeOrderMarks(root: ParentNode): void {
  for (const mark of Array.from(root.querySelectorAll(`[${MARK_ATTR}]`))) mark.remove();
}

/** True when this row has not been answered for *this* order yet — either never, or for the order it
 *  was about before a re-render moved it to another one. */
export function orderNeedsMark(anchor: Element, orderId: string): boolean {
  return anchor.getAttribute(ANSWERED_ATTR) !== orderId;
}

/** Common look for whatever the mark currently says: a plain inline element the width of its own
 *  words. `all: initial` because this lives inside somebody else's stylesheet — a mark that inherits
 *  Delcampe's `font-size` reads as part of their page, which is the one thing it must not do. */
function markStyle(color: string, underline: boolean): string {
  return [
    "all: initial",
    "margin-left: 8px",
    "font-family: system-ui, sans-serif",
    "font-size: 12px",
    "line-height: 16px",
    "white-space: nowrap",
    `color: ${color}`,
    underline ? "text-decoration: underline" : "text-decoration: none",
    "cursor: pointer",
  ].join("; ");
}

function withIcon(element: Element, iconUrl: string | null, label: string): void {
  const doc = element.ownerDocument;
  if (!doc) return;
  if (iconUrl) {
    const img = doc.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    img.width = 11;
    img.height = 11;
    img.style.cssText = "width: 11px; height: 11px; vertical-align: -1px; margin-right: 3px";
    element.appendChild(img);
  }
  element.appendChild(doc.createTextNode(label));
}

/**
 * Draw the mark for one order after `anchor` — the row's own order link — replacing whatever it said
 * before, and record that this row has been answered for `orderId`.
 *
 * `onImport` is called with nothing when the collector presses *Import*. The mark does not change
 * itself in response: the caller redraws it as `importing` and then as whatever the instance
 * answered, so what the row says is always what the instance last said rather than what this module
 * hoped would happen.
 */
export function renderOrderMark(
  anchor: Element,
  orderId: string,
  state: OrderMarkState,
  iconUrl: string | null,
  onImport: () => void
): Element | null {
  const doc = anchor.ownerDocument;
  const parent = anchor.parentNode;
  if (!doc || !parent) return null;

  // Any mark this row carried — for this order or for the one it was about before — goes first, so a
  // redraw replaces rather than accumulates.
  const row = anchor.closest("li, tr, div") ?? anchor;
  removeOrderMarks(row);
  anchor.setAttribute(ANSWERED_ATTR, orderId);

  let mark: Element;
  if (state.kind === "recorded") {
    const link = doc.createElement("a");
    link.href = state.sale.url;
    link.title = `Sale #${state.sale.saleNo} · ${state.sale.status} — open in Stamporama`;
    // A new tab, always: the screen the collector is packing from is the one they are coming back
    // to, and navigating it away to look at the sale loses their place in the list.
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.style.cssText = markStyle("#2563eb", true);
    withIcon(link, iconUrl, `Sale #${state.sale.saleNo}`);
    mark = link;
  } else if (state.kind === "importing") {
    const span = doc.createElement("span");
    span.style.cssText = markStyle("#6b7280", false);
    withIcon(span, iconUrl, "Importing…");
    mark = span;
  } else if (state.kind === "refused") {
    // The reason in full on hover, and a word in the row: the refusal names an item and an offer, and
    // a sentence of that length written into a table cell would push the row around. Still a button,
    // because the way through is to fix what it names and press it again.
    const button = doc.createElement("a");
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.title = state.message;
    button.style.cssText = markStyle("#b45309", true);
    withIcon(button, iconUrl, "Not imported");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onImport();
    });
    mark = button;
  } else {
    const button = doc.createElement("a");
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.title = "Record this order as a sale in Stamporama";
    button.style.cssText = markStyle("#2563eb", true);
    withIcon(button, iconUrl, "Import");
    button.addEventListener("click", (event) => {
      // The row's own link opens Delcampe's order page, and this sits inside it on some phase
      // screens: without this the import happens *and* the page navigates away from the answer.
      event.preventDefault();
      event.stopPropagation();
      onImport();
    });
    mark = button;
  }

  mark.setAttribute(MARK_ATTR, "");
  parent.insertBefore(mark, anchor.nextSibling);
  return mark;
}
