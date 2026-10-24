"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PICKER_DIALOG_HEIGHT,
  DialogShell,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { ItemListItem } from "@/lib/items";
import type { AttachableCopy } from "@/lib/lots";
import {
  ATTACH_PURCHASE_LABEL,
  ATTACH_PURCHASE_VALUES,
  ATTACH_STATES,
  ATTACH_STATE_LABEL,
  effectiveAttachStates,
  matchesAttachFilters,
  parseAttachFilters,
  serializeAttachFilters,
  toggleValue,
  type AttachPickerFilters,
  type AttachState,
} from "@/lib/attach-picker-filters";
import {
  ATTACH_SORT_KEYS,
  ATTACH_SORT_LABEL,
  isAttachSortKey,
  sortAttachableCopies,
} from "@/lib/attach-picker-sort";
import { catalogMatchKey } from "@/lib/catalog-number";
import { copyMatchesSearch } from "@/lib/copy-search";
import { countHiddenTicks, hiddenTicksSuffix } from "@/lib/picker-hidden-ticks";
import { summarizeRelink, untickOrder, type TickedCopy } from "@/lib/attach-relink";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { usePersistedSearch } from "@/app/c/[collectionSlug]/shared/use-persisted-search";
import {
  flattenAreaTree,
  resolveAreaFilterIds,
} from "@/app/c/[collectionSlug]/shared/area-helpers";
import { SortControl } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import {
  keepRowsAcrossTreeChange,
  type AreaSelection,
} from "@/app/c/[collectionSlug]/shared/area-scope-placeholder";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import { attachCopiesToLotAction } from "@/app/actions/purchases";
import { useInvalidateInventory } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { Icon } from "@/app/icons";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { CheckCell } from "@/app/c/[collectionSlug]/shared/cell-target";
import { FilterChip } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { MultiSelectFilter } from "@/app/c/[collectionSlug]/shared/multi-select-filter";
import { FilterSlot } from "@/app/c/[collectionSlug]/shared/filter-popover";
import { ROW_CHIP } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { FILTER_WIDTH } from "@/app/c/[collectionSlug]/inventory/copies-filter-controls";

const SEARCH_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

/** *Untick these* on a line of the re-link warning — a quiet text action, the Offers list's
 * `LINK_BTN`, so it reads as part of the sentence it answers rather than as a second footer. */
const LINK_BTN: React.CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: "0.8125rem",
  color: "var(--color-accent)",
  fontWeight: 600,
};

/** The rule between the chip groups of the filter row, so *Held* and *On a purchase* read as two
 *  questions rather than one list. */
const DIVIDER_STYLE: React.CSSProperties = {
  width: 1,
  alignSelf: "stretch",
  background: "var(--color-border)",
  margin: "0 0.25rem",
};

/**
 * What the picker adds to a copy's row (#2121, #2120): the purchase it is filed against, which is
 * the question the *On a purchase* chip asks and which the row otherwise answers only in its menu,
 * and the sale a sold copy went out on, beside the row's own *Sold* chip.
 */
function AttachRowChips({ item }: { item: AttachableCopy }) {
  return (
    <>
      {item.purchase && (
        <span style={ROW_CHIP}>
          <Icon name="purchases" size="sm" /> {item.purchase.label}
        </span>
      )}
      {item.soldOn && (
        <span style={ROW_CHIP}>
          <Icon name="sell" size="sm" /> Sale #{item.soldOn.saleNo}
        </span>
      )}
    </>
  );
}

const SORT_OPTIONS = ATTACH_SORT_KEYS.map((key) => ({ value: key, label: ATTACH_SORT_LABEL[key] }));

const HINT_STYLE: React.CSSProperties = {
  padding: "2rem 1.5rem",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

/** The copies this lot could take on (#388). Unpaginated — the dialog scopes by area/year and
 * filters the rest client-side, exactly as the offer composition picker does. The state (#2121) is
 * the one filter sent to the server, since it decides which copies are read at all. */
function useAttachableCopies(
  collectionId: string,
  lotId: string,
  areaIds: string[] | null,
  states: AttachState[],
  areaSelection: AreaSelection
) {
  return useQuery<AttachableCopy[]>({
    queryKey: ["purchases", collectionId, "attachable", lotId, areaIds, states] as const,
    // An area added from the rail's `＋` must not blank the list the collector is ticking in (#977).
    ...keepRowsAcrossTreeChange<AttachableCopy[]>(areaSelection, [
      "purchases",
      collectionId,
      "attachable",
      lotId,
    ]),
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const id of areaIds ?? []) params.append("areaId", id);
      for (const state of states) params.append("state", state);
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/lots/${lotId}/attachable-copies?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to load copies");
      return (await res.json()).items;
    },
  });
}

/**
 * Attach copies that **already exist** to an open lot (#388) — the correction path beside intake
 * (#121), which creates them: a copy entered by hand before the receipt was recorded, or one filed
 * under the wrong purchase.
 *
 * Modelled on the offer composition picker: area tree + year facets on the left, a text-filterable
 * list of eligible copies on the right, each a checkbox row rendered with `InventoryItemRow` so a
 * copy reads the same here as everywhere else. Above the list, the picker's own filters (#2121):
 * condition, certificate and format as the Copies list draws them, whether a copy is on a purchase,
 * and whether it is still held — the copies that have been sold or written off are offered too
 * (#2120), because a copy that left before its receipt was recorded still needs a cost. Beside them,
 * the sort (#2147): catalogue order by default, so the copies come in the order a receipt or an album
 * lists them. Filters and sort are remembered per collection, as the area and year are.
 *
 * A copy that already belongs to **another** purchase is offered but never moved silently — the
 * footer names the orders being left and the move has to be confirmed, because reassigning a copy
 * changes what two purchases each say they bought. That warning is read off the **selection** and
 * not off the fetched page (#1079, `@/lib/attach-relink`): the area rail is server-side, so a copy
 * ticked under one area is absent from `copies` once the rail moves, and a warning derived from
 * `copies` went silent for exactly the collector the hidden-ticks label had just invited to tick
 * across areas. Copies frozen into a *closed* lot are not in
 * the list at all: their cost basis has already been split (ADR-0009 §3), so that lot has to be
 * reopened first, and the server refuses them on the same grounds.
 */
export function AttachCopiesDialog({
  collectionId,
  lotId,
  lotLabel,
  areas,
  locations,
  baseCurrency,
  onClose,
  onDone,
}: {
  collectionId: string;
  lotId: string;
  lotLabel: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { storedAreaId, storedYear, writeStore } = useCollectionFilterStore(collectionId);
  const areaId = storedAreaId;
  const year = storedYear;
  const setAreaId = useCallback(
    (id: string | null) => writeStore({ areaId: id, year: storedYear }),
    [writeStore, storedYear]
  );
  const setYear = useCallback(
    (y: string | null) => writeStore({ areaId: storedAreaId, year: y }),
    [writeStore, storedAreaId]
  );

  const [search, setSearch] = usePersistedSearch(`${collectionId}:attach-copies`);
  const [storedFilters, storeFilters] = usePersistedCollectionValue(
    "attach-copies-filters",
    collectionId
  );
  const filters = useMemo(() => parseAttachFilters(storedFilters), [storedFilters]);
  const setFilters = (patch: Partial<AttachPickerFilters>) =>
    storeFilters(serializeAttachFilters({ ...filters, ...patch }));
  const states = useMemo(() => effectiveAttachStates(filters.states), [filters.states]);
  const { data: conditions = [] } = useCollectionConditions(collectionId);
  const { data: certificateStatuses = [] } = useCollectionCertificateStatuses(collectionId);
  const { data: formats = [] } = useCollectionFormats(collectionId);
  // The selection carries what the re-link warning needs rather than re-deriving it from the
  // current fetch (#1079): the area rail is resolved server-side, so a copy ticked under one area
  // is not in `copies` at all once the rail moves, and a warning read off `copies` went silent for
  // exactly the collector who had ticked across areas. A tick is recorded at the moment it is
  // made, which is the moment the collector can see the order it is coming off.
  const [selected, setSelected] = useState<Map<string, TickedCopy>>(new Map());
  const [confirmRelink, setConfirmRelink] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const queryClient = useQueryClient();
  // A copy's purchase link is part of its row (#387), so the Copies list is stale after this too.
  const { invalidateList } = useInvalidateInventory();

  const [includeSubAreas] = useSubtreeScope("area");
  const areaIds = useMemo(
    () => resolveAreaFilterIds(areas, areaId, includeSubAreas),
    [areas, areaId, includeSubAreas]
  );

  const { data: copies = [], isLoading } = useAttachableCopies(collectionId, lotId, areaIds, states, {
    areaId,
    includeSubAreas,
  });
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);
  const areaOrder = useMemo(() => flattenAreaTree(areas).map(({ area }) => area.id), [areas]);

  const yearFacets = useMemo(() => {
    const counts = new Map<number | null, number>();
    for (const c of copies) counts.set(c.issuedYear, (counts.get(c.issuedYear) ?? 0) + 1);
    return [...counts.entries()]
      .map(([y, count]) => ({ year: y, count }))
      .sort((a, b) => (a.year === null ? 1 : b.year === null ? -1 : a.year - b.year));
  }, [copies]);

  const visibleCopies = useMemo(() => {
    const raw = search.trim();
    const y = year === "none" ? "none" : year ? Number(year) : null;
    const matching = copies.filter((c) => {
      if (!matchesAttachFilters(c, filters)) return false;
      if (y === "none" && c.issuedYear !== null) return false;
      if (typeof y === "number" && c.issuedYear !== y) return false;
      // The one copy search a picker runs (#2136): `#123` is that copy alone, anything else its
      // stamp, issue, location ref, catalogue number or — bare — its own number.
      return copyMatchesSearch(c, raw, () => {
        const vm = vendorMapFor(c.areaId, c.issueId);
        return c.catalogNumbers.map((cn) => {
          const v = vm.get(cn.catalogVendorId);
          return catalogMatchKey(v?.vendorAbbreviation ?? "", v?.prefix, cn.number);
        });
      });
    });
    // Re-sorting reorders the rows and nothing else: a tick is keyed by copy, never by position.
    return sortAttachableCopies(matching, filters.sortBy, filters.sortDir, areaOrder);
  }, [copies, filters, year, search, vendorMapFor, areaOrder]);

  function toggle(item: ItemListItem) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, { relinkFrom: item.purchase ?? null });
      return next;
    });
  }

  const allVisibleIds = visibleCopies.map((c) => c.id);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id));
  function toggleAll(on: boolean) {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const c of visibleCopies) {
        if (on) next.set(c.id, { relinkFrom: c.purchase ?? null });
        else next.delete(c.id);
      }
      return next;
    });
  }

  const selectedIds = useMemo(() => [...selected.keys()], [selected]);

  // A picker submits the whole selection and says how many rows its filters are hiding (#1046).
  // The area rail and the state are resolved server-side and the rest client-side, so what is
  // subtracted is the rows on screen rather than any one filter.
  const hiddenTicks = countHiddenTicks(selected.keys(), new Set(allVisibleIds));
  const hiddenNote = hiddenTicksSuffix(hiddenTicks);

  // The selected copies that would be taken off another purchase — read off the **selection**, so a
  // tick made under an area the rail has since left is still counted and its order still named
  // (#1079). Named rather than counted: the question a collector needs answered before agreeing is
  // *which* order loses them, so the count and the names come out of one pass and cannot drift.
  // Each order carries its own share of the count, and can be unticked whole (#1770).
  const relinked = useMemo(() => summarizeRelink(selected), [selected]);
  const needsConfirm = relinked.count > 0;
  const untickFrom = (orderId: string) => setSelected((prev) => untickOrder(prev, orderId));

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const result = await attachCopiesToLotAction(lotId, selectedIds, needsConfirm && confirmRelink);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      // A partial outcome is reported rather than swallowed: the copies that went on are on, and
      // the collector is told plainly about the ones that did not and why.
      if (result.refusals.length > 0) {
        setError(
          `${result.attached} attached. ${result.refusals.length} could not be: ${[
            ...new Set(result.refusals),
          ].join(" ")}`
        );
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["purchases", collectionId, "attachable"] });
      invalidateList(collectionId);
      onDone();
    });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title={`Attach existing copies to ${lotLabel}`}
      onClose={onClose}
      maxWidth="min(96vw, 100rem)"
      height={PICKER_DIALOG_HEIGHT}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <ListFilterSidebar
          variant="dialog"
          areas={areas}
          filterAreaId={areaId}
          onNavigateArea={setAreaId}
          yearFacets={yearFacets}
          yearsLoading={isLoading}
          selectedYear={year}
          onSelectYear={setYear}
          quickAddCollectionId={collectionId}
        />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderLeft: "1px solid var(--color-border)",
          }}
        >
          <div
            style={{
              padding: "0.75rem 1rem",
              borderBottom: "1px solid var(--color-border)",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                fontSize: "0.8125rem",
                color: "var(--color-text-secondary)",
                whiteSpace: "nowrap",
                flexShrink: 0,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => toggleAll(e.target.checked)}
                disabled={visibleCopies.length === 0}
              />
              All
            </label>
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by stamp, issue, catalog number, or location ref…"
              style={{ ...SEARCH_STYLE, flex: 1 }}
              aria-label="Filter copies"
            />
          </div>

          {/* The picker's own filters (#2121). The state chips decide which copies are read at
              all — the held ones by default, the sold, traded and written-off ones for a receipt
              recorded after they left (#2120); the purchase chips separate the copies on no
              purchase from those already filed against one. Neither set lit is every value. The
              sort closes the row (#2147), the Copies list's control, remembered with the filters. */}
          <div
            style={{
              padding: "0.5rem 1rem",
              borderBottom: "1px solid var(--color-border)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            {ATTACH_STATES.map((state) => (
              <FilterChip
                key={state}
                label={ATTACH_STATE_LABEL[state]}
                active={filters.states.includes(state)}
                toggle
                onClick={() => setFilters({ states: toggleValue(filters.states, state) })}
              />
            ))}
            <span aria-hidden style={DIVIDER_STYLE} />
            {ATTACH_PURCHASE_VALUES.map((value) => (
              <FilterChip
                key={value}
                label={ATTACH_PURCHASE_LABEL[value]}
                active={filters.purchase.includes(value)}
                toggle
                onClick={() => setFilters({ purchase: toggleValue(filters.purchase, value) })}
              />
            ))}
            <span aria-hidden style={DIVIDER_STYLE} />
            <FilterSlot width={FILTER_WIDTH.conditions}>
              <MultiSelectFilter
                fullWidth
                options={conditions.map((c) => ({ id: c.id, label: c.name }))}
                selected={filters.conditionIds}
                onChange={(ids) => setFilters({ conditionIds: ids })}
                allLabel="All conditions"
                itemNoun="conditions"
                ariaLabel="Filter by condition"
              />
            </FilterSlot>
            {certificateStatuses.length > 0 && (
              <FilterSlot width={FILTER_WIDTH.certificates}>
                <MultiSelectFilter
                  fullWidth
                  options={[
                    { id: "none", label: "No certificate" },
                    ...certificateStatuses.map((c) => ({ id: c.id, label: c.name })),
                  ]}
                  selected={filters.certificateStatusIds}
                  onChange={(ids) => setFilters({ certificateStatusIds: ids })}
                  allLabel="All certificates"
                  itemNoun="certificates"
                  ariaLabel="Filter by certificate status"
                />
              </FilterSlot>
            )}
            {formats.length > 0 && (
              <FilterSlot width={FILTER_WIDTH.formats}>
                <MultiSelectFilter
                  fullWidth
                  options={[
                    { id: "single", label: "Single" },
                    ...formats.map((f) => ({ id: f.id, label: f.name })),
                  ]}
                  selected={filters.formatIds}
                  onChange={(ids) => setFilters({ formatIds: ids })}
                  allLabel="All formats"
                  itemNoun="formats"
                  ariaLabel="Filter by format"
                />
              </FilterSlot>
            )}
            <span aria-hidden style={DIVIDER_STYLE} />
            <SortControl
              sortBy={filters.sortBy}
              sortDir={filters.sortDir}
              sortOptions={SORT_OPTIONS}
              onSortChange={(sortBy, sortDir) =>
                setFilters({ sortBy: isAttachSortKey(sortBy) ? sortBy : filters.sortBy, sortDir })
              }
            />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {isLoading ? (
              <p style={HINT_STYLE}>Loading copies…</p>
            ) : visibleCopies.length === 0 ? (
              <p style={HINT_STYLE}>
                {copies.length === 0
                  ? "No copies available to attach. A copy already on this lot, or on a lot that has been closed, is not offered — reopen that lot first. Sold and written-off copies are under their own chips."
                  : "No copies match your filter."}
              </p>
            ) : (
              visibleCopies.map((item, i) => {
                const checked = selected.has(item.id);
                const primaryVendorId = item.areaId
                  ? (primaryVendorByArea.get(item.areaId) ?? null)
                  : null;
                const vendorMap = vendorMapFor(item.areaId, item.issueId);
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "stretch",
                      background: checked ? "var(--color-accent-soft)" : undefined,
                    }}
                  >
                    <CheckCell style={SELECT_STRIP}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(item)}
                        aria-label="Select this copy"
                        style={{ cursor: "pointer" }}
                      />
                    </CheckCell>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <InventoryItemRow
                        collectionId={collectionId}
                        item={item}
                        areas={areas}
                        locations={locations}
                        baseCurrency={baseCurrency}
                        primaryVendorId={primaryVendorId}
                        vendorMap={vendorMap}
                        isLast={i === visibleCopies.length - 1}
                        readOnly
                        showCostBasis
                        trailingChips={<AttachRowChips item={item} />}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Re-linking is a real change to two orders, so it is confirmed rather than assumed. The
          warning names the purchases being left — a count would not tell the collector whether
          this is the mistake they are correcting — one line each, with how many of the ticked
          copies come off it and a way to leave all of them where they are (#1770). */}
      {needsConfirm && (
        <div
          style={{
            padding: "0.625rem 1rem",
            borderTop: "1px solid var(--color-warning-border, var(--color-border))",
            background: "var(--color-warning-soft)",
            color: "var(--color-warning)",
            fontSize: "0.8125rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.375rem",
          }}
        >
          <span>
            <Icon name="warning" size="sm" /> {relinked.count}{" "}
            {relinked.count === 1 ? "copy belongs" : "copies belong"} to another purchase.
            Attaching {relinked.count === 1 ? "it" : "them"} here moves{" "}
            {relinked.count === 1 ? "it" : "them"} off{" "}
            {relinked.orders.length === 1 ? "that order" : "those orders"}.
          </span>
          <ul style={{ margin: 0, paddingLeft: "1.5rem" }}>
            {relinked.orders.map((order) => (
              <li key={order.id}>
                {order.label} — {order.count} {order.count === 1 ? "copy" : "copies"}{" "}
                <button type="button" onClick={() => untickFrom(order.id)} style={LINK_BTN}>
                  Untick these
                </button>
              </li>
            ))}
          </ul>
          <label
            style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={confirmRelink}
              onChange={(e) => setConfirmRelink(e.target.checked)}
              style={{ marginTop: "0.15rem", cursor: "pointer" }}
            />
            <span>Confirm the move.</span>
          </label>
        </div>
      )}

      <DialogFooter error={error}>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        <DialogPrimaryButton
          type="button"
          onClick={submit}
          disabled={isPending || selectedIds.length === 0 || (needsConfirm && !confirmRelink)}
        >
          {isPending
            ? "Attaching…"
            : selectedIds.length > 1
              ? `Attach ${selectedIds.length} copies${hiddenNote}`
              : `Attach copy${hiddenNote}`}
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
