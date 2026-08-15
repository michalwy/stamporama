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
