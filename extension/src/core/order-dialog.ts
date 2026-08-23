// The window one **Import** click opens on a marketplace's own order screen (#612/#698).
//
// The mark beside a row answers a question — *is this written down here?* — and answering is all a
// mark should do. Pressing it is something else: it **writes**, once, to the collection, and what it
// wrote is not something a word in a table cell can say. The first cut said it in the mark itself —
// `Sale #34` on success, `Not imported` with the reason hidden in a `title` on refusal — and that is
// exactly as much as a mark can carry and much less than the moment deserves: a refusal naming three
// listings became one hover-only sentence, and a success became a number with nothing to check the
// screen against.
//
// So the act reports in a window of its own, and the mark keeps being the answer. The window opens on
// the click, says it is working, and then says what happened:
//
//   * **recorded** — the sale's own number as a link, and the few figures worth reading against the
//     page the collector is standing on: who, when, how many lines, what they add up to, what the
//     buyer paid, how it is going. A sale that was **already** there is described the same way, since
//     a re-import is a link and a link worth following is worth describing.
//   * **not recorded** — every reason, one per line, because an order is recorded whole or not at all
//     and the collector is about to go and fix all of them (ADR-0038 §3). One sentence per row, in
//     the instance's own words, rather than the run-on the mark's tooltip had to be.
//
// It is a window and not a confirmation: nothing is asked before the write, which is #515's rule
// unchanged — an overlay restating the label just clicked is a step, not a safeguard.
//
// Pure DOM: no `chrome.*`, so it is unit-tested against `linkedom` like the marks it accompanies.

import { ORDER_DIALOG_ATTR as DIALOG_ATTR } from "./marker-shell";
import type { OrderSaleTarget } from "./order-marker";

/**
 * What an imported order became, mirrored by hand from the instance's own `ImportedSaleSummary` —
 * the extension is a separate build with no import path into the app, as `core/decisions.ts` mirrors
 * the matcher's answer.
 *
 * Every field is **as the instance stored it**: this window states the record, and a figure
 * re-derived here would be a second opinion about the collection's own data.
 */
export interface OrderImportSummary {
  buyer: string | null;
  soldAt: string;
  currency: string;
  lineCount: number;
  gross: string;
  buyerPaidTotal: string | null;
  shippingMethodName: string | null;
  setChoicePending: number;
}

/** What the window is currently saying. */
export type OrderDialogState =
  /** The instance is deciding. The window opens in this state, on the click, so the collector is
   *  never looking at a button that appears to have done nothing. */
  | { kind: "working" }
  | {
      kind: "recorded";
      sale: OrderSaleTarget;
      summary: OrderImportSummary | null;
      /** False where the order was already a sale — then nothing was written just now. */
      created: boolean;
    }
  /** Nothing was recorded. `problems` is one sentence per reason; `message` is the whole of it for a
   *  refusal that named no rows (no platform set, no currency, an unreachable instance). */
  | { kind: "refused"; message: string; problems: string[] };

const TEXT = "#111827";
const MUTED = "#6b7280";
const LINK = "#2563eb";
const WARN = "#b45309";
const BAD = "#b91c1c";

/** Take the window away, and the key handler with it. */
export function closeOrderDialog(doc: Document): void {
  for (const node of Array.from(doc.querySelectorAll(`[${DIALOG_ATTR}]`))) node.remove();
  if (escapeHandler) {
    doc.removeEventListener("keydown", escapeHandler, true);
    escapeHandler = null;
  }
}

/** The listener closing the window on Escape, held so it can be taken off again — a content script
 *  that left one behind would keep swallowing the page's own key handling after the window is gone. */
let escapeHandler: ((event: KeyboardEvent) => void) | null = null;

/**
 * Draw the window for one order, replacing whatever it was saying before.
 *
 * `orderLabel` is how the marketplace names this order — its own id — because the window floats over
 * the page rather than sitting in the row, and a window that did not say which order it is about
 * would be one more thing to work out.
 */
export function showOrderDialog(
  doc: Document,
  orderLabel: string,
  state: OrderDialogState,
  iconUrl: string | null
): HTMLElement | null {
  const body = doc.body;
  if (!body) return null;
  closeOrderDialog(doc);

  const backdrop = doc.createElement("div");
  backdrop.setAttribute(DIALOG_ATTR, "");
  backdrop.style.cssText = [
    "all: initial",
    "position: fixed",
    "inset: 0",
    "background: rgba(17, 24, 39, 0.45)",
    // Above the marks' own corner stack, which is the only other thing the Assistant draws here.
    "z-index: 2147483100",
    "display: flex",
    "align-items: center",
    "justify-content: center",
    "font-family: system-ui, sans-serif",
  ].join("; ");
  // Only the backdrop itself: a click that started inside the panel and drifted out is not a click
  // on the backdrop, and closing on it would take the window away mid-selection.
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeOrderDialog(doc);
  });

  const panel = doc.createElement("div");
  panel.setAttribute("role", "dialog");
  panel.style.cssText = [
    "all: initial",
    "box-sizing: border-box",
    "width: min(440px, calc(100vw - 32px))",
    "max-height: calc(100vh - 64px)",
    "overflow: auto",
    "padding: 16px 18px",
    "border-radius: 10px",
    "background: #ffffff",
    "box-shadow: 0 8px 40px rgba(0, 0, 0, 0.3)",
    "font-family: system-ui, sans-serif",
    "font-size: 13px",
    "line-height: 1.45",
    `color: ${TEXT}`,
  ].join("; ");
  backdrop.appendChild(panel);

  panel.appendChild(header(doc, orderLabel, iconUrl, () => closeOrderDialog(doc)));
  for (const node of bodyOf(doc, state)) panel.appendChild(node);

  escapeHandler = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // The page underneath has its own Escape handling — a lightbox, a menu — and this window is the
    // topmost thing on screen, so it takes the key rather than sharing it.
    event.preventDefault();
    event.stopPropagation();
    closeOrderDialog(doc);
  };
  doc.addEventListener("keydown", escapeHandler, true);

  body.appendChild(backdrop);
  return backdrop;
}

function header(
  doc: Document,
  orderLabel: string,
  iconUrl: string | null,
  onClose: () => void
): HTMLElement {
  const row = doc.createElement("div");
  row.style.cssText =
    "all: initial; display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-family: inherit";

  if (iconUrl) {
    const icon = doc.createElement("img");
    icon.src = iconUrl;
    icon.alt = "";
    icon.style.cssText = "width: 16px; height: 16px; flex: none";
    row.appendChild(icon);
  }

  const title = doc.createElement("div");
  title.style.cssText = `all: initial; flex: 1; font-family: inherit; font-size: 14px; font-weight: 600; color: ${TEXT}`;
  title.textContent = `Order ${orderLabel}`;
  row.appendChild(title);

  const close = doc.createElement("a");
  close.setAttribute("role", "button");
  close.tabIndex = 0;
  close.title = "Close";
  close.style.cssText = `all: initial; font-family: inherit; font-size: 16px; line-height: 1; padding: 2px 4px; cursor: pointer; color: ${MUTED}`;
  close.textContent = "✕";
  close.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  });
  row.appendChild(close);
  return row;
}

function bodyOf(doc: Document, state: OrderDialogState): HTMLElement[] {
  if (state.kind === "working") return [line(doc, "Recording this order…", MUTED)];
  if (state.kind === "refused") return refusal(doc, state.message, state.problems);
  return recorded(doc, state.sale, state.summary, state.created);
}

function recorded(
  doc: Document,
  sale: OrderSaleTarget,
  summary: OrderImportSummary | null,
  created: boolean
): HTMLElement[] {
  const nodes: HTMLElement[] = [];

  const link = doc.createElement("a");
  link.href = sale.url;
  // A new tab, always: the screen being packed from is the one the collector is coming back to.
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.style.cssText = `all: initial; font-family: inherit; font-size: 15px; font-weight: 600; color: ${LINK}; text-decoration: underline; cursor: pointer`;
  link.textContent = `Sale #${sale.saleNo}`;
  const lead = doc.createElement("div");
  lead.style.cssText = "all: initial; display: block; font-family: inherit; margin-bottom: 6px";
  lead.appendChild(link);
  nodes.push(lead);

  nodes.push(
    line(
      doc,
      created
        ? "Recorded in Stamporama."
        : "This order was already recorded — nothing was written just now.",
      MUTED
    )
  );

  if (summary) {
    const facts: [string, string][] = [
      ["Buyer", summary.buyer ?? "—"],
      ["Sold on", summary.soldAt],
      ["Lines", `${summary.lineCount}`],
      ["Lines total", `${summary.gross} ${summary.currency}`],
      [
        "Buyer paid",
        summary.buyerPaidTotal ? `${summary.buyerPaidTotal} ${summary.currency}` : "not stated",
      ],
      ["Shipping", summary.shippingMethodName ?? "—"],
      ["Status", sale.status],
    ];
    nodes.push(table(doc, facts));

    if (summary.setChoicePending > 0) {
      // The one thing an imported sale can still want from a person (#697). Said here rather than
      // left to be found: the collector is holding the parcel, which is exactly when the question
      // *which of these identical copies goes* can actually be answered.
      nodes.push(
        line(
          doc,
          `${summary.setChoicePending} line${summary.setChoicePending === 1 ? "" : "s"} name a set nobody has chosen yet — pick the copy that goes on the sale's own screen.`,
          WARN
        )
      );
    }
  }

  return nodes;
}

function refusal(doc: Document, message: string, problems: string[]): HTMLElement[] {
  const nodes: HTMLElement[] = [line(doc, "Nothing was recorded.", BAD)];

  const reasons = problems.length > 0 ? problems : [message];
  const list = doc.createElement("ul");
  list.style.cssText =
    "all: initial; display: block; font-family: inherit; margin: 8px 0 0; padding-left: 18px; list-style: disc";
  for (const reason of reasons) {
    const item = doc.createElement("li");
    item.style.cssText = `all: initial; display: list-item; font-family: inherit; font-size: 13px; line-height: 1.45; color: ${TEXT}; margin-bottom: 4px`;
    item.textContent = reason;
    list.appendChild(item);
  }
  nodes.push(list);

  nodes.push(
    line(doc, "An order is recorded whole or not at all. Fix these and press Import again.", MUTED)
  );
  return nodes;
}

function table(doc: Document, facts: readonly [string, string][]): HTMLElement {
  const grid = doc.createElement("div");
  grid.style.cssText = [
    "all: initial",
    "display: grid",
    "grid-template-columns: auto 1fr",
    "gap: 2px 12px",
    "margin-top: 10px",
    "font-family: inherit",
    "font-size: 13px",
    `color: ${TEXT}`,
  ].join("; ");
  for (const [label, value] of facts) {
    const key = doc.createElement("div");
    key.style.cssText = `all: initial; font-family: inherit; font-size: 12px; color: ${MUTED}`;
    key.textContent = label;
    const held = doc.createElement("div");
    held.style.cssText = `all: initial; font-family: inherit; font-size: 13px; color: ${TEXT}`;
    held.textContent = value;
    grid.appendChild(key);
    grid.appendChild(held);
  }
  return grid;
}

function line(doc: Document, text: string, color: string): HTMLElement {
  const element = doc.createElement("div");
  element.style.cssText = `all: initial; display: block; font-family: inherit; font-size: 13px; line-height: 1.45; margin-top: 8px; color: ${color}`;
  element.textContent = text;
  return element;
}
