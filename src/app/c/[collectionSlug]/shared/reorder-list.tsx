"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Drag-to-reorder (#306, #313) ────────────────────────────────────────────
// The **container** is the drop target, not the individual cards / rows: the landing gap is derived
// from the pointer's position against each element's midpoint. That way the gaps between elements,
// the insertion line itself, and the outer halves of the first and last element all drop where the
// user expects — there is no thin strip to hit.

/** Everything a reorderable list needs: spread `containerProps` on the scrolling list, `itemProps`
 * on each element, and draw an {@link InsertionLine} wherever {@link showLineAt} says so. */
export interface DragList {
  /** Index being dragged, or null when idle. */
  fromIndex: number | null;
  /** The gap the drop lands in — the index the line is drawn *before* (`count` means "at the end"). */
  insertAt: number | null;
  containerProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  itemProps: (index: number) => {
    ref: (el: HTMLElement | null) => void;
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  /** With `handleOnly`, spread these on the part that starts a drag (a card's header). The element
   * itself stays the drag source, so the ghost is the whole card, not just the strip you grabbed. */
  handleProps: (index: number) => { onMouseDown: () => void; onMouseUp: () => void };
}

/** Wires one reorderable list. `onMove(from, to)` gets list indexes; it fires only for a real move.
 * Returns null when reordering is off, so the caller can spread nothing. With `handleOnly`, an
 * element only becomes draggable while the pointer went down on its handle. */
export function useReorderList(
  enabled: boolean,
  onMove: (from: number, to: number) => void,
  { handleOnly = false }: { handleOnly?: boolean } = {}
): DragList | null {
  const [fromIndex, setFromIndex] = useState<number | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  /** Index whose handle is currently held down — only that element is draggable (handle mode). */
  const [armed, setArmed] = useState<number | null>(null);
  const els = useRef(new Map<number, HTMLElement>());

  // A press that never became a drag (pointer released off the handle) must disarm too, or the card
  // would stay grabbable anywhere until the next click.
  useEffect(() => {
    if (armed == null) return;
    const disarm = () => setArmed(null);
    window.addEventListener("mouseup", disarm);
    return () => window.removeEventListener("mouseup", disarm);
  }, [armed]);

  /** Which gap the pointer sits in: before the first element whose midpoint it has not passed. */
  const gapAt = useCallback((clientY: number) => {
    const entries = [...els.current.entries()].sort((a, b) => a[0] - b[0]);
    for (const [index, el] of entries) {
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return index;
    }
    return entries.length;
  }, []);

  const reset = useCallback(() => {
    setFromIndex(null);
    setInsertAt(null);
    setArmed(null);
  }, []);

  const containerProps = useMemo(
    () => ({
      // Claim the event only while *this* list is the one being dragged, so a set dragged over an
      // expanded card's copies still reaches the set list, and vice versa.
      onDragOver: (e: React.DragEvent) => {
        if (fromIndex == null) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const at = gapAt(e.clientY);
        setInsertAt((prev) => (prev === at ? prev : at));
      },
      onDrop: (e: React.DragEvent) => {
        if (fromIndex == null) return;
        e.preventDefault();
        e.stopPropagation();
        const at = gapAt(e.clientY);
        // A gap below the source shifts down by one once the source is lifted out.
        const to = at > fromIndex ? at - 1 : at;
        const from = fromIndex;
        reset();
        if (to !== from) onMove(from, to);
      },
    }),
    [fromIndex, gapAt, onMove, reset]
  );

  const itemProps = useCallback(
    (index: number) => ({
      ref: (el: HTMLElement | null) => {
        if (el) els.current.set(index, el);
        else els.current.delete(index);
      },
      draggable: handleOnly ? armed === index : true,
      onDragStart: (e: React.DragEvent) => {
        e.stopPropagation();
        // Firefox only starts a drag when some data is set.
        e.dataTransfer.setData("text/plain", String(index));
        e.dataTransfer.effectAllowed = "move";
        setFromIndex(index);
        setInsertAt(null);
      },
      onDragEnd: reset,
    }),
    [armed, handleOnly, reset]
  );

  const handleProps = useCallback(
    (index: number) => ({
      onMouseDown: () => setArmed(index),
      onMouseUp: () => setArmed(null),
    }),
    []
  );

  if (!enabled) return null;
  return { fromIndex, insertAt, containerProps, itemProps, handleProps };
}

/** Whether the insertion line belongs before `index` — suppressed either side of the source, where
 * dropping would change nothing. */
export function showLineAt(drag: DragList | null, index: number): boolean {
  if (!drag || drag.fromIndex == null || drag.insertAt !== index) return false;
  return index !== drag.fromIndex && index !== drag.fromIndex + 1;
}

/** The line drawn in the gap between two elements to mark where the drop lands. Negative margins
 * cancel its own height, so the list does not jump while dragging. */
export function InsertionLine({ inset = 0 }: { inset?: number }) {
  return (
    <div
      aria-hidden
      style={{
        height: "3px",
        margin: `-1.5px ${inset}px`,
        borderRadius: "999px",
        background: "var(--color-accent)",
      }}
    />
  );
}

/** Lifted-source styling: only the element being dragged is marked, the target is left alone (the
 * insertion line carries that job). */
export function dragStyle(drag: DragList | null, index: number): React.CSSProperties {
  if (!drag || drag.fromIndex !== index) return {};
  return { opacity: 0.4, outline: "2px dashed var(--color-accent)", outlineOffset: "-2px" };
}

/** The grab affordance. Purely visual — the whole card / row is the draggable element, so there is
 * no thin handle to hit. */
export function DragGrip({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      title={label}
      style={{
        flexShrink: 0,
        padding: "0 0.25rem",
        color: "var(--color-text-muted)",
        fontSize: "0.75rem",
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      ⠿
    </span>
  );
}
