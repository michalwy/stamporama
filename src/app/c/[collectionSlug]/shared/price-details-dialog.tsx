"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { DialogShell } from "@/app/dialog-shell";
import { Tooltip } from "./tooltip";
import type { StampPriceDetails } from "@/lib/stamps";
import type { IssuePriceDetails } from "@/lib/issues";

/** What the dialog describes: a single stamp, or a whole issue's required stamps. */
export type PriceDetailsTarget =
  | { kind: "stamp"; stampId: string }
  | { kind: "issue"; collectionId: string; issueId: string };

type Scope = "latest" | "all";
type CurrencyMode = "catalog" | "collection";

/**
 * Modal showing all recorded catalog prices for a stamp or issue. Sections: the
 * cross-catalog average (always in collection currency, expanded by default) and
 * one collapsible section per catalog edition (collapsed by default). Stamp tables
 * are laid out as a conditions-as-rows × certificates-as-columns matrix. A scope
 * toggle picks latest-only vs all editions; a currency toggle switches the catalog
 * sections between catalog and collection currency. Both toggles leave the averages
 * untouched. The dialog height is fixed: the toolbar is pinned and the sections
 * scroll internally, so expanding a section never resizes the window. See
 * price-details dialog.
 */
export function PriceDetailsDialog({
  target,
  onClose,
}: {
  target: PriceDetailsTarget;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>("latest");
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>("catalog");

  const stampQuery = useQuery<StampPriceDetails>({
    queryKey: ["stampPriceDetails", target.kind === "stamp" ? target.stampId : null],
    enabled: target.kind === "stamp",
    staleTime: 30_000,
    queryFn: async () => {
      const { getStampPriceDetailsAction } = await import("@/app/actions/stamps");
      return getStampPriceDetailsAction((target as { stampId: string }).stampId);
    },
  });

  const issueQuery = useQuery<IssuePriceDetails>({
    queryKey:
      target.kind === "issue"
        ? ["issuePriceDetails", target.collectionId, target.issueId]
        : ["issuePriceDetails", null],
    enabled: target.kind === "issue",
    staleTime: 30_000,
    queryFn: async () => {
      const t = target as { collectionId: string; issueId: string };
      const { getIssuePriceDetailsAction } = await import("@/app/actions/issues");
      return getIssuePriceDetailsAction(t.collectionId, t.issueId);
    },
  });

  const isLoading = target.kind === "stamp" ? stampQuery.isLoading : issueQuery.isLoading;

  return (
    <DialogShell
      title="Catalog prices"
      onClose={onClose}
      maxWidth="min(98vw, 92rem)"
      height="min(96vh, 66rem)"
    >
      {/* Pinned toolbar — stays put while the sections below scroll. */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          flexWrap: "wrap",
          gap: "1.25rem",
          padding: "0.85rem 1.5rem",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <Segmented
          label="Editions"
          value={scope}
          onChange={setScope}
          options={[
            { value: "latest", label: "Latest only" },
            { value: "all", label: "All editions" },
          ]}
        />
        <Segmented
          label="Currency"
          value={currencyMode}
          onChange={setCurrencyMode}
          options={[
            { value: "catalog", label: "Catalog" },
            { value: "collection", label: "Collection" },
          ]}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "1.25rem 1.5rem" }}>
        {isLoading && <div style={{ color: "var(--color-text-muted)" }}>Loading prices…</div>}

        {!isLoading && target.kind === "stamp" && stampQuery.data && (
          <StampSections data={stampQuery.data} scope={scope} currencyMode={currencyMode} />
        )}

        {!isLoading && target.kind === "issue" && issueQuery.data && (
          <IssueSections data={issueQuery.data} scope={scope} currencyMode={currencyMode} />
        )}
      </div>
    </DialogShell>
  );
}

// ── Matrix helper (conditions as rows, certificates as columns) ─────────────────

type CellAxes = {
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  conditionSortOrder: number;
  certificateStatusId: string | null;
  certificateStatusAbbreviation: string | null;
  certificateSortOrder: number;
};

type CertColumn = { key: string; abbreviation: string; sort: number };

/**
 * Union of certificate columns across the given cell sets, ordered by sort. Shared
 * by every stamp table so a certificate that appears in any edition gets a column
 * in all of them — keeping the columns aligned across sections.
 */
function collectCertColumns(cellSets: CellAxes[][]): CertColumn[] {
  const map = new Map<string, CertColumn>();
  for (const cells of cellSets) {
    for (const c of cells) {
      const key = c.certificateStatusId ?? "";
      map.set(key, {
        key,
        abbreviation: c.certificateStatusAbbreviation ?? "No cert.",
        sort: c.certificateSortOrder,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.sort - b.sort);
}

function MatrixTable<C extends CellAxes>({
  cells,
  certificates,
  renderCell,
}: {
  cells: C[];
  /** Full certificate column set (shared across tables), so columns stay aligned. */
  certificates: CertColumn[];
  renderCell: (cell: C | undefined) => ReactNode;
}) {
  const conditions = new Map<string, { id: string; abbreviation: string; name: string; sort: number }>();
  const byKey = new Map<string, C>();
  for (const c of cells) {
    conditions.set(c.conditionId, {
      id: c.conditionId,
      abbreviation: c.conditionAbbreviation,
      name: c.conditionName,
      sort: c.conditionSortOrder,
    });
    byKey.set(`${c.conditionId}~${c.certificateStatusId ?? ""}`, c);
  }
  const rows = [...conditions.values()].sort((a, b) => a.sort - b.sort);

  return (
    <table style={{ ...tableStyle, tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: "16rem" }} />
        {certificates.map((cert) => (
          <col key={cert.key} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th style={thStyle}>Condition</th>
          {certificates.map((cert) => (
            <th key={cert.key} style={{ ...thStyle, textAlign: "right" }}>
              {cert.abbreviation}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cond) => (
          <tr key={cond.id}>
            <td style={{ ...tdStyle, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ fontWeight: 500 }}>{cond.abbreviation}</span>
              <span style={{ color: "var(--color-text-muted)", marginLeft: "0.4rem" }}>
                {cond.name}
              </span>
            </td>
            {certificates.map((cert) => (
              <td key={cert.key} style={numTdStyle}>
                {renderCell(byKey.get(`${cond.id}~${cert.key}`))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Stamp ─────────────────────────────────────────────────────────────────────

function StampSections({
  data,
  scope,
  currencyMode,
}: {
  data: StampPriceDetails;
  scope: Scope;
  currencyMode: CurrencyMode;
}) {
  const editions = data.editions.filter((e) => scope === "all" || e.isNewest);
  if (data.averageCells.length === 0 && editions.length === 0) {
    return <Empty>No prices recorded.</Empty>;
  }

  // One shared certificate column set across the average and every edition table,
  // built from all editions (not just the visible ones) so the columns never shift.
  const certColumns = collectCertColumns([
    data.averageCells,
    ...data.editions.map((e) => e.cells),
  ]);

  return (
    <>
      <CollapsibleSection title="Average across all catalogs" defaultOpen>
        {data.averageCells.length === 0 ? (
          <Muted>No averageable prices.</Muted>
        ) : (
          <MatrixTable
            cells={data.averageCells}
            certificates={certColumns}
            renderCell={(cell) =>
              !cell || cell.averageBase == null ? (
                <Dash />
              ) : (
                <div style={numStyle}>
                  <ValueWithTip tip={`Average of ${cell.catalogCount} catalog(s)`}>
                    {cell.averageBase} {cell.baseCurrency}
                  </ValueWithTip>
                  {cell.excludedNoRateCount > 0 && (
                    <Warn content={`${cell.excludedNoRateCount} catalog price(s) had no rate and were excluded`} />
                  )}
                </div>
              )
            }
          />
        )}
      </CollapsibleSection>

      {editions.map((ed) => (
        <CollapsibleSection
          key={ed.catalogEditionId}
          title={`${ed.catalogName} · ${ed.editionYear}`}
          subtitle={ed.vendorAbbreviation}
          badge={ed.isNewest ? "latest" : undefined}
        >
          <MatrixTable
            cells={ed.cells}
            certificates={certColumns}
            renderCell={(cell) => {
              if (!cell) return <Dash />;
              const money = priceForMode(
                currencyMode,
                cell.price,
                cell.currency,
                cell.convertedAmount,
                cell.baseCurrency
              );
              return <Money primary={money.primary} secondary={money.secondary} />;
            }}
          />
        </CollapsibleSection>
      ))}
    </>
  );
}

// ── Issue ─────────────────────────────────────────────────────────────────────

function IssueSections({
  data,
  scope,
  currencyMode,
}: {
  data: IssuePriceDetails;
  scope: Scope;
  currencyMode: CurrencyMode;
}) {
  const catalogs = scope === "all" ? data.catalogsAll : data.catalogsLatest;
  if (data.averageCells.length === 0 && catalogs.length === 0) {
    return <Empty>No prices recorded for required stamps.</Empty>;
  }

  // Shared certificate columns across the average and every catalog table (both
  // variants), so the columns never shift when toggling latest/all.
  const certColumns = collectCertColumns([
    data.averageCells,
    ...data.catalogsLatest.map((c) => c.cells),
    ...data.catalogsAll.map((c) => c.cells),
  ]);

  return (
    <>
      <CollapsibleSection title="Average across all catalogs" defaultOpen>
        {data.averageCells.length === 0 ? (
          <Muted>No averageable prices.</Muted>
        ) : (
          <MatrixTable
            cells={data.averageCells}
            certificates={certColumns}
            renderCell={(cell) => {
              if (!cell) return <Dash />;
              const excluded = cell.incompleteCatalogs
                .map((ic) => `${ic.catalogName} ${ic.pricedCount}/${ic.requiredCount}`)
                .join(", ");
              if (cell.averageBase == null) {
                return (
                  <Tooltip
                    placement="top"
                    align="end"
                    content={`No catalog covers all ${data.requiredCount} required stamp${
                      data.requiredCount === 1 ? "" : "s"
                    }${excluded ? ` — excluded: ${excluded}` : ""}`}
                  >
                    <span style={{ color: "var(--color-warning)", fontSize: "0.75rem", cursor: "default" }}>
                      incomplete
                    </span>
                  </Tooltip>
                );
              }
              return (
                <div style={numStyle}>
                  <ValueWithTip tip={`Average of ${cell.completeCatalogCount} catalog(s)`}>
                    {cell.averageBase} {cell.baseCurrency}
                  </ValueWithTip>
                  {cell.incompleteCatalogs.length > 0 && (
                    <Warn content={`Excluded (incomplete): ${excluded}`} />
                  )}
                </div>
              );
            }}
          />
        )}
      </CollapsibleSection>

      {catalogs.map((cat) => (
        <CollapsibleSection key={cat.catalogNameId} title={cat.catalogName} subtitle={cat.vendorAbbreviation}>
          <MatrixTable
            cells={cat.cells}
            certificates={certColumns}
            renderCell={(cell) => {
              if (!cell) return <Dash />;
              const money = priceForMode(
                currencyMode,
                cell.sumCatalog,
                cell.catalogCurrency,
                cell.convertedSum,
                cell.baseCurrency
              );
              return (
                <Money
                  primary={money.primary}
                  secondary={money.secondary}
                  badge={
                    !cell.complete ? (
                      <Warn content={`${cell.pricedCount} of ${cell.requiredCount} required stamps priced`} />
                    ) : null
                  }
                />
              );
            }}
          />
        </CollapsibleSection>
      ))}
    </>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────────────

function priceForMode(
  mode: CurrencyMode,
  amount: string,
  currency: string,
  converted: string | null,
  baseCurrency: string
): { primary: string; secondary: string | null } {
  if (mode === "catalog") {
    return {
      primary: `${amount} ${currency}`,
      secondary: converted ? `≈ ${converted} ${baseCurrency}` : null,
    };
  }
  const base = currency === baseCurrency ? amount : converted;
  if (base) return { primary: `${base} ${baseCurrency}`, secondary: null };
  return { primary: `${amount} ${currency}`, secondary: "no rate" };
}

function Money({
  primary,
  secondary,
  badge,
}: {
  primary: string;
  secondary: string | null;
  badge?: ReactNode;
}) {
  return (
    <>
      <div style={numStyle}>
        {primary}
        {badge}
      </div>
      {secondary && (
        <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }}>
          {secondary}
        </div>
      )}
    </>
  );
}

function Dash() {
  return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
}

function Warn({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content} placement="top" align="end">
      <span style={{ color: "var(--color-warning)", marginLeft: "0.3rem", cursor: "default" }}>⚠</span>
    </Tooltip>
  );
}

/** A value with a hover tooltip, right-anchored so it stays inside the table. */
function ValueWithTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <Tooltip content={tip} placement="top" align="end">
      <span style={numStyle}>{children}</span>
    </Tooltip>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <div style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>{children}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ color: "var(--color-text-muted)" }}>{children}</div>;
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontWeight: 500 }}>{label}</span>
      <div
        style={{
          display: "inline-flex",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "0.375rem",
          overflow: "hidden",
        }}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              style={{
                padding: "0.35rem 0.75rem",
                border: "none",
                cursor: "pointer",
                fontSize: "0.8125rem",
                fontWeight: active ? 600 : 500,
                background: active ? "var(--color-action-primary)" : "var(--color-bg-page)",
                color: active ? "#fff" : "var(--color-text-secondary)",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        marginBottom: "0.75rem",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          width: "100%",
          padding: "0.6rem 0.75rem",
          border: "none",
          background: "var(--color-bg-page)",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--color-text-primary)",
          fontSize: "0.875rem",
          fontWeight: 600,
        }}
        aria-expanded={open}
      >
        <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>{open ? "▾" : "▸"}</span>
        <span>{title}</span>
        {subtitle && (
          <span style={{ color: "var(--color-text-muted)", fontWeight: 500, fontSize: "0.8125rem" }}>
            {subtitle}
          </span>
        )}
        {badge && <span style={latestBadge}>{badge}</span>}
      </button>
      {open && <div style={{ padding: "0.75rem" }}>{children}</div>}
    </div>
  );
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  border: "1px solid var(--color-border)",
  fontSize: "0.8125rem",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.3rem 0.6rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-muted)",
  fontWeight: 500,
  fontSize: "0.75rem",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "0.3rem 0.6rem",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-primary)",
  verticalAlign: "top",
};

const numTdStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  whiteSpace: "nowrap",
};

const numStyle: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

const latestBadge: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 500,
  color: "var(--color-text-muted)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0 0.3rem",
};
