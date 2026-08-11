"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StampWantSummary } from "@/lib/wants";
import {
  wantMatchesCopy,
  WANT_PRIORITY_CHIP,
  WANT_PRIORITY_LABEL,
  type WantCandidateCopy,
} from "@/lib/want-rules";
import { STAMP_SECONDARY_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import {
  WantCopyCountsLine,
  hasIncomingCopies,
  wantCopyCountsText,
} from "./want-copy-counts";
import { Icon } from "@/app/icons";

/**
 * The catalogue row's *you are looking for this* marker (#532), on the stamps list and in every
 * issue's stamp tree.
 *
 * **Absent when nothing is wanted**, which is the whole point: a chip on a handful of rows out of a
 * catalogue is a signal, and one on every row saying "0" is a column. Open wants only — a settled
 * one would keep the marker lit for ever, and what this answers is what is still being chased.
 *
 * The detail opens on **click, as a popover**, not on hover as a tooltip. A tooltip is one short line of
 * prose; what sits behind this chip is up to a dozen wants, each with three axes and a priority, and
 * flattening that into a paragraph made it unreadable. A popover can draw them the way the want list
 * draws them — one row of chips per want — which is also what stops the two surfaces describing one
 * want differently.
 *
 * Deliberately a **popover, not a layer**: it owns its own Escape and outside-click rather than
 * joining the escape stack (#361), the call `MultiSelectFilter` and the row menu make, because it is
 * not a surface one navigates into. Portaled to `<body>` with fixed positioning so a row's `overflow`
 * cannot clip it, and closed on scroll for the reason a row menu is: a fixed box does not follow its
 * trigger.
 *
 * `copy` is what turns "this stamp is wanted" into "**this** would satisfy a want". A catalogue row
 * names a stamp and nothing more, so it passes none; an auction lot line names a concrete
 * `(condition, certificate, format)` and passes it, and the chip then marks itself and the matching
 * rows in the popover. The decision runs through `wantMatchesCopy` — the same predicate the intake
 * review uses — so a lot marked as matching and the review that greets the copy when it arrives
 * cannot disagree.
 */

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  fontSize: "0.75rem",
  background: "var(--color-bg-muted)",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

export function WantChip({
  wants,
  copy,
}: {
  wants: StampWantSummary | null;
  /** The concrete thing in front of the collector, where the surface has one. */
  copy?: WantCandidateCopy;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      // Stopped, not merely handled: this chip is rendered inside dialogs too, and the same
      // keypress reaching the escape stack would take the surface underneath with it.
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  if (!wants || wants.openCount === 0) return null;

  const matched = wants.entries.map((e) => !!copy && wantMatchesCopy(e.acceptance, copy));
  const matchCount = matched.filter(Boolean).length;
  // Matching takes the colour of the loudest want it satisfies, not of the loudest want on the
  // stamp: what is being said is "this one is on your list", and it should be as urgent as the want
  // it answers.
  const topShown = matchCount
    ? wants.entries.find((_, i) => matched[i])!.priority
    : wants.topPriority;
  const chip = WANT_PRIORITY_CHIP[topShown];
  const copyCounts = wantCopyCountsText(wants.copies);
  // The chip's own hint is about the *wants*, so it asks the per-want figures, not the stamp's.
  const incoming = wants.entries.some((e) => hasIncomingCopies(e.copies));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={[
          matchCount
            ? `Matches ${matchCount} of ${wants.openCount} wants`
            : wants.openCount === 1
              ? "Wanted"
              : `${wants.openCount} wants`,
          incoming ? "one already on its way" : null,
          "show terms",
        ]
          .filter(Boolean)
          .join(" — ")}
        onClick={(e) => {
          // The row around this may act on a click of its own.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        // Built on the **shared chip base** the copy-count badge and the catalog chips beside it use
        // (#459's vocabulary, `chip-styles.ts`), so it sits on their line rather than near it. Its
        // own metrics were a rem out and the row read as a stack of three different things. A
        // `<button>` also brings its own font and line-height, which is what the two resets undo.
        style={{
          ...STAMP_SECONDARY_CHIP,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.2rem",
          fontFamily: "inherit",
          fontSize: "0.75rem",
          lineHeight: "inherit",
          fontWeight: matchCount || topShown === "high" ? 600 : 500,
          background: chip.background,
          color: chip.color,
          borderColor: chip.border,
          cursor: "pointer",
          // A match is the loud case and gets a ring rather than another colour: the colour is
          // already spoken for by priority, and stacking two meanings on it would leave neither
          // readable.
          boxShadow: matchCount ? `0 0 0 2px ${chip.border}` : undefined,
        }}
      >
        <Icon name="wants" size="xs" />
        {/* The count is **always** drawn, one included. Dropping it for a single want was the
            tidier reading and the wrong call: an icon on its own gives the chip no text to set its
            line box from, so it came out shorter than every chip beside it. A number that repeats
            what the icon implies costs a character; a row of chips at three different heights costs
            the line. It also makes the figure scannable down the list without first telling
            "icon alone" apart from "icon and number". */}
        {wants.openCount}
      </button>

      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Wants for this stamp"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              maxWidth: "26rem",
              maxHeight: "20rem",
              overflowY: "auto",
              padding: "0.5rem",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              boxShadow: "0 8px 24px rgb(0 0 0 / 0.16)",
              // Above a dialog's own panel, so the chip works inside one as well as on a list.
              zIndex: 200,
              display: "flex",
              flexDirection: "column",
              gap: "0.375rem",
            }}
          >
            <span
              style={{
                fontSize: "0.6875rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--color-text-muted)",
              }}
            >
              {matchCount
                ? `Matches ${matchCount} of ${wants.openCount === 1 ? "1 want" : `${wants.openCount} wants`}`
                : wants.openCount === 1
                  ? "Wanted"
                  : `${wants.openCount} wants`}
            </span>

            {/* What the collection has of **the stamp**, whichever want it answers — context, and
                deliberately making no claim about anything being on its way. That claim belongs to
                the want it is true of, and sits on each entry below: a used copy in the post
                answers a want for "anything" and a mint-only want not at all, so one line over a
                list of wants would send you bidding on the wrong thing. */}
            {copyCounts && (
              <div
                style={{
                  // Ruled off from the wants below. Sitting flush above the first one, it read as
                  // that want's own figure — which is exactly the confusion the per-stamp and
                  // per-want split exists to prevent.
                  paddingBottom: "0.5rem",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <WantCopyCountsLine copies={wants.copies} prefix="Of this stamp:" />
              </div>
            )}

            {wants.entries.map((entry, i) => {
              const priority = WANT_PRIORITY_CHIP[entry.priority];
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                    paddingTop: i === 0 ? 0 : "0.375rem",
                    borderTop: i === 0 ? undefined : "1px solid var(--color-border)",
                  }}
                >
                  {/* The figures alone. They sit inside this want's own block, so a sentence
                      restating whose they are is words for what the layout already says — and each
                      bucket is coloured on its own, since only the ones still in the post are news. */}
                  <WantCopyCountsLine copies={entry.copies} />
                  {matched[i] && (
                    <span
                      style={{
                        fontSize: "0.6875rem",
                        fontWeight: 600,
                        color: "var(--color-success)",
                      }}
                    >
                      This one would satisfy it
                    </span>
                  )}
                  {/* The same four chips the want list row draws, in the same order. */}
                  <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                    <span style={CHIP}>{entry.conditions}</span>
                    <span style={CHIP}>{entry.certificate}</span>
                    <span style={CHIP}>{entry.format}</span>
                    <span
                      style={{
                        ...CHIP,
                        ...priority,
                        border: `1px solid ${priority.border}`,
                        fontWeight: entry.priority === "high" ? 600 : 400,
                      }}
                    >
                      {WANT_PRIORITY_LABEL[entry.priority]}
                    </span>
                  </div>
                  {entry.notes && (
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      {entry.notes}
                    </span>
                  )}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
