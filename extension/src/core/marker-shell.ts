// The corner the Assistant's own chips live in on a marketplace page (#466, #575).
//
// There is more than one thing a listing can be here. It can be an **offer** of ours (#466), and it
// can be an **auction lot** we are bidding on (#575) — the same URL and the same markup either way,
// which is exactly why both questions are asked of the instance rather than of the page. In practice
// a listing is one or the other, but nothing in either answer says so, and two chips each claiming
// the bottom-right corner would sit on top of each other with the lower one unreadable.
//
// So the corner is a **stack**: one fixed container both chips append into, laid out as a column.
// A chip therefore states how it looks and nothing about where it sits, and adding a third kind of
// answer later moves no pixels of the first two.
//
// Pure DOM, like everything else drawn into somebody else's page — unit-tested under `linkedom`.

/** Marks the stack, so a chip can find the one this document already has. */
export const STACK_ATTR = "data-stamporama-markers";

// The attributes that say a node is the Assistant's own. They live here, together, because the one
// thing every surface has to be able to ask is "did *we* draw this?" — the page watcher's own
// question (see {@link isAssistantNode}) — and an answer assembled from constants scattered across
// the modules that draw them is one that silently stops covering a mark somebody adds later.

/** The corner chip naming the offer a listing is here (#466). */
export const OFFER_MARKER_ATTR = "data-stamporama-offer";
/** The inline link naming that offer beside a row's own identifier (#466). */
export const OFFER_LINK_ATTR = "data-stamporama-offer-link";
/** The corner chip naming the auction lot a listing is being bid on as (#575). */
export const LOT_MARKER_ATTR = "data-stamporama-lot";
/** The mark on a sold order: the sale it is here, or the affordance that records it (#612). */
export const ORDER_MARK_ATTR = "data-stamporama-order";

/**
 * The document's marker stack, created on first use. Null when there is no body to attach to — a
 * document being parsed is a normal thing to be handed.
 *
 * `all: initial` for every chip's own reason: this element lives inside somebody else's stylesheet,
 * and a container that inherits the page's `font-size` or `direction` would take its children with
 * it.
 */
export function markerStack(doc: Document): HTMLElement | null {
  const body = doc.body;
  if (!body) return null;
  const existing = body.querySelector<HTMLElement>(`[${STACK_ATTR}]`);
  if (existing) return existing;

  const stack = doc.createElement("div");
  stack.setAttribute(STACK_ATTR, "");
  stack.style.cssText = [
    "all: initial",
    "position: fixed",
    "right: 16px",
    "bottom: 16px",
    // Above Allegro's own sticky buy-box and cookie bar, below nothing that matters: this is the
    // collector's own overlay on a page they are only reading.
    "z-index: 2147483000",
    "display: flex",
    "flex-direction: column",
    "align-items: flex-end",
    "gap: 8px",
  ].join("; ");
  body.appendChild(stack);
  return stack;
}

/** Take the stack away once the last chip has left it, so a page whose answers all turned out to be
 *  misses is left exactly as it was found. */
export function pruneMarkerStack(doc: Document): void {
  const stack = doc.body?.querySelector(`[${STACK_ATTR}]`);
  if (stack && stack.children.length === 0) stack.remove();
}

/** How a chip in the stack looks. Shared because the two answers are the same kind of thing said
 *  about the same listing, and a difference in shape between them would read as a difference in
 *  kind. Positioning is the stack's, deliberately absent here. */
export const CHIP_STYLE = [
  "all: initial",
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

/** True for markup the Assistant drew — the corner stack and anything in it (a chip of either kind),
 *  an inline link, an order mark, or anything inside one.
 *
 *  A page that redraws itself is watched so the marks survive it, and our own writing is a change
 *  like any other. Without this the first mark drawn schedules the scan that draws the next, and a
 *  page the site is also rebuilding never settles — which is the page moving under the collector's
 *  hands. The stack counts as ours in its own right: it is created and pruned by the chips, so a page
 *  whose answers are all misses would otherwise schedule a scan for the container appearing and
 *  another for it going away. */
export function isAssistantNode(node: Node): boolean {
  const element =
    node.nodeType === 1 ? (node as Element) : ((node.parentElement as Element | null) ?? null);
  return (
    element?.closest(
      `[${OFFER_MARKER_ATTR}], [${OFFER_LINK_ATTR}], [${LOT_MARKER_ATTR}], [${ORDER_MARK_ATTR}], [${STACK_ATTR}]`
    ) != null
  );
}
