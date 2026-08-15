"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Tooltip } from "./tooltip";
import { CollapsibleSection } from "./collapsible-section";
import {
  FormatTables,
  Dash,
  Muted,
  numStyle,
  mutedSmallStyle,
  type CellAxes,
  type CertColumn,
} from "./price-matrix";
import type {
  ChecklistEstimatedValue,
  EstimatedValueCell,
  EstimatedValueRow,
  StampEstimatedValue,
} from "@/lib/estimated-values";

// **Estimated value** — the Valuation dialog's fourth answer (#602; ADR-0022 §6 as revised), under
// Market value and above What I paid.
//
// Catalogue value × the learned realization ratio (#520; ADR-0029 §2), which is the very arithmetic
// the lots screen already recommends a bid from. The dialog used to answer "no auction results
// recorded for this stamp yet" for a stamp the app had just told the collector to bid 35.50 on, and
// both statements were true: one reports the measured median for the stamp's own key, the other
// applies a ratio learned elsewhere. Nothing on screen said so.
//
// **A section of its own, never merged into the Market value grid**, and the reason is the ratio's
// shape rather than tidiness: the ladder buckets on *condition*, so every row of the grid can
// resolve a different bucket at a different `n`. The bucket's name is the entire justification for
// the number — `Polska Ludowa, MNH, 1946–1950 · n = 6` can be argued with, `≈ 35.50` cannot — and in
// a merged grid there is nowhere to put it but a hover, which is the mistake this section exists to
// correct. So each row states its bucket beside the condition.
//
// **No confidence badge and no confidence colour.** Confidence (ADR-0022 §5) scores the datapoints
// for *this key*, of which an estimated cell has none by definition; borrowing the badge would make
// the estimate look measured, which is the one thing it must never do. The bucket and its `n` are
// this figure's evidence and they are already on the row.
//
// The figures are prefixed `≈` and the amounts are drawn in the muted tone — the same vocabulary
// the app already uses for *inferred, not recorded* (#238's `~`, an italic muted amount). Neither
// dialog toggle reaches the section: a ratio is unitless and carries no catalogue edition, which is
// exactly why Market value ignores them too.

/** A percentage as it is read aloud — `34%`, not `0.34`. Whole numbers only: a median over a
 * handful of ratios has no decimal place to state. */
function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function day(value: string | Date): string {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function axesOf(cell: EstimatedValueCell): CellAxes {
  return {
    conditionId: cell.conditionId,
    conditionName: cell.conditionName,
    conditionAbbreviation: cell.conditionAbbreviation,
    conditionSortOrder: cell.conditionSortOrder,
    certificateStatusId: cell.certificateStatusId,
    certificateStatusAbbreviation: cell.certificateStatusAbbreviation,
    certificateSortOrder: cell.certificateSortOrder,
  };
}

/** Every estimated cell's axes, so the dialog can union this section's certificates into the column
 * set every grid in the window shares. */
export function estimatedValueCertCells(
  data: StampEstimatedValue | ChecklistEstimatedValue | undefined
): CellAxes[] {
  return (data?.cells ?? []).map(axesOf);
}

/** A labelled line of a hover panel — the market section's, so the two read alike. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ ...numStyle, justifySelf: "end", whiteSpace: "nowrap" }}>{children}</span>
    </>
  );
}

/**
 * What a row was extrapolated with, said beside the condition rather than in a hover.
 *
 * The fallback rung is drawn in the warning tone and named for what it is: at that level the ratio
 * is the collection's configured `bidFallbackPercent` (#508) and not something learned, and that is
 * exactly the case where the figure most needs to be read as policy.
 */
function BucketAside({ row }: { row: EstimatedValueRow }) {
  const isFallback = row.level === "fallback";
  const label =
    row.bucketLabel ?? `${row.bucketCount} bucket${row.bucketCount === 1 ? "" : "s"}`;
  return (
    <span
      style={{
        ...mutedSmallStyle,
        color: isFallback ? "var(--color-warning)" : "var(--color-text-muted)",
      }}
    >
      {label}
      {row.ratio !== null && <> · {percent(row.ratio)}</>}
      {row.n > 0 && <> · n = {row.n}</>}
      {isFallback && <> · policy, not evidence</>}
    </span>
  );
}

/** What one estimated figure is made of, on hover. Deliberately short: the row already carries the
 * evidence, and the only things a cell adds are the two numbers the multiplication is over. */
function EstimateDetails({
  cell,
  row,
  baseCurrency,
  expandable,
}: {
  cell: EstimatedValueCell;
  row: EstimatedValueRow | undefined;
  baseCurrency: string;
  expandable: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <span style={{ fontWeight: 600 }}>
        {[cell.conditionAbbreviation, cell.certificateStatusAbbreviation, cell.formatAbbreviation]
          .filter(Boolean)
          .join(" · ")}
      </span>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          columnGap: "1.25rem",
          rowGap: "0.15rem",
        }}
      >
        <DetailRow label="Catalogue">
          {cell.catalogueValue} {baseCurrency}
        </DetailRow>
        {row?.ratio != null && <DetailRow label="Ratio">{percent(row.ratio)}</DetailRow>}
        <DetailRow label="Estimate">
          <strong>
            ≈ {cell.estimate} {baseCurrency}
          </strong>
        </DetailRow>
        {row && <DetailRow label="Learned from">{row.bucketLabel ?? `${row.bucketCount} buckets`}</DetailRow>}
      </div>

      <span style={{ color: "var(--color-text-muted)" }}>
        Nothing has been recorded for this key. The figure is the catalogue value times a ratio
        learned from other results — an estimate, not a measurement.
        {expandable && " Click for the lots the ratio came from."}
      </span>
    </div>
  );
}

/** The lots a **bucket** was learned from — the drill-down behind an estimated figure, and the same
 * gesture that expands a measured median into its datapoints. They are other stamps' lots by
 * construction: that is what a bucket is, and seeing which ones is most of what makes the ratio
 * arguable. */
function BucketLots({
  row,
  collectionSlug,
}: {
  row: EstimatedValueRow;
  collectionSlug: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        marginTop: "0.5rem",
        padding: "0.5rem 0.6rem",
        border: "1px solid var(--color-border)",
        borderRadius: "0.375rem",
        background: "var(--color-bg-page)",
      }}
    >
      <div style={{ ...mutedSmallStyle, fontWeight: 600 }}>
        {row.bucketLabel ?? "The ratio's bucket"} — {row.n} result{row.n === 1 ? "" : "s"}
        {row.ratio !== null && <>, median {percent(row.ratio)} of catalogue</>}
      </div>
      {row.lots.map((lot, index) => (
        <div
          key={`${lot.lotId}-${index}`}
          style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}
        >
          <a
            href={`/c/${collectionSlug}/auctions/sales/${lot.saleId}?lot=${lot.lotId}`}
            style={{ fontSize: "0.8125rem", color: "var(--color-accent)", textDecoration: "none" }}
          >
            {lot.lotNo ? `Lot ${lot.lotNo}` : `Lot #${lot.auctionLotNo}`}
          </a>
          <span style={mutedSmallStyle}>{lot.stampName ?? lot.lotTitle ?? lot.saleName}</span>
          <span style={mutedSmallStyle}>{lot.conditionAbbreviation}</span>
          <span style={mutedSmallStyle}>{day(lot.endsAt)}</span>
          <span style={{ ...mutedSmallStyle, marginLeft: "auto", whiteSpace: "nowrap" }}>
            {percent(lot.ratio)}
            {lot.split && <span style={{ opacity: 0.8 }}> (split)</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The amount itself: muted and prefixed `≈`, never in a confidence colour. */
const ESTIMATE_STYLE: React.CSSProperties = {
  ...numStyle,
  fontWeight: 600,
  color: "var(--color-text-muted)",
  fontStyle: "italic",
};

// ── One stamp ─────────────────────────────────────────────────────────────────

/**
 * The Valuation dialog's estimated-value section for a single stamp (#602).
 *
 * The cell is a **button** wherever its bucket has evidence, exactly as a measured median is: what
 * it expands is the lots the *ratio* was learned from, which is the only evidence an estimate has.
 * At the fallback rung there is nothing to expand and the figure is plain text.
 */
export function StampEstimatedValueSection({
  query,
  certificates,
}: {
  query: UseQueryResult<StampEstimatedValue>;
  certificates: CertColumn[];
}) {
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const [openCondition, setOpenCondition] = useState<string | null>(null);
  const data = query.data;
  const cells = data?.cells ?? [];
  const rowOf = (conditionId: string) => data?.rows.find((r) => r.conditionId === conditionId);
  const open = openCondition ? rowOf(openCondition) : undefined;

  return (
    <EstimateSection
      query={query}
      empty={cells.length === 0}
      emptyText="Nothing to estimate here: every condition this stamp is priced at either has auction results of its own — read them above — or has no catalogue value to extrapolate from."
    >
      {data && (
        <>
          <FormatTables
            values={cells.map((cell) => ({ ...cell, ...axesOf(cell) }))}
            certificates={certificates}
            labelWidth="22rem"
            renderRowAside={(conditionId) => {
              const row = rowOf(conditionId);
              return row ? <BucketAside row={row} /> : null;
            }}
            renderCell={(cell) => {
              // Empty, never a restatement: this cell's measured median is one section up, and the
              // two printed side by side invite reading the gap between them as a signal.
              if (!cell) return <Dash />;
              const row = rowOf(cell.conditionId);
              const expandable = (row?.lots.length ?? 0) > 0;
              const selected = expandable && openCondition === cell.conditionId;
              const figure = (
                <>
                  ≈ {cell.estimate} {data.baseCurrency}
                </>
              );
              return (
                <Tooltip
                  content={
                    <EstimateDetails
                      cell={cell}
                      row={row}
                      baseCurrency={data.baseCurrency}
                      expandable={expandable}
                    />
                  }
                  placement="top"
                  align="end"
                  maxWidth="24rem"
                >
                  {expandable ? (
                    <button
                      type="button"
                      onClick={() => setOpenCondition(selected ? null : cell.conditionId)}
                      aria-expanded={selected}
                      aria-label={`Estimated ${cell.estimate} ${data.baseCurrency}, from ${
                        row?.bucketLabel ?? "the learned ratio"
                      }`}
                      style={{
                        padding: "0.1rem 0.3rem",
                        margin: "-0.1rem -0.3rem",
                        border: "none",
                        borderRadius: "0.25rem",
                        background: selected ? "var(--color-bg-row-hover)" : "transparent",
                        cursor: "pointer",
                        font: "inherit",
                        // After `font`, never before — the shorthand resets tabular figures.
                        ...ESTIMATE_STYLE,
                      }}
                    >
                      {figure}
                    </button>
                  ) : (
                    <span style={ESTIMATE_STYLE}>{figure}</span>
                  )}
                </Tooltip>
              );
            }}
          />
          {open && <BucketLots row={open} collectionSlug={collectionSlug} />}
        </>
      )}
    </EstimateSection>
  );
}

// ── One checklist ─────────────────────────────────────────────────────────────

/**
 * The same section for a whole set (#602).
 *
 * A total with its **coverage count**, and no expansion — the rule the set's Market value already
 * follows. The two counts are complementary: a member with a measured median at a key is counted
 * there and not here, so `5 of 40` beside `7 of 40` above it says twelve of the forty have any
 * figure at all.
 *
 * A row can hold several buckets, since the ladder resolves per stamp — one is named only when the
 * members agree on it, and the count is stated otherwise. Naming one of several would be the wrong
 * evidence for the rest.
 */
export function ChecklistEstimatedValueSection({
  query,
  certificates,
}: {
  query: UseQueryResult<ChecklistEstimatedValue>;
  certificates: CertColumn[];
}) {
  const data = query.data;
  const cells = data?.cells ?? [];

  return (
    <EstimateSection
      query={query}
      empty={cells.length === 0}
      emptyText="Nothing to estimate here: the stamps on this checklist either have auction results of their own — totalled above — or have no catalogue value to extrapolate from."
    >
      {data && (
        <FormatTables
          values={cells.map((cell) => ({ ...cell, ...axesOf(cell) }))}
          certificates={certificates}
          labelWidth="22rem"
          renderRowAside={(conditionId) => {
            const row = data.rows.find((r) => r.conditionId === conditionId);
            return row ? <BucketAside row={row} /> : null;
          }}
          renderCell={(cell) => {
            if (!cell) return <Dash />;
            const complete = cell.stampCount === data.requiredCount;
            return (
              <Tooltip
                placement="top"
                align="end"
                maxWidth="24rem"
                content={
                  <EstimateDetails
                    cell={cell}
                    row={data.rows.find((r) => r.conditionId === cell.conditionId)}
                    baseCurrency={data.baseCurrency}
                    expandable={false}
                  />
                }
              >
                <span style={{ display: "inline-block" }}>
                  <div style={ESTIMATE_STYLE}>
                    ≈ {cell.estimate} {data.baseCurrency}
                  </div>
                  {/* Coverage, always — the figure above is a sum over the members with no results
                      of their own, not over the set. */}
                  <div
                    style={{
                      ...mutedSmallStyle,
                      color: complete ? "var(--color-text-muted)" : "var(--color-warning)",
                    }}
                  >
                    {cell.stampCount} of {data.requiredCount}
                  </div>
                </span>
              </Tooltip>
            );
          }}
        />
      )}
    </EstimateSection>
  );
}

// ── Shared shell and reads ────────────────────────────────────────────────────

export function useStampEstimatedValue(stampId: string) {
  return useQuery<StampEstimatedValue>({
    queryKey: ["stampEstimatedValue", stampId],
    staleTime: 30_000,
    queryFn: async () => {
      const { getStampEstimatedValueAction } = await import("@/app/actions/stamps");
      return getStampEstimatedValueAction(stampId);
    },
  });
}

export function useChecklistEstimatedValue(collectionId: string, checklistId: string) {
  return useQuery<ChecklistEstimatedValue>({
    queryKey: ["checklistEstimatedValue", collectionId, checklistId],
    staleTime: 30_000,
    queryFn: async () => {
      const { getChecklistEstimatedValueAction } = await import("@/app/actions/issues");
      return getChecklistEstimatedValueAction(collectionId, checklistId);
    },
  });
}

/**
 * The section box, and the three answers that are not a table.
 *
 * A {@link CollapsibleSection} like every other answer in this window, **open by default** beside
 * the three measured ones: the whole problem this section fixes is a dialog that said "no auction
 * results recorded" about a stamp the app had just recommended a bid on, and a collapsed box would
 * only half-fix it. The subtitle carries the label the issue turns on, so an extrapolation is named
 * as one before a single figure is read.
 */
function EstimateSection({
  query,
  empty,
  emptyText,
  children,
}: {
  query: { isLoading: boolean; isError: boolean };
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <CollapsibleSection
      title="Estimated value"
      subtitle="catalogue × the learned ratio — an estimate, not a measurement"
      defaultOpen
    >
      {query.isLoading && <Muted>Working out what these are likely worth…</Muted>}
      {query.isError && <Muted>The estimate could not be worked out just now.</Muted>}

      {!query.isLoading && !query.isError && empty && <Muted>{emptyText}</Muted>}

      {!query.isLoading && !query.isError && !empty && children}
    </CollapsibleSection>
  );
}
