"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import type { IssueConditionTotal } from "@/lib/issues";

interface IssuePricesPopoverProps {
  collectionId: string;
  issueId: string;
  anchor: { x: number; y: number };
  onClose: () => void;
}

/**
 * Floating panel listing an issue's required-stamps total for every condition
 * (certificate = none), so the issue row can surface its value across conditions
 * without changing the list's selected condition. Fetched lazily. See #95.
 */
export function IssuePricesPopover({ collectionId, issueId, anchor, onClose }: IssuePricesPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<IssueConditionTotal[]>({
    queryKey: ["issueTotals", collectionId, issueId],
    queryFn: async () => {
      const { getIssuePriceTotalsByConditionAction } = await import("@/app/actions/issues");
      return getIssuePriceTotalsByConditionAction(collectionId, issueId);
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const rows = data ?? [];

  const popover = (
    <div
      ref={ref}
      role="dialog"
      style={{
        position: "fixed",
        top: Math.min(anchor.y + 8, (typeof window !== "undefined" ? window.innerHeight : 800) - 320),
        left: Math.min(anchor.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 320),
        zIndex: 2000,
        width: "20rem",
        maxHeight: "22rem",
        overflowY: "auto",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "0.5rem",
        boxShadow: "0 10px 28px rgba(0,0,0,0.22)",
        padding: "0.75rem",
        fontSize: "0.8125rem",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "var(--color-text-secondary)" }}>
        Required-stamps total by condition
      </div>

      {isLoading && <div style={{ color: "var(--color-text-muted)" }}>Loading totals…</div>}

      {!isLoading && rows.length === 0 && (
        <div style={{ color: "var(--color-text-muted)" }}>No conditions defined.</div>
      )}

      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid var(--color-border)" }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.conditionId}>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 500 }}>{r.conditionAbbreviation}</span>
                  <span style={{ color: "var(--color-text-muted)", marginLeft: "0.4rem" }}>{r.conditionName}</span>
                </td>
                <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                  {r.total ? (
                    <>
                      <div style={{ fontVariantNumeric: "tabular-nums" }}>
                        {r.total.amount} {r.total.currency}
                        {(r.total.usesOlderEdition ||
                          r.total.pricedCount < r.total.requiredCount) && (
                          <span
                            title={
                              r.total.usesOlderEdition
                                ? "Older-edition prices"
                                : `${r.total.pricedCount} of ${r.total.requiredCount} required stamps priced`
                            }
                            style={{ color: "var(--color-warning)", marginLeft: "0.3rem" }}
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                      {r.total.convertedAmount && (
                        <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }}>
                          ≈ {r.total.convertedAmount} {r.total.baseCurrency}
                        </div>
                      )}
                    </>
                  ) : (
                    <span style={{ color: "var(--color-text-muted)" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(popover, document.body);
}

const tdStyle: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-primary)",
  verticalAlign: "top",
};
