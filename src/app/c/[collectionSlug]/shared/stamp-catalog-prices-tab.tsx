"use client";

import { useMemo } from "react";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import type { CatalogVendorData } from "@/lib/catalog";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";

const CELL_INPUT: React.CSSProperties = {
  padding: "0.25rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box" as const,
  minHeight: "1.75rem",
  width: "5.5rem",
  textAlign: "right" as const,
};

export function formatPrice(value: string): string {
  const trimmed = normalizeDecimalInput(value.trim());
  if (trimmed === "") return "";
  const n = Number(trimmed);
  if (Number.isNaN(n)) return trimmed;
  return n.toFixed(2);
}

/** Form/state key for one price cell. `certId` null → the "no certificate" column. */
export function priceCellKey(
  editionId: string,
  conditionId: string,
  certId: string | null
): string {
  return `${editionId}~${conditionId}~${certId ?? ""}`;
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
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  priceEdits: Map<string, string>;
  /** Cell keys (`${editionId}~${conditionId}~${certId}`) that had a price at
   *  load — used to decide which older edition/condition rows to show. */
  pricedCells: Set<string>;
  onPriceChange: (cellKey: string, value: string) => void;
  disabled?: boolean;
}

export function StampCatalogPricesTab({
  catalogTree,
  areaVendors,
  conditions,
  certificateStatuses,
  priceEdits,
  pricedCells,
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

  // Column set: the "no certificate" column first, then each configured status.
  const certColumns = useMemo(
    () => [{ id: null as string | null, label: "None" }, ...certificateStatuses.map((c) => ({ id: c.id as string | null, label: c.abbreviation }))],
    [certificateStatuses]
  );

  // Which (edition, condition-rows) to show, decided per (condition, certificate)
  // cell:
  //  - the newest edition of a catalog always shows every condition row and is
  //    editable;
  //  - an older edition shows a condition row only when it has at least one
  //    priced cell that no newer edition of the same catalog has carried up. A
  //    row disappears only once every certificate it was priced for exists in a
  //    newer edition. Older editions are read-only.
  // Evaluated against the load-time snapshot so the grid stays stable while the
  // user types. See #91.
  const visibleBlocks = useMemo(() => {
    const byName = new Map<string, EditionRow[]>();
    for (const row of rows) {
      const list = byName.get(row.catalogNameId);
      if (list) list.push(row);
      else byName.set(row.catalogNameId, [row]);
    }
    const blocks: {
      row: EditionRow;
      conditions: StampConditionData[];
      isNewest: boolean;
      newestEditionId: string;
    }[] = [];
    for (const list of byName.values()) {
      // `rows` is already sorted year-desc within a catalog name.
      const newestEditionId = list[0].editionId;
      // (condition,cert) pairs already priced in a newer edition.
      const newerPricedCells = new Set<string>();
      const ccKey = (condId: string, certId: string | null) => `${condId}~${certId ?? ""}`;
      for (let i = 0; i < list.length; i++) {
        const ed = list[i];
        const shown =
          i === 0
            ? conditions
            : conditions.filter((c) => {
                const oldCerts = certColumns.filter((col) =>
                  pricedCells.has(priceCellKey(ed.editionId, c.id, col.id))
                );
                if (oldCerts.length === 0) return false;
                // Keep the row while any priced certificate isn't yet in a newer edition.
                return oldCerts.some((col) => !newerPricedCells.has(ccKey(c.id, col.id)));
              });
        if (shown.length > 0) {
          blocks.push({ row: ed, conditions: shown, isNewest: i === 0, newestEditionId });
        }
        for (const c of conditions) {
          for (const col of certColumns) {
            if (pricedCells.has(priceCellKey(ed.editionId, c.id, col.id))) {
              newerPricedCells.add(ccKey(c.id, col.id));
            }
          }
        }
      }
    }
    blocks.sort((a, b) => {
      const v = a.row.vendorName.localeCompare(b.row.vendorName);
      if (v !== 0) return v;
      const n = a.row.catalogName.localeCompare(b.row.catalogName);
      if (n !== 0) return n;
      return b.row.year - a.row.year;
    });
    return blocks;
  }, [rows, conditions, certColumns, pricedCells]);

  if (rows.length === 0) {
    return (
      <div style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
        {areaVendors.length === 0
          ? "No catalogs assigned to this area."
          : "No catalog editions found. Add editions in Settings → Catalogs first."}
      </div>
    );
  }

  if (conditions.length === 0) {
    return (
      <div style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
        No conditions defined. Add conditions in Settings → Conditions before
        recording prices.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {visibleBlocks.map(({ row, conditions: rowConditions, isNewest, newestEditionId }) => (
        <div key={row.editionId}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.5rem",
              marginBottom: "0.375rem",
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: "var(--color-text-secondary)",
            }}
          >
            <span>
              {row.vendorName} · {row.catalogName} · {row.year}
            </span>
            <span style={{ fontWeight: 400, color: "var(--color-text-muted)" }}>
              {row.currency}
            </span>
            {!isNewest && (
              <span style={{ fontWeight: 400, color: "var(--color-text-muted)", fontStyle: "italic" }}>
                (older edition — read only)
              </span>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <thead>
                <tr>
                  <th style={thCondStyle}>Condition</th>
                  {certColumns.map((col) => (
                    <th key={col.id ?? "none"} style={thCertStyle}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowConditions.map((cond) => (
                  <tr key={cond.id}>
                    <td style={tdCondStyle}>
                      <span style={{ fontWeight: 500 }}>{cond.abbreviation}</span>
                      <span style={{ color: "var(--color-text-muted)", marginLeft: "0.4rem" }}>
                        {cond.name}
                      </span>
                    </td>
                    {certColumns.map((col) => {
                      const key = priceCellKey(row.editionId, cond.id, col.id);
                      const price = priceEdits.get(key) ?? "";

                      if (isNewest) {
                        return (
                          <td key={col.id ?? "none"} style={tdCellStyle}>
                            <NumericInput
                              value={price}
                              onChange={(e) => onPriceChange(key, e.target.value)}
                              onBlur={(e) => onPriceChange(key, formatPrice(e.target.value))}
                              disabled={disabled}
                              placeholder="—"
                              style={CELL_INPUT}
                            />
                          </td>
                        );
                      }

                      // Older edition: read-only value, with a button to copy the
                      // price up to the (editable) newest edition when it's empty there.
                      const newestKey = priceCellKey(newestEditionId, cond.id, col.id);
                      const canCopy =
                        price.trim() !== "" && (priceEdits.get(newestKey) ?? "").trim() === "";
                      return (
                        <td key={col.id ?? "none"} style={tdCellStyle}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.25rem" }}>
                            <span
                              style={{
                                color: price.trim() === "" ? "var(--color-text-muted)" : "var(--color-text-secondary)",
                                fontVariantNumeric: "tabular-nums",
                                minWidth: "3.5rem",
                                textAlign: "right",
                              }}
                            >
                              {price.trim() === "" ? "—" : price}
                            </span>
                            {canCopy && (
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onPriceChange(newestKey, formatPrice(price))}
                                title={`Copy this price into the newest edition to update it.`}
                                style={warnBtnStyle}
                              >
                                ⤴
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

const thCondStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.25rem 0.5rem 0.375rem 0",
  color: "var(--color-text-muted)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const thCertStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "0.25rem 0.375rem 0.375rem",
  color: "var(--color-text-muted)",
  fontWeight: 500,
  fontFamily: "monospace",
  whiteSpace: "nowrap",
};

const tdCondStyle: React.CSSProperties = {
  padding: "0.15rem 0.75rem 0.15rem 0",
  whiteSpace: "nowrap",
  color: "var(--color-text-primary)",
};

const tdCellStyle: React.CSSProperties = {
  padding: "0.15rem 0.375rem",
};

const warnBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: "0.8125rem",
  lineHeight: 1,
  color: "var(--color-warning)",
  background: "var(--color-warning-soft)",
  border: "1px solid var(--color-warning-border)",
  borderRadius: "0.25rem",
  padding: "0.2rem 0.35rem",
  cursor: "pointer",
};
