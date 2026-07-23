"use client";

import type { IssueRangeSuggestion } from "@/lib/issues";

/** Format a declared range for display, e.g. "Mi 100–105" or "Mi 100". */
function rangeLabel(prefix: string, first: string, last: string | null): string {
  const range = last ? `${first}–${last}` : first;
  return prefix ? `${prefix} ${range}` : range;
}

/**
 * Non-blocking notice that an issue's member stamps extend its declared catalog
 * range (per vendor). Each row offers a one-click Apply that widens the declared
 * First–Last to cover its members. Only extensions are surfaced — a narrower set
 * of members than declared is a normal, partially-entered issue and never warns.
 * Mirrors the styling of `CatalogDuplicateWarning`.
 */
export function IssueRangeWarning({
  suggestions,
  onApply,
  disabled = false,
}: {
  suggestions: IssueRangeSuggestion[];
  onApply: (suggestion: IssueRangeSuggestion) => void;
  disabled?: boolean;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div
      role="status"
      style={{
        marginTop: "1rem",
        border: "1px solid var(--color-warning-border)",
        background: "var(--color-warning-soft)",
        borderRadius: "0.5rem",
        padding: "0.75rem 0.875rem",
        fontSize: "0.8125rem",
        color: "var(--color-text-primary)",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
        <span aria-hidden style={{ color: "var(--color-warning)", lineHeight: 1.3 }}>
          ⚠
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: "0 0 0.5rem", fontWeight: 600, color: "var(--color-warning)" }}>
            The declared catalog range needs updating
          </p>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {suggestions.map((s) => {
              const current = rangeLabel(s.vendorAbbreviation, s.currentFirst, s.currentLast);
              const proposed = rangeLabel(s.vendorAbbreviation, s.proposedFirst, s.proposedLast);
              return (
                <li
                  key={s.catalogVendorId}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{current}</span>
                    <span style={{ color: "var(--color-text-muted)" }}> → </span>
                    <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{proposed}</span>
                    {s.outsideNumbers.length > 0 && (
                      <span style={{ color: "var(--color-text-muted)" }}>
                        {" "}· covers {s.outsideNumbers.join(", ")}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onApply(s)}
                    disabled={disabled}
                    style={{
                      marginLeft: "auto",
                      flexShrink: 0,
                      padding: "0.2rem 0.6rem",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "var(--color-warning)",
                      background: "transparent",
                      border: "1px solid var(--color-warning-border)",
                      borderRadius: "0.3rem",
                      cursor: disabled ? "default" : "pointer",
                    }}
                  >
                    Apply
                  </button>
                </li>
              );
            })}
          </ul>
          <p style={{ margin: "0.5rem 0 0", color: "var(--color-text-muted)" }}>
            Apply updates the field below; save the issue to keep it.
          </p>
        </div>
      </div>
    </div>
  );
}
