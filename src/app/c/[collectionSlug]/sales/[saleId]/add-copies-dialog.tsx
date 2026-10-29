"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  PICKER_DIALOG_HEIGHT,
  DialogShell,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import { yearSelects } from "@/lib/list-area-year-filter";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { catalogMatchKey } from "@/lib/catalog-number";
import { copyMatchesSearch } from "@/lib/copy-search";
import { countHiddenTicks, hiddenTicksSuffix } from "@/lib/picker-hidden-ticks";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { usePersistedSearch } from "@/app/c/[collectionSlug]/shared/use-persisted-search";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { CheckCell } from "@/app/c/[collectionSlug]/shared/cell-target";
import { useStockCopiesForSale } from "../use-sales-query";

// Copies on no offer, added to the sale as **one set** with one price (#2021).
//
// The trade give side's picker in shape (`trade-copy-picker-dialog.tsx`) — area tree and year facets
// on the left, a text-filterable list of copies on the right, each a checkbox row drawn with
// `InventoryItemRow` — because it is the same act: choosing pieces out of the collection. What is
// offered is every copy **in stock**, whatever it is kept for: a stamp sold to someone who asked for
// it was rarely marked for sale. The server decides what is in stock (`listStockCopiesForSale`) and
// re-checks it on save. A copy that is also in an offer can be picked; that offer is then flagged as
// for any copy sold elsewhere.
//
// The price starts empty and has to be typed: there is no offer to take an asking price from, and a
// guessed one would be recorded as what the buyer paid.

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

const PRICE_STYLE: React.CSSProperties = {
  ...SEARCH_STYLE,
  width: "7rem",
  textAlign: "right",
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

export function AddCopiesDialog({
  collectionId,
  currency,
  baseCurrency,
  areas,
  locations,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  collectionId: string;
  /** The sale's currency — the price is typed in it. */
  currency: string;
  baseCurrency: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (set: { itemIds: string[]; price: string }) => void;
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

  const [search, setSearch] = usePersistedSearch(`${collectionId}:sale-copies`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [price, setPrice] = useState("");

  const [includeSubAreas] = useSubtreeScope("area");
  const areaIds = useMemo(
    () => resolveAreaFilterIds(areas, areaId, includeSubAreas),
    [areas, areaId, includeSubAreas]
  );

  const { data: copies = [], isLoading } = useStockCopiesForSale(collectionId, areaIds, {
    areaId,
    includeSubAreas,
  });
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  const yearFacets = useMemo(() => {
    const counts = new Map<number | null, number>();
    for (const c of copies) counts.set(c.issuedYear, (counts.get(c.issuedYear) ?? 0) + 1);
    return [...counts.entries()]
      .map(([y, count]) => ({ year: y, count }))
      .sort((a, b) => (a.year === null ? 1 : b.year === null ? -1 : a.year - b.year));
  }, [copies]);

  const visibleCopies = useMemo(() => {
    const raw = search.trim();
    return copies.filter((c) => {
      // One year, No year or a span of them (#2258), read as the rail and the routes read it.
      if (!yearSelects(year, c.issuedYear)) return false;
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
  // A picker submits the whole selection and says how many rows its filters are hiding (#1046).
  const hiddenNote = hiddenTicksSuffix(countHiddenTicks(selected, new Set(allVisibleIds)));
  const canSubmit = !isPending && selectedIds.length > 0 && price.trim() !== "";

  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title="Sell copies on no offer"
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
            <label style={TOGGLE_STYLE}>
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

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {isLoading ? (
              <p style={HINT_STYLE}>Loading copies…</p>
            ) : visibleCopies.length === 0 ? (
              <p style={HINT_STYLE}>
                {copies.length === 0
                  ? "No copies in stock here. A copy that is sold, gone, or not yet in hand is not offered."
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
                    <CheckCell style={SELECT_STRIP}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(item.id)}
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

      <DialogFooter error={error}>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label
            style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}
          >
            Price for the set
            <NumericInput
              kind="amount"
              value={price}
              placeholder="0.00"
              onChange={(e) => setPrice(e.target.value)}
              style={PRICE_STYLE}
              aria-label="Price for the set"
            />
            {currency}
          </label>
          <DialogPrimaryButton
            type="button"
            onClick={() => onSubmit({ itemIds: selectedIds, price })}
            disabled={!canSubmit}
          >
            {isPending
              ? "Adding…"
              : selectedIds.length > 1
                ? `Add ${selectedIds.length} copies as one set${hiddenNote}`
                : `Add copy${hiddenNote}`}
          </DialogPrimaryButton>
        </div>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
