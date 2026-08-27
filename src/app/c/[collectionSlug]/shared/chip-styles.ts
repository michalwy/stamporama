/** Dashed "create inline" affordance (+ New stamp / + variant) used in the stamp pickers. */
export const CREATE_LINK_STYLE: React.CSSProperties = {
  background: "none",
  border: "1px dashed var(--color-border-strong)",
  borderRadius: "0.375rem",
  cursor: "pointer",
  color: "var(--color-accent)",
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.3rem 0.6rem",
  whiteSpace: "nowrap",
};

export const ISSUE_PRIMARY_CHIP: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.8125rem",
  fontWeight: 700,
  color: "var(--color-accent)",
  border: "1.5px solid var(--color-accent)",
  borderRadius: "0.3rem",
  padding: "0.1rem 0.45rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export const ISSUE_SECONDARY_CHIP: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.3rem",
  padding: "0.1rem 0.4rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export const STAMP_PRIMARY_CHIP: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-accent)",
  border: "1px solid var(--color-accent)",
  borderRadius: "0.25rem",
  padding: "0.05rem 0.35rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
  opacity: 0.85,
};

export const STAMP_SECONDARY_CHIP: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.6875rem",
  color: "var(--color-text-muted)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.05rem 0.3rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export const STAMP_MUTED_PRIMARY_CHIP: React.CSSProperties = {
  ...STAMP_PRIMARY_CHIP,
  color: "var(--color-text-muted)",
  borderColor: "var(--color-border)",
  opacity: 0.7,
};

/**
 * The **set-completeness chip** — *how much of this set is held* — and the state it takes when the
 * answer is "all of it".
 *
 * One vocabulary for both surfaces that ask the question: the Copies list's per-condition chips on
 * an issue group header (#594) and the lot header's for-sale fraction (#563). They count different
 * copies and say so in their own hovers, but a collector meets them on two screens of one app, and a
 * complete set that looks like an achievement on one screen and like a slightly greener number on
 * the other is two conventions to learn (#671).
 *
 * **Complete is filled, ticked and bolder**, not merely tinted. Colour alone was the whole
 * difference before, and on a header line carrying six chips at 0.75rem a green numeral beside a
 * grey one is not what a scanning eye catches — which is the one thing these chips exist to be
 * caught for. Fill, weight and glyph say the same thing three ways, so the chip still reads as
 * complete where the tint does not carry: a colour-blind eye, a dim screen, a screenshot. The edge
 * is `success-border` rather than `success`, since against a filled chip the darker line is a ring
 * around the fill and not a second, competing signal.
 *
 * The tick also **replaces the word**. #563's chip spelled "— complete" beside its fraction because
 * a border tint was too quiet to be the only statement; a glyph says it in the width of a character,
 * and both surfaces can afford that. #594's line of per-condition chips never could afford the word.
 */
export const SET_COMPLETENESS_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  fontVariantNumeric: "tabular-nums",
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export const SET_COMPLETENESS_CHIP_COMPLETE: React.CSSProperties = {
  ...SET_COMPLETENESS_CHIP,
  fontWeight: 600,
  color: "var(--color-success)",
  background: "var(--color-success-soft)",
  borderColor: "var(--color-success-border)",
};

export const PRICE_MAIN: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export const PRICE_CONVERTED: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export const PRICE_STALE_ICON: React.CSSProperties = {
  color: "var(--color-warning)",
  fontSize: "0.8125rem",
  lineHeight: 1,
  cursor: "help",
  flexShrink: 0,
};

// `formatStampCN` now lives in `@/lib/area-vendor` (shared with the server lot-intake reads,
// #172); re-exported here for existing importers.
export { formatStampCN } from "@/lib/area-vendor";
