"use client";

import { useEffect } from "react";

/**
 * While a dialog is open, the page behind it does not scroll (#1577).
 *
 * The page is the document itself — there is no inner scroll container — so scrolling a dialog's
 * list past its end, or turning the wheel over the backdrop, used to move the page underneath and
 * lose the collector's place on it. Every surface that covers the page holds this lock while it is
 * mounted, and the page is locked while **any** of them does: dialogs nest (a picker opened from a
 * form), and closing the inner one must not unlock the page under the outer one.
 *
 * The lock is an attribute on `<html>`, and `globals.css` does the rest:
 *
 * - `html[data-page-scroll-locked] { overflow: hidden }` — the wheel, a trackpad and the keyboard
 *   all stop moving the page, and the page keeps its scroll position, so it is exactly where it was
 *   when the dialog closes.
 * - `html { scrollbar-gutter: stable }` — the scrollbar's room is kept whether or not it is drawn, so
 *   the page does not jump sideways or change width as a dialog opens and closes.
 * - `overscroll-behavior: contain` inside every dialog, listbox and menu — a list scrolled to its
 *   end stops there rather than dragging the dialog body (or the page) along.
 */
export const PAGE_SCROLL_LOCK_ATTRIBUTE = "data-page-scroll-locked";

/** What the lock needs of `<html>`; a plain object stands in for it in the unit test. */
export interface ScrollLockRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** A counted lock over one root: the attribute is set by the first holder and cleared by the last.
 *  Releasing twice is a no-op, so an effect cleanup that runs again cannot unlock a page another
 *  surface still holds. */
export function createPageScrollLock(root: () => ScrollLockRoot) {
  let holders = 0;
  return {
    acquire(): () => void {
      if (holders++ === 0) root().setAttribute(PAGE_SCROLL_LOCK_ATTRIBUTE, "");
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--holders === 0) root().removeAttribute(PAGE_SCROLL_LOCK_ATTRIBUTE);
      };
    },
    get holders() {
      return holders;
    },
  };
}

const lock = createPageScrollLock(() => document.documentElement);

/** Lock the page's scroll while this surface is mounted (and `active`). */
export function usePageScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    return lock.acquire();
  }, [active]);
}
