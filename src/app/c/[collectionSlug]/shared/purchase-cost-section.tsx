"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Tooltip } from "./tooltip";
import { CollapsibleSection } from "./collapsible-section";
import {
  FormatTables,
  Dash,
  Muted,
  numStyle,
  mutedSmallStyle,
  type CertColumn,
} from "./price-matrix";
import type { StampPurchaseCost, StampPurchaseCosts } from "@/lib/purchase-costs";

// **What I paid** — the Valuation dialog's third answer (#560), between what the market paid (#457)
// and what the catalogues list.
//
// It sits **below Market value and above the catalogue sections** for a reason of order rather than
// of importance: the catalogue tables are the evidence market value is read against, so they belong
// under it, and what the collector paid is evidence for neither. It is put nearest market value
// because those two are the transaction-derived answers — one from other people's money, one from
// this collector's.
//
// Laid out on the dialog's **own grid** and sharing its certificate columns: a collector comparing
// "I paid 40" against "the market pays 55" and "the catalogue lists 120" should be able to read the
// three off the same cell position, which only works if the three grids are one grid drawn thrice.
//
// **The figures are over the priced copies only.** A copy in a still-open purchase lot has no final
// cost basis (#123; ADR-0009 §5) — its share of the lot's pool is not settled — and a copy added by
// hand never had one. Neither is averaged in at nothing, and neither is guessed at. They are
// counted, on their own line under the figure, which is why a cell can carry counts and no figure at
// all: "two of these, cost not settled yet" is an answer, and an empty cell would say "none held".
//
// Neither toolbar toggle reaches this section, on market value's reasoning exactly: a cost basis is
// frozen in the collection's own currency when the lot closes, and it belongs to an order rather
// than to a published edition.

/** Dates cross a server action intact; formatted in the browser's own locale, like every other date
 * in this window. */
function day(value: string | Date): string {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** A labelled line of the hover panel, numbers sharing a right-aligned column so they can be
 * compared down it — the same panel shape the market medians use. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ ...numStyle, justifySelf: "end", whiteSpace: "nowrap" }}>{children}</span>
    </>
  );
}

/** What an average is made of, on hover: the spread it covers, how many copies stand behind it, how
 * many are not counted and why, and when the most recent of the priced ones was bought. */
function CostDetails({ cell }: { cell: StampPurchaseCost }) {
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
        {cell.average !== null && (
          <DetailRow label="Average">
            <strong>
              {cell.average} {cell.baseCurrency}
            </strong>
          </DetailRow>
        )}
        {cell.min !== null && cell.max !== null && (
          <DetailRow label="Range">
            {cell.min} – {cell.max} {cell.baseCurrency}
          </DetailRow>
        )}
        <DetailRow label="Priced copies">{cell.knownCount}</DetailRow>
        {cell.pendingCount > 0 && (
          <DetailRow label="Cost pending">
            <span style={{ color: "var(--color-warning)" }}>{cell.pendingCount}</span>
          </DetailRow>
        )}
        {cell.noneCount > 0 && <DetailRow label="No cost recorded">{cell.noneCount}</DetailRow>}
        {cell.latestPurchasedAt && (
          <DetailRow label="Last bought">{day(cell.latestPurchasedAt)}</DetailRow>
        )}
      </div>

      {cell.pendingCount > 0 && (
        <span style={{ color: "var(--color-text-muted)" }}>
          A copy on a still-open purchase lot has no final cost yet — it is counted here, never
          averaged in. Closing the lot settles it.
        </span>
      )}
    </div>
  );
}

/** The counts under a figure: what the average covers, and what it deliberately leaves out. Said on
 * the cell rather than in the tooltip alone, because a figure over 1 of 5 copies is not "what I paid
 * for these" and only this line says which it is. */
function CountLine({ cell }: { cell: StampPurchaseCost }) {
  const parts: React.ReactNode[] = [];
  if (cell.knownCount > 0) parts.push(<span key="known">{cell.knownCount} priced</span>);
  if (cell.pendingCount > 0)
    parts.push(
      <span key="pending" style={{ color: "var(--color-warning)" }}>
        {cell.pendingCount} pending
      </span>
    );
  if (cell.noneCount > 0) parts.push(<span key="none">{cell.noneCount} no cost</span>);

  return (
    <div style={mutedSmallStyle}>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && " · "}
          {part}
        </span>
      ))}
    </div>
  );
}

function CostCell({ cell }: { cell: StampPurchaseCost }) {
  return (
    <Tooltip content={<CostDetails cell={cell} />} placement="top" align="end" maxWidth="24rem">
      <span style={{ display: "inline-block" }}>
        {cell.average === null ? (
          // Held copies, no settled cost — a dash on the figure line and the counts below saying
          // why. Never a zero: zero is a price, and "not yet known" is not one.
          <div style={{ ...numStyle, color: "var(--color-text-muted)" }}>—</div>
        ) : (
          <div style={{ ...numStyle, fontWeight: 600 }}>
            {cell.average} {cell.baseCurrency}
          </div>
        )}
        <CountLine cell={cell} />
      </span>
    </Tooltip>
  );
}

/** Fetched at the dialog's level like the market values, because the certificate columns are unioned
 * across every grid in the window and that union cannot be taken before the figures are in. Nothing
 * is stored: a purchase lot closing freezes its copies' cost bases, and the next read shows them. */
export function useStampPurchaseCosts(stampId: string) {
  return useQuery<StampPurchaseCosts>({
    queryKey: ["stampPurchaseCosts", stampId],
    staleTime: 30_000,
    queryFn: async () => {
      const { getStampPurchaseCostsAction } = await import("@/app/actions/stamps");
      return getStampPurchaseCostsAction(stampId);
    },
  });
}

/** Every cell's axes, so the dialog can union this section's certificates into the column set every
 * grid in the window shares. A certificate that appears only on a copy the collector owns still
 * earns a column in the catalogue tables, which is what keeps them lined up. */
export function purchaseCostCertCells(data: StampPurchaseCosts | undefined) {
  return data?.cells ?? [];
}

/**
 * The Valuation dialog's purchase-cost section for a single stamp (#560).
 *
 * A {@link CollapsibleSection} like every other answer in this window, **open by default** beside
 * market value: the two are what the dialog is for, and the per-catalogue tables under them are the
 * workings.
 *
 * The negative answer is a **sentence**, not an absent section — a section that is not there is
 * indistinguishable from one that failed, and a collector who has never recorded a purchase has no
 * way to guess that recording one is what fills this in.
 *
 * No cell expands. The evidence behind a cost basis is the purchase order it was frozen from, which
 * a copy's own row already links to (#387) — repeating that list here would be a second route to the
 * same screen from a window that is meant to be read and closed.
 */
export function StampPurchaseCostSection({
  query,
  certificates,
}: {
  query: UseQueryResult<StampPurchaseCosts>;
  certificates: CertColumn[];
}) {
  const data = query.data;
  const cells = data?.cells ?? [];

  return (
    <CollapsibleSection title="What I paid" subtitle="across the copies still held" defaultOpen>
      {query.isLoading && <Muted>Reading what these copies cost…</Muted>}
      {query.isError && <Muted>What you paid could not be worked out just now.</Muted>}

      {!query.isLoading && !query.isError && cells.length === 0 && (
        <Muted>
          No copies of this stamp are held. What you paid is read off the copies in the collection —
          their cost is frozen when the purchase order&rsquo;s lot is closed.
        </Muted>
      )}

      {!query.isLoading && !query.isError && cells.length > 0 && data && (
        <>
          <FormatTables
            values={cells}
            certificates={certificates}
            renderCell={(cell) => (cell ? <CostCell cell={cell} /> : <Dash />)}
          />
          {/* The totals said once, rather than left to be added up out of the matrix — "how many of
              these do I have, and how many of them have a settled cost" is a question about the
              stamp, not about one cell of it. */}
          <div style={{ ...mutedSmallStyle, marginTop: "0.5rem" }}>
            {data.knownCount} priced
            {data.pendingCount > 0 && (
              <span style={{ color: "var(--color-warning)" }}> · {data.pendingCount} pending</span>
            )}
            {data.noneCount > 0 && <> · {data.noneCount} with no cost recorded</>}
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
