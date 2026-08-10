"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StampPriceDetails } from "@/lib/stamps";
import type { IssuePriceDetails } from "@/lib/issues";
import { DetailCard, EmptyNote, DETAIL_BUTTON } from "./detail-page";
import { PriceDetailsDialog, type PriceDetailsTarget } from "./price-details-dialog";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";

// The catalog-value card of a detail screen (#517/#518/#519). It shows the **cross-catalog
// average** matrix — condition × certificate, always in the collection's currency — because that
// is the figure a collector reads a value off, and puts the per-edition breakdown behind the same
// #114 dialog the row menus open. One card, two targets: a stamp (the copy screen shows its
// stamp's) and an issue's required members.

interface AverageCell {
  conditionId: string;
  conditionAbbreviation: string;
  conditionName: string;
  conditionSortOrder: number;
  certificateStatusId: string | null;
  certificateStatusAbbreviation: string | null;
  certificateSortOrder: number;
  averageBase: string | null;
  baseCurrency: string;
}

const CELL: React.CSSProperties = {
  padding: "0.3rem 0.6rem",
  fontSize: "0.8125rem",
  borderTop: "1px solid var(--color-border)",
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
  whiteSpace: "nowrap",
};

const HEAD: React.CSSProperties = {
  padding: "0.3rem 0.6rem",
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
  textAlign: "right",
  whiteSpace: "nowrap",
};

export function CatalogPricesCard({
  target,
  title = "Catalog prices",
  /** Sentence for a subject with nothing recorded, in that subject's own words. */
  emptyText,
}: {
  target: PriceDetailsTarget;
  title?: string;
  emptyText: string;
}) {
  const [dialog, setDialog] = useState(false);

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
  const cells: AverageCell[] =
    (target.kind === "stamp" ? stampQuery.data?.averageCells : issueQuery.data?.averageCells) ?? [];
  const priced = cells.filter((c) => c.averageBase !== null);

  // Conditions as rows, certificates as columns — the dialog's own layout, so the two read alike.
  const certificates = [
    ...new Map(
      priced.map((c) => [
        c.certificateStatusId ?? "",
        {
          key: c.certificateStatusId ?? "",
          label: c.certificateStatusAbbreviation ?? "No cert.",
          sort: c.certificateSortOrder,
        },
      ])
    ).values(),
  ].sort((a, b) => a.sort - b.sort);
  const conditions = [
    ...new Map(
      priced.map((c) => [
        c.conditionId,
        { id: c.conditionId, label: c.conditionAbbreviation, name: c.conditionName, sort: c.conditionSortOrder },
      ])
    ).values(),
  ].sort((a, b) => a.sort - b.sort);
  const byKey = new Map(priced.map((c) => [`${c.conditionId}~${c.certificateStatusId ?? ""}`, c]));

  return (
    <>
      <DetailCard
        title={title}
        actions={
          <button type="button" style={DETAIL_BUTTON} onClick={() => setDialog(true)}>
            <Icon name="prices" size="sm" /> Full breakdown
          </button>
        }
      >
        {isLoading && <EmptyNote>Loading prices…</EmptyNote>}
        {!isLoading && priced.length === 0 && <EmptyNote>{emptyText}</EmptyNote>}
        {priced.length > 0 && (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: "18rem" }}>
                <thead>
                  <tr>
                    <th style={{ ...HEAD, textAlign: "left" }}>Condition</th>
                    {certificates.map((cert) => (
                      <th key={cert.key} style={HEAD}>
                        {cert.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {conditions.map((cond) => (
                    <tr key={cond.id}>
                      <td style={{ ...CELL, textAlign: "left" }}>
                        <Tooltip content={cond.name}>
                          <span style={{ fontWeight: 500 }}>{cond.label}</span>
                        </Tooltip>
                      </td>
                      {certificates.map((cert) => {
                        const cell = byKey.get(`${cond.id}~${cert.key}`);
                        return (
                          <td key={cert.key} style={CELL}>
                            {cell?.averageBase ? (
                              <>
                                {cell.averageBase}{" "}
                                <span style={{ color: "var(--color-text-muted)", fontSize: "0.6875rem" }}>
                                  {cell.baseCurrency}
                                </span>
                              </>
                            ) : (
                              <span style={{ color: "var(--color-text-muted)" }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              Cross-catalog average, in the collection currency. The per-catalog and per-edition
              figures are in the full breakdown.
            </div>
          </>
        )}
      </DetailCard>
      {dialog && <PriceDetailsDialog target={target} onClose={() => setDialog(false)} />}
    </>
  );
}
