"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  DialogShell,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { catalogMatchKey, catalogKeyMatches } from "@/lib/catalog-number";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { usePersistedSearch } from "@/app/c/[collectionSlug]/shared/use-persisted-search";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import { addTradeGiveLinesAction } from "@/app/actions/trades";
import { useOfferableCopies, useInvalidateTradeDetail } from "./use-trade-detail-query";

// The **give side's** picker (#637): which copies leave.
//
// Modelled on the offer composition and lot-attach pickers — area tree and year facets on the left,
// a text-filterable list of eligible copies on the right, each a checkbox row drawn with
// `InventoryItemRow` — because they are the same act: choosing pieces out of the collection. A copy
// should read the same here as it does everywhere else.
//
// It opens on **for-trade copies** and can be widened to everything held. That is the whole design
// of the toggle: `Item.forTrade` is where a collector files what they are willing to part with, so
// it is the right list to open on, but a partner routinely asks by name for something that was never
// marked, and a picker that could not offer it would send the collector off to edit a disposition
// mid-negotiation.
//
// What is **not** offerable never reaches the list at all — sold, disposed of, not yet in hand, or
// already promised to a live trade. The server decides that (`listOfferableCopies`) and re-checks it
// on save, because the list is a moment old by the time anything is ticked.

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

const HINT_STYLE: React.CSSProperties = {
  padding: "2rem 1.5rem",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

const TOGGLE_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
  flexShrink: 0,
  cursor: "pointer",
};

export function TradeCopyPickerDialog({
  collectionId,
  tradeId,
  sectionId,
  sectionName,
  areas,
  locations,
  baseCurrency,
  onClose,
}: {
  collectionId: string;
  tradeId: string;
  sectionId: string;
  sectionName: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  onClose: () => void;
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

  const [forTradeOnly, setForTradeOnly] = useState(true);
  const [search, setSearch] = usePersistedSearch(`${collectionId}:trade-copies`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const { invalidateTrade } = useInvalidateTradeDetail();

  const [includeSubAreas] = useSubtreeScope("area");
  const areaIds = useMemo(
    () => resolveAreaFilterIds(areas, areaId, includeSubAreas),
    [areas, areaId, includeSubAreas]
  );

  const { data: copies = [], isLoading } = useOfferableCopies(
    collectionId,
    tradeId,
    areaIds,
    forTradeOnly
  );
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  const yearFacets = useMemo(() => {
    const counts = new Map<number | null, number>();
    for (const c of copies) counts.set(c.issuedYear, (counts.get(c.issuedYear) ?? 0) + 1);
    return [...counts.entries()]
      .map(([y, count]) => ({ year: y, count }))
      .sort((a, b) => (a.year === null ? 1 : b.year === null ? -1 : b.year - a.year));
  }, [copies]);

  const visibleCopies = useMemo(() => {
    const raw = search.trim();
    const q = raw.toLowerCase();
    const y = year === "none" ? "none" : year ? Number(year) : null;
    return copies.filter((c) => {
      if (y === "none" && c.issuedYear !== null) return false;
      if (typeof y === "number" && c.issuedYear !== y) return false;
      if (!q) return true;
      if ((c.stampName ?? "").toLowerCase().includes(q)) return true;
      if ((c.issueName ?? "").toLowerCase().includes(q)) return true;
      // Where the copy is filed (#303) — pull a piece off the shelf, type its ref, add it.
      if ((c.locationRef ?? "").toLowerCase().includes(q)) return true;
      const vm = vendorMapFor(c.areaId, c.issueId);
      const keys = c.catalogNumbers.map((cn) => {
        const v = vm.get(cn.catalogVendorId);
        return catalogMatchKey(v?.vendorAbbreviation ?? "", v?.prefix, cn.number);
      });
      return catalogKeyMatches(raw, keys);
    });
  }, [copies, year, search, vendorMapFor]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisibleIds = visibleCopies.map((c) => c.id);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id));
  function toggleAll(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of allVisibleIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const selectedIds = useMemo(() => [...selected], [selected]);

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const result = await addTradeGiveLinesAction(sectionId, selectedIds);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      invalidateTrade(collectionId);
      // A partial outcome is **reported, not swallowed**: what went on is on, and the copies that
      // did not are named with the reason. A copy promised elsewhere between opening this dialog
      // and pressing the button is exactly the case this exists for.
      if (result.refused.length > 0) {
        setSelected(new Set());
        setError(
          `${result.added} added. ${result.refused.length} could not be: ${result.refused
            .map((r) => r.reason)
            .join(" ")}`
        );
        return;
      }
      onClose();
    });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title={`Add copies to ${sectionName}`}
      onClose={onClose}
      maxWidth="min(96vw, 100rem)"
      height="min(90vh, 60rem)"
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
            <label style={TOGGLE_STYLE}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => toggleAll(e.target.checked)}
                disabled={visibleCopies.length === 0}
              />
              All
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by stamp, issue, catalog number, or location ref…"
              style={{ ...SEARCH_STYLE, flex: 1 }}
              aria-label="Filter copies"
            />
            {/* The widening switch. Ticking it changes what the *server* sends, not what is hidden
                client-side: a collection with thousands of copies would otherwise ship all of them
                to filter most away. */}
            <label style={TOGGLE_STYLE}>
              <input
                type="checkbox"
                checked={!forTradeOnly}
                onChange={(e) => setForTradeOnly(!e.target.checked)}
              />
              Any held copy
            </label>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {isLoading ? (
              <p style={HINT_STYLE}>Loading copies…</p>
            ) : visibleCopies.length === 0 ? (
              <p style={HINT_STYLE}>
                {copies.length === 0
                  ? forTradeOnly
                    ? "No copies marked for trade here. Tick “Any held copy” to offer everything you hold — a copy that is sold, gone, not yet arrived, or already promised to another trade is never offered."
                    : "No copies available. A copy that is sold, gone, not yet arrived, or already promised to another trade is not offered."
                  : "No copies match your filter."}
              </p>
            ) : (
              visibleCopies.map((item, i) => {
                const checked = selected.has(item.id);
                const primaryVendorId = item.areaId
                  ? (primaryVendorByArea.get(item.areaId) ?? null)
                  : null;
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "stretch",
                      background: checked ? "var(--color-accent-soft)" : undefined,
                    }}
                  >
                    <label style={SELECT_STRIP}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(item.id)}
                        aria-label="Select this copy"
                        style={{ cursor: "pointer" }}
                      />
                    </label>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <InventoryItemRow
                        collectionId={collectionId}
                        item={item}
                        areas={areas}
                        locations={locations}
                        baseCurrency={baseCurrency}
                        primaryVendorId={primaryVendorId}
                        vendorMap={vendorMapFor(item.areaId, item.issueId)}
                        isLast={i === visibleCopies.length - 1}
                        readOnly
                        showCostBasis
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <DialogFooter>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
            Listing a copy here is a plan, not a claim on it.
          </span>
          <ErrorBubble>{error}</ErrorBubble>
          <DialogPrimaryButton
            type="button"
            onClick={submit}
            disabled={isPending || selectedIds.length === 0}
          >
            {isPending
              ? "Adding…"
              : selectedIds.length > 1
                ? `Add ${selectedIds.length} copies`
                : "Add copy"}
          </DialogPrimaryButton>
        </div>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
