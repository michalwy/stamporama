"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import type { StampCatalogPriceDisplay } from "@/lib/stamps";

interface StampPricesPopoverProps {
  stampId: string;
  /** Screen coordinates of the trigger; the popover anchors near this point. */
  anchor: { x: number; y: number };
  onClose: () => void;
}

/**
 * Floating panel listing a stamp's recorded prices (conditions × certificate
 * statuses), one catalog edition per catalog — the newest edition that has any
 * price, so superseded editions stay out of the way. Prices are fetched lazily
 * when the popover opens. See #91 / #95.
 */
export function StampPricesPopover({ stampId, anchor, onClose }: StampPricesPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<StampCatalogPriceDisplay[]>({
    queryKey: ["stampPrices", stampId],
    queryFn: async () => {
      const { getStampCatalogPricesAction } = await import("@/app/actions/stamps");
      return getStampCatalogPricesAction(stampId);
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

  // Keep, per catalog name, only rows on the newest edition that has any price.
  const newestYearByName = new Map<string, number>();
  for (const p of data ?? []) {
    const cur = newestYearByName.get(p.catalogNameId);
    if (cur === undefined || p.editionYear > cur) newestYearByName.set(p.catalogNameId, p.editionYear);
  }
  const visible = (data ?? []).filter(
    (p) => p.editionYear === newestYearByName.get(p.catalogNameId)
  );

  // Group the visible rows by catalog edition, preserving newest-first ordering.
  const groups: { key: string; header: string; rows: StampCatalogPriceDisplay[] }[] = [];
  const byEdition = new Map<string, number>();
  for (const p of visible) {
    let idx = byEdition.get(p.catalogEditionId);
    if (idx === undefined) {
      idx = groups.length;
      byEdition.set(p.catalogEditionId, idx);
      groups.push({ key: p.catalogEditionId, header: `${p.catalogName} · ${p.editionYear}`, rows: [] });
    }
    groups[idx].rows.push(p);
  }

  const popover = (
    <div
      ref={ref}
      role="dialog"
      style={{
        position: "fixed",
        top: Math.min(anchor.y + 8, (typeof window !== "undefined" ? window.innerHeight : 800) - 340),
        left: Math.min(anchor.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 340),
        zIndex: 2000,
        width: "21rem",
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
        All catalog prices
      </div>

      {isLoading && <div style={{ color: "var(--color-text-muted)" }}>Loading prices…</div>}

      {!isLoading && groups.length === 0 && (
        <div style={{ color: "var(--color-text-muted)" }}>No prices recorded.</div>
      )}

      {groups.map((g) => (
        <div key={g.key} style={{ marginBottom: "0.75rem" }}>
          <div
            style={{
              color: "var(--color-text-secondary)",
              fontWeight: 600,
              marginBottom: "0.25rem",
            }}
          >
            {g.header}
          </div>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              border: "1px solid var(--color-border)",
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>Condition</th>
                <th style={thStyle}>Cert.</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Price</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={`${r.conditionId}~${r.certificateStatusId ?? ""}`}>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 500 }}>{r.conditionAbbreviation}</span>
                  </td>
                  <td style={{ ...tdStyle, color: "var(--color-text-muted)", fontFamily: "monospace" }}>
                    {r.certificateStatusAbbreviation ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                    <div style={{ fontVariantNumeric: "tabular-nums" }}>
                      {r.price} {r.currency}
                    </div>
                    {r.convertedAmount && (
                      <div
                        style={{
                          color: "var(--color-text-muted)",
                          fontSize: "0.75rem",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        ≈ {r.convertedAmount} {r.baseCurrency}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(popover, document.body);
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.25rem 0.5rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  fontWeight: 500,
  fontSize: "0.75rem",
};

const tdStyle: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-primary)",
  verticalAlign: "top",
};
