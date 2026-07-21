"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { getDescendantIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { useSellableCopies } from "../use-lots-query";

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

interface InventoryPickerProps {
  collectionId: string;
  lotId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  isPending: boolean;
  error?: string;
  /** Dialog title override (e.g. "Add copies as sub-lots" for a quantity lot). */
  title?: string;
  /** Restrict to one stamp — the quantity-lot flow passes the lot's shape stamp so only
   * interchangeable copies show. */
  stampId?: string | null;
  /** Restrict to one condition — the quantity-lot flow passes the lot's shape condition
   * (condition must match for interchangeability). */
  conditionId?: string | null;
  /** Distinct certificate keys already in the target quantity lot ("" = none). When set, the
   * picker warns if the current selection would mix certificates (a warning, not a block). */
  existingCertKeys?: string[];
  /** Copy ids to hide (already represented under the target quantity lot). */
  excludeIds?: string[];
  onClose: () => void;
  onConfirm: (itemIds: string[]) => void;
}

/**
 * Popup **inventory picker** for composing a unit lot (ADR-0012 §2, #164). Mirrors the
 * Copies screen: an area sidebar + year facets on the left, a text-filterable **flat list**
 * of inventory copies on the right — each a checkbox row rendered with the same
 * `InventoryItemRow`. Only copies flagged *For sale* that aren't already in the lot, and
 * aren't sold, appear.
 */
export function InventoryPicker({
  collectionId,
  lotId,
  areas,
  locations,
  baseCurrency,
  isPending,
  error,
  title = "Add copies from inventory",
  stampId = null,
  conditionId = null,
  existingCertKeys,
  excludeIds,
  onClose,
  onConfirm,
}: InventoryPickerProps) {
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

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const areaIds = useMemo(() => {
    if (!areaId) return null;
    const ids = getDescendantIds(areas, areaId);
    ids.add(areaId);
    return [...ids];
  }, [areas, areaId]);

  // Copies are area-scoped server-side; year + search filter client-side for stable facets
  // and instant response (mirrors the stamp picker).
  const { data: copies = [], isLoading } = useSellableCopies(
    collectionId,
    lotId,
    { areaIds, year: null, search: "", stampId, conditionId, excludeIds },
    true
  );

  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);

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
      // Match catalog numbers on their normalized key (vendor abbreviation + area prefix +
      // number) so a prefixed query resolves in any spacing — "Mi PL 200", "MiPL200",
      // "PL200", or bare "200" all hit the same copy (#146), mirroring the inventory list.
      const vm = c.areaId ? vendorMapByArea.get(c.areaId) : undefined;
      const keys = c.catalogNumbers.map((cn) => {
        const v = vm?.get(cn.catalogVendorId);
        return catalogMatchKey(v?.vendorAbbreviation ?? "", v?.prefix, cn.number);
      });
      return catalogKeyMatches(raw, keys);
    });
  }, [copies, year, search, vendorMapByArea]);

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

  const count = selected.size;

  // Certificate warning (not a block): adding these copies would leave the quantity lot with
  // more than one distinct certificate status among its interchangeable units.
  const certWarning = useMemo(() => {
    if (!existingCertKeys) return false; // not the quantity-lot copy flow
    const certs = new Set<string>(existingCertKeys);
    for (const c of copies) {
      if (selected.has(c.id)) certs.add(c.certificateStatusId ?? "");
    }
    return certs.size > 1;
  }, [existingCertKeys, copies, selected]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title={title}
      onClose={onClose}
      maxWidth="min(94vw, 80rem)"
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
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by stamp, issue, or catalog number…"
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
                  ? "No copies available to add. Copies must be marked For sale and delivered (in hand)."
                  : "No copies match your filter."}
              </p>
            ) : (
              visibleCopies.map((item, i) => {
                const checked = selected.has(item.id);
                const primaryVendorId = item.areaId ? (primaryVendorByArea.get(item.areaId) ?? null) : null;
                const vendorMap = (item.areaId ? vendorMapByArea.get(item.areaId) : undefined) ?? new Map();
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      paddingLeft: "1rem",
                      background: checked ? "var(--color-accent-soft)" : undefined,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(item.id)}
                      aria-label="Select this copy"
                      style={{ flexShrink: 0 }}
                    />
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
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {certWarning && (
        <div
          style={{
            padding: "0.5rem 1rem",
            borderTop: "1px solid var(--color-warning-border, var(--color-border))",
            background: "var(--color-warning-soft)",
            color: "var(--color-warning)",
            fontSize: "0.8125rem",
          }}
        >
          ⚠ These copies have different certificate statuses. They can still be grouped, but the
          quantity lot won&apos;t be uniform on certificate.
        </div>
      )}

      <DialogFooter>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        <div style={{ position: "relative" }}>
          <ErrorBubble>{error}</ErrorBubble>
          <DialogPrimaryButton
            type="button"
            onClick={() => onConfirm([...selected])}
            disabled={isPending || count === 0}
          >
            {isPending
              ? "Adding…"
              : count > 0
                ? `Add ${count} ${count === 1 ? "copy" : "copies"}`
                : "Add copies"}
          </DialogPrimaryButton>
        </div>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
