"use client";

import Link from "next/link";
import type { CSSProperties } from "react";

/**
 * The whole-row navigation of a list row, as a **real link** (#557).
 *
 * These rows used to be a `<div role="link">` with an `onClick` that called `router.push`, which
 * navigates on a plain left click and on nothing else: cmd/ctrl+click opened the row in the same
 * tab, the middle button did nothing at all, and the browser's own context menu had no *Open link
 * in new tab* to offer — because there was no link. A row that reads as a link has to be one.
 *
 * It is drawn as an **overlay** rather than by wrapping the row, because a row is full of controls
 * — the `⋮` menu, an inline advance button, the marketplace link on line 2 — and interactive
 * content nested inside an `<a>` is neither valid nor reliably clickable. The anchor therefore
 * covers the row at {@link ROW_LINK_Z}, and anything that needs its own pointer behaviour is
 * lifted above it with {@link ROW_LINK_ABOVE}.
 *
 * Two consequences worth knowing:
 *
 * - The row keeps its own `onClick`. A lifted region is *above* the link, so a plain click there
 *   would otherwise do nothing where today it opens the row; the handler catches it as it bubbles.
 *   The anchor stops its own click for the same reason in reverse — without it a click on the link
 *   would navigate twice, once through the anchor and once through the row.
 * - Lifting a region takes the browser's new-tab affordances with it: the collector right-clicks
 *   the row's **name**, not the chip line under it. That is where a link is aimed anyway, and it
 *   is the trade that keeps every tooltip and inline control on the row working — an overlay over
 *   a `Tooltip` swallows the hover it exists for.
 *
 * The row must be `position: relative` for the overlay to cover it, and must drop the
 * `role="link"` / `tabIndex` / Enter handling it carried by hand: the anchor is the tab stop and
 * the keyboard target now, and two of them on one row is one too many.
 */
export const ROW_LINK_Z = 1;

/** Row content that sits above the overlay: interactive controls, and anything hover-driven. */
export const ROW_LINK_ABOVE: CSSProperties = { position: "relative", zIndex: ROW_LINK_Z + 1 };

export function RowLink({
  href,
  label,
  /** Native `title` for the row, where it carried one (a name too long for its column). */
  title,
}: {
  href: string;
  /** What the link is called for a screen reader — the row's own name, since the anchor is empty. */
  label: string;
  title?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={title}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: ROW_LINK_Z,
        borderRadius: "inherit",
      }}
    />
  );
}
