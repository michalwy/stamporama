import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  prefersReducedMotion,
  scrollIntoView,
} from "../../src/app/c/[collectionSlug]/shared/motion";

/**
 * How much motion the app uses (#1022).
 *
 * `globals.css` suppressed the three flashes under `prefers-reduced-motion` and the scroll that
 * goes with an arrival honoured nothing, so a collector who had asked for less motion got the
 * flash removed and the whole page gliding — the motion they asked not to have.
 *
 * This is here because it is the **only** thing in the five required checks that can see any of
 * it. Nothing in the suite renders a screen, so an unguarded `behavior: "smooth"` is green
 * forever; what a test can pin is the one decision, which is why the decision was moved into a
 * module of its own rather than left at three call sites.
 *
 * What it cannot see: that the three call sites go through this module. That is a compiler
 * guarantee instead — `scrollIntoView` takes `Omit<ScrollIntoViewOptions, "behavior">`, so a call
 * site cannot restate the preference even by accident.
 */

/** A `window` with just the one method this module reads. */
function stubWindow(reduce: boolean | null): void {
  (globalThis as { window?: unknown }).window =
    reduce === null ? {} : { matchMedia: (query: string) => ({ matches: reduce && query.includes("reduce") }) };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("motion", () => {
  describe("prefersReducedMotion", () => {
    it("is true when the system asks for less motion", () => {
      stubWindow(true);
      assert.equal(prefersReducedMotion(), true);
    });

    it("is false when it does not", () => {
      stubWindow(false);
      assert.equal(prefersReducedMotion(), false);
    });

    it("is false with no window at all — the RSC pass, and this suite", () => {
      assert.equal(prefersReducedMotion(), false);
    });

    it("is false where `window` exists but `matchMedia` does not", () => {
      // The safe direction: the caller then behaves exactly as it did before this module existed,
      // rather than throwing on a browser too old to answer.
      stubWindow(null);
      assert.equal(prefersReducedMotion(), false);
    });
  });

  describe("scrollIntoView", () => {
    /** Records what the DOM method was handed. */
    function fakeElement() {
      const calls: ScrollIntoViewOptions[] = [];
      return {
        calls,
        el: { scrollIntoView: (opts: ScrollIntoViewOptions) => calls.push(opts) } as unknown as Element,
      };
    }

    it("glides normally", () => {
      stubWindow(false);
      const { calls, el } = fakeElement();
      scrollIntoView(el, { block: "center" });
      assert.deepEqual(calls, [{ block: "center", behavior: "smooth" }]);
    });

    it("is instant under reduced motion, and keeps the rest of the options", () => {
      stubWindow(true);
      const { calls, el } = fakeElement();
      scrollIntoView(el, { block: "center" });
      // `block: "center"` is not motion — it is which part of the card ends up under the sticky
      // header — so it survives the preference. Only `behavior` changes.
      assert.deepEqual(calls, [{ block: "center", behavior: "auto" }]);
    });

    it("does nothing for a node that is not there", () => {
      // Normal, not exceptional: a row filtered out of its column, a card not yet mounted. The
      // trade summary's *Go to the first* reads exactly this case and says so on screen.
      stubWindow(false);
      assert.doesNotThrow(() => scrollIntoView(null, { block: "center" }));
      assert.doesNotThrow(() => scrollIntoView(undefined));
    });
  });
});
