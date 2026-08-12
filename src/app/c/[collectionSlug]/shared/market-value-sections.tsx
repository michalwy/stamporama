"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Tooltip } from "./tooltip";
import { MarketConfidenceChip, marketConfidenceColor } from "./market-confidence-chip";
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
  StampMarketValue,
  ChecklistMarketValue,
  ChecklistMarketCell,
} from "@/lib/market-values";

// **What the market paid** — the read-only section that leads the Valuation dialog (#457;
// ADR-0022 §8).
//
// Laid out on the dialog's **own grid**: conditions as rows, certificate statuses as columns, the
// same table the catalogue sections use and sharing their certificate columns, so a reader learns
// to read this window once and can compare a median against a list price cell for cell.
//
// It is not laid *into* the catalogue tables, though. Those are per catalogue edition and a market
// value has none (§1): a hammer price belongs to the date it was struck, not to a published book,
// so a market row inside one of them would sit there pretending to be an edition. That is also why
// neither toolbar toggle reaches this section — no editions to choose between, and every figure is
// in the collection's currency to begin with, the rate having been frozen on each lot at its close
// (#354). The toggles stay pinned above it all the same: they are the window's controls, and a
// control that scrolls away is one a reader has to go looking for.
//
// **The format is a table, not a column.** A market key carries a third axis the catalogue grid has
// no room for, so each format gets its own matrix under its own caption, the single first (shared
// `FormatTables`, in `price-matrix.tsx` since the purchase-cost section, #560, is laid out on the
// same axes). Folding them into one grid would put a block's price in the same cell as a single's.
//
// A key with no datapoints is **absent** — no cell, and never a zero: nothing is estimated from a
// neighbouring key, and a zero reads as "worth nothing" where the truth is "nothing recorded".

/** A percentage as it is read aloud — `24%`, not `0.24`. Whole numbers only: the ratio is a median
 * over a handful of results, and a decimal would state a precision it does not have. */
function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Dates cross a server action intact; formatted in the browser's own locale, like every other date
 * on the auction screens. */
function day(value: string | Date): string {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function span(earliestAt: string | Date, latestAt: string | Date): string {
  const from = day(earliestAt);
  const to = day(latestAt);
  return from === to ? to : `${from} – ${to}`;
}

/** The axes a market figure sits at, in the shape every cell in this dialog is drawn from.
 * `certificateSortOrder` already carries `-1` for "none", which is the convention that makes the
 * No cert. column lead in the catalogue tables. */
function axesOf(value: {
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  conditionSortOrder: number;
  certificateStatusId: string | null;
  certificateStatusAbbreviation: string | null;
  certificateSortOrder: number;
}): CellAxes {
  return {
    conditionId: value.conditionId,
    conditionName: value.conditionName,
    conditionAbbreviation: value.conditionAbbreviation,
    conditionSortOrder: value.conditionSortOrder,
    certificateStatusId: value.certificateStatusId,
    certificateStatusAbbreviation: value.certificateStatusAbbreviation,
    certificateSortOrder: value.certificateSortOrder,
  };
}

/** Every market figure as a bare cell, so the dialog can union its certificates into the column set
 * the catalogue grids share. A certificate that appears only in an auction result still gets a
 * column in every table, which is what keeps them lined up. */
export function marketCertCells(
  stamp: StampMarketValue[] | undefined,
  checklist: ChecklistMarketValue | undefined
): CellAxes[] {
  return [...(stamp ?? []), ...(checklist?.cells ?? [])].map(axesOf);
}

// ── One stamp ─────────────────────────────────────────────────────────────────

/** The lots a figure was computed from — the evidence, one row each, each a link to the lot on its
 * sale's own screen. `amount` is what this lot contributed *per unit*, which is what the median is
 * over; `finalPrice` is what the whole lot fetched, and the two differ whenever a lot held more
 * than one of something or was split (ADR-0022 §3). */
function LotList({ value, collectionSlug }: { value: StampMarketValue; collectionSlug: string }) {
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
      {/* The panel names the cell it belongs to: it opens below the table, and an unlabelled list of
          lots under a grid says nothing about which figure it explains. */}
      <div style={{ ...mutedSmallStyle, fontWeight: 600 }}>
        {[value.conditionAbbreviation, value.certificateStatusAbbreviation, value.formatAbbreviation]
          .filter(Boolean)
          .join(" · ")}{" "}
        — {value.n} result{value.n === 1 ? "" : "s"}, {span(value.earliestAt, value.latestAt)}
      </div>
      {value.lots.map((lot) => (
        <div
          key={lot.lotId}
          style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}
        >
          <a
            href={`/c/${collectionSlug}/auctions/sales/${lot.saleId}?lot=${lot.lotId}`}
            style={{ fontSize: "0.8125rem", color: "var(--color-accent)", textDecoration: "none" }}
          >
            {lot.lotNo ? `Lot ${lot.lotNo}` : `Lot #${lot.auctionLotNo}`}
          </a>
          <span style={mutedSmallStyle}>{lot.saleName}</span>
          <span style={mutedSmallStyle}>{day(lot.endsAt)}</span>
          <span style={{ ...mutedSmallStyle, marginLeft: "auto", whiteSpace: "nowrap" }}>
            {lot.amount} {value.baseCurrency}
            {(lot.split || lot.quantity > 1) && (
              <span style={{ opacity: 0.8 }}>
                {" "}
                (of {lot.finalPrice} {value.baseCurrency}
                {lot.quantity > 1 ? ` ÷ ${lot.quantity}` : ""}
                {lot.split ? ", split" : ""})
              </span>
            )}
          </span>
        </div>
      ))}
      {/* Said once under the lots rather than as a note on each split row: the pro-rata rule is one
          fact about how this figure was arrived at, not a warning repeated per line. */}
      {value.splitCount > 0 && (
        <span style={{ ...mutedSmallStyle, fontStyle: "italic" }}>
          {value.splitCount} of {value.n} came out of a lot holding other stamps too, split by
          catalogue value.
        </span>
      )}
    </div>
  );
}

/** A labelled line of the hover panel. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span style={{ color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ ...numStyle, justifySelf: "end", whiteSpace: "nowrap" }}>{children}</span>
    </>
  );
}

/**
 * What a median is made of, on hover — everything that does not fit in a cell.
 *
 * A **panel of labelled figures**, not a sentence: mean, range, sample, span and the catalogue
 * comparison strung together with separators ran into one block that had to be picked apart word by
 * word, which is the opposite of what a figure's backing should take to read. Each fact gets its own
 * line, and the numbers share a right-aligned column so they can be compared down it.
 *
 * The confidence is **said here in words** as well as shown in the figure's colour: colour alone is
 * not something every reader can act on, and this is the only other place the score appears now
 * that the chip is gone from the grid.
 */
function MedianDetails({ value }: { value: StampMarketValue }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600 }}>
          {[value.conditionAbbreviation, value.certificateStatusAbbreviation, value.formatAbbreviation]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <MarketConfidenceChip badge={value.confidence.badge} score={value.confidence.score} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          columnGap: "1.25rem",
          rowGap: "0.15rem",
        }}
      >
        <DetailRow label="Median">
          <strong style={{ color: marketConfidenceColor(value.confidence.badge) }}>
            {value.median} {value.baseCurrency}
          </strong>
        </DetailRow>
        <DetailRow label="Mean">
          {value.mean} {value.baseCurrency}
        </DetailRow>
        <DetailRow label="Range">
          {value.min} – {value.max} {value.baseCurrency}
        </DetailRow>
        <DetailRow label="Results">
          {value.n}
          {value.splitCount > 0 ? `, ${value.splitCount} split` : ""}
        </DetailRow>
        <DetailRow label="Span">{span(value.earliestAt, value.latestAt)}</DetailRow>
        {/* A key can carry evidence and no catalogue price — a single-line lot needs none to yield a
            datapoint — and that reads as no row rather than as a ratio of nothing. */}
        {value.catalogueValue !== null && (
          <DetailRow label="Catalog">
            {value.catalogueValue} {value.baseCurrency}
            {value.realizationRatio !== null ? ` · ${percent(value.realizationRatio)}` : ""}
          </DetailRow>
        )}
      </div>

      <span style={{ color: "var(--color-text-muted)" }}>Click for the lots behind it.</span>
    </div>
  );
}

/** The same panel for a set's total, where coverage is the fact a reader most needs (#457). */
function ChecklistTotalDetails({
  cell,
  data,
}: {
  cell: ChecklistMarketCell;
  data: ChecklistMarketValue;
}) {
  const complete = cell.stampCount === data.requiredCount;
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
        <DetailRow label="Total">
          <strong>
            {cell.totalBaseAmount} {data.baseCurrency}
          </strong>
        </DetailRow>
        <DetailRow label="From">
          <span style={{ color: complete ? undefined : "var(--color-warning)" }}>
            {cell.stampCount} of {data.requiredCount} stamps
          </span>
        </DetailRow>
        <DetailRow label="Results">{cell.n}</DetailRow>
        <DetailRow label="Span">{span(cell.earliestAt, cell.latestAt)}</DetailRow>
      </div>

      <span style={{ color: "var(--color-text-muted)" }}>
        {complete
          ? "Every stamp on this checklist has auction results here."
          : "The rest contribute nothing — nothing is estimated for them."}
      </span>
    </div>
  );
}

/**
 * The Valuation dialog's market section for a single stamp (#457).
 *
 * The cell is a **button**: a matrix holds a number but not an argument, and the argument — the lots
 * the median came from, each a link out — is the whole reason to trust the number. The lots open
 * *under* the table, where there is room, and one key at a time, since what is being asked is
 * "where did **this** figure come from".
 */
export function StampMarketValueSection({
  query,
  certificates,
}: {
  query: UseQueryResult<StampMarketValue[]>;
  certificates: CertColumn[];
}) {
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const values = query.data ?? [];
  const keyOf = (v: { conditionId: string; certificateStatusId: string | null; formatId: string | null }) =>
    `${v.conditionId}~${v.certificateStatusId ?? ""}~${v.formatId ?? ""}`;
  const open = values.find((v) => keyOf(v) === openKey) ?? null;

  return (
    <MarketSection query={query} empty={values.length === 0} emptySubject="this stamp">
      <FormatTables
        values={values.map((value) => ({ ...value, ...axesOf(value) }))}
        certificates={certificates}
        renderCell={(cell) => {
          if (!cell) return <Dash />;
          const selected = keyOf(cell) === openKey;
          return (
            <Tooltip
              content={<MedianDetails value={cell} />}
              placement="top"
              align="end"
              maxWidth="24rem"
            >
              {/* Nothing beside the figure, deliberately: the confidence rides **on** it as its
                  colour, so every median in a column starts and ends in the same place and the
                  column can be scanned. */}
              <button
                type="button"
                onClick={() => setOpenKey(selected ? null : keyOf(cell))}
                aria-expanded={selected}
                aria-label={`${cell.median} ${cell.baseCurrency}, ${cell.confidence.badge} confidence`}
                style={{
                  padding: "0.1rem 0.3rem",
                  margin: "-0.1rem -0.3rem",
                  border: "none",
                  borderRadius: "0.25rem",
                  background: selected ? "var(--color-bg-row-hover)" : "transparent",
                  cursor: "pointer",
                  font: "inherit",
                  // After `font`, never before: the shorthand resets `font-variant-numeric`, and
                  // without tabular figures the digits do not line up — which is the whole reason
                  // the confidence stopped being a chip.
                  ...numStyle,
                  fontWeight: 600,
                  color: marketConfidenceColor(cell.confidence.badge),
                }}
              >
                {cell.median} {cell.baseCurrency}
              </button>
            </Tooltip>
          );
        }}
      />
      {open && <LotList value={open} collectionSlug={collectionSlug} />}
    </MarketSection>
  );
}

// ── One checklist ─────────────────────────────────────────────────────────────

/**
 * The Valuation dialog's market section for a whole set (#457).
 *
 * The same figures the stamp half prints, summed per key — a set's worth is the sum of its members'
 * worth. What replaces the per-stamp confidence badge is **coverage**, on the cell's second line the
 * way a catalogue total carries its own completeness: how many of the required stamps stand behind
 * the figure. Averaging forty confidence scores would produce a badge describing nothing in
 * particular, while a total resting on 7 of 40 members is exactly what a reader has to be told.
 *
 * No cell expands here: a set's evidence is every lot of every member, which is a list read one
 * stamp at a time.
 */
export function ChecklistMarketValueSection({
  query,
  certificates,
}: {
  query: UseQueryResult<ChecklistMarketValue>;
  certificates: CertColumn[];
}) {
  const data = query.data;
  const cells = data?.cells ?? [];

  return (
    <MarketSection query={query} empty={cells.length === 0} emptySubject="these stamps">
      {data && (
        <FormatTables
          values={cells.map((cell) => ({ ...cell, ...axesOf(cell) }))}
          certificates={certificates}
          renderCell={(cell) => (cell ? <ChecklistCell cell={cell} data={data} /> : <Dash />)}
        />
      )}
    </MarketSection>
  );
}

function ChecklistCell({ cell, data }: { cell: ChecklistMarketCell; data: ChecklistMarketValue }) {
  const complete = cell.stampCount === data.requiredCount;
  return (
    <Tooltip
      placement="top"
      align="end"
      maxWidth="24rem"
      content={<ChecklistTotalDetails cell={cell} data={data} />}
    >
      <span style={{ display: "inline-block" }}>
        <div style={numStyle}>
          {cell.totalBaseAmount} {data.baseCurrency}
        </div>
        {/* Coverage, always — the figure above is a sum over the members that have results, not over
            the set. A partial total that does not say so is the one thing this must never draw. */}
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
}

// ── Shared shell and reads ────────────────────────────────────────────────────

/** Fetched at the dialog's level rather than inside the section, because the certificate columns are
 * unioned across every grid in the window and that union cannot be taken before the figures are in.
 * Nothing is stored server-side (ADR-0022 §7), so there is nothing to invalidate: a lot's final
 * price edited on the auctions screen changes the next answer this asks for. */
export function useStampMarketValue(stampId: string) {
  return useQuery<StampMarketValue[]>({
    queryKey: ["stampMarketValue", stampId],
    staleTime: 30_000,
    queryFn: async () => {
      const { getStampMarketValueAction } = await import("@/app/actions/stamps");
      return getStampMarketValueAction(stampId);
    },
  });
}

export function useChecklistMarketValue(collectionId: string, checklistId: string) {
  return useQuery<ChecklistMarketValue>({
    queryKey: ["checklistMarketValue", collectionId, checklistId],
    staleTime: 30_000,
    queryFn: async () => {
      const { getChecklistMarketValueAction } = await import("@/app/actions/issues");
      return getChecklistMarketValueAction(collectionId, checklistId);
    },
  });
}

/** The section box, and the three answers that are not a table: loading, failure, and nothing
 * recorded.
 *
 * It is a {@link CollapsibleSection} like every other answer in this dialog rather than a heading of
 * its own — a section that drew its own title would read as a caption on the page instead of one
 * more thing to open and close. Open by default, leading the average: those two are what the dialog
 * is for, and the per-catalogue tables under them are the workings.
 *
 * The negative answer is a **sentence**, not an absent section: a section that is not there is
 * indistinguishable from one that failed, and a collector who has never recorded a closed lot has
 * no way to guess that recording one is what fills this in. */
function MarketSection({
  query,
  empty,
  emptySubject,
  children,
}: {
  query: { isLoading: boolean; isError: boolean };
  empty: boolean;
  emptySubject: string;
  children: React.ReactNode;
}) {
  return (
    <CollapsibleSection title="Market value" subtitle="from recorded auction results" defaultOpen>
      {query.isLoading && <Muted>Working out what the market paid…</Muted>}
      {query.isError && <Muted>The market value could not be worked out just now.</Muted>}

      {!query.isLoading && !query.isError && empty && (
        <Muted>
          No auction results recorded for {emptySubject} yet. Market value is worked out from closed
          lots on the Auctions screen — a lot added purely to watch what it fetched counts too.
        </Muted>
      )}

      {!query.isLoading && !query.isError && !empty && children}
    </CollapsibleSection>
  );
}
