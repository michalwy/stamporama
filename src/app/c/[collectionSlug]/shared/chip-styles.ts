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
