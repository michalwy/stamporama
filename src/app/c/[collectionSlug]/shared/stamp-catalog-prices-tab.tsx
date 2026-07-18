"use client";

import { useMemo } from "react";
import type { CatalogVendorData } from "@/lib/catalog";
import type { AreaCatalogEntry } from "@/lib/areas";

const CELL_INPUT: React.CSSProperties = {
  padding: "0.25rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box" as const,
  minHeight: "1.75rem",
  width: "100%",
};

export function formatPrice(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const n = Number(trimmed);
  if (Number.isNaN(n)) return trimmed;
  return n.toFixed(2);
}

interface EditionRow {
  editionId: string;
  catalogNameId: string;
  vendorName: string;
  catalogName: string;
  year: number;
  currency: string;
}

interface StampCatalogPricesTabProps {
  catalogTree: CatalogVendorData[];
  areaVendors: AreaCatalogEntry[];
  priceEdits: Map<string, string>;
  onPriceChange: (editionId: string, value: string) => void;
  disabled?: boolean;
}

export function StampCatalogPricesTab({
  catalogTree,
  areaVendors,
  priceEdits,
  onPriceChange,
  disabled,
}: StampCatalogPricesTabProps) {
  const relevantNameIds = useMemo(
    () => new Set(areaVendors.map((v) => v.catalogNameId)),
    [areaVendors]
  );

  const rows = useMemo(() => {
    const result: EditionRow[] = [];
    for (const vendor of catalogTree) {
      for (const name of vendor.catalogNames) {
        if (!relevantNameIds.has(name.id)) continue;
        for (const ed of name.catalogEditions) {
          result.push({
            editionId: ed.id,
            catalogNameId: name.id,
            vendorName: vendor.name,
            catalogName: name.name,
            year: ed.year,
            currency: name.currency,
          });
        }
      }
    }
    result.sort((a, b) => {
      const v = a.vendorName.localeCompare(b.vendorName);
      if (v !== 0) return v;
      const n = a.catalogName.localeCompare(b.catalogName);
      if (n !== 0) return n;
      return b.year - a.year;
    });
    return result;
  }, [catalogTree, relevantNameIds]);

  // Latest edition (by year) per catalog name — used to detect stale prices.
  const latestByName = useMemo(() => {
    const m = new Map<string, { editionId: string; year: number }>();
    for (const row of rows) {
      const cur = m.get(row.catalogNameId);
      if (!cur || row.year > cur.year) {
        m.set(row.catalogNameId, { editionId: row.editionId, year: row.year });
      }
    }
    return m;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
        {areaVendors.length === 0
          ? "No catalogs assigned to this area."
          : "No catalog editions found. Add editions in Settings → Catalogs first."}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      {rows.map((row) => {
        const price = priceEdits.get(row.editionId) ?? "";

        // A priced row is stale when a newer edition exists for the same catalog
        // name and that newest edition has no price yet.
        const latest = latestByName.get(row.catalogNameId);
        const latestPrice = latest ? (priceEdits.get(latest.editionId) ?? "") : "";
        const isStale =
          !!latest &&
          latest.editionId !== row.editionId &&
          price.trim() !== "" &&
          latestPrice.trim() === "";

        return (
          <div
            key={row.editionId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              ...(isStale
                ? {
                    paddingLeft: "0.375rem",
                    borderLeft: "2px solid var(--color-warning-border)",
                  }
                : null),
            }}
          >
            <span style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.8125rem",
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {row.vendorName} · {row.catalogName} · {row.year}
              </span>
              {isStale && latest && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPriceChange(latest.editionId, formatPrice(price))}
                  title={`Copy this price to the ${latest.year} edition. The ${row.year} price is kept as history.`}
                  style={{
                    flexShrink: 0,
                    fontSize: "0.6875rem",
                    fontWeight: 600,
                    lineHeight: 1,
                    color: "var(--color-warning)",
                    background: "var(--color-warning-soft)",
                    border: "1px solid var(--color-warning-border)",
                    borderRadius: "0.25rem",
                    padding: "0.15rem 0.35rem",
                    cursor: disabled ? "default" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  ⚠ Update {latest.year}
                </button>
              )}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => onPriceChange(row.editionId, e.target.value)}
              onBlur={(e) => onPriceChange(row.editionId, formatPrice(e.target.value))}
              disabled={disabled}
              placeholder="—"
              style={{ ...CELL_INPUT, width: "7rem", flex: "none", textAlign: "right" }}
            />
            <span style={{
              width: "3rem",
              flexShrink: 0,
              fontSize: "0.8125rem",
              color: "var(--color-text-muted)",
            }}>
              {row.currency}
            </span>
          </div>
        );
      })}
    </div>
  );
}
