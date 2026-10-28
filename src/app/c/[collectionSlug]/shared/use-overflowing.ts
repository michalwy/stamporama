"use client";

import { useEffect, useRef, useState } from "react";

/** Whether a single-line, ellipsised element is currently cutting its text short (#1412) — so the
 *  full text is offered on hover only when some of it is actually hidden. Re-read on every resize,
 *  since a window made narrower is what shortens it, and whenever the text itself changes. */
export function useOverflowing<T extends HTMLElement>(text: string) {
  const ref = useRef<T>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setOverflowing(el.scrollWidth > el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return [ref, overflowing] as const;
}
