"use client";

import { Fragment, useMemo } from "react";
import type { StampCopyCounts } from "@/lib/copy-counts";
import {
  breakDownCopies,
  copyLineParts,
  type CopyBreakdownGroup,
  type CopyBreakdownGroupKey,
  type CopyBreakdownLine,
} from "@/lib/copy-breakdown";
import { ROW_CHIP, STAMP_SECONDARY_CHIP } from "./chip-styles";
import { CertificateStatusChip, ConditionChip } from "./dictionary-chip";
import { Tooltip } from "./tooltip";
import { useCollectionConditions } from "./use-display-condition";
import { useCollectionCertificateStatuses } from "./use-certificate-statuses";
import { useCollectionFormats } from "./use-display-format";

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
// **Under each disposition the panel says which copies** (#1243): one line per condition ×
// certificate × format held, with its count — *MNH · Sig. · HPair — 1*. That is what decides
// whether another copy is worth having, and a total split only by disposition could not say it.
// Combinations rather than three tallies, because separate tallies cannot say which condition
// carries the certificate. The defaults — no certificate, single — are left off a line, so *MNH — 2*
// is two plain single copies; conditions and certificates are the dictionary's own chips (#728),
// resolved here from the cached dictionaries rather than carried on the row; and the lines follow
// the settings' order. The rolling up is `breakDownCopies`, pure, over the `lines` the count query
// already grouped, so each group's figure is the sum of its lines by construction.
//
// Where there is **no copies view to open** — the stamp pickers, the identify dialog, the detail
// pages — no `onOpenCopies` is passed and the chip is a plain `<span>` rather than a dead button:
// the panel still previews on hover, and a chip that looks pressable and does nothing is worse than
// one that never claimed to be. `WantChip` beside it took the same shape in #1244: hover for the
// wants, click for the want list.
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
// the one case where the badge shows a 0, and it is showing it *about* something you hold. The
// panel's lines keep the same split: a line is not divided by variant, but its variants' copies are
// their own `+N` beside its own figure, never added into it.

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

/** A line's chips, a size down from a list row's: a panel of them is read as a column, not as one
 * row of six. The tint is the dictionary chip's own and is not touched here. */
const LINE_CHIP: React.CSSProperties = {
  fontSize: "0.6875rem",
  padding: "0 0.3rem",
  borderRadius: "0.25rem",
};

/** Local zero, since `copy-counts` is server-only and this badge is a client component. */
const NO_COPY_COUNTS: StampCopyCounts = {
  total: 0,
  inCollection: 0,
  forSale: 0,
  forTrade: 0,
  unmarked: 0,
  lines: [],
};

/** How each disposition group is named and tinted, in the order the copy rows list the markers,
 * followed by the copies carrying no disposition at all — which are held all the same and are the
 * one figure that would otherwise have nothing in the breakdown to account for it. `token` is the
 * disposition colour vocabulary the copy rows use; the unmarked figure has no disposition to be
 * coloured by and is drawn muted. */
const MARKERS: Record<CopyBreakdownGroupKey, { token: string | null; label: string }> = {
  inCollection: { token: "collection", label: "In collection" },
  forSale: { token: "sale", label: "For sale" },
  forTrade: { token: "trade", label: "For trade" },
  unmarked: { token: null, label: "No disposition" },
};

const MARKER_KEYS = ["inCollection", "forSale", "forTrade", "unmarked"] as const;

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

export function CopyCountBadge({
  /** Resolves the panel's condition, certificate and format chips against the collection's
   * dictionaries (#1243). */
  collectionId,
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
  collectionId: string;
  copies: StampCopyCounts | null | undefined;
  variantCopies?: StampCopyCounts | null;
  size?: "small" | "medium";
  onOpenCopies?: () => void;
}) {
  const counts = copies ?? NO_COPY_COUNTS;
  const variants = variantCopies ?? NO_COPY_COUNTS;
  if (counts.total === 0 && variants.total === 0) return null;
  // A component of its own below the zero rule, so the dictionary reads it holds are made only by
  // rows that have a panel to draw — and made when the row renders, not on the first hover, which
  // would open a panel of blank chips.
  return (
    <HeldCopiesChip
      collectionId={collectionId}
      counts={counts}
      variants={variants}
      size={size}
      onOpenCopies={onOpenCopies}
    />
  );
}

function HeldCopiesChip({
  collectionId,
  counts,
  variants,
  size,
  onOpenCopies,
}: {
  collectionId: string;
  counts: StampCopyCounts;
  variants: StampCopyCounts;
  size: "small" | "medium";
  onOpenCopies?: () => void;
}) {
  const { data: conditions } = useCollectionConditions(collectionId);
  const { data: certificateStatuses } = useCollectionCertificateStatuses(collectionId);
  const { data: formats } = useCollectionFormats(collectionId);

  const total = counts.total;
  const medium = size === "medium";
  // Presence, not quantity: a dot says *there is at least one copy marked this way*, which is the
  // one thing about the breakdown that can be said beside a total without inviting the eye to add
  // it up. The figures are a hover away in the panel. The unmarked copies get no dot — they have
  // no disposition to be coloured by, and "no disposition" is what the *absence* of dots already says.
  const dots = MARKER_KEYS.filter(
    (key) => MARKERS[key].token !== null && (counts[key] > 0 || variants[key] > 0)
  );

  const groups = useMemo(
    () =>
      breakDownCopies(counts.lines, variants.lines, {
        conditionIds: (conditions ?? []).map((c) => c.id),
        certificateStatusIds: (certificateStatuses ?? []).map((c) => c.id),
        formatIds: (formats ?? []).map((f) => f.id),
      }),
    [counts.lines, variants.lines, conditions, certificateStatuses, formats]
  );

  const label = [
    summarize(total, variants.total),
    // What the dots convey, in words: which markers are present, not how many carry them.
    dots.length ? dots.map((key) => MARKERS[key].label.toLowerCase()).join(", ") : null,
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
      {dots.map((key) => (
        <span
          key={key}
          aria-hidden
          style={{
            ...DOT,
            color: `var(--color-disposition-${MARKERS[key].token})`,
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

  const names = {
    condition: (id: string) => {
      const c = conditions?.find((x) => x.id === id);
      return c ? c.abbreviation || c.name : "…";
    },
    certificate: (id: string) => {
      const c = certificateStatuses?.find((x) => x.id === id);
      return c ? c.abbreviation || c.name : "…";
    },
    format: (id: string) => {
      const f = formats?.find((x) => x.id === id);
      return f ? f.abbreviation || f.name : "…";
    },
  };

  return (
    <Tooltip
      content={
        <CopiesPanel
          collectionId={collectionId}
          total={total}
          variants={variants}
          groups={groups}
          names={names}
        />
      }
      // Wide enough for the chip lines, their figures and the two sentences under them — sentence
      // width wraps the rows into a block nobody can read (`Tooltip`'s own `maxWidth` note).
      maxWidth="26rem"
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

type LineNames = Record<"condition" | "certificate" | "format", (id: string) => string>;

/** The breakdown itself, as it reads inside the hover panel: the total, then each disposition ruled
 * off below it with the combinations held under it, then what the figures do and do not cover. */
function CopiesPanel({
  collectionId,
  total,
  variants,
  groups,
  names,
}: {
  collectionId: string;
  total: number;
  variants: StampCopyCounts;
  groups: CopyBreakdownGroup[];
  names: LineNames;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <span style={PANEL_HEADING}>{summarize(total, variants.total)}</span>

      {/* Ruled off from the total above: the figures below describe those copies, they do not
          divide them. One grid for every group, so the figures line up down the whole panel. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          columnGap: "0.5rem",
          rowGap: "0.2rem",
          alignItems: "center",
          paddingTop: "0.375rem",
          borderTop: "1px solid var(--color-border)",
          fontSize: "0.75rem",
        }}
      >
        {groups.map((group, i) => {
          const marker = MARKERS[group.key];
          return (
            <Fragment key={group.key}>
              <span
                style={{
                  color: marker.token
                    ? `var(--color-disposition-${marker.token})`
                    : "var(--color-text-muted)",
                  fontWeight: 500,
                  paddingTop: i === 0 ? 0 : "0.25rem",
                }}
              >
                {marker.label}
              </span>
              <Figure value={group.own} strong top={i > 0} />
              <VariantFigure value={group.variant} wording="in variants" top={i > 0} />
              {group.lines.map((line) => (
                <CopyLineRow
                  key={`${line.conditionId}~${line.certificateStatusId}~${line.formatId}`}
                  collectionId={collectionId}
                  line={line}
                  names={names}
                />
              ))}
            </Fragment>
          );
        })}
      </div>

      {/* The sentence the chip could not carry, and the reason the breakdown lives here at all.
          Only worth saying when two markers are actually in play — with one marker there is
          nothing to add up wrongly. */}
      {groups.length > 1 && (
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

function Figure({ value, strong = false, top = false }: { value: number; strong?: boolean; top?: boolean }) {
  return (
    <span
      style={{
        fontWeight: strong ? 600 : 500,
        fontVariantNumeric: "tabular-nums",
        textAlign: "right",
        paddingTop: top ? "0.25rem" : 0,
      }}
    >
      {value}
    </span>
  );
}

/** The variants' own figure, kept in a column of its own rather than folded into the number (#528).
 * An empty cell when there is none, so the grid keeps its shape. */
function VariantFigure({ value, wording, top = false }: { value: number; wording?: string; top?: boolean }) {
  return (
    <span style={{ ...NOTE, fontVariantNumeric: "tabular-nums", paddingTop: top ? "0.25rem" : 0 }}>
      {value > 0 ? `+${value}${wording ? ` ${wording}` : ""}` : ""}
    </span>
  );
}

/** One combination under a disposition: its chips — the condition always, the certificate and the
 * format only when they are not the default — and its count. */
function CopyLineRow({
  collectionId,
  line,
  names,
}: {
  collectionId: string;
  line: CopyBreakdownLine;
  names: LineNames;
}) {
  return (
    <>
      <span style={{ display: "inline-flex", gap: "0.2rem", paddingLeft: "0.75rem", flexWrap: "wrap" }}>
        {copyLineParts(line).map((part) =>
          part.axis === "condition" ? (
            <ConditionChip
              key={part.axis}
              collectionId={collectionId}
              conditionId={part.id}
              label={names.condition(part.id)}
              style={LINE_CHIP}
            />
          ) : part.axis === "certificate" ? (
            <CertificateStatusChip
              key={part.axis}
              collectionId={collectionId}
              certificateStatusId={part.id}
              label={names.certificate(part.id)}
              style={LINE_CHIP}
            />
          ) : (
            // Formats carry no colour of their own (#728 coloured conditions and certificates), so
            // the format is the neutral chip a list row draws one with.
            <span key={part.axis} style={{ ...ROW_CHIP, ...LINE_CHIP }}>
              {names.format(part.id)}
            </span>
          )
        )}
      </span>
      <Figure value={line.own} />
      <VariantFigure value={line.variant} />
    </>
  );
}
