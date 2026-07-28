"use client";

import { useEffect, useRef } from "react";

/**
 * One Escape, one surface (#361).
 *
 * Dialogs, pickers and the photo lightbox all used to register their own document-level Escape
 * listener, and each nested surface fought the ones beneath it by listening in the capture phase
 * and calling `stopImmediatePropagation`. That only works while the nesting order happens to match
 * the registration order: capture listeners on the same target fire in the order they were added,
 * so the *outer* dialog — mounted first — ran first and closed itself out from under the lightbox
 * that had just opened above it.
 *
 * Instead, every dismissable surface registers here. The stack is ordered by mount, which is the
 * order surfaces are opened in, so the last entry is the topmost one and it is the only one that
 * hears Escape.
 *
 * The shared listener deliberately does **not** stop the event: popovers that are not layers of
 * their own (row-action menus, autocompletes, translation popovers) keep their own listeners and
 * keep behaving as they did. A surface that must yield to such a popover disables its layer while
 * the popover is up — that is what `DialogShell`'s `dismissable` is for.
 */
type Layer = { onEscape: () => void };

const stack: Layer[] = [];
let listening = false;

function onDocumentKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.onEscape();
}

function push(layer: Layer) {
  stack.push(layer);
  if (!listening) {
    document.addEventListener("keydown", onDocumentKeyDown, true);
    listening = true;
  }
}

function remove(layer: Layer) {
  const i = stack.indexOf(layer);
  if (i >= 0) stack.splice(i, 1);
}

/** Close this surface on Escape while it is the topmost registered layer. Pass `enabled: false`
 * to step out of the stack (e.g. while a nested popover owns the key). */
export function useEscapeLayer(onEscape: () => void, enabled = true) {
  const latest = useRef(onEscape);
  useEffect(() => {
    latest.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!enabled) return;
    const layer: Layer = { onEscape: () => latest.current() };
    push(layer);
    return () => remove(layer);
  }, [enabled]);
}
