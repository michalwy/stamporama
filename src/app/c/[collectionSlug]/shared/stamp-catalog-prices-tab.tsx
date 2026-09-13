"use client";

import { useMemo, useRef, type KeyboardEvent } from "react";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { formatAmountInput, normalizeDecimalInput } from "@/lib/decimal-input";
import type { CatalogVendorData } from "@/lib/catalog";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampFormatData } from "@/lib/stamp-formats";
import { deriveFormatPrice, formatFactorKey } from "@/lib/format-factor";
import { fillCertificateCell, formatPricePercent } from "@/lib/certificate-price-fill";
import { Icon } from "@/app/icons";

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

/** Form/state key for one price cell. `certId` null → the "no certificate" column; `formatId`
 *  null → the single, which is what a stamp is when no format is chosen. The format segment is
 *  trailing so a three-segment key written before formats existed still parses. */
export function priceCellKey(
  editionId: string,
  conditionId: string,
  certId: string | null,
  formatId: string | null = null
): string {
  return `${editionId}~${conditionId}~${certId ?? ""}~${formatId ?? ""}`;
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
  /** Physical formats (#multiples). Empty renders the grid exactly as before formats existed. */
  formats: StampFormatData[];
  /** `formatId~conditionId` → multiplier, resolved server-side against this stamp's area and
   *  issue. A missing entry means nothing derives for that pair. */
  formatFactors: Record<string, number>;
  /** Which format's slice of the grid is shown; null is the single. */
  activeFormatId: string | null;
  onActiveFormatChange: (formatId: string | null) => void;
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
  formats,
  formatFactors,
  activeFormatId,
  onActiveFormatChange,
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

  // Column set: the "no certificate" column first, then each configured status, carrying the
  // percentage of the plain price the fill action applies to it (#1242).
  const certColumns = useMemo(
    () => [
      { id: null as string | null, label: "None", pricePercent: null as number | null },
      ...certificateStatuses.map((c) => ({
        id: c.id as string | null,
        label: c.abbreviation,
        pricePercent: c.pricePercent,
      })),
    ],
    [certificateStatuses]
  );
  const anyPercent = certificateStatuses.some((c) => c.pricePercent != null);

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
                  pricedCells.has(priceCellKey(ed.editionId, c.id, col.id, activeFormatId))
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
            if (pricedCells.has(priceCellKey(ed.editionId, c.id, col.id, activeFormatId))) {
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
  }, [rows, conditions, certColumns, pricedCells, activeFormatId]);

  // Column-first Tab order (#232): within an editable table, Tab walks top-to-bottom
  // through the condition rows of a certificate column before moving to the next
  // column, instead of the browser's default left-to-right-then-down. Only the newest
  // editions carry inputs, so navigation is built across those blocks in
  // block → certificate-column → condition-row order.
  const inputRefs = useRef<Map<string, HTMLInputElement | null>>(new Map());
  const navOrder = useMemo(() => {
    const order: string[] = [];
    for (const block of visibleBlocks) {
      if (!block.isNewest) continue;
      for (const col of certColumns) {
        for (const cond of block.conditions) {
          order.push(priceCellKey(block.row.editionId, cond.id, col.id, activeFormatId));
        }
      }
    }
    return order;
  }, [visibleBlocks, certColumns, activeFormatId]);

  // The value a cell falls back to when nothing was entered for this format. Null on the single
  // tab (there is nothing to derive from), when no multiplier resolves, or when the single itself
  // is blank — a derived price is an inference from two facts and says nothing without both.
  function derivedFor(
    editionId: string,
    conditionId: string,
    certId: string | null
  ): string | null {
    if (!activeFormatId) return null;
    const factor = formatFactors[formatFactorKey(activeFormatId, conditionId)];
    if (!factor) return null;
    const single = (priceEdits.get(priceCellKey(editionId, conditionId, certId, null)) ?? "").trim();
    if (single === "") return null;
    const amount = Number(normalizeDecimalInput(single));
    if (!Number.isFinite(amount)) return null;
    return deriveFormatPrice(amount, factor).toFixed(2);
  }

  /**
   * The cells one press of *Fill certificates* writes in an edition's section (#1242): every empty
   * certificate cell of every condition row, on the format tab that is open, from that row's own
   * *None* figure at the status's percentage. The rule — empty cells only, no percentage no fill, no
   * plain price no fill — is `fillCertificateCell`'s. A derived placeholder is not a plain price: it is
   * a figure nothing stored, and the certificate cells on a format tab derive from the single anyway.
   */
  function certificateFills(
    editionId: string,
    rowConditions: StampConditionData[]
  ): { key: string; value: string }[] {
    const fills: { key: string; value: string }[] = [];
    for (const cond of rowConditions) {
      const plain = priceEdits.get(priceCellKey(editionId, cond.id, null, activeFormatId)) ?? "";
      for (const col of certColumns) {
        if (col.id === null) continue;
        const key = priceCellKey(editionId, cond.id, col.id, activeFormatId);
        const value = fillCertificateCell({
          plain,
          current: priceEdits.get(key) ?? "",
          percent: col.pricePercent,
        });
        if (value !== null) fills.push({ key, value });
      }
    }
    return fills;
  }

  function handleCellKeyDown(e: KeyboardEvent<HTMLInputElement>, key: string) {
    if (e.key !== "Tab") return;
    const idx = navOrder.indexOf(key);
    if (idx === -1) return;
    const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
    // At either end let the browser take over, so focus can leave the grid normally.
    if (nextIdx < 0 || nextIdx >= navOrder.length) return;
    const target = inputRefs.current.get(navOrder[nextIdx]);
    if (!target) return;
    e.preventDefault();
    target.focus();
    target.select();
  }

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

  const activeFormat = formats.find((f) => f.id === activeFormatId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {formats.length > 0 && (
        <div>
          {/* Format tabs, not extra columns: the grid is already condition x certificate, and a
              third axis inline would make it unreadable. One tab at a time keeps every format's
              prices in the same familiar shape. */}
          <div
            role="tablist"
            aria-label="Format"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.25rem",
              borderBottom: "1px solid var(--color-border)",
              paddingBottom: "0.5rem",
            }}
          >
            {[{ id: null as string | null, label: "Single" }, ...formats.map((f) => ({ id: f.id as string | null, label: f.abbreviation }))].map(
              (tab) => {
                const active = tab.id === activeFormatId;
                return (
                  <button
                    key={tab.id ?? "single"}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onActiveFormatChange(tab.id)}
                    style={{
                      padding: "0.25rem 0.625rem",
                      fontSize: "0.8125rem",
                      fontWeight: active ? 600 : 400,
                      color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
                      background: active ? "var(--color-bg-page)" : "transparent",
                      border: `1px solid ${active ? "var(--color-border-strong)" : "transparent"}`,
                      borderRadius: "0.375rem",
                      cursor: "pointer",
                    }}
                  >
                    {tab.label}
                  </button>
                );
              }
            )}
          </div>
          {activeFormat && (
            <p
              style={{
                fontSize: "0.6875rem",
                color: "var(--color-text-muted)",
                margin: "0.5rem 0 0",
              }}
            >
              {activeFormat.name}. Greyed values are derived from the single&apos;s price by this
              format&apos;s multiplier — nothing is stored until you type over one. Clear a cell to
              go back to the derived value.
            </p>
          )}
        </div>
      )}
      {visibleBlocks.map(({ row, conditions: rowConditions, isNewest, newestEditionId }) => {
        // Only the newest edition is editable, so only its section offers the fill — and only once a
        // status carries a percentage, since until then the button could never do anything.
        const fills = isNewest && anyPercent ? certificateFills(row.editionId, rowConditions) : null;
        return (
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
              {fills && (
                <Tooltip
                  style={{ marginLeft: "auto" }}
                  content={
                    fills.length > 0
                      ? `Fill ${fills.length === 1 ? "1 empty certificate price" : `${fills.length} empty certificate prices`} from each condition's None price, at the percentage shown under each column. Prices already entered stay as they are.`
                      : "Nothing to fill: every certificate price with a percentage is already entered, or its condition has no None price."
                  }
                >
                  <button
                    type="button"
                    disabled={disabled || fills.length === 0}
                    onClick={() => {
                      for (const fill of fills) onPriceChange(fill.key, fill.value);
                    }}
                    // Auxiliary to the price inputs, as the copy-up button is (#446).
                    tabIndex={-1}
                    style={{
                      ...fillBtnStyle,
                      opacity: disabled || fills.length === 0 ? 0.5 : 1,
                      cursor: disabled || fills.length === 0 ? "default" : "pointer",
                    }}
                  >
                    <Icon name="factors" size="xs" /> Fill certificates
                  </button>
                </Tooltip>
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
                        {col.pricePercent != null && (
                          // The status's percentage (#1242), so what *Fill certificates* will write
                          // can be read before it is pressed.
                          <span style={thPercentStyle}>{formatPricePercent(col.pricePercent)}</span>
                        )}
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
                        const key = priceCellKey(row.editionId, cond.id, col.id, activeFormatId);
                        const price = priceEdits.get(key) ?? "";
                        // What this cell would show if left empty: the single's price for the same
                        // edition/condition/certificate, times the format's multiplier. Recomputed
                        // as the single is typed, so a derived value is never stale on screen.
                        const derived = derivedFor(row.editionId, cond.id, col.id);

                        if (isNewest) {
                          return (
                            <td key={col.id ?? "none"} style={tdCellStyle}>
                              <NumericInput
                                kind="amount"
                                ref={(el) => {
                                  inputRefs.current.set(key, el);
                                }}
                                value={price}
                                onChange={(e) => onPriceChange(key, e.target.value)}
                                onKeyDown={(e) => handleCellKeyDown(e, key)}
                                disabled={disabled}
                                placeholder={derived ?? "—"}
                                style={derived && price.trim() === "" ? CELL_INPUT_DERIVED : CELL_INPUT}
                                title={
                                  derived && price.trim() === ""
                                    ? "Derived from the single's price. Type a value to record this format's own price."
                                    : undefined
                                }
                              />
                            </td>
                          );
                        }

                        // Older edition: read-only value, with a button to copy the
                        // price up to the (editable) newest edition when it's empty there.
                        const newestKey = priceCellKey(newestEditionId, cond.id, col.id, activeFormatId);
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
                                <Tooltip content="Copy this price into the newest edition to update it." align="end">
                                  <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onPriceChange(newestKey, formatAmountInput(price))}
                                    aria-label="Copy this price into the newest edition"
                                    // Auxiliary to the grid's price inputs (#446): tabbing a price
                                    // table should walk the figures, not the shortcuts beside them.
                                    tabIndex={-1}
                                    style={warnBtnStyle}
                                  >
                                    <Icon name="copyUpwards" size="sm" />
                                  </button>
                                </Tooltip>
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
        );
      })}
    </div>
  );
}

/** A cell showing a derived value rather than a stored one: same box, quieter text, so the grid
 *  reads as complete without ever claiming the number was entered. */
const CELL_INPUT_DERIVED: React.CSSProperties = {
  ...CELL_INPUT,
  borderStyle: "dashed",
};

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

const thPercentStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.6875rem",
  fontWeight: 400,
  fontVariantNumeric: "tabular-nums",
};

/** The section's *Fill certificates* shortcut: small and quiet, a heading's companion rather than a
 *  form action. */
const fillBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.15rem 0.5rem",
  fontSize: "0.75rem",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.25rem",
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
