"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { ItemListItem } from "@/lib/items";
import type { IssueHeader } from "@/lib/issues";
import type { OfferDetailSet, OfferSetsTotals } from "@/lib/offers";
import { formatEntityNo } from "@/lib/quick-jump";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useAreaVendorMaps, type AreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { LotIssueGroupHeader } from "@/app/c/[collectionSlug]/shared/lot-issue-group-header";
import { buildLocationPath } from "@/app/c/[collectionSlug]/shared/location-helpers";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { sortCopies, COPY_SORT_KEYS, COPY_SORT_LABELS } from "@/app/c/[collectionSlug]/shared/copy-sort";
import { useHydrated, usePersistentToggle, usePersistentString } from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { QuickPriceDialog } from "@/app/c/[collectionSlug]/shared/quick-price-dialog";
import { useCardExpansion } from "@/app/c/[collectionSlug]/shared/use-card-expansion";
import {
  useReorderList,
  showLineAt,
  InsertionLine,
  dragStyle,
  DragGrip,
  type DragList,
} from "@/app/c/[collectionSlug]/shared/reorder-list";
import { useInvalidateOffers } from "../use-offers-query";


// The offer sets view adds two keys to the shared copy sort list: "Set order" — the offer's own
// canonical copy order (#306), which is the default and the only key copies can be dragged in —
// and "Location ref", handy for pulling a copy off the shelf while composing. Offer-local so other
// views are unaffected.
const SET_ORDER_KEY = "set";
const SET_SORT_KEYS = [SET_ORDER_KEY, ...COPY_SORT_KEYS, "ref"] as const;
const SET_SORT_LABELS: Record<string, string> = {
  ...COPY_SORT_LABELS,
  [SET_ORDER_KEY]: "Set order",
  ref: "Location ref",
};
const REF_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortSetCopies(
  items: ItemListItem[],
  sortKey: string,
  sortDir: string,
  primaryVendorByArea: Map<string, string | null>,
  /** Copy id → its position in the offer's canonical order (#306); drives the "Set order" key. */
  canonicalIndex?: Map<string, number>
): ItemListItem[] {
  if (sortKey === SET_ORDER_KEY) {
    if (!canonicalIndex) return items;
    const dir = sortDir === "desc" ? -1 : 1;
    return items
      .map((it, i) => ({ it, i }))
      .sort((a, b) => {
        const cmp = ((canonicalIndex.get(a.it.id) ?? Number.MAX_SAFE_INTEGER) -
          (canonicalIndex.get(b.it.id) ?? Number.MAX_SAFE_INTEGER)) * dir;
        return cmp === 0 ? a.i - b.i : cmp;
      })
      .map((d) => d.it);
  }
  if (sortKey !== "ref") return sortCopies(items, sortKey, sortDir, primaryVendorByArea);
  const dir = sortDir === "desc" ? -1 : 1;
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const ra = a.it.locationRef ?? "";
      const rb = b.it.locationRef ?? "";
      let cmp: number;
      if (!ra && !rb) cmp = 0;
      else if (!ra) cmp = 1;
      else if (!rb) cmp = -1;
      else cmp = REF_COLLATOR.compare(ra, rb) * dir;
      if (cmp === 0) cmp = a.i - b.i;
      return cmp;
    })
    .map((d) => d.it);
}

const LS_PRIMARY = "stamporama:offer:primaryGroup";
const LS_BY_ISSUE = "stamporama:offer:byIssue";
const LS_SORT_KEY = "stamporama:offer:sortKey";
const LS_SORT_DIR = "stamporama:offer:sortDir";

type Primary = "set" | "location" | "none";

const STUCK_SHADOW = "0 6px 8px -6px rgba(0, 0, 0, 0.28)";

const TOOLBAR_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const TOOLBAR_LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const MUTED_BOX: React.CSSProperties = { padding: "1rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" };

interface CopyCtx {
  collectionId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  issueHeaderById: Record<string, IssueHeader>;
  primaryVendorByArea: Map<string, string | null>;
  /** Catalog-entry lookup resolved from area *and* issue, so a per-issue prefix override (#377)
   * reaches the copy rows and the issue group headers alike. */
  vendorMapFor: AreaVendorMaps["vendorMapFor"];
  areaNameById: Map<string, string>;
  /** Opens the quick catalog-value editor for a copy (the "+ catalog value" link). */
  onSetPrice?: (item: ItemListItem) => void;
}

interface CopyGroup {
  key: string;
  label: string;
  items: ItemListItem[];
}

function groupByIssue(items: ItemListItem[]): CopyGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, CopyGroup>();
  for (const it of items) {
    const key = it.issueId ?? "__none__";
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: it.issueId == null ? "No issue" : it.issueName || "Untitled issue", items: [] };
      byKey.set(key, g);
      order.push(key);
    }
    g.items.push(it);
  }
  return order.map((k) => byKey.get(k)!);
}

function groupByLocation(items: ItemListItem[], locations: LocationData[]): CopyGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, CopyGroup>();
  for (const it of items) {
    const key = it.locationId ?? "__none__";
    let g = byKey.get(key);
    if (!g) {
      const path = buildLocationPath(locations, it.locationId);
      g = { key, label: path ?? "No location", items: [] };
      byKey.set(key, g);
      order.push(key);
    }
    g.items.push(it);
  }
  return order.map((k) => byKey.get(k)!);
}

function useStuck(topOffset: number) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { rootMargin: `-${Math.max(0, Math.round(topOffset))}px 0px 0px 0px`, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [topOffset]);
  return { sentinelRef, stuck };
}

function CopyRow({
  item,
  ctx,
  isLast,
  index,
  drag,
}: {
  item: ItemListItem;
  ctx: CopyCtx;
  isLast: boolean;
  index: number;
  drag: DragList | null;
}) {
  const areaId = item.areaId;
  const primaryVendorId = areaId ? (ctx.primaryVendorByArea.get(areaId) ?? null) : null;
  const vendorMap = ctx.vendorMapFor(areaId, item.issueId);
  const row = (
    <InventoryItemRow
      collectionId={ctx.collectionId}
      item={item}
      areas={ctx.areas}
      locations={ctx.locations}
      baseCurrency={ctx.baseCurrency}
      primaryVendorId={primaryVendorId}
      vendorMap={vendorMap}
      isLast={isLast}
      readOnly
      showCostBasis
      onSetCatalogPrice={ctx.onSetPrice ? () => ctx.onSetPrice!(item) : undefined}
    />
  );
  if (!drag) return row;
  return (
    <div
      {...drag.itemProps(index)}
      style={{
        display: "flex",
        alignItems: "stretch",
        cursor: "grab",
        ...dragStyle(drag, index),
      }}
    >
      <span style={{ display: "flex", alignItems: "center", borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
        <DragGrip label="Drag to reorder this copy" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{row}</div>
    </div>
  );
}

/** Copies rendered flat, or (when `byIssue`) as collapsible issue sub-sections. */
function IssueOrFlat({
  items,
  byIssue,
  issueStickyTop,
  ctx,
  drag = null,
}: {
  items: ItemListItem[];
  byIssue: boolean;
  issueStickyTop: number | null;
  ctx: CopyCtx;
  drag?: DragList | null;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  if (!byIssue) {
    return (
      <>
        {items.map((item, i) => (
          <Fragment key={item.id}>
            {showLineAt(drag, i) && <InsertionLine inset={8} />}
            <CopyRow item={item} ctx={ctx} isLast={i === items.length - 1} index={i} drag={drag} />
          </Fragment>
        ))}
        {showLineAt(drag, items.length) && <InsertionLine inset={8} />}
      </>
    );
  }
  return (
    <>
      {groupByIssue(items).map((group) => {
        const isCollapsed = collapsed.has(group.key);
        const header = group.key === "__none__" ? null : ctx.issueHeaderById[group.key];
        const areaId = header?.collectionAreaId ?? group.items[0]?.areaId ?? null;
        const primaryVendorId = areaId ? (ctx.primaryVendorByArea.get(areaId) ?? null) : null;
        const vendorMap = ctx.vendorMapFor(
          areaId,
          group.key === "__none__" ? null : group.key
        );
        const headerNode = (
          <LotIssueGroupHeader
            header={header}
            fallbackLabel={group.label}
            copyCount={group.items.length}
            countLabel="listed"
            areaName={areaId ? (ctx.areaNameById.get(areaId) ?? null) : null}
            primaryVendorId={primaryVendorId}
            vendorMap={vendorMap}
            collapsed={isCollapsed}
            onToggle={() => toggle(group.key)}
          />
        );
        return (
          <div key={group.key} style={{ borderBottom: "1px solid var(--color-border)" }}>
            {issueStickyTop != null ? (
              <div style={{ position: "sticky", top: issueStickyTop, zIndex: 2 }}>{headerNode}</div>
            ) : (
              headerNode
            )}
            {!isCollapsed && (
              <div style={{ borderTop: "1px solid var(--color-border)", marginLeft: "1.25rem", borderLeft: "2px solid var(--color-border)" }}>
                {group.items.map((item, i) => (
                  <CopyRow key={item.id} item={item} ctx={ctx} isLast={i === group.items.length - 1} index={i} drag={null} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function CopiesBody({
  items,
  byIssue,
  sortKey,
  sortDir,
  stickyTop,
  ctx,
  canonicalIndex,
  drag = null,
}: {
  items: ItemListItem[];
  byIssue: boolean;
  sortKey: string;
  sortDir: string;
  stickyTop: number;
  ctx: CopyCtx;
  canonicalIndex?: Map<string, number>;
  drag?: DragList | null;
}) {
  const sorted = useMemo(
    () => sortSetCopies(items, sortKey, sortDir, ctx.primaryVendorByArea, canonicalIndex),
    [items, sortKey, sortDir, ctx.primaryVendorByArea, canonicalIndex]
  );
  if (sorted.length === 0) return <div style={MUTED_BOX}>No copies.</div>;
  return <IssueOrFlat items={sorted} byIssue={byIssue} issueStickyTop={stickyTop} ctx={ctx} drag={drag} />;
}

/**
 * A set's catalogue value and purchase cost (#378) — the holdings pair every other summary shows
 * (#134/#179), here per **set**, because a set is what a buyer takes and therefore what the asking
 * price is judged against.
 *
 * It sits at the **right edge of the card header**, as an amount column: money lives on the right of
 * a row everywhere in the app. A three-column grid, like the totals bar it hangs under, so the two
 * labels start in one column and the two amounts end in one whatever they happen to contain — a row
 * of self-measuring cells drifts the moment one line has an equivalent and the other has nothing.
 *
 * Each figure is stated **twice** where the offer prices in another currency, in the header's own
 * grammar (the asking price right above it): the **offer's currency leads**, in the row's strong
 * type, and the base-currency amount follows muted behind `≈`. The offer's currency is the one the
 * collector actually works in — it is what the price, the platform and the buyer are all stated in —
 * even though the base figure is the stored one here; `≈` marks the *secondary* reading throughout
 * this screen, not the derived one.
 *
 * A figure reads `—` when nothing under it is priced / costed rather than `0.00`, which would claim
 * a worthless set; an uncertain (unknown-variant) share is marked with the same `~` the price columns
 * use (#238), and the exact breakdown — unpriced, unconvertible, cost still pending — lives on the
 * row's label, since it is the answer to "why is this lower than I expected", not a headline.
 */
function SetFigures({ set }: { set: OfferDetailSet }) {
  const { holdings } = set;
  const { cost } = holdings;
  const converted = set.holdingsInOfferCurrency;
  const valueNotes = [
    `${holdings.pricedCount} priced`,
    ...(holdings.uncertainCount > 0
      ? [`~${holdings.uncertainBaseAmount} ${holdings.baseCurrency} uncertain (${holdings.uncertainCount} unknown-variant)`]
      : []),
    ...(holdings.unpricedCount > 0 ? [`${holdings.unpricedCount} unpriced`] : []),
    ...(holdings.unconvertibleCount > 0
      ? [`${holdings.unconvertibleCount} not convertible to ${holdings.baseCurrency}`]
      : []),
  ];
  const costNotes = [
    `${cost.knownCount} costed`,
    ...(cost.pendingCount > 0 ? [`${cost.pendingCount} pending`] : []),
    ...(cost.noneCount > 0 ? [`${cost.noneCount} no cost recorded`] : []),
  ];
  return (
    <div
      style={{
        display: "grid",
        // label · amount (· base equivalent, only when the offer prices in its own currency)
        gridTemplateColumns: converted ? "auto auto auto" : "auto auto",
        columnGap: "0.5rem",
        rowGap: "0.1875rem",
        alignItems: "baseline",
        fontSize: "0.75rem",
        flexShrink: 0,
        // The figures label the set, not the caret they sit beside — clicking one must not collapse
        // the card out from under the hover that explains it.
        cursor: "default",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip content={`Catalog value of this set — ${valueNotes.join(" · ")}`}>
        <span style={FIGURE_LABEL}>cat</span>
      </Tooltip>
      <MoneyPair
        baseAmount={holdings.pricedCount === 0 ? null : holdings.totalBaseAmount}
        baseCurrency={holdings.baseCurrency}
        offerAmount={converted?.catalogAmount ?? null}
        offerCurrency={converted?.currency ?? null}
        uncertain={holdings.uncertainCount > 0}
      />
      <Tooltip content={`What this set's copies cost — ${costNotes.join(" · ")}`}>
        <span style={FIGURE_LABEL}>cost</span>
      </Tooltip>
      <MoneyPair
        baseAmount={cost.knownCount === 0 ? null : cost.totalCostBasis}
        baseCurrency={cost.baseCurrency}
        offerAmount={converted?.costAmount ?? null}
        offerCurrency={converted?.currency ?? null}
      />
    </div>
  );
}

const FIGURE_LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
};

/**
 * The offer's sets **taken together** (#378): what the whole listing is worth and what it cost,
 * beside the same figures per set. Two questions, deliberately side by side — the total is what
 * leaves the shelf if everything sells, the per-set average is what one buyer takes and therefore
 * what the asking price is set against.
 *
 * It sits in the section's **header band**, between the heading + controls on the left and the
 * Add set / Collapse all pair on the right — everything addressing the whole listing on one line of
 * sight, above the cards the figures are summed from.
 *
 * Laid out as a **grid**, not as rows of fixed-width cells: the two headings have to sit over the
 * pairs they name, and a column that measures itself per row cannot promise that — the moment one
 * amount ran wider than its neighbour, heading and figure drifted apart. Each figure is therefore a
 * cell of a shared column, and the hover moved onto the row's **label**, since a tooltip wrapper
 * around a row would be one grid item holding four.
 *
 * An average counts only the sets that carried a figure; the hover says how many, because "50.00
 * over 2 of 3 sets" and "50.00 over 3" are different claims.
 */
function SetsTotalsBar({ totals, baseCurrency }: { totals: OfferSetsTotals; baseCurrency: string }) {
  if (totals.setCount === 0) return null;
  const converted = totals.inOfferCurrency;
  const sets = `${totals.setCount} set${totals.setCount === 1 ? "" : "s"}`;
  const rows = [
    {
      key: "cat",
      label: "cat",
      total: totals.catalogTotal,
      average: totals.catalogAverage,
      counted: totals.catalogValuedSets,
      hint: "Catalog value of every set in this listing",
      convertedTotal: converted?.catalogTotal ?? null,
      convertedAverage: converted?.catalogAverage ?? null,
    },
    {
      key: "cost",
      label: "cost",
      total: totals.costTotal,
      average: totals.costAverage,
      counted: totals.costKnownSets,
      hint: "What every set in this listing cost you",
      convertedTotal: converted?.costTotal ?? null,
      convertedAverage: converted?.costAverage ?? null,
    },
  ];
  return (
    <div
      style={{
        display: "grid",
        // label · total · per set, each figure one cell wider where a base equivalent follows it.
        gridTemplateColumns: converted ? "auto auto auto auto auto" : "auto auto auto",
        columnGap: "0.5rem",
        rowGap: "0.1875rem",
        alignItems: "baseline",
        padding: "0.5rem 0.875rem",
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        background: "var(--color-bg-elevated)",
        fontSize: "0.75rem",
      }}
    >
      <span />
      <span style={{ ...TOTALS_HEAD, gridColumn: converted ? "span 2" : "span 1" }}>total · {sets}</span>
      <span
        style={{
          ...TOTALS_HEAD,
          gridColumn: converted ? "span 2" : "span 1",
          paddingLeft: TOTALS_PAIR_GAP,
        }}
      >
        per set
      </span>
      {rows.map((r) => (
        <Fragment key={r.key}>
          <Tooltip
            content={
              r.total === null
                ? `${r.hint} — nothing recorded yet`
                : `${r.hint} · averaged over the ${r.counted} of ${sets} that carry one`
            }
          >
            <span style={FIGURE_LABEL}>{r.label}</span>
          </Tooltip>
          <MoneyPair
            baseAmount={r.total}
            baseCurrency={baseCurrency}
            offerAmount={r.convertedTotal}
            offerCurrency={converted?.currency ?? null}
          />
          <MoneyPair
            baseAmount={r.average}
            baseCurrency={baseCurrency}
            offerAmount={r.convertedAverage}
            offerCurrency={converted?.currency ?? null}
            leadingStyle={{ paddingLeft: TOTALS_PAIR_GAP }}
          />
        </Fragment>
      ))}
    </div>
  );
}

/** What separates the *total* pair from the *per set* pair — wider than the gap inside a pair, so
 * the eye groups each amount with its own equivalent rather than with its neighbour. */
const TOTALS_PAIR_GAP = "1.25rem";

const TOTALS_HEAD: React.CSSProperties = {
  textAlign: "right",
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
};

/**
 * One money figure the way the offer header states its price: the amount the collector operates in —
 * **the offer's currency** wherever the offer prices in one of its own — in strong type, with the
 * base-currency reading muted behind `≈` beside it. With no conversion available there is one
 * figure, the base one, and it takes the strong type: it is then the only thing there is to read.
 *
 * Renders **cells** and no wrapper, so the caller's grid owns the columns and every figure on the
 * screen lines up with the one above it: two where there is a currency to convert to (the empty
 * string still emitted for a row with no figure, so the grid keeps its shape), one where there is
 * not.
 */
function MoneyPair({
  baseAmount,
  baseCurrency,
  offerAmount,
  offerCurrency,
  uncertain = false,
  leadingStyle,
}: {
  baseAmount: string | null;
  baseCurrency: string;
  offerAmount: string | null;
  /** The offer's currency, or null when it prices in the base one — there is then no second cell at
   * all, and the caller's grid is one column narrower. */
  offerCurrency: string | null;
  /** Prefix the leading figure with `~`: it leans on an unknown-variant guess (#238). */
  uncertain?: boolean;
  /** Extra styling for the leading cell — the totals bar spaces its second pair with it. */
  leadingStyle?: React.CSSProperties;
}) {
  const mark = uncertain ? "~" : "";
  const leads = offerAmount !== null && offerCurrency !== null;
  return (
    <>
      <span style={{ ...MONEY_LEAD, ...leadingStyle }}>
        {baseAmount === null
          ? "—"
          : leads
            ? `${mark}${offerAmount} ${offerCurrency}`
            : `${mark}${baseAmount} ${baseCurrency}`}
      </span>
      {offerCurrency !== null && (
        <span style={MONEY_EQUIVALENT}>
          {baseAmount === null ? "" : `≈ ${baseAmount} ${baseCurrency}`}
        </span>
      )}
    </>
  );
}

const MONEY_LEAD: React.CSSProperties = {
  fontWeight: 600,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
  whiteSpace: "nowrap",
};

/** The secondary reading — the same muted `≈ … EUR` the header puts under the asking price. */
const MONEY_EQUIVALENT: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
  whiteSpace: "nowrap",
};

/** One set as a collapsible card: sticky header/** One set as a collapsible card: sticky header (caret · label · count · state) over its copies. */
function SetCard({
  set,
  collectionSlug,
  copies,
  expanded,
  byIssue,
  sortKey,
  sortDir,
  editable,
  ctx,
  index,
  setDrag,
  copyDragEnabled,
  onReorderCopies,
  onToggle,
  onRemove,
  onResetCopyOrder,
  onSell,
}: {
  set: OfferDetailSet;
  collectionSlug: string;
  copies: ItemListItem[];
  expanded: boolean;
  byIssue: boolean;
  sortKey: string;
  sortDir: string;
  editable: boolean;
  ctx: CopyCtx;
  /** Position among the rendered set cards, for set-level dragging (#306). */
  index: number;
  setDrag: DragList | null;
  /** Copies inside this set can be hand-reordered (#306). */
  copyDragEnabled: boolean;
  onReorderCopies: (from: number, to: number) => void;
  onToggle: () => void;
  onRemove: () => void;
  onResetCopyOrder: () => void;
  /** Sell this one set (#473), or undefined where the offer cannot be sold from at all. */
  onSell?: () => void;
}) {
  const { sentinelRef, stuck } = useStuck(0);
  // Each card owns its copy list's drag state — copies never move between sets by dragging.
  const copyDrag = useReorderList(copyDragEnabled, onReorderCopies);
  const actions: RowAction[] = [
    // Selling one set out of the offer (#473) — the offer-level Sell in the header menu takes every
    // remaining set at once; this takes exactly this one, which is how a multi-qty offer (#372) is
    // actually sold down. First entry: it is the action, the others are housekeeping.
    ...(onSell ? [{ key: "sell", label: "Sell this set", icon: "💰", onSelect: onSell } as RowAction] : []),
    // Only offered once the order was actually hand-corrected — a derived set has nothing to reset.
    ...(set.manualCopyOrder
      ? [{ key: "reset-order", label: "Reset to catalog order", icon: "↕", separatorBefore: !!onSell, onSelect: onResetCopyOrder }]
      : []),
    { key: "remove", label: "Remove set", icon: "✕", danger: true, separatorBefore: set.manualCopyOrder || !!onSell, onSelect: onRemove },
  ];
  return (
    <div
      {...(setDrag ? setDrag.itemProps(index) : {})}
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        overflow: "clip",
        background: "var(--color-bg-elevated)",
        opacity: set.sold ? 0.7 : 1,
        ...dragStyle(setDrag, index),
      }}
    >
      <div ref={sentinelRef} style={{ height: 0 }} />
      <div
        onClick={onToggle}
        // The header is the grab area (#306): pressing here arms the card as the drag source, so
        // the copies below stay free for selecting text and for their own dragging.
        {...(setDrag ? setDrag.handleProps(index) : {})}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          padding: "0.75rem 1rem",
          cursor: setDrag ? "grab" : "pointer",
          background: "var(--color-bg-elevated)",
          borderBottom: expanded ? "1px solid var(--color-border)" : undefined,
          boxShadow: stuck ? STUCK_SHADOW : undefined,
        }}
      >
        {setDrag && <DragGrip label="Drag to reorder this set" />}
        <span aria-hidden style={{ width: "0.9rem", flexShrink: 0, color: "var(--color-text-muted)", fontSize: "0.75rem", lineHeight: 1 }}>
          {expanded ? "▼" : "▶"}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {set.label}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
            {copies.length} cop{copies.length === 1 ? "y" : "ies"}
          </div>
        </div>
        {set.sold &&
          // Where the set went (#472). The chip is the link: a sold set's one remaining question is
          // "which sale was that", and the number beside it is the sale's own (#432), so the target
          // is named rather than merely pointed at. A set sold before the sale record existed — or
          // whose sale line lost its sale — still says *Sold*, just without anywhere to go.
          (set.sale ? (
            <Tooltip content={`Sold on sale ${formatEntityNo(set.sale.saleNo)} — open it`}>
              <Link
                href={`/c/${collectionSlug}/sales/${set.sale.id}`}
                onClick={(e) => e.stopPropagation()}
                style={{ ...CHIP, color: "var(--color-accent)", borderColor: "var(--color-accent)", textDecoration: "none" }}
              >
                Sold · {formatEntityNo(set.sale.saleNo)}
              </Link>
            </Tooltip>
          ) : (
            <Tooltip content="Sold through this offer">
              <span style={CHIP}>Sold</span>
            </Tooltip>
          ))}
        {set.needsAction && (
          <Tooltip content="A copy of this set sold elsewhere — remove it">
            <span style={{ ...CHIP, color: "var(--color-error)", borderColor: "var(--color-error-border, var(--color-border))" }}>
              Sold elsewhere
            </span>
          </Tooltip>
        )}
        {/* Money at the right edge, as everywhere else in the app (#378) — after the status chips,
            so the amount column sits in the same place whether or not a card carries one. */}
        <SetFigures set={set} />
        {editable && !set.sold && (
          <span onClick={(e) => e.stopPropagation()}>
            <RowActionsMenu actions={actions} ariaLabel="Set actions" />
          </span>
        )}
      </div>
      {expanded && (
        <div {...(copyDrag?.containerProps ?? {})}>
          <CopiesBody
            items={copies}
            byIssue={byIssue}
            sortKey={sortKey}
            sortDir={sortDir}
            stickyTop={0}
            ctx={ctx}
            drag={copyDrag}
          />
        </div>
      )}
    </div>
  );
}

function LocationCard({ group, byIssue, ctx }: { group: CopyGroup; byIssue: boolean; ctx: CopyCtx }) {
  const [collapsed, setCollapsed] = useState(false);
  const { sentinelRef, stuck } = useStuck(0);
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.75rem", overflow: "clip", background: "var(--color-bg-elevated)" }}>
      <div ref={sentinelRef} style={{ height: 0 }} />
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.625rem 1rem",
          cursor: "pointer",
          background: "var(--color-bg-elevated)",
          borderBottom: collapsed ? undefined : "1px solid var(--color-border)",
          boxShadow: stuck ? STUCK_SHADOW : undefined,
        }}
      >
        <span aria-hidden style={{ width: "0.9rem", flexShrink: 0, color: "var(--color-text-muted)", fontSize: "0.75rem", lineHeight: 1 }}>
          {collapsed ? "▶" : "▼"}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          📍 {group.label}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
          {group.items.length} cop{group.items.length === 1 ? "y" : "ies"}
        </span>
      </div>
      {!collapsed && <IssueOrFlat items={group.items} byIssue={byIssue} issueStickyTop={null} ctx={ctx} />}
    </div>
  );
}

interface OfferSetsViewProps {
  collectionId: string;
  /** For the link a sold set's chip carries to its sale (#472). */
  collectionSlug: string;
  offerId: string;
  sets: OfferDetailSet[];
  /** The sets summed and averaged (#378) — the figures in the header band. */
  setsTotals: OfferSetsTotals;
  /** The section's own heading, rendered as the band's first line. Passed in rather than built here
   * so the panel keeps saying what the section is called, while this view owns the whole band. */
  heading: React.ReactNode;
  /** The section's primary action (Add set), stacked over this view's own Collapse all so both
   * buttons share one right edge. */
  primaryAction?: React.ReactNode;
  copies: ItemListItem[];
  isLoading: boolean;
  editable: boolean;
  areas: CollectionAreaData[];
  locations: LocationData[];
  issueHeaderById: Record<string, IssueHeader>;
  baseCurrency: string;
  onRemoveSet: (set: OfferDetailSet) => void;
  /** Sell one set on its own (#473). Undefined on an offer nothing can be sold from — a terminal
   * state — which is exactly when the offer-level Sell is withheld too. */
  onSellSet?: (set: OfferDetailSet) => void;
}

/** The offer's sets as the same rich, sortable copy layout as a purchase order. Group by **Set**
 * (each a collapsible card), **Location** (a section per storage spot), or none; **Issue**
 * sub-groups copies within whichever primary is chosen. */
export function OfferSetsView({
  collectionId,
  collectionSlug,
  offerId,
  sets,
  setsTotals,
  heading,
  primaryAction,
  copies,
  isLoading,
  editable,
  areas,
  locations,
  issueHeaderById,
  baseCurrency,
  onRemoveSet,
  onSellSet,
}: OfferSetsViewProps) {
  const hydrated = useHydrated();
  const [primaryRaw, setPrimary] = usePersistentString(`${LS_PRIMARY}:${collectionId}`, "set");
  const primary = (primaryRaw === "location" || primaryRaw === "none" ? primaryRaw : "set") as Primary;
  const [byIssue, setByIssue] = usePersistentToggle(`${LS_BY_ISSUE}:${collectionId}`, false);
  const [sortKey, setSortKey] = usePersistentString(`${LS_SORT_KEY}:${collectionId}`, "added");
  const [sortDir, setSortDir] = usePersistentString(`${LS_SORT_DIR}:${collectionId}`, "asc");

  // Sets are collapsed by default (#382) — a listing is scanned by its sets, and what is inside
  // one is a second question. A set added while the screen is open opens itself.
  const expansion = useCardExpansion(sets.map((s) => s.id));

  // Optimistic overrides while a reorder (#306) is in flight; cleared as soon as the server's own
  // order arrives. `setOrder` is a list of set ids, `copyOrder` a per-set list of copy ids.
  const [setOrder, setSetOrder] = useState<string[] | null>(null);
  const [copyOrder, setCopyOrder] = useState<Record<string, string[]>>({});
  const [orderError, setOrderError] = useState<string | null>(null);
  // Drop the optimistic overrides the moment fresh sets arrive from the server (the documented
  // adjust-state-during-render pattern — an effect here would cascade a second render).
  const [lastSets, setLastSets] = useState(sets);
  if (lastSets !== sets) {
    setLastSets(sets);
    setSetOrder(null);
    setCopyOrder({});
  }

  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const [onlyNoPhoto, setOnlyNoPhoto] = useState(false);
  const [onlyUnknownVariant, setOnlyUnknownVariant] = useState(false);
  const filterActive = onlyUnpriced || onlyNoPhoto || onlyUnknownVariant;
  const matches = (c: ItemListItem) =>
    (!onlyUnpriced || c.value.unpriced) &&
    (!onlyNoPhoto || c.photos.length === 0) &&
    (!onlyUnknownVariant || c.unknownVariant);

  // Totals across the offer's copies (unfiltered), for the count badges on each filter.
  const unpricedCount = copies.filter((c) => c.value.unpriced).length;
  const noPhotoCount = copies.filter((c) => c.photos.length === 0).length;
  const unknownVariantCount = copies.filter((c) => c.unknownVariant).length;

  const { invalidateAll } = useInvalidateOffers();
  const [quickPriceItem, setQuickPriceItem] = useState<ItemListItem | null>(null);
  const [isPending, startTransition] = useTransition();
  const [copyError, setCopyError] = useState<string | undefined>();

  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);
  const byId = useMemo(() => new Map(copies.map((c) => [c.id, c])), [copies]);

  const ctx: CopyCtx = {
    collectionId,
    areas,
    locations,
    baseCurrency,
    issueHeaderById,
    primaryVendorByArea,
    vendorMapFor,
    areaNameById,
    onSetPrice: setQuickPriceItem,
  };

  // The offer's canonical order (#306) after any optimistic override: sets in order, each set's
  // copies in order. Drives both the cards and the "Set order" sort key in the flat / location views.
  const orderedSets = useMemo(() => {
    if (!setOrder) return sets;
    const byId = new Map(sets.map((s) => [s.id, s]));
    const listed = setOrder.map((id) => byId.get(id)).filter((s): s is OfferDetailSet => !!s);
    const seen = new Set(listed.map((s) => s.id));
    return [...listed, ...sets.filter((s) => !seen.has(s.id))];
  }, [sets, setOrder]);
  const setItemIds = useCallback(
    (set: OfferDetailSet) => copyOrder[set.id] ?? set.itemIds,
    [copyOrder]
  );
  const canonicalIndex = useMemo(() => {
    const index = new Map<string, number>();
    let n = 0;
    for (const set of orderedSets) for (const id of setItemIds(set)) index.set(id, n++);
    return index;
  }, [orderedSets, setItemIds]);

  // Dragging only makes sense against the canonical order itself, so it is off while a filter hides
  // rows, while copies are grouped by issue, and for read-only (terminal) offers.
  const canDragSets = editable && !filterActive;
  const canDragCopies = editable && !filterActive && !byIssue && sortKey === SET_ORDER_KEY;

  const filteredCopies = copies.filter(matches);
  const flatSorted = useMemo(
    () => sortSetCopies(filteredCopies, sortKey, sortDir, primaryVendorByArea, canonicalIndex),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [copies, onlyUnpriced, onlyNoPhoto, onlyUnknownVariant, sortKey, sortDir, primaryVendorByArea, canonicalIndex]
  );
  const locationGroups = useMemo(() => groupByLocation(flatSorted, locations), [flatSorted, locations]);

  // The set cards actually on screen — with a filter on, sets with nothing matching are dropped, so
  // this (not `orderedSets`) is what drag indexes refer to.
  const renderedSets = orderedSets
    .map((set) => ({
      set,
      copies: setItemIds(set)
        .map((id) => byId.get(id))
        .filter((c): c is ItemListItem => !!c && matches(c)),
    }))
    .filter(({ copies }) => !filterActive || copies.length > 0);


  /** Move `from` to `to` in `ids`, returning null when the move is a no-op. */
  function moved(ids: string[], from: number, to: number): string[] | null {
    if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return null;
    const next = [...ids];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    return next;
  }

  /** Apply a reorder optimistically, then persist it; a rejected write rolls the view back. */
  function persist(apply: () => void, rollback: () => void, run: () => Promise<{ status: string; message?: string }>) {
    setOrderError(null);
    apply();
    startTransition(async () => {
      const r = await run();
      if (r.status === "error") {
        rollback();
        setOrderError(r.message ?? "Failed to save the new order.");
      } else {
        invalidateAll(collectionId);
      }
    });
  }

  function reorderSets(from: number, to: number) {
    const next = moved(orderedSets.map((s) => s.id), from, to);
    if (!next) return;
    const before = setOrder;
    persist(
      () => setSetOrder(next),
      () => setSetOrder(before),
      async () => {
        const { reorderOfferSetsAction } = await import("@/app/actions/offers");
        return reorderOfferSetsAction(offerId, next);
      }
    );
  }

  function reorderCopies(set: OfferDetailSet, from: number, to: number) {
    const next = moved(setItemIds(set), from, to);
    if (!next) return;
    const before = copyOrder;
    persist(
      () => setCopyOrder({ ...copyOrder, [set.id]: next }),
      () => setCopyOrder(before),
      async () => {
        const { reorderOfferSetItemsAction } = await import("@/app/actions/offers");
        return reorderOfferSetItemsAction(set.id, next);
      }
    );
  }

  // Sets are grabbed by their header only; copy rows have no header, so the whole row grabs.
  const setDrag = useReorderList(canDragSets, reorderSets, { handleOnly: true });

  function resetCopyOrder(set: OfferDetailSet) {
    setOrderError(null);
    startTransition(async () => {
      const { resetOfferSetItemOrderAction } = await import("@/app/actions/offers");
      const r = await resetOfferSetItemOrderAction(set.id);
      if (r.status === "error") setOrderError(r.message);
      else invalidateAll(collectionId);
    });
  }

  /**
   * The section's whole header, as **one band**: the heading over the view's own controls on the
   * left, the listing's figures (#378), and the two buttons stacked on the right — Add set over
   * Collapse all, sharing an edge.
   *
   * One band rather than a heading row in the panel and a toolbar row here: rendered as two
   * independent rows they aligned to nothing in particular, and the tall figures box stretched the
   * row it happened to land in, which is what made the vertical rhythm look broken. Everything that
   * addresses the whole section now shares one grid of rows and one right edge.
   */
  const band = (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "1.25rem",
        marginBottom: "0.75rem",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: 1, minWidth: "16rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        {heading}
        {sets.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={TOOLBAR_LABEL}>Group by</span>
              <ToggleChip label="Set" on={primary === "set"} onClick={() => setPrimary(primary === "set" ? "none" : "set")} />
              <ToggleChip label="Location" on={primary === "location"} onClick={() => setPrimary(primary === "location" ? "none" : "location")} />
              <span style={{ width: "1px", height: "1rem", background: "var(--color-border)" }} />
              <ToggleChip label="Issue" on={byIssue} onClick={() => setByIssue(!byIssue)} />
            </div>

            {(unpricedCount > 0 || noPhotoCount > 0 || unknownVariantCount > 0 || filterActive) && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={TOOLBAR_LABEL}>Only</span>
                {(unpricedCount > 0 || onlyUnpriced) && (
                  <CountFilterChip
                    token="error"
                    label={`⚠ ${unpricedCount} unpriced`}
                    active={onlyUnpriced}
                    onClick={() => setOnlyUnpriced(!onlyUnpriced)}
                  />
                )}
                {(noPhotoCount > 0 || onlyNoPhoto) && (
                  <CountFilterChip
                    token="accent"
                    label={`${noPhotoCount} no photo`}
                    active={onlyNoPhoto}
                    onClick={() => setOnlyNoPhoto(!onlyNoPhoto)}
                  />
                )}
                {(unknownVariantCount > 0 || onlyUnknownVariant) && (
                  <CountFilterChip
                    token="warning"
                    label={`~ ${unknownVariantCount} unknown variant`}
                    active={onlyUnknownVariant}
                    onClick={() => setOnlyUnknownVariant(!onlyUnknownVariant)}
                  />
                )}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={TOOLBAR_LABEL}>Sort copies</span>
              <select
                aria-label="Sort copies by"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                style={{ ...TOOLBAR_CHIP, cursor: "pointer", appearance: "auto", paddingRight: "1.25rem" }}
              >
                {SET_SORT_KEYS.map((k) => (
                  <option key={k} value={k}>{SET_SORT_LABELS[k]}</option>
                ))}
              </select>
              <Tooltip content={sortDir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}>
                <button
                  type="button"
                  onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
                  aria-label={`Sort direction: ${sortDir === "asc" ? "ascending" : "descending"}`}
                  style={{ ...TOOLBAR_CHIP, cursor: "pointer", fontWeight: 600 }}
                >
                  {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
                </button>
              </Tooltip>
            </div>
          </div>
        )}
      </div>

      <SetsTotalsBar totals={setsTotals} baseCurrency={baseCurrency} />

      {(primaryAction || (sets.length > 0 && primary === "set")) && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.625rem" }}>
          {primaryAction}
          {sets.length > 0 && primary === "set" && (
            <button
              type="button"
              onClick={expansion.toggleAll}
              style={{ ...TOOLBAR_CHIP, cursor: "pointer" }}
            >
              {expansion.allExpanded ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (sets.length === 0) {
    return (
      <div>
        {band}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.75rem", background: "var(--color-bg-elevated)", padding: "1.25rem", color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
          No sets yet. Add one or more sets — each is a whole sellable unit (a single stamp, a series,
          or one of a quantity).
        </div>
      </div>
    );
  }

  return (
    <div>
      {band}

      {orderError && (
        <div style={{ marginBottom: "0.75rem", fontSize: "0.8125rem", color: "var(--color-error)" }}>{orderError}</div>
      )}

      {isLoading ? (
        <div style={MUTED_BOX}>Loading copies…</div>
      ) : primary === "set" ? (
        <div
          {...(setDrag?.containerProps ?? {})}
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          {renderedSets.map(({ set, copies }, index) => (
            <Fragment key={set.id}>
              {showLineAt(setDrag, index) && <InsertionLine />}
              <SetCard
                set={set}
                collectionSlug={collectionSlug}
                copies={copies}
                expanded={hydrated && expansion.isExpanded(set.id)}
                byIssue={byIssue}
                sortKey={sortKey}
                sortDir={sortDir}
                editable={editable}
                ctx={ctx}
                index={index}
                setDrag={setDrag}
                copyDragEnabled={canDragCopies && !set.sold}
                onReorderCopies={(from, to) => reorderCopies(set, from, to)}
                onToggle={() => expansion.toggle(set.id)}
                onRemove={() => onRemoveSet(set)}
                onResetCopyOrder={() => resetCopyOrder(set)}
                // A set that has already gone has nothing left to sell (#473).
                onSell={onSellSet && !set.sold ? () => onSellSet(set) : undefined}
              />
            </Fragment>
          ))}
          {showLineAt(setDrag, renderedSets.length) && <InsertionLine />}
          {filterActive &&
            orderedSets.every((set) => setItemIds(set).every((id) => { const c = byId.get(id); return !c || !matches(c); })) && (
              <div style={MUTED_BOX}>No copies match the filter.</div>
            )}
        </div>
      ) : primary === "location" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {locationGroups.map((group) => (
            <LocationCard key={group.key} group={group} byIssue={byIssue} ctx={ctx} />
          ))}
        </div>
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.75rem", overflow: "clip", background: "var(--color-bg-elevated)" }}>
          <CopiesBody
            items={filteredCopies}
            byIssue={byIssue}
            sortKey={sortKey}
            sortDir={sortDir}
            stickyTop={0}
            ctx={ctx}
            canonicalIndex={canonicalIndex}
          />
        </div>
      )}

      {quickPriceItem && (
        <QuickPriceDialog
          subject={quickPriceItem}
          collectionId={collectionId}
          areaName={quickPriceItem.areaId ? (areaNameById.get(quickPriceItem.areaId) ?? null) : null}
          primaryVendorId={quickPriceItem.areaId ? (primaryVendorByArea.get(quickPriceItem.areaId) ?? null) : null}
          vendorMap={vendorMapFor(quickPriceItem.areaId, quickPriceItem.issueId)}
          isPending={isPending}
          error={copyError}
          onClose={() => {
            if (!isPending) {
              setQuickPriceItem(null);
              setCopyError(undefined);
            }
          }}
          onSubmit={(entries) => {
            const it = quickPriceItem;
            setCopyError(undefined);
            startTransition(async () => {
              const { quickSetCatalogPricesAction } = await import("@/app/actions/stamps");
              const r = await quickSetCatalogPricesAction(it.stampId, it.conditionId, it.certificateStatusId, entries);
              if (r.status === "error") setCopyError(r.message);
              else {
                setQuickPriceItem(null);
                invalidateAll(collectionId); // refresh copies + the suggested price
              }
            });
          }}
        />
      )}
    </div>
  );
}

/** A count filter chip, tinted by semantic token — mirrors the PO lot header's attention chips:
 * active gets a bold label and a 1px ring in the token colour. */
function CountFilterChip({
  token,
  label,
  active,
  onClick,
}: {
  token: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        ...TOOLBAR_CHIP,
        color: `var(--color-${token})`,
        borderColor: `var(--color-${token}-border, var(--color-border))`,
        background: `var(--color-${token}-soft, var(--color-bg-page))`,
        cursor: "pointer",
        fontWeight: active ? 700 : 500,
        boxShadow: active ? `0 0 0 1px var(--color-${token})` : undefined,
      }}
    >
      {label}
    </button>
  );
}

function ToggleChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        ...TOOLBAR_CHIP,
        cursor: "pointer",
        fontWeight: on ? 600 : 500,
        color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
        borderColor: on ? "var(--color-accent)" : "var(--color-border)",
        background: on ? "var(--color-accent-soft)" : "var(--color-bg-page)",
      }}
    >
      {on ? "✓ " : ""}
      {label}
    </button>
  );
}
