import type { AreaCatalogEntry } from "@/lib/areas";

export const rowBtnStyle: React.CSSProperties = {
  padding: "0.25rem 0.625rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  border: "1px solid var(--color-border)",
  borderRadius: "0.3rem",
  cursor: "pointer",
  background: "transparent",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

export const rowBtnDangerStyle: React.CSSProperties = {
  ...rowBtnStyle,
  color: "var(--color-error)",
  borderColor: "var(--color-error-border)",
};

export const addBtnStyle: React.CSSProperties = {
  ...rowBtnStyle,
  color: "var(--color-text-muted)",
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

export function formatStampCN(number: string, v?: AreaCatalogEntry): string {
  if (!v) return number;
  return v.prefix
    ? `${v.vendorAbbreviation}·${v.prefix} ${number}`
    : `${v.vendorAbbreviation} ${number}`;
}
