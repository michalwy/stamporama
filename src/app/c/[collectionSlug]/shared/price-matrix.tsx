"use client";

import type { ReactNode } from "react";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";

// The Valuation dialog's one grid, and the bits every cell of it is drawn from.
//
// Extracted from `price-details-dialog.tsx` when market value (#457) joined the catalogue figures
// in that window: it is laid out on the **same** conditions × certificates matrix, so it has to be
// the same table — one that a reader learns to read once — and the certificate columns have to be
// unioned across all the grids so a certificate appearing in even one of them gets a column in
// every one and the columns line up.

export type CellAxes = {
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  conditionSortOrder: number;
  certificateStatusId: string | null;
  certificateStatusAbbreviation: string | null;
  certificateSortOrder: number;
};

export type CertColumn = { key: string; abbreviation: string; sort: number };

/**
 * Union of certificate columns across the given cell sets, ordered by sort. Shared
 * by every stamp table so a certificate that appears in any edition gets a column
 * in all of them — keeping the columns aligned across sections.
 */
export function collectCertColumns(cellSets: CellAxes[][]): CertColumn[] {
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

export function MatrixTable<C extends CellAxes>({
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

export function Money({
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

export function Dash() {
  return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
}

export function Warn({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content} placement="top" align="end">
      <span
        style={{
          display: "inline-flex",
          color: "var(--color-warning)",
          marginLeft: "0.3rem",
          cursor: "default",
        }}
      >
        <Icon name="warning" size="sm" />
      </span>
    </Tooltip>
  );
}

/** A value with a hover tooltip, right-anchored so it stays inside the table. */
export function ValueWithTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <Tooltip content={tip} placement="top" align="end">
      <span style={numStyle}>{children}</span>
    </Tooltip>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <div style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ color: "var(--color-text-muted)" }}>{children}</div>;
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

export const numStyle: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
