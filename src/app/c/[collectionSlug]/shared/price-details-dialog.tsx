"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DialogShell } from "@/app/dialog-shell";
import { Tooltip } from "./tooltip";
import { Segmented } from "./segmented";
import type { StampPriceDetails } from "@/lib/stamps";
import type { ChecklistPriceDetails } from "@/lib/issues";
import { CollapsibleSection } from "./collapsible-section";
import {
  collectCertColumns,
  MatrixTable,
  Money,
  Dash,
  Warn,
  ValueWithTip,
  Muted,
  Empty,
  numStyle,
} from "./price-matrix";
import {
  StampMarketValueSection,
  ChecklistMarketValueSection,
  useStampMarketValue,
  useChecklistMarketValue,
  marketCertCells,
} from "./market-value-sections";
import {
  StampPurchaseCostSection,
  useStampPurchaseCosts,
  purchaseCostCertCells,
} from "./purchase-cost-section";

/** What the dialog describes: a single stamp, or one checklist's stamps (#531 — an issue may carry
 *  several goals, so "the set" is named by a checklist rather than by the publication). */
export type PriceDetailsTarget =
  | { kind: "stamp"; stampId: string }
  | { kind: "checklist"; collectionId: string; checklistId: string };

type Scope = "latest" | "all";
type CurrencyMode = "catalog" | "collection";

/**
 * Modal answering **what is this worth** for a stamp or a checklist — which is why it is titled
 * *Valuation* rather than *Catalog prices* (#457; ADR-0022 §8): the catalog is one of the two
 * answers it now carries, and a window named after one of them would hide the other.
 *
 * Sections, each the same collapsible box on the same conditions-as-rows × certificates-as-columns
 * matrix: the read-only **Market value** grid first (what closed auction lots actually paid), then
 * **What I paid** over the copies still held (#560), then the cross-catalog average (always in
 * collection currency) — those three open by default — then one section per catalog edition
 * (collapsed). A scope toggle picks latest-only vs all editions; a currency toggle switches the
 * catalog sections between catalog and collection currency. Neither toggle reaches the averages,
 * the market grid **or** the purchase costs — a hammer price and a cost basis both have no catalog
 * edition and are in the collection's currency to begin with. They stay pinned above it all the
 * same: they are the window's controls, and a control that scrolls away is one a reader goes
 * looking for.
 *
 * Market value leads because it is the answer the catalog sections are evidence for, and because it
 * is the one figure here that comes from transactions rather than from a published list. What the
 * collector paid follows it: it is evidence for neither of the other two — a different axis, not a
 * reading of the same one — so it goes beside the answer it most resembles, the other one derived
 * from money that actually changed hands.
 *
 * It is a **stamp-only** section. The aggregate is defined over the copies of one stamp, and a
 * checklist's copies are a different figure (a set's cost is a sum over its members, not an average
 * over one key), so the checklist half of this window carries no purchase costs.
 *
 * The dialog height is fixed: the toolbar is pinned and the sections scroll internally, so
 * expanding a section never resizes the window.
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

  const checklistQuery = useQuery<ChecklistPriceDetails>({
    queryKey:
      target.kind === "checklist"
        ? ["checklistPriceDetails", target.collectionId, target.checklistId]
        : ["checklistPriceDetails", null],
    enabled: target.kind === "checklist",
    staleTime: 30_000,
    queryFn: async () => {
      const t = target as { collectionId: string; checklistId: string };
      const { getChecklistPriceDetailsAction } = await import("@/app/actions/issues");
      return getChecklistPriceDetailsAction(t.collectionId, t.checklistId);
    },
  });

  const isLoading = target.kind === "stamp" ? stampQuery.isLoading : checklistQuery.isLoading;

  return (
    <DialogShell
      title="Valuation"
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
          <StampSections
            data={stampQuery.data}
            stampId={target.stampId}
            scope={scope}
            currencyMode={currencyMode}
          />
        )}

        {!isLoading && target.kind === "checklist" && checklistQuery.data && (
          <ChecklistSections
            data={checklistQuery.data}
            collectionId={target.collectionId}
            checklistId={target.checklistId}
            scope={scope}
            currencyMode={currencyMode}
          />
        )}
      </div>
    </DialogShell>
  );
}

// ── Stamp ─────────────────────────────────────────────────────────────────────

function StampSections({
  data,
  stampId,
  scope,
  currencyMode,
}: {
  data: StampPriceDetails;
  stampId: string;
  scope: Scope;
  currencyMode: CurrencyMode;
}) {
  const market = useStampMarketValue(stampId);
  const purchases = useStampPurchaseCosts(stampId);
  const editions = data.editions.filter((e) => scope === "all" || e.isNewest);

  // One shared certificate column set across the market grid, the purchase costs, the average and
  // every edition table, built from all editions (not just the visible ones) so the columns never
  // shift. The market and purchase figures are in the union too: a certificate that appears only in
  // an auction result or only on a copy the collector owns still earns a column everywhere, which is
  // what keeps the grids readable against each other.
  const certColumns = collectCertColumns([
    data.averageCells,
    ...data.editions.map((e) => e.cells),
    marketCertCells(market.data, undefined),
    purchaseCostCertCells(purchases.data),
  ]);

  // No catalog prices is **not** an empty dialog: a stamp can have auction results, or copies with a
  // cost, and no catalog price at all — a single-line lot needs none to yield one (ADR-0022 §3) — so
  // those two sections still stand, and only the catalog half is empty.
  if (data.averageCells.length === 0 && editions.length === 0) {
    return (
      <>
        <StampMarketValueSection query={market} certificates={certColumns} />
        <StampPurchaseCostSection query={purchases} certificates={certColumns} />
        <Empty>No catalog prices recorded.</Empty>
      </>
    );
  }

  return (
    <>
      <StampMarketValueSection query={market} certificates={certColumns} />
      <StampPurchaseCostSection query={purchases} certificates={certColumns} />

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

// ── Checklist ─────────────────────────────────────────────────────────────────

function ChecklistSections({
  data,
  collectionId,
  checklistId,
  scope,
  currencyMode,
}: {
  data: ChecklistPriceDetails;
  collectionId: string;
  checklistId: string;
  scope: Scope;
  currencyMode: CurrencyMode;
}) {
  const market = useChecklistMarketValue(collectionId, checklistId);
  const catalogs = scope === "all" ? data.catalogsAll : data.catalogsLatest;

  // Shared certificate columns across the market grid, the average and every catalog table (both
  // variants), so the columns never shift when toggling latest/all.
  const certColumns = collectCertColumns([
    data.averageCells,
    ...data.catalogsLatest.map((c) => c.cells),
    ...data.catalogsAll.map((c) => c.cells),
    marketCertCells(undefined, market.data),
  ]);

  if (data.averageCells.length === 0 && catalogs.length === 0) {
    return (
      <>
        <ChecklistMarketValueSection query={market} certificates={certColumns} />
        <Empty>No catalog prices recorded for the stamps on “{data.checklistName}”.</Empty>
      </>
    );
  }

  return (
    <>
      <ChecklistMarketValueSection query={market} certificates={certColumns} />

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
