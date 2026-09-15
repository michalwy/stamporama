"use client";

import { useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProfitAndLoss } from "@/lib/profit-and-loss";
import type { SaleProfitRow } from "@/lib/sales";
import { describeLeftOut, type ProfitFigures } from "@/lib/sale-profit";
import {
  describeWriteOffLeftOut,
  isPeriodGranularity,
  parseDateRange,
  type PeriodGranularity,
  type ResultFigures,
  type WriteOffFigures,
} from "@/lib/profit-and-loss-rules";
import { FilterChip, FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { ROW_LINK_ABOVE, RowLink } from "@/app/c/[collectionSlug]/shared/row-link";
import { useProfitAndLoss, useProfitAndLossSales } from "./use-profit-and-loss-query";

/**
 * The profit and loss screen (#1305): where the Overview's **Realized profit and loss** comes from.
 * One date range over four readings — the totals, the result per month or year, the result per
 * platform, and every sale — with the write-offs (copies lost, damaged or otherwise gone, #394/#396)
 * as their own loss line so the result is not flattered by leaving them out.
 *
 * Every sale figure is the one its own screen shows (#168); a copy that cannot be counted is left
 * out and counted by why, never read as zero.
 */

const SECTION_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: "0.75rem" };

const SECTION_LABEL: CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const CARD_STYLE: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  overflow: "clip",
};

const TILE_STYLE: CSSProperties = {
  ...CARD_STYLE,
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  padding: "1rem 1.25rem",
};

const TILE_LABEL: CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const HEADLINE_STYLE: CSSProperties = {
  fontSize: "1.375rem",
  fontWeight: 700,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.2,
};

const LINE_STYLE: CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  fontVariantNumeric: "tabular-nums",
};

const NOTE_STYLE: CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  fontVariantNumeric: "tabular-nums",
};

const HEAD_CELL: CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
};

const NUM: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

const MUTED: CSSProperties = { color: "var(--color-text-muted)" };

function signedStyle(amount: number): CSSProperties {
  if (amount > 0) return { color: "var(--color-success)" };
  if (amount < 0) return { color: "var(--color-error)" };
  return {};
}

/** `−` typographic, `+` printed — a result states its sign. */
function signed(amount: string): string {
  const n = Number(amount);
  if (n === 0) return "0.00";
  return n < 0 ? `−${Math.abs(n).toFixed(2)}` : `+${n.toFixed(2)}`;
}

/** A loss stated as one: `−12.00`, or `0.00` when there is none. */
function loss(amount: string): string {
  return Number(amount) === 0 ? "0.00" : `−${Number(amount).toFixed(2)}`;
}

function formatDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Why a sales figure is partial or missing, in one line; null when it counts everything. */
function salesNote(sales: ProfitFigures): string | null {
  const reasons = describeLeftOut(sales.leftOut);
  if (reasons.length === 0) return null;
  if (sales.profit == null) return `Cannot be computed — ${reasons.join(", ")}.`;
  return `Counted over ${sales.countedCount} of ${sales.copyCount} sold copies — left out: ${reasons.join(", ")}.`;
}

function writeOffNote(writeOff: WriteOffFigures): string | null {
  const reasons = describeWriteOffLeftOut(writeOff);
  if (reasons.length === 0) return null;
  return `Write-off counted over ${writeOff.countedCount} of ${writeOff.copyCount} copies — left out: ${reasons.join(", ")}.`;
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function ProfitAndLossPanel({
  collectionId,
  collectionSlug,
}: {
  collectionId: string;
  collectionSlug: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const range = useMemo(() => parseDateRange(fromParam, toParam), [fromParam, toParam]);
  const periodParam = searchParams.get("period");
  const granularity: PeriodGranularity = isPeriodGranularity(periodParam) ? periodParam : "month";

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/sales/profit-and-loss${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const { data, isLoading, isError } = useProfitAndLoss(collectionId, range, granularity);
  const ranged = range.from != null || range.to != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1.5rem" }}>
      {/* The range: either end open. The Clear button is always drawn, so choosing a date never
          moves the bar (#868). */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", ...LINE_STYLE }}>
          From
          <input
            type="date"
            aria-label="From date"
            value={range.from ?? ""}
            max={range.to ?? undefined}
            onChange={(e) => updateParams({ from: e.target.value })}
            style={FILTER_CONTROL_STYLE}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", ...LINE_STYLE }}>
          To
          <input
            type="date"
            aria-label="To date"
            value={range.to ?? ""}
            min={range.from ?? undefined}
            onChange={(e) => updateParams({ to: e.target.value })}
            style={FILTER_CONTROL_STYLE}
          />
        </label>
        <button
          type="button"
          disabled={!ranged}
          onClick={() => updateParams({ from: "", to: "" })}
          style={{
            ...FILTER_CONTROL_STYLE,
            cursor: ranged ? "pointer" : "default",
            color: ranged ? "var(--color-text-primary)" : "var(--color-text-muted)",
          }}
        >
          All dates
        </button>
      </div>

      {isLoading && <div style={{ ...LINE_STYLE, ...MUTED }}>Loading profit and loss…</div>}
      {isError && (
        <div style={{ ...LINE_STYLE, color: "var(--color-error)" }}>
          The profit and loss figures could not be loaded.
        </div>
      )}

      {data && (
        <>
          <Totals data={data} />
          {data.total.saleCount === 0 && data.total.writeOff.copyCount === 0 ? (
            <div style={{ ...CARD_STYLE, padding: "2rem", ...LINE_STYLE, ...MUTED }}>
              {ranged
                ? "No sales and no write-offs in this range."
                : "No sales and no write-offs yet. Record a sale to see what the collection has returned."}
            </div>
          ) : (
            <>
              <Periods
                data={data}
                granularity={granularity}
                onGranularity={(g) => updateParams({ period: g === "month" ? "" : g })}
              />
              <Platforms data={data} />
            </>
          )}
        </>
      )}

      <Sales collectionId={collectionId} collectionSlug={collectionSlug} ranged={ranged} range={range} />
    </div>
  );
}

// ── Totals ───────────────────────────────────────────────────────────────────

function Totals({ data }: { data: ProfitAndLoss }) {
  const { total, baseCurrency: ccy } = data;
  const salesNoteText = salesNote(total.sales);
  const writeOffNoteText = writeOffNote(total.writeOff);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(17rem, 1fr))",
        gap: "1rem",
      }}
    >
      <div style={TILE_STYLE}>
        <span style={TILE_LABEL}>Sales</span>
        {total.sales.profit == null ? (
          <div style={{ ...LINE_STYLE, ...MUTED }}>Cannot be computed</div>
        ) : (
          <div style={{ ...HEADLINE_STYLE, ...signedStyle(Number(total.sales.profit)) }}>
            {signed(total.sales.profit)} {ccy}
          </div>
        )}
        <div style={LINE_STYLE}>
          {total.sales.proceeds != null &&
            `Proceeds ${total.sales.proceeds} ${ccy} · cost ${total.sales.cost} ${ccy} · `}
          {plural(total.saleCount, "sale", "sales")}
        </div>
        {salesNoteText && <div style={NOTE_STYLE}>{salesNoteText}</div>}
      </div>

      <div style={TILE_STYLE}>
        <span style={TILE_LABEL}>Write-offs</span>
        <div style={{ ...HEADLINE_STYLE, ...signedStyle(-Number(total.writeOff.cost)) }}>
          {loss(total.writeOff.cost)} {ccy}
        </div>
        <div style={LINE_STYLE}>
          Cost of {plural(total.writeOff.copyCount, "copy", "copies")} lost, damaged or otherwise
          gone
        </div>
        {writeOffNoteText && <div style={NOTE_STYLE}>{writeOffNoteText}</div>}
      </div>

      <div style={TILE_STYLE}>
        <span style={TILE_LABEL}>Result</span>
        {total.result == null ? (
          <div style={{ ...LINE_STYLE, ...MUTED }}>Cannot be computed</div>
        ) : (
          <div style={{ ...HEADLINE_STYLE, ...signedStyle(Number(total.result)) }}>
            {signed(total.result)} {ccy}
          </div>
        )}
        <div style={LINE_STYLE}>Sales profit less write-offs</div>
        {(salesNoteText || writeOffNoteText) && (
          <div style={NOTE_STYLE}>Over the counted copies only — see the notes beside.</div>
        )}
      </div>
    </div>
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────

function Row({
  columns,
  children,
  note,
  head = false,
  strong = false,
  isLast = false,
  href,
  linkLabel,
}: {
  columns: string;
  children: ReactNode;
  note?: string | null;
  head?: boolean;
  strong?: boolean;
  isLast?: boolean;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        padding: "0.625rem 1.25rem",
        borderBottom: isLast ? undefined : "1px solid var(--color-border)",
        background: head ? "var(--color-bg-page)" : undefined,
      }}
    >
      {href && <RowLink href={href} label={linkLabel ?? ""} />}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: columns,
          gap: "0.75rem",
          alignItems: "baseline",
          fontSize: "0.875rem",
          fontWeight: strong ? 600 : undefined,
          color: "var(--color-text-primary)",
        }}
      >
        {children}
      </div>
      {note && <div style={{ ...NOTE_STYLE, marginTop: "0.25rem" }}>{note}</div>}
    </div>
  );
}

/** A profit cell: signed and tinted, or a dash when there is no figure. */
function ProfitCell({ amount }: { amount: string | null }) {
  if (amount == null) return <span style={{ ...NUM, ...MUTED }}>—</span>;
  return <span style={{ ...NUM, ...signedStyle(Number(amount)) }}>{signed(amount)}</span>;
}

function AmountCell({ amount }: { amount: string | null }) {
  return <span style={{ ...NUM, ...(amount == null ? MUTED : {}) }}>{amount ?? "—"}</span>;
}

const PERIOD_COLUMNS = "minmax(9rem, 1.5fr) 4rem repeat(5, minmax(6rem, 1fr))";

function Periods({
  data,
  granularity,
  onGranularity,
}: {
  data: ProfitAndLoss;
  granularity: PeriodGranularity;
  onGranularity: (g: PeriodGranularity) => void;
}) {
  const ccy = data.baseCurrency;
  return (
    <section style={SECTION_STYLE}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <h3 style={SECTION_LABEL}>By period</h3>
        <FilterChip label="Month" active={granularity === "month"} onClick={() => onGranularity("month")} />
        <FilterChip label="Year" active={granularity === "year"} onClick={() => onGranularity("year")} />
      </div>
      <div style={{ ...CARD_STYLE, overflowX: "auto" }}>
        <Row columns={PERIOD_COLUMNS} head>
          <span style={HEAD_CELL}>{granularity === "month" ? "Month" : "Year"}</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Sales</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Net proceeds ({ccy})</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Cost</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Sales profit</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Write-offs</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Result</span>
        </Row>
        {data.periods.map((period) => (
          <ResultRow key={period.key} label={period.label} figures={period} columns={PERIOD_COLUMNS} />
        ))}
        <ResultRow label="Total" figures={data.total} columns={PERIOD_COLUMNS} strong isLast />
      </div>
    </section>
  );
}

function ResultRow({
  label,
  figures,
  columns,
  strong = false,
  isLast = false,
}: {
  label: string;
  figures: ResultFigures;
  columns: string;
  strong?: boolean;
  isLast?: boolean;
}) {
  const note = [salesNote(figures.sales), writeOffNote(figures.writeOff)]
    .filter((n) => n != null)
    .join(" ");
  return (
    <Row columns={columns} note={note || null} strong={strong} isLast={isLast}>
      <span>{label}</span>
      <span style={NUM}>{figures.saleCount}</span>
      <AmountCell amount={figures.sales.proceeds} />
      <AmountCell amount={figures.sales.cost} />
      <ProfitCell amount={figures.sales.profit} />
      <span style={{ ...NUM, ...(figures.writeOff.copyCount === 0 ? MUTED : signedStyle(-Number(figures.writeOff.cost))) }}>
        {figures.writeOff.copyCount === 0 ? "—" : loss(figures.writeOff.cost)}
      </span>
      <ProfitCell amount={figures.result} />
    </Row>
  );
}

const PLATFORM_COLUMNS = "minmax(9rem, 2fr) 4rem repeat(3, minmax(6rem, 1fr))";

function Platforms({ data }: { data: ProfitAndLoss }) {
  const { total, baseCurrency: ccy } = data;
  return (
    <section style={SECTION_STYLE}>
      <h3 style={SECTION_LABEL}>By platform</h3>
      <div style={{ ...CARD_STYLE, overflowX: "auto" }}>
        <Row columns={PLATFORM_COLUMNS} head>
          <span style={HEAD_CELL}>Platform</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Sales</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Net proceeds ({ccy})</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Cost</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Profit</span>
        </Row>
        {data.platforms.map((platform) => (
          <Row key={platform.platformId} columns={PLATFORM_COLUMNS} note={salesNote(platform.sales)}>
            <span>{platform.platformName}</span>
            <span style={NUM}>{platform.saleCount}</span>
            <AmountCell amount={platform.sales.proceeds} />
            <AmountCell amount={platform.sales.cost} />
            <ProfitCell amount={platform.sales.profit} />
          </Row>
        ))}
        {/* A write-off has no platform: its own line, so the total below still adds up. */}
        <Row columns={PLATFORM_COLUMNS} note={writeOffNote(total.writeOff)}>
          <span>
            Write-offs <span style={MUTED}>· no platform</span>
          </span>
          <span style={{ ...NUM, ...MUTED }}>—</span>
          <span style={{ ...NUM, ...MUTED }}>—</span>
          <AmountCell amount={total.writeOff.cost} />
          <span style={{ ...NUM, ...signedStyle(-Number(total.writeOff.cost)) }}>{loss(total.writeOff.cost)}</span>
        </Row>
        <Row columns={PLATFORM_COLUMNS} strong isLast>
          <span>Result</span>
          <span style={NUM}>{total.saleCount}</span>
          <span />
          <span />
          <ProfitCell amount={total.result} />
        </Row>
      </div>
    </section>
  );
}

// ── By sale ──────────────────────────────────────────────────────────────────

const SALE_COLUMNS = "6.5rem 4.5rem minmax(8rem, 2fr) repeat(3, minmax(6rem, 1fr))";

function Sales({
  collectionId,
  collectionSlug,
  range,
  ranged,
}: {
  collectionId: string;
  collectionSlug: string;
  range: ReturnType<typeof parseDateRange>;
  ranged: boolean;
}) {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useProfitAndLossSales(
    collectionId,
    range
  );
  const rows = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const ccy = data?.pages[0]?.baseCurrency ?? "";

  return (
    <section style={SECTION_STYLE}>
      <h3 style={SECTION_LABEL}>By sale</h3>
      <div style={{ ...CARD_STYLE, overflowX: "auto" }}>
        <Row columns={SALE_COLUMNS} head isLast={!isLoading && rows.length === 0}>
          <span style={HEAD_CELL}>Date</span>
          <span style={HEAD_CELL}>Sale</span>
          <span style={HEAD_CELL}>Platform</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Net proceeds{ccy && ` (${ccy})`}</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Cost</span>
          <span style={{ ...HEAD_CELL, ...NUM }}>Profit</span>
        </Row>
        {isLoading && <div style={{ padding: "1rem 1.25rem", ...LINE_STYLE, ...MUTED }}>Loading sales…</div>}
        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "1rem 1.25rem", ...LINE_STYLE, ...MUTED }}>
            {ranged ? "No sales in this range." : "No sales yet."}
          </div>
        )}
        {rows.map((sale, idx) => (
          <SaleRow
            key={sale.id}
            sale={sale}
            href={`/c/${collectionSlug}/sales/${sale.id}`}
            isLast={idx === rows.length - 1 && !hasNextPage}
          />
        ))}
        <InfiniteScrollSentinel
          onLoadMore={fetchNextPage}
          hasMore={!!hasNextPage}
          isLoading={isFetchingNextPage}
        />
      </div>
    </section>
  );
}

function SaleRow({ sale, href, isLast }: { sale: SaleProfitRow; href: string; isLast: boolean }) {
  const { profit } = sale;
  const reasons = describeLeftOut(profit.leftOut);
  const note =
    reasons.length === 0
      ? null
      : profit.profit == null
        ? `Cannot be computed — ${reasons.join(", ")}.`
        : `Incomplete: counted over ${profit.countedCount} of ${profit.copyCount} copies — left out: ${reasons.join(", ")}.`;
  return (
    <Row
      columns={SALE_COLUMNS}
      note={note}
      isLast={isLast}
      href={href}
      linkLabel={`Sale ${formatDate(sale.soldAt)}`}
    >
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatDate(sale.soldAt)}</span>
      <span style={ROW_LINK_ABOVE}>
        <EntityNoChip entity="sale" no={sale.saleNo} prefix="s" />
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {sale.platformName}
        {sale.buyerName && <span style={MUTED}> · {sale.buyerName}</span>}
      </span>
      <AmountCell amount={profit.proceeds} />
      <AmountCell amount={profit.cost} />
      <ProfitCell amount={profit.profit} />
    </Row>
  );
}
