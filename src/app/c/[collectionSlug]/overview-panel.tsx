"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { OverviewProgress, OverviewValue } from "@/lib/overview";
import { RowLink, ROW_LINK_ABOVE } from "./shared/row-link";
import { useOverviewProgress, useOverviewValue } from "./use-overview-query";

/**
 * The Overview screen (#649–#651; decided in #397): a financial and progress picture of the
 * collection on one screen. Two sections — **Value** (what it is worth, what it cost, what it
 * returned) and **Progress** (coverage, growth, gaps) — each a grid of tiles, and **every tile is
 * a link** into the list screen that holds the underlying rows with the filter applied: the
 * Overview is an entry point, never a dead end, and the list screens stay where detail lives.
 *
 * An empty tile says what would fill it, not "0" (#649); an unconvertible or unpriced row is a
 * count on the tile, never a silent exclusion (#650); an area with no checklist reads "not
 * tracked", never complete (#651).
 */

const SECTION_STYLE: CSSProperties = { marginBottom: "2rem" };

const SECTION_LABEL: CSSProperties = {
  margin: "0 0 0.75rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const GRID_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(17rem, 1fr))",
  gap: "1rem",
};

/** The tile is a card and a link at once: `RowLink`'s overlay pattern (#557), so the whole card
 * navigates while an inner link — lifted with `ROW_LINK_ABOVE` — can still point elsewhere. */
const TILE_STYLE: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  minHeight: "8.5rem",
  padding: "1rem 1.25rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
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

const EMPTY_STYLE: CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  margin: "auto 0",
};

const INNER_LINK_STYLE: CSSProperties = {
  ...ROW_LINK_ABOVE,
  ...LINE_STYLE,
  color: "var(--color-text-secondary)",
  textDecoration: "underline",
  textDecorationColor: "var(--color-border)",
  textUnderlineOffset: "0.2em",
  width: "fit-content",
};

/** Gain green, loss red, break-even plain — the holdings bar's own vocabulary. */
function signedStyle(amount: number): CSSProperties {
  if (amount > 0) return { color: "var(--color-success)" };
  if (amount < 0) return { color: "var(--color-error)" };
  return {};
}

/** `−` typographic, `+` printed — a surplus states its sign. */
function signed(amount: string): string {
  const n = Number(amount);
  return n < 0 ? `−${Math.abs(n).toFixed(2)}` : `+${n.toFixed(2)}`;
}

function Tile({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div style={TILE_STYLE}>
      <RowLink href={href} label={label} />
      <div style={TILE_LABEL}>{label}</div>
      {children}
    </div>
  );
}

function TileEmpty({ children }: { children: ReactNode }) {
  return <p style={EMPTY_STYLE}>{children}</p>;
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** The section's final geometry with nothing in it, so tiles appearing shift nothing (#151). */
function TileSkeleton() {
  return (
    <div style={TILE_STYLE} aria-hidden>
      <span style={{ ...skeletonBlock, width: "8rem", height: "0.6875rem" }} />
      <span style={{ ...skeletonBlock, width: "10rem", height: "1.375rem" }} />
      <span style={{ ...skeletonBlock, width: "12rem", height: "0.8125rem" }} />
    </div>
  );
}

const skeletonBlock: CSSProperties = {
  display: "inline-block",
  borderRadius: "0.25rem",
  background: "var(--color-border)",
};

function SectionSkeleton() {
  return (
    <div style={GRID_STYLE}>
      <TileSkeleton />
      <TileSkeleton />
      <TileSkeleton />
      <TileSkeleton />
    </div>
  );
}

// ── Value (#650) ─────────────────────────────────────────────────────────────

function ValueTiles({ data, base }: { data: OverviewValue; base: string }) {
  const { holdings, market, realized, purchases } = data;
  const ccy = data.baseCurrency;
  const heldCount =
    holdings.pricedCount + holdings.unpricedCount + holdings.unconvertibleCount;
  const surplus = (
    (Math.round(Number(holdings.totalBaseAmount) * 100) -
      Math.round(Number(holdings.cost.totalCostBasis) * 100)) /
    100
  ).toFixed(2);

  return (
    <div style={GRID_STYLE}>
      <Tile href={`${base}/inventory`} label="Holdings value">
        {heldCount === 0 ? (
          <TileEmpty>Add copies to see what the collection is worth.</TileEmpty>
        ) : (
          <>
            <div style={HEADLINE_STYLE}>
              {holdings.totalBaseAmount} {ccy}
            </div>
            <div style={LINE_STYLE}>
              Cost {holdings.cost.totalCostBasis} {ccy} · surplus{" "}
              <span style={signedStyle(Number(surplus))}>{signed(surplus)}</span>
            </div>
            {holdings.market.valuedCount > 0 && (
              <div style={LINE_STYLE}>
                Market {holdings.market.totalBaseAmount} {ccy} over{" "}
                {holdings.market.valuedCount} of {heldCount} copies
              </div>
            )}
            <ValueCaveats
              parts={[
                count(holdings.unpricedCount, "unpriced"),
                count(holdings.unconvertibleCount, "unconvertible"),
                count(holdings.cost.pendingCount, "cost pending"),
                count(holdings.cost.noneCount, "no cost recorded"),
              ]}
            />
          </>
        )}
      </Tile>

      <Tile href={`${base}/offers?state=active`} label="Capital on the market">
        {market.asking.offerCount === 0 && market.exposure.payableCount === 0 ? (
          <TileEmpty>
            Create an offer or track an auction to see money committed to the market.
          </TileEmpty>
        ) : (
          <>
            <div style={HEADLINE_STYLE}>
              {market.asking.amount} {ccy}
            </div>
            <div style={LINE_STYLE}>
              Asking on {market.asking.offerCount}{" "}
              {market.asking.offerCount === 1 ? "active offer" : "active offers"}
            </div>
            <Link href={`${base}/auctions`} style={INNER_LINK_STYLE}>
              Bidding {market.exposure.committed} {ccy} across {market.exposure.payableCount}{" "}
              {market.exposure.payableCount === 1 ? "lot" : "lots"}
            </Link>
            <ValueCaveats
              parts={[
                count(market.asking.unpricedCount, "offers unpriced"),
                count(market.asking.unconvertibleCount, "offers unconvertible"),
                count(market.exposure.uncappedCount, "lots uncapped"),
                count(market.exposure.unconvertibleCount, "lots unconvertible"),
              ]}
            />
          </>
        )}
      </Tile>

      <Tile href={`${base}/sales`} label="Realized profit and loss">
        {realized.saleCount === 0 ? (
          <TileEmpty>Record a sale to see what the collection has returned.</TileEmpty>
        ) : (
          <>
            <div style={{ ...HEADLINE_STYLE, ...signedStyle(Number(realized.profit)) }}>
              {signed(realized.profit)} {ccy}
            </div>
            <div style={LINE_STYLE}>
              Proceeds {realized.proceeds} {ccy} over {realized.soldCount} sold{" "}
              {realized.soldCount === 1 ? "copy" : "copies"} · cost{" "}
              {realized.soldCost.totalCostBasis} {ccy}
            </div>
            <ValueCaveats
              parts={[
                count(realized.unresolvedCount, "sold shares unresolved"),
                count(realized.soldCost.pendingCount, "cost pending"),
                count(realized.soldCost.noneCount, "no cost recorded"),
              ]}
            />
          </>
        )}
      </Tile>

      <Tile href={`${base}/purchases`} label="Purchase ROI">
        {purchases.measured === 0 ? (
          <TileEmpty>Record a purchase and sort its copies to track what comes back.</TileEmpty>
        ) : (
          <>
            <div style={HEADLINE_STYLE}>
              {purchases.recouped} of {purchases.measured}
            </div>
            <div style={LINE_STYLE}>
              {purchases.recouped === 1 ? "purchase has" : "purchases have"} returned their cost
            </div>
            <div style={LINE_STYLE}>
              Spent {purchases.spent} {ccy} · returned {purchases.realized} {ccy}
            </div>
            <ValueCaveats
              parts={[
                count(purchases.uncosted, "not costed yet"),
                count(purchases.pendingCostCount, "with cost still settling"),
              ]}
            />
          </>
        )}
      </Tile>
    </div>
  );
}

/** A caveat with a zero count is not a caveat — nothing renders when every part is absent. */
function count(n: number, label: string): string | null {
  return n > 0 ? `${n} ${label}` : null;
}

function ValueCaveats({ parts }: { parts: (string | null)[] }) {
  const present = parts.filter((p): p is string => p != null);
  if (present.length === 0) return null;
  return <div style={NOTE_STYLE}>{present.join(" · ")}</div>;
}

// ── Progress (#651) ──────────────────────────────────────────────────────────

const COVERAGE_ROWS_SHOWN = 4;

function ProgressTiles({ data, base }: { data: OverviewProgress; base: string }) {
  const { coverage, checklists, growth, wants } = data;
  const months = growth.months;
  const thisMonth = months[months.length - 1];
  const lastMonth = months[months.length - 2];
  const windowCopies = months.reduce((sum, m) => sum + m.copies, 0);
  const windowIssues = months.reduce((sum, m) => sum + m.issues, 0);

  return (
    <div style={GRID_STYLE}>
      <Tile href={`${base}/issues`} label="Coverage by area">
        {coverage.tracked.length === 0 ? (
          <TileEmpty>
            Add checklists to the issues you collect to track coverage
            {coverage.untracked.length > 0 &&
              ` — ${coverage.untracked.length} ${
                coverage.untracked.length === 1 ? "area is" : "areas are"
              } not tracked yet`}
            .
          </TileEmpty>
        ) : (
          <>
            {coverage.tracked.slice(0, COVERAGE_ROWS_SHOWN).map((area) => (
              <Link
                key={area.areaId}
                href={`${base}/issues?areaId=${area.areaId}`}
                style={INNER_LINK_STYLE}
              >
                {area.name} — {Math.floor((area.owned / area.required) * 100)}% ({area.owned}/
                {area.required})
              </Link>
            ))}
            <ProgressNote
              parts={[
                coverage.tracked.length > COVERAGE_ROWS_SHOWN
                  ? `${coverage.tracked.length - COVERAGE_ROWS_SHOWN} more`
                  : null,
                count(coverage.untracked.length, "areas not tracked"),
              ]}
            />
          </>
        )}
      </Tile>

      <Tile
        href={
          checklists.closest ? `${base}/issues/${checklists.closest.issueId}` : `${base}/issues`
        }
        label="Checklists"
      >
        {checklists.total === 0 ? (
          <TileEmpty>Create a checklist on an issue to track set completeness.</TileEmpty>
        ) : (
          <>
            <div style={HEADLINE_STYLE}>
              {checklists.complete} of {checklists.total}
            </div>
            <div style={LINE_STYLE}>
              complete · {checklists.partial} part-done · {checklists.untouched} untouched
            </div>
            {checklists.closest && (
              <div style={LINE_STYLE}>
                Closest to done: {checklists.closest.name || "Unnamed checklist"} (
                {checklists.closest.owned}/{checklists.closest.requiredCount})
              </div>
            )}
          </>
        )}
      </Tile>

      <Tile href={`${base}/inventory?sortBy=created&sortDir=desc`} label="Growth">
        {windowCopies === 0 && windowIssues === 0 ? (
          <TileEmpty>Copies and issues you add will chart the collection&apos;s growth here.</TileEmpty>
        ) : (
          <>
            <div style={HEADLINE_STYLE}>+{thisMonth?.copies ?? 0} copies</div>
            <div style={LINE_STYLE}>
              this month · {lastMonth?.copies ?? 0} last month · {thisMonth?.issues ?? 0}{" "}
              {thisMonth?.issues === 1 ? "issue" : "issues"} this month
            </div>
            <div style={NOTE_STYLE}>
              Last {months.length} months: {windowCopies} copies · {windowIssues} issues
            </div>
          </>
        )}
      </Tile>

      <Tile href={`${base}/wants`} label="Open wants">
        {wants.openCount === 0 ? (
          <TileEmpty>Add wants to record what the collection is still looking for.</TileEmpty>
        ) : (
          <>
            <div style={HEADLINE_STYLE}>
              {wants.gapCount} {wants.gapCount === 1 ? "gap" : "gaps"}
            </div>
            <div style={LINE_STYLE}>
              of {wants.openCount} open {wants.openCount === 1 ? "want" : "wants"} — nothing
              acceptable held yet
            </div>
            {wants.pricedGapCount > 0 && (
              <div style={LINE_STYLE}>
                Catalogue{" "}
                {wants.gapMinBase === wants.gapMaxBase
                  ? wants.gapMinBase
                  : `${wants.gapMinBase} – ${wants.gapMaxBase}`}{" "}
                {wants.baseCurrency}
              </div>
            )}
            <ProgressNote
              parts={[
                count(wants.onTheWayCount, "on the way"),
                count(wants.unpricedGapCount, "gaps unpriced"),
              ]}
            />
          </>
        )}
      </Tile>
    </div>
  );
}

function ProgressNote({ parts }: { parts: (string | null)[] }) {
  const present = parts.filter((p): p is string => p != null);
  if (present.length === 0) return null;
  return <div style={NOTE_STYLE}>{present.join(" · ")}</div>;
}

// ── The panel ────────────────────────────────────────────────────────────────

const ERROR_STYLE: CSSProperties = {
  padding: "1rem 0",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

export function OverviewPanel({
  collectionId,
  collectionSlug,
}: {
  collectionId: string;
  collectionSlug: string;
}) {
  const value = useOverviewValue(collectionId);
  const progress = useOverviewProgress(collectionId);
  const base = `/c/${collectionSlug}`;

  return (
    <div>
      <section style={SECTION_STYLE}>
        <h3 style={SECTION_LABEL}>Value</h3>
        {value.data ? (
          <ValueTiles data={value.data} base={base} />
        ) : value.isError ? (
          <div style={ERROR_STYLE}>The value figures could not be loaded.</div>
        ) : (
          <SectionSkeleton />
        )}
      </section>
      <section style={SECTION_STYLE}>
        <h3 style={SECTION_LABEL}>Progress</h3>
        {progress.data ? (
          <ProgressTiles data={progress.data} base={base} />
        ) : progress.isError ? (
          <div style={ERROR_STYLE}>The progress figures could not be loaded.</div>
        ) : (
          <SectionSkeleton />
        )}
      </section>
    </div>
  );
}
