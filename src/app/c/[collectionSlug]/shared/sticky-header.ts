"use client";

import { useEffect, useRef, useState } from "react";

// Pinned headers on a long, page-scrolled list (#172, #621, #637).
//
// The pattern these two hooks serve is one thing: a card's own header pins at the top of the
// viewport while its rows scroll under it, and a **group** header inside the card pins right below
// that one rather than over it. Which means a nested header has to know the height of the header
// above it, and both have to know whether they are currently pinned — CSS `position: sticky` says
// neither.
//
// Extracted from the purchase-order screen, which is where the behaviour was worked out, so the
// trade screen's sections and their group headings pin **identically** rather than approximately.
// Two implementations of "am I stuck yet" would drift by a pixel and then by a rule.

/** Drop shadow under a sticky header once it is pinned — not at rest — so it reads as floating
 *  above the rows scrolling beneath it. Downward-only, so a card clipping its overflow does not cut
 *  it and it does not bleed over the row above. */
export const STUCK_SHADOW = "0 6px 8px -6px rgba(0, 0, 0, 0.28)";

/**
 * Whether a sticky header is currently pinned.
 *
 * A zero-height sentinel is rendered just **above** the sticky element; once that sentinel scrolls
 * past the pin line (`topOffset` from the viewport top) the header is stuck. Place the returned ref
 * on the sentinel and read `stuck` for the shadow.
 */
export function useStuck(topOffset: number) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { rootMargin: `-${Math.max(0, Math.round(topOffset))}px 0px 0px 0px`, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [topOffset]);
  return { sentinelRef, stuck };
}

/** An element's rendered height, kept current across resizes and content changes — what a nested
 *  sticky header pins below. Measured rather than assumed: a header's height depends on what is in
 *  it, and a hard-coded offset is a header that overlaps the moment a chip wraps. */
export function useMeasuredHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}
