"use client";

import type { StampCopyCounts } from "@/lib/copy-counts";
import { STAMP_SECONDARY_CHIP } from "./chip-styles";
import { Tooltip } from "./tooltip";

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
// So the breakdown is a **panel shown on hover** (#721), the shared `Tooltip` with a small grid of
// labelled figures in it — the same shape the purchase-cost cell uses (#457) — rather than a hover
// *hint*: it needs room to rule the markers off from the total and to say in words that a copy can
// carry more than one of them, which a sentence cannot do. It opened on click until #721, and the
// click is worth more than the breakdown is: the reason to look at the chip at all is usually to go
// to the copies, and spending the only click on a read-only summary meant the ⋮ menu's *View
// copies* was the sole way there from a row whose chip was pointing straight at it. Hover is what a
// preview is for, so **hover previews and click opens the copies** — the same dialog that entry
// opens (#110/#125), passed in as `onOpenCopies`. It is the shared `Tooltip` and not a second hover
// mechanism because placement, viewport clamping and the rule that an inner hint silences an outer
// one are the hard part and are already solved there; it also drops the portal, the outside-click
// listener and the stopped Escape this chip used to carry, all of which existed only to make a
// click-opened surface behave inside a dialog.
//
// Where there is **no copies view to open** — the stamp pickers, the identify dialog, the detail
// pages — no `onOpenCopies` is passed and the chip is a plain `<span>` rather than a dead button:
// the panel still previews on hover, and a chip that looks pressable and does nothing is worse than
// one that never claimed to be. This is why `WantChip` beside it is *not* being changed to match:
// its popover is still the only place its wants are listed, so its click is still the way in.
//
// What the chip does carry is a **dot per marker present** — green in collection, blue for sale,
// violet for trade, the copy rows' own vocabulary. Presence, never quantity: an unnumbered dot is
// the one part of the breakdown that survives beside a total, because there is nothing there for
// the eye to try to add up. A dot lights for a marker carried anywhere the chip counts, this
// stamp's copies or its variants' alike; which side it came from is a row in the panel. Copies
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
 * *Copies held* field, which says in one line what the hover panel lays out in rows. A marker no copy
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

/** One marker's row inside the hover panel: the name, tinted as the copy rows tint it, and its figure
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
   * the same chip, and broken down beside the stamp's own figures in the hover panel. */
  variantCopies,
  /** Slightly larger variant used on the flat stamp list, which sizes its chips up (mirrors
   * `SubtypeChip` / `ColnectChip`). */
  size = "small",
  /** Opens the read-only copies dialog — the `⋮` menu's *View copies* (#110/#125), handed in by
   * the row that already builds it, so the chip and the menu entry cannot open two different
   * surfaces. Omitted where the site has no such view (pickers, dialogs, detail pages); the chip
   * is then not a control at all and only previews on hover. */
  onOpenCopies,
}: {
  copies: StampCopyCounts | null | undefined;
  variantCopies?: StampCopyCounts | null;
  size?: "small" | "medium";
  onOpenCopies?: () => void;
}) {
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
  // it up. The figures are a hover away in the panel. The unmarked copies get no dot — they have
  // no disposition to be coloured by, and "no disposition" is what the *absence* of dots already says.
  const dots = rows.filter((m) => m.token !== null);

  const label = [
    summarize(total, variants.total),
    // What the dots convey, in words: which markers are present, not how many carry them.
    dots.length ? dots.map((m) => m.label.toLowerCase()).join(", ") : null,
    onOpenCopies ? "view the copies" : null,
  ]
    .filter(Boolean)
    .join(" — ");

  const contents = (
    <>
      {/* Spelled out rather than a bare number or "×3": the price sits at the other end of the
          same line, and a lone multiplier there reads as a quantity *of the price*. The noun is
          plural whenever a variant figure is present, since it then covers both numbers. */}
      {total}
      {variants.total > 0 && <span style={VARIANT_PART}>&nbsp;(+{variants.total})</span>}&nbsp;
      {total === 1 && variants.total === 0 ? "copy" : "copies"}
      {/* Decorative for a screen reader: the label above says the same in words. */}
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
    </>
  );

  const chipStyle: React.CSSProperties = {
    ...CHIP,
    fontSize: medium ? "0.75rem" : "0.6875rem",
    padding: medium ? "0.1rem 0.4rem" : "0.05rem 0.35rem",
    cursor: onOpenCopies ? "pointer" : "default",
  };

  return (
    <Tooltip
      content={<CopiesPanel total={total} variants={variants} rows={rows} />}
      // Wide enough for a labelled figure grid and the two sentences under it — sentence width
      // wraps the rows into a block nobody can read (`Tooltip`'s own `maxWidth` note).
      maxWidth="22rem"
      align="start"
      // The chip's own `flexShrink: 0` (from `STAMP_SECONDARY_CHIP`) has to sit on the wrapper the
      // tooltip inserts, or the chip line squeezes it as the row narrows.
      style={{ flexShrink: 0 }}
    >
      {onOpenCopies ? (
        <button
          type="button"
          aria-label={label}
          onClick={(e) => {
            // The row around this may act on a click of its own.
            e.stopPropagation();
            onOpenCopies();
          }}
          style={chipStyle}
        >
          {contents}
        </button>
      ) : (
        // Not a button where there is nothing to open: a control that does nothing on click is a
        // worse answer than a chip that never offered one. `role="img"` is what gives the plain
        // span an accessible name at all — an `aria-label` on a bare `<span>` is not reliably
        // exposed — and it collapses the number, the muted `(+2)` and the dots into the one
        // sentence the button's label says.
        <span role="img" aria-label={label} style={chipStyle}>
          {contents}
        </span>
      )}
    </Tooltip>
  );
}

/** The breakdown itself, as it reads inside the hover panel: the total, then the markers ruled off
 * below it, then what the figures do and do not cover. */
function CopiesPanel({
  total,
  variants,
  rows,
}: {
  total: number;
  variants: StampCopyCounts;
  rows: { key: string; token: string | null; label: string; own: number; variant: number }[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <span style={PANEL_HEADING}>{summarize(total, variants.total)}</span>

      {/* Ruled off from the total above: the figures below describe those copies, they do not
          divide them. */}
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
          <MarkerRow key={m.key} label={m.label} token={m.token} own={m.own} variant={m.variant} />
        ))}
      </div>

      {/* The sentence the chip could not carry, and the reason the breakdown lives here at all.
          Only worth saying when two markers are actually in play — with one marker there is
          nothing to add up wrongly. */}
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
    </div>
  );
}
