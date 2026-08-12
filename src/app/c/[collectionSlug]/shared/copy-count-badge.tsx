"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StampCopyCounts } from "@/lib/copy-counts";
import { STAMP_SECONDARY_CHIP } from "./chip-styles";

// How many copies of a stamp you hold, shown beside its catalog numbers wherever stamps are
// listed (#348): the issue tree, the flat stamp list, and the stamp pickers that reuse the tree.
//
// **A stamp you own none of shows nothing.** Most of a catalog is stamps you do not have yet, so
// a "0" on every row would be a column of noise — the same rule the subtype chip and the single
// format follow. The badge therefore only ever means "you have some", and its absence means none.
//
// The chip states **one number: the copies held**. The breakdown by disposition deliberately does
// not go on the chip, because the dispositions are *markers, not slices* — a copy can be in the
// collection and for sale at once — so a run of figures beside the total would be a set of numbers
// that do not add up to it and cannot be made to. Read as parts of a whole, which is what a row of
// figures looks like, they are simply wrong.
//
// So the breakdown opens on **click, as a popover**, the way `WantChip` opens its wants: a surface
// with room to rule the markers off from the total, and to say in words that a copy can carry more
// than one of them. A tooltip could hold the same sentence but not the layout that makes it
// unnecessary to read.
//
// What the chip does carry is a **dot per marker present** — green in collection, blue for sale,
// violet for trade, the copy rows' own vocabulary. Presence, never quantity: an unnumbered dot is
// the one part of the breakdown that survives beside a total, because there is nothing there for
// the eye to try to add up. A dot lights for a marker carried anywhere the chip counts, this
// stamp's copies or its variants' alike; which side it came from is a row in the popover. Copies
// carrying no disposition get no dot — the absence of dots is already what that looks like.
//
// The count is *this stamp's* copies exactly, never rolled up from variant children: the tree
// shows each child's own badge right below, so a rollup would show one copy on two rows. What the
// variants hold is a **parenthesised addition inside the same chip** (#528) — "3 (+2) copies" —
// so the two questions ("how many of this do I have" and "how many of its variants") keep their
// own numbers without either being folded into a sum. One chip rather than two: a second chip on
// a line that already carries catalog numbers, a Colnect link, a subtype and a price stopped being
// readable as anything but more noise. The parenthesised half is drawn muted, and appears against
// a **zero** — "0 (+2) copies" — when the stamp has no copies of its own, which is the ordinary
// shape of an unknown-variant umbrella whose copies are all filed under specific variants; that is
// the one case where the badge shows a 0, and it is showing it *about* something you hold.

const CHIP: React.CSSProperties = {
  ...STAMP_SECONDARY_CHIP,
  display: "inline-flex",
  alignItems: "center",
  fontFamily: "inherit",
  lineHeight: "inherit",
  fontWeight: 600,
  color: "var(--color-disposition-collection)",
  borderColor: "var(--color-disposition-collection-border)",
  background: "var(--color-disposition-collection-soft)",
  cursor: "pointer",
};

/** The parenthesised variant figure inside the chip (#528): the badge's own shape, drawn muted so
 * the row's own number still reads first. Green is what "you hold this" is tinted with, and these
 * copies are held of something one level down. */
const VARIANT_PART: React.CSSProperties = {
  fontWeight: 500,
  opacity: 0.8,
};

/** A disposition dot on the chip: presence, never quantity. Sized in `em` so it follows whichever
 * chip size is in use. */
const DOT: React.CSSProperties = {
  width: "0.45em",
  height: "0.45em",
  borderRadius: "50%",
  background: "currentColor",
  display: "inline-block",
};

const PANEL_HEADING: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--color-text-muted)",
};

const NOTE: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "var(--color-text-muted)",
  lineHeight: 1.4,
};

/** Local zero, since `copy-counts` is server-only and this badge is a client component. */
const NO_COPY_COUNTS: StampCopyCounts = {
  total: 0,
  inCollection: 0,
  forSale: 0,
  forTrade: 0,
  unmarked: 0,
};

/** The disposition markers, in the order the copy rows list them, followed by the copies carrying
 * no disposition at all — which are held all the same and are the one figure that would otherwise
 * have nothing in the breakdown to account for it. `token` is the disposition colour vocabulary the copy
 * rows use; the unmarked figure has no disposition to be coloured by and is drawn muted. */
const MARKERS = [
  { key: "inCollection", token: "collection", label: "In collection" },
  { key: "forSale", token: "sale", label: "For sale" },
  { key: "forTrade", token: "trade", label: "For trade" },
  { key: "unmarked", token: null, label: "No disposition" },
] as const;

/** The markers spelled out in full — "2 in collection", "1 for sale" — for the stamp page's
 * *Copies held* field, which says in one line what the popover lays out in rows. A marker no copy
 * carries is left out. */
export function dispositionParts(copies: StampCopyCounts): string[] {
  const parts: string[] = [];
  if (copies.inCollection) parts.push(`${copies.inCollection} in collection`);
  if (copies.forSale) parts.push(`${copies.forSale} for sale`);
  if (copies.forTrade) parts.push(`${copies.forTrade} for trade`);
  if (copies.unmarked) parts.push(`${copies.unmarked} with no disposition`);
  return parts;
}

/** What the chip itself says, and what a screen reader hears before opening anything. */
function summarize(total: number, variantTotal: number): string {
  const held = `${total} ${total === 1 ? "copy" : "copies"} held`;
  return variantTotal ? `${held}, ${variantTotal} more under its variants` : held;
}

/** One marker's row inside the popover: the name, tinted as the copy rows tint it, and its figure
 * — with the variants' own figure kept in its own column rather than folded into the number. */
function MarkerRow({
  label,
  token,
  own,
  variant,
}: {
  label: string;
  token: string | null;
  own: number;
  variant: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "0.75rem" }}>
      <span
        style={{
          flex: 1,
          color: token ? `var(--color-disposition-${token})` : "var(--color-text-muted)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{own}</span>
      {variant > 0 && (
        <span style={{ ...NOTE, fontVariantNumeric: "tabular-nums" }}>+{variant} in variants</span>
      )}
    </div>
  );
}

export function CopyCountBadge({
  copies,
  /** Copies held under this stamp's variant-kind descendants (#528). Drawn as a muted `(+2)` in
   * the same chip, and broken down beside the stamp's own figures in the popover. */
  variantCopies,
  /** Slightly larger variant used on the flat stamp list, which sizes its chips up (mirrors
   * `SubtypeChip` / `ColnectChip`). */
  size = "small",
}: {
  copies: StampCopyCounts | null | undefined;
  variantCopies?: StampCopyCounts | null;
  size?: "small" | "medium";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Positioning, dismissal and Escape handling are `WantChip`'s exactly (#532): the two chips sit
  // on the same row and would be indefensible to open differently. Portaled to `<body>` with fixed
  // positioning so a row's `overflow` cannot clip it, closed on scroll because a fixed box does not
  // follow its trigger, and its Escape is **stopped** rather than merely handled — the badge is
  // rendered inside dialogs too, and the same keypress reaching the escape stack (#361) would take
  // the surface underneath with it.
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

  const counts = copies ?? NO_COPY_COUNTS;
  const variants = variantCopies ?? NO_COPY_COUNTS;
  const total = counts.total;
  if (total === 0 && variants.total === 0) return null;
  const medium = size === "medium";
  const rows = MARKERS.map((m) => ({ ...m, own: counts[m.key], variant: variants[m.key] })).filter(
    (m) => m.own > 0 || m.variant > 0
  );
  // Presence, not quantity: a dot says *there is at least one copy marked this way*, which is the
  // one thing about the breakdown that can be said beside a total without inviting the eye to add
  // it up. The figures are a click away in the popover. The unmarked copies get no dot — they have
  // no disposition to be coloured by, and "no disposition" is what the *absence* of dots already says.
  const dots = rows.filter((m) => m.token !== null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={[
          summarize(total, variants.total),
          // What the dots convey, in words: which markers are present, not how many carry them.
          dots.length ? dots.map((m) => m.label.toLowerCase()).join(", ") : null,
          "show the breakdown",
        ]
          .filter(Boolean)
          .join(" — ")}
        onClick={(e) => {
          // The row around this may act on a click of its own.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          ...CHIP,
          fontSize: medium ? "0.75rem" : "0.6875rem",
          padding: medium ? "0.1rem 0.4rem" : "0.05rem 0.35rem",
        }}
      >
        {/* Spelled out rather than a bare number or "×3": the price sits at the other end of the
            same line, and a lone multiplier there reads as a quantity *of the price*. The noun is
            plural whenever a variant figure is present, since it then covers both numbers. */}
        {total}
        {variants.total > 0 && <span style={VARIANT_PART}>&nbsp;(+{variants.total})</span>}&nbsp;
        {total === 1 && variants.total === 0 ? "copy" : "copies"}
        {/* Decorative for a screen reader: the button's `aria-label` says the same in words. */}
        {dots.map((m) => (
          <span
            key={m.key}
            aria-hidden
            style={{
              ...DOT,
              color: `var(--color-disposition-${m.token})`,
              marginLeft: "0.3em",
            }}
          />
        ))}
      </button>

      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Copies held of this stamp"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              minWidth: "15rem",
              maxWidth: "22rem",
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
            <span style={PANEL_HEADING}>{summarize(total, variants.total)}</span>

            {/* Ruled off from the total above: the figures below describe those copies, they do
                not divide them. */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                paddingTop: "0.375rem",
                borderTop: "1px solid var(--color-border)",
              }}
            >
              {rows.map((m) => (
                <MarkerRow
                  key={m.key}
                  label={m.label}
                  token={m.token}
                  own={m.own}
                  variant={m.variant}
                />
              ))}
            </div>

            {/* The sentence the chip could not carry, and the reason the breakdown lives here at
                all. Only worth saying when two markers are actually in play — with one marker there
                is nothing to add up wrongly. */}
            {rows.length > 1 && (
              <span style={NOTE}>
                A copy can carry more than one disposition, so these do not add up to the total.
              </span>
            )}
            <span style={NOTE}>
              Sold copies are not counted, nor are copies you no longer hold.
              {variants.total > 0
                ? " The variant figures are held of this stamp's variants, at any depth; children that" +
                  " are distinct entries (errors, plate flaws, overprints) are not counted."
                : ""}
            </span>
          </div>,
          document.body
        )}
    </>
  );
}
