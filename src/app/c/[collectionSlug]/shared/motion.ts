"use client";

// The one place the app reads `prefers-reduced-motion` (#1022).
//
// `globals.css` already suppresses the three animations it has — `.just-added-flash` (#158),
// `.arrival-flash` (#850/#876) and the toast slide (#541) — under
// `@media (prefers-reduced-motion: reduce)`. The **scroll** that goes with an arrival is
// JavaScript, and it honoured nothing: a collector who had asked for less motion got the flash
// suppressed and the whole page gliding instead, which is the motion they asked not to have. The
// CSS kept the preference and the JavaScript did not.
//
// **Decided here rather than at each call site.** Three call sites reaching for `matchMedia`
// separately is three chances to miss the fourth, and the fourth is the one nobody would notice —
// nothing in the five required checks looks at a screen, so an unguarded `behavior: "smooth"` is
// green forever. So the preference is read in this module and the call sites say only *scroll this
// into view*; `Omit<…, "behavior">` below is what makes that a compiler guarantee rather than a
// convention.
//
// **A scroll that must be instant whatever the preference does not belong here.** It calls the DOM
// method with no `behavior` at all — the autocomplete's keyboard navigation and the Delcampe
// category picker both do, and gliding on an arrow key would be wrong under either preference.
// That is instant because `behavior: "auto"` resolves to the element's computed CSS
// `scroll-behavior`, which is `auto` unless something sets it: this app sets it nowhere, which was
// swept for rather than assumed.

/**
 * Whether the collector has asked their system for less motion.
 *
 * Read on each call rather than cached: the preference can be changed while the app is open, and
 * `matchMedia` is cheap enough that subscribing to it would be more machinery than the answer is
 * worth. Answers `false` where there is no `window` (the RSC pass, and the unit suite), which is
 * the safe direction — the caller then behaves exactly as it did before this module existed.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Bring `element` into view — gliding normally, instantly for a collector who asked for less
 * motion.
 *
 * `element` is nullable because every caller holds one out of a ref or a `querySelector` and a
 * missing node is a normal state (a row filtered away, a card not yet mounted), not an error.
 */
export function scrollIntoView(
  element: Element | null | undefined,
  options: Omit<ScrollIntoViewOptions, "behavior"> = {}
): void {
  element?.scrollIntoView({ ...options, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}
