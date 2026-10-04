"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

/**
 * **Clicking a list row opens that record's page** (#1591) — the click half of it, shared by every
 * list whose rows are records with a page of their own.
 *
 * A row is full of things that mean something else when clicked: a caret, a checkbox, a chip with
 * its own popover, a price that edits in place, the `⋮` menu. So the row only opens on a click that
 * **nothing on it wanted** — the rule the auction lot row already followed (#374) — and the test is
 * structural rather than a list each row keeps: everything interactive here is an `a`, a `button`,
 * a form control, a `label` or a `[role="button"]`, so one `closest` covers them and keeps covering
 * them as rows grow.
 *
 * Two more clicks are not the row's, and both are easy to miss:
 *
 * - **A click inside a dialog the row opened.** Rows render their own dialogs (`{addCopy.dialog}`),
 *   and React bubbles a synthetic event along the *component* tree — so a click in a portaled
 *   dialog, or on the backdrop of one drawn in place, would reach the row and navigate as the
 *   dialog closed. A portal is caught by the row not containing the target; an in-place dialog,
 *   backdrop and popover alike, by being `position: fixed`, which every overlay here is.
 * - **The end of a text selection.** Dragging across a row to copy a name is a read.
 *
 * A modified click (⌘, Ctrl, Shift) and the middle button open the page in a **new tab**, as they
 * would on a link (#557). The real link for the browser's own context menu is {@link RowTitleLink}
 * on the row's name: the row cannot be one anchor, since interactive content inside an `<a>` is
 * invalid, and an overlay anchor (`RowLink`) over these rows would swallow every tooltip and stop
 * text being selected at all.
 */
export function useRowOpen(href: string | null | undefined) {
  const router = useRouter();
  if (!href) return null;
  return {
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (!clickIsTheRows(event)) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      router.push(href);
    },
    onAuxClick: (event: MouseEvent<HTMLElement>) => {
      if (event.button !== 1 || !clickIsTheRows(event)) return;
      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    },
  };
}

/** The row's look while it opens on click: a pointer over all of it. The hover state is the row's
 *  own background, which every one of these rows already draws. */
export const ROW_OPEN_STYLE: CSSProperties = { cursor: "pointer" };

const ROW_CONTROL =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [contenteditable="true"]';

function clickIsTheRows(event: MouseEvent<HTMLElement>): boolean {
  if (event.defaultPrevented) return false;
  const row = event.currentTarget;
  const target = event.target;
  if (!(target instanceof Element) || !row.contains(target)) return false;
  for (let el: Element | null = target; el && el !== row; el = el.parentElement) {
    if (el.matches(ROW_CONTROL)) return false;
    if (getComputedStyle(el).position === "fixed") return false;
  }
  const selection = window.getSelection();
  return !selection || selection.isCollapsed || selection.toString() === "";
}

/**
 * The row's name, as a **real link** to the page the row opens (#1591, #557): what answers a
 * right-click with *Open link in new tab*, and a cmd- or middle-click natively. It reads as the
 * plain text it replaces — the whole row is the way in, and one underlined word would say otherwise.
 */
export function RowTitleLink({
  href,
  children,
  style,
}: {
  href: string | null | undefined;
  children: ReactNode;
  style?: CSSProperties;
}) {
  if (!href) return <>{children}</>;
  return (
    <Link
      href={href}
      // No `stopPropagation`: the row's handler already leaves a click on an `a` alone.
      style={{ color: "inherit", textDecoration: "none", ...style }}
    >
      {children}
    </Link>
  );
}
