"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
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
import { getDescendantIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { useComposableCopies, useOfferCollisions } from "../use-offers-query";

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

interface ComposeSetDialogProps {
  collectionId: string;
  offerId: string;
  platformId: string;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Full **inventory picker** for composing an offer's sets (ADR-0013). Mirrors the Copies screen and
 * the old lot picker: an area sidebar + year facets on the left, a text-filterable flat list of
 * eligible copies (For sale, delivered, unsold, not already in this offer) on the right, each a
 * checkbox row rendered with `InventoryItemRow`. Selected copies go in either as **one set per
 * copy** (a quantity of singles) or **one set holding all** (a series). A non-blocking collision
 * warning shows when another active offer on this platform already lists a chosen copy.
 */
export function ComposeSetDialog({
  collectionId,
  offerId,
  platformId,
  areas,
  locations,
  baseCurrency,
  onClose,
  onDone,
}: ComposeSetDialogProps) {
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

  const [search, setSearch] = usePersistedSearch(`${collectionId}:offer-copies`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();

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

  const { data: copies = [], isLoading } = useComposableCopies(collectionId, offerId, areaIds, true);
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

  const selectedIds = useMemo(() => [...selected], [selected]);
  const { data: collisions = [] } = useOfferCollisions(
    collectionId,
    selectedIds,
    platformId,
    offerId,
    selectedIds.length > 0
  );

  const multi = selectedIds.length > 1;

  function submit(perCopy: boolean) {
    if (selectedIds.length === 0) {
      setError("Pick at least one copy.");
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const { addOfferSetAction } = await import("@/app/actions/offers");
      const result = await addOfferSetAction(offerId, selectedIds, { perCopy: multi ? perCopy : false });
      if (result.status === "success") onDone();
      else setError(result.message);
    });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell title="Add set" onClose={onClose} maxWidth="min(94vw, 80rem)" height="min(90vh, 60rem)">
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
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0, borderLeft: "1px solid var(--color-border)" }}>
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--color-text-secondary)", whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer" }}>
              <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} disabled={visibleCopies.length === 0} />
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
                  ? "No copies available to add. Copies must be For sale and delivered (in hand), unsold, and not already in this offer."
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
                    <input type="checkbox" checked={checked} onChange={() => toggle(item.id)} aria-label="Select this copy" style={{ flexShrink: 0 }} />
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

      {collisions.length > 0 && (
        <div style={{ padding: "0.5rem 1rem", borderTop: "1px solid var(--color-warning-border, var(--color-border))", background: "var(--color-warning-soft)", color: "var(--color-warning)", fontSize: "0.8125rem" }}>
          ⚠ This platform already has an active offer sharing a copy — {collisions.map((c) => c.offerLabel).join(", ")}. You can still add it, but keep at most one active listing per copy on a platform.
        </div>
      )}

      <DialogFooter>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        <div style={{ position: "relative", display: "flex", gap: "0.5rem" }}>
          <ErrorBubble>{error}</ErrorBubble>
          {/* Single copy → one plain Add. Several → two ways to add them: as a quantity of
              separate single-copy sets, or as one set sold together (a series). */}
          {multi ? (
            <>
              <DialogSecondaryButton onClick={() => submit(false)} disabled={isPending}>
                {isPending ? "Adding…" : `Add as one set`}
              </DialogSecondaryButton>
              <DialogPrimaryButton type="button" onClick={() => submit(true)} disabled={isPending}>
                {isPending ? "Adding…" : `Add as ${selectedIds.length} sets`}
              </DialogPrimaryButton>
            </>
          ) : (
            <DialogPrimaryButton type="button" onClick={() => submit(false)} disabled={isPending || selectedIds.length === 0}>
              {isPending ? "Adding…" : "Add copy"}
            </DialogPrimaryButton>
          )}
        </div>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
