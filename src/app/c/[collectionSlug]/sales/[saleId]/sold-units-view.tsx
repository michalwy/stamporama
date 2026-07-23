"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { SaleCopyItem } from "@/lib/sales";
import type { IssueHeader } from "@/lib/issues";
import type { SaleDetailLine } from "@/lib/sales";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { LotIssueGroupHeader } from "@/app/c/[collectionSlug]/shared/lot-issue-group-header";
import { buildLocationPath } from "@/app/c/[collectionSlug]/shared/location-helpers";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  sortCopies,
  COPY_SORT_KEYS,
  COPY_SORT_LABELS,
} from "@/app/c/[collectionSlug]/shared/copy-sort";
import {
  useHydrated,
  usePersistentToggle,
  usePersistentString,
} from "@/app/c/[collectionSlug]/shared/lot-view-prefs";
import { useSaleLineCopies, useSaleCopies, useInvalidateSales } from "../use-sales-query";

const EMPTY_VENDOR_MAP: Map<string, AreaCatalogEntry> = new Map();

// The sales packing view adds "Location ref" to the shared copy sort keys — the in-location
// identifier (e.g. `A234`) is how you find a piece on the shelf. It is sales-local so the PO /
// lot views (whose server pagination validates a fixed key set) are unaffected.
const SALE_SORT_KEYS = [...COPY_SORT_KEYS, "ref"] as const;
const SALE_SORT_LABELS: Record<string, string> = { ...COPY_SORT_LABELS, ref: "Location ref" };
const REF_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Sort copies for the packing view. Handles the sales-local "ref" key (by location ref, blanks
 * last, natural order); everything else delegates to the shared `sortCopies`. */
function sortSaleCopies(
  items: SaleCopyItem[],
  sortKey: string,
  sortDir: string,
  primaryVendorByArea: Map<string, string | null>
): SaleCopyItem[] {
  // `sortCopies` only reorders the same objects, so the result still holds `SaleCopyItem`s.
  if (sortKey !== "ref")
    return sortCopies(items, sortKey, sortDir, primaryVendorByArea) as SaleCopyItem[];
  const dir = sortDir === "desc" ? -1 : 1;
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const ra = a.it.locationRef ?? "";
      const rb = b.it.locationRef ?? "";
      let cmp: number;
      if (!ra && !rb) cmp = 0;
      else if (!ra) cmp = 1; // blanks last, both directions
      else if (!rb) cmp = -1;
      else cmp = REF_COLLATOR.compare(ra, rb) * dir;
      if (cmp === 0) cmp = a.i - b.i; // stable tiebreak
      return cmp;
    })
    .map((d) => d.it);
}

// Group / sort prefs, namespaced separately from the lot & purchase views.
const LS_PRIMARY = "stamporama:sale:primaryGroup";
const LS_BY_ISSUE = "stamporama:sale:byIssue";
const LS_SORT_KEY = "stamporama:sale:sortKey";
const LS_SORT_DIR = "stamporama:sale:sortDir";
const LS_PACKED_FILTER = "stamporama:sale:packedFilter";

/** Primary grouping of the sold copies (mutually exclusive): each sold **lot** as its own card,
 * each storage **location** as a section (packing walk-order), or a single flat stream. */
type Primary = "lot" | "location" | "none";

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

/** Packed-status filter for the packing view (#192): show everything, only packed, or only the
 * copies still to pack. */
type PackedFilter = "all" | "packed" | "unpacked";

/** Narrow a copy set by packed status. */
function filterByPacked(items: SaleCopyItem[], filter: PackedFilter): SaleCopyItem[] {
  if (filter === "all") return items;
  const want = filter === "packed";
  return items.filter((it) => it.packed === want);
}

/** Maps + lookups the copy rows need, bundled so they pass through one prop. */
interface CopyCtx {
  collectionId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  issueHeaderById: Record<string, IssueHeader>;
  primaryVendorByArea: Map<string, string | null>;
  vendorMapByArea: Map<string, Map<string, AreaCatalogEntry>>;
  areaNameById: Map<string, string>;
  /** Toggle a single copy's packed flag (#192). */
  onTogglePacked: (itemId: string, packed: boolean) => void;
  /** True while a packed toggle is in flight — disables the checkboxes to avoid double-submits. */
  packedPending: boolean;
  /** Active packed-status filter (#192): copies are narrowed to it before grouping/rendering. */
  packedFilter: PackedFilter;
}

interface CopyGroup {
  key: string;
  label: string;
  items: SaleCopyItem[];
}

/** Group copies by owning issue, preserving first-seen order (mirrors the lot / PO views). */
function groupByIssue(items: SaleCopyItem[]): CopyGroup[] {
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

/** Group copies by storage location (packing walk-order), preserving first-seen order. Unfiled
 * copies fall into a trailing group. */
function groupByLocation(items: SaleCopyItem[], locations: LocationData[]): CopyGroup[] {
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

/** Toggle a sticky element's "stuck" flag via a zero-height sentinel placed just above it. */
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

/** Measure an element's rendered height, kept current across resizes. */
function useMeasuredHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}

function CopyRow({ item, ctx, isLast }: { item: SaleCopyItem; ctx: CopyCtx; isLast: boolean }) {
  const areaId = item.areaId;
  const primaryVendorId = areaId ? (ctx.primaryVendorByArea.get(areaId) ?? null) : null;
  const vendorMap = (areaId ? ctx.vendorMapByArea.get(areaId) : undefined) ?? EMPTY_VENDOR_MAP;
  const rowBorder = isLast ? undefined : "1px solid var(--color-border)";
  const packed = item.packed;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        background: packed ? "var(--color-success-soft, var(--color-bg-page))" : undefined,
      }}
    >
      {/* Per-copy packed toggle (#192): the whole full-height column is clickable (not just the
          chip), so it's an easy target while packing. The chip inside is a visual indicator. */}
      <Tooltip content={packed ? "Packed — click to mark as not packed" : "Mark this copy packed"}>
        <button
          type="button"
          aria-label={packed ? "Packed" : "Not packed"}
          aria-pressed={packed}
          disabled={ctx.packedPending}
          onClick={() => ctx.onTogglePacked(item.id, !packed)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 0.75rem",
            border: "none",
            borderBottom: rowBorder,
            borderRight: "1px solid var(--color-border)",
            background: "transparent",
            cursor: ctx.packedPending ? "default" : "pointer",
            opacity: ctx.packedPending ? 0.6 : 1,
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              minWidth: "5.5rem",
              justifyContent: "center",
              padding: "0.25rem 0.6rem",
              borderRadius: "999px",
              fontSize: "0.75rem",
              fontWeight: 600,
              whiteSpace: "nowrap",
              border: packed
                ? "1px solid var(--color-success-border, var(--color-success))"
                : "1px solid var(--color-border-strong)",
              color: packed ? "var(--color-success)" : "var(--color-text-muted)",
              background: packed ? "var(--color-success-soft, var(--color-bg-page))" : "var(--color-bg-elevated)",
            }}
          >
            <span style={{ fontSize: "0.8rem", lineHeight: 1 }}>{packed ? "✓" : "○"}</span>
            {packed ? "Packed" : "Pack"}
          </span>
        </button>
      </Tooltip>
      <div style={{ flex: 1, minWidth: 0 }}>
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
        />
      </div>
    </div>
  );
}

/** A set of already-sorted copies, rendered flat or — when `byIssue` — as collapsible issue
 * sections. `issueStickyTop` pins the issue headers (null = not sticky, e.g. when nested inside a
 * location section). Owns its own collapse state so sibling scopes collapse independently. */
function IssueOrFlat({
  items,
  byIssue,
  issueStickyTop,
  ctx,
}: {
  items: SaleCopyItem[];
  byIssue: boolean;
  issueStickyTop: number | null;
  ctx: CopyCtx;
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
    return <>{items.map((item, i) => <CopyRow key={item.id} item={item} ctx={ctx} isLast={i === items.length - 1} />)}</>;
  }
  return (
    <>
      {groupByIssue(items).map((group) => {
        const isCollapsed = collapsed.has(group.key);
        const header = group.key === "__none__" ? null : ctx.issueHeaderById[group.key];
        const areaId = header?.collectionAreaId ?? group.items[0]?.areaId ?? null;
        const primaryVendorId = areaId ? (ctx.primaryVendorByArea.get(areaId) ?? null) : null;
        const vendorMap = (areaId ? ctx.vendorMapByArea.get(areaId) : undefined) ?? EMPTY_VENDOR_MAP;
        const headerNode = (
          <LotIssueGroupHeader
            header={header}
            fallbackLabel={group.label}
            copyCount={group.items.length}
            countLabel="sold"
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
                {group.items.map((item, i) => <CopyRow key={item.id} item={item} ctx={ctx} isLast={i === group.items.length - 1} />)}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

const MUTED_BOX: React.CSSProperties = { padding: "1rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" };

/** The copies of one scope (a sold unit, or the whole sale), sorted then rendered flat or by
 * issue. `stickyTop` pins the issue headers. */
function CopiesBody({
  items,
  isLoading,
  byIssue,
  sortKey,
  sortDir,
  stickyTop,
  ctx,
}: {
  items: SaleCopyItem[];
  isLoading: boolean;
  byIssue: boolean;
  sortKey: string;
  sortDir: string;
  stickyTop: number;
  ctx: CopyCtx;
}) {
  const sorted = useMemo(
    () => sortSaleCopies(filterByPacked(items, ctx.packedFilter), sortKey, sortDir, ctx.primaryVendorByArea),
    [items, ctx.packedFilter, sortKey, sortDir, ctx.primaryVendorByArea]
  );
  if (isLoading) return <div style={MUTED_BOX}>Loading copies…</div>;
  if (sorted.length === 0) return <div style={MUTED_BOX}>{emptyCopiesLabel(ctx.packedFilter)}</div>;
  return <IssueOrFlat items={sorted} byIssue={byIssue} issueStickyTop={stickyTop} ctx={ctx} />;
}

/** Empty-state copy for a copies list, tailored to the active packed filter (#192). */
function emptyCopiesLabel(filter: PackedFilter): string {
  if (filter === "packed") return "No packed copies.";
  if (filter === "unpacked") return "No copies left to pack.";
  return "No copies.";
}

/** The whole-sale copies grouped by storage location (packing walk-order). Each location is its
 * own card — visually separated like the sold-unit cards — with a sticky header; inside each,
 * copies are optionally sub-grouped by issue. */
function LocationView({
  items,
  isLoading,
  byIssue,
  sortKey,
  sortDir,
  ctx,
}: {
  items: SaleCopyItem[];
  isLoading: boolean;
  byIssue: boolean;
  sortKey: string;
  sortDir: string;
  ctx: CopyCtx;
}) {
  const sorted = useMemo(
    () => sortSaleCopies(filterByPacked(items, ctx.packedFilter), sortKey, sortDir, ctx.primaryVendorByArea),
    [items, ctx.packedFilter, sortKey, sortDir, ctx.primaryVendorByArea]
  );
  const groups = useMemo(() => groupByLocation(sorted, ctx.locations), [sorted, ctx.locations]);

  if (isLoading) return <div style={MUTED_BOX}>Loading copies…</div>;
  if (sorted.length === 0) return <div style={MUTED_BOX}>{emptyCopiesLabel(ctx.packedFilter)}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {groups.map((group) => (
        <LocationCard key={group.key} group={group} byIssue={byIssue} ctx={ctx} />
      ))}
    </div>
  );
}

/** One location as a separate card (mirrors the sold-unit card): a sticky header (caret · 📍 path
 * · count) with a stuck shadow, expanding to its copies. */
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
          {group.items.length} sold
        </span>
      </div>
      {/* Nested issue headers are not sticky — the location header is the one that pins. */}
      {!collapsed && <IssueOrFlat items={group.items} byIssue={byIssue} issueStickyTop={null} ctx={ctx} />}
    </div>
  );
}

interface SoldUnitsViewProps {
  collectionId: string;
  saleId: string;
  currency: string;
  lines: SaleDetailLine[];
  areas: CollectionAreaData[];
  locations: LocationData[];
  issueHeaderById: Record<string, IssueHeader>;
  baseCurrency: string;
  onRemove: (lineId: string, label: string) => void;
}

/** The sold-units list for the packing view (ADR-0012, #166): the same rich, sortable copy
 * layout as a purchase order. The primary grouping is **Lot** (each sold unit a collapsible card,
 * copies loaded lazily), **Location** (a section per storage spot — a packing walk-order), or
 * none (a flat stream). **Issue** sub-groups copies within whichever primary is chosen. Group /
 * sort are order-level controls. */
export function SoldUnitsView({
  collectionId,
  saleId,
  currency,
  lines,
  areas,
  locations,
  issueHeaderById,
  baseCurrency,
  onRemove,
}: SoldUnitsViewProps) {
  const hydrated = useHydrated();
  const [primaryRaw, setPrimary] = usePersistentString(`${LS_PRIMARY}:${collectionId}`, "lot");
  const primary = (primaryRaw === "location" || primaryRaw === "none" ? primaryRaw : "lot") as Primary;
  const [byIssue, setByIssue] = usePersistentToggle(`${LS_BY_ISSUE}:${collectionId}`, true);
  const [sortKey, setSortKey] = usePersistentString(`${LS_SORT_KEY}:${collectionId}`, "added");
  const [sortDir, setSortDir] = usePersistentString(`${LS_SORT_DIR}:${collectionId}`, "asc");
  const [packedFilterRaw, setPackedFilter] = usePersistentString(`${LS_PACKED_FILTER}:${collectionId}`, "all");
  const packedFilter = (packedFilterRaw === "packed" || packedFilterRaw === "unpacked"
    ? packedFilterRaw
    : "all") as PackedFilter;

  // Cards default expanded (packing wants contents visible); a set of collapsed line ids overrides.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const allCollapsed = collapsed.size === lines.length && lines.length > 0;

  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);
  const areaNameById = useMemo(() => new Map(areas.map((a) => [a.id, a.name])), [areas]);

  // Per-copy packed toggle (#192): flip the flag, then refresh the copy caches and the server
  // component (so the header's "all packed" hint / status stay in sync).
  const router = useRouter();
  const { invalidateAll } = useInvalidateSales();
  const [packedPending, startPacked] = useTransition();
  function onTogglePacked(itemId: string, packed: boolean) {
    startPacked(async () => {
      const { setSaleLineItemPackedAction } = await import("@/app/actions/sales");
      const result = await setSaleLineItemPackedAction(itemId, packed);
      if (result.status === "success") {
        invalidateAll(collectionId);
        router.refresh();
      }
    });
  }

  const ctx: CopyCtx = {
    collectionId,
    areas,
    locations,
    baseCurrency,
    issueHeaderById,
    primaryVendorByArea,
    vendorMapByArea,
    areaNameById,
    onTogglePacked,
    packedPending,
    packedFilter,
  };

  // Whole-sale copies for the flat / location views — one lazy query, run only when not by-lot.
  const flat = useSaleCopies(collectionId, saleId, hydrated && primary !== "lot");

  function toggle(lineId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  return (
    <div>
      {/* Order-level controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={TOOLBAR_LABEL}>Group by</span>
          <ToggleChip label="Lot" on={primary === "lot"} onClick={() => setPrimary(primary === "lot" ? "none" : "lot")} />
          <ToggleChip label="Location" on={primary === "location"} onClick={() => setPrimary(primary === "location" ? "none" : "location")} />
          <span style={{ width: "1px", height: "1rem", background: "var(--color-border)" }} />
          <ToggleChip label="Issue" on={byIssue} onClick={() => setByIssue(!byIssue)} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={TOOLBAR_LABEL}>Sort copies</span>
          <select
            aria-label="Sort copies by"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            style={{ ...TOOLBAR_CHIP, cursor: "pointer", appearance: "auto", paddingRight: "1.25rem" }}
          >
            {SALE_SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {SALE_SORT_LABELS[k]}
              </option>
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

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={TOOLBAR_LABEL}>Packed</span>
          <ToggleChip label="All" on={packedFilter === "all"} onClick={() => setPackedFilter("all")} />
          <ToggleChip label="Packed" on={packedFilter === "packed"} onClick={() => setPackedFilter("packed")} />
          <ToggleChip label="To pack" on={packedFilter === "unpacked"} onClick={() => setPackedFilter("unpacked")} />
        </div>

        {primary === "lot" && (
          <button
            type="button"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(lines.map((l) => l.id)))}
            style={{ ...TOOLBAR_CHIP, cursor: "pointer", marginLeft: "auto" }}
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
      </div>

      {primary === "lot" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {lines.map((line) => (
            <SoldUnitCard
              key={line.id}
              currency={currency}
              line={line}
              expanded={hydrated && !collapsed.has(line.id)}
              byIssue={byIssue}
              sortKey={sortKey}
              sortDir={sortDir}
              ctx={ctx}
              onToggle={() => toggle(line.id)}
              onRemove={() => onRemove(line.id, line.setLabel)}
            />
          ))}
        </div>
      ) : primary === "location" ? (
        <LocationView
          items={flat.data ?? []}
          isLoading={!hydrated || flat.isLoading}
          byIssue={byIssue}
          sortKey={sortKey}
          sortDir={sortDir}
          ctx={ctx}
        />
      ) : (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.75rem", overflow: "clip", background: "var(--color-bg-elevated)" }}>
          <CopiesBody
            items={flat.data ?? []}
            isLoading={!hydrated || flat.isLoading}
            byIssue={byIssue}
            sortKey={sortKey}
            sortDir={sortDir}
            stickyTop={0}
            ctx={ctx}
          />
        </div>
      )}
    </div>
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

function SoldUnitCard({
  currency,
  line,
  expanded,
  byIssue,
  sortKey,
  sortDir,
  ctx,
  onToggle,
  onRemove,
}: {
  currency: string;
  line: SaleDetailLine;
  expanded: boolean;
  byIssue: boolean;
  sortKey: string;
  sortDir: string;
  ctx: CopyCtx;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { sentinelRef, stuck } = useStuck(0);
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();

  // Copies load only when the card is expanded (packing view stays cheap for a large sale).
  const { data: copies = [], isLoading } = useSaleLineCopies(ctx.collectionId, line.id, expanded);

  const actions: RowAction[] = [
    { key: "remove", label: "Remove", icon: "✕", danger: true, onSelect: onRemove },
  ];

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.75rem", overflow: "clip", background: "var(--color-bg-elevated)" }}>
      <div ref={sentinelRef} style={{ height: 0 }} />
      {/* Sticky card header */}
      <div
        ref={headerRef}
        onClick={onToggle}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          padding: "0.75rem 1rem",
          cursor: "pointer",
          background: "var(--color-bg-elevated)",
          borderBottom: expanded ? "1px solid var(--color-border)" : undefined,
          boxShadow: stuck ? STUCK_SHADOW : undefined,
        }}
      >
        <span aria-hidden style={{ width: "0.9rem", flexShrink: 0, color: "var(--color-text-muted)", fontSize: "0.75rem", lineHeight: 1 }}>
          {expanded ? "▼" : "▶"}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {line.setLabel}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginTop: "0.25rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
              {line.copyCount} cop{line.copyCount === 1 ? "y" : "ies"}
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
            {line.price} {currency}
            {line.priceBase && (
              <span style={{ marginLeft: "0.375rem", fontWeight: 500, fontSize: "0.6875rem", color: "var(--color-text-muted)" }}>
                ≈ {line.priceBase} {ctx.baseCurrency}
              </span>
            )}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            net {line.netBase} {ctx.baseCurrency}
          </div>
        </div>
        <span onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <RowActionsMenu actions={actions} ariaLabel="Sold unit actions" />
        </span>
      </div>

      {expanded && (
        <CopiesBody
          items={copies}
          isLoading={isLoading}
          byIssue={byIssue}
          sortKey={sortKey}
          sortDir={sortDir}
          stickyTop={headerHeight}
          ctx={ctx}
        />
      )}
    </div>
  );
}
