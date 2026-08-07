"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DialogShell,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  ErrorBubble,
} from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { ItemListItem } from "@/lib/items";
import { catalogMatchKey, catalogKeyMatches } from "@/lib/catalog-number";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { usePersistedSearch } from "@/app/c/[collectionSlug]/shared/use-persisted-search";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { InventoryItemRow } from "@/app/c/[collectionSlug]/inventory/inventory-item-row";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import { attachCopiesToLotAction } from "@/app/actions/purchases";
import { useInvalidateInventory } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { Icon } from "@/app/icons";

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

/** The copies this lot could take on (#388). Unpaginated — the dialog scopes by area/year and
 * filters the rest client-side, exactly as the offer composition picker does. */
function useAttachableCopies(collectionId: string, lotId: string, areaIds: string[] | null) {
  return useQuery<ItemListItem[]>({
    queryKey: ["purchases", collectionId, "attachable", lotId, areaIds] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const id of areaIds ?? []) params.append("areaId", id);
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
 * copy reads the same here as everywhere else.
 *
 * A copy that already belongs to **another** purchase is offered but never moved silently — the
 * footer names the orders being left and the move has to be confirmed, because reassigning a copy
 * changes what two purchases each say they bought. Copies frozen into a *closed* lot are not in
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  const { data: copies = [], isLoading } = useAttachableCopies(collectionId, lotId, areaIds);
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

  // The selected copies that would be taken off another purchase. Named rather than counted: the
  // question a collector needs answered before agreeing is *which* order loses them.
  const relinked = useMemo(
    () => copies.filter((c) => selected.has(c.id) && c.purchase),
    [copies, selected]
  );
  const relinkedOrders = useMemo(
    () => [...new Set(relinked.map((c) => c.purchase!.label))],
    [relinked]
  );
  const needsConfirm = relinked.length > 0;

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
                  ? "No copies available to attach. A copy already on this lot, or on a lot that has been closed, is not offered — reopen that lot first."
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

      {/* Re-linking is a real change to two orders, so it is confirmed rather than assumed. The
          warning names the purchases being left — a count would not tell the collector whether
          this is the mistake they are correcting. */}
      {needsConfirm && (
        <div
          style={{
            padding: "0.625rem 1rem",
            borderTop: "1px solid var(--color-warning-border, var(--color-border))",
            background: "var(--color-warning-soft)",
            color: "var(--color-warning)",
            fontSize: "0.8125rem",
          }}
        >
          <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={confirmRelink}
              onChange={(e) => setConfirmRelink(e.target.checked)}
              style={{ marginTop: "0.15rem", cursor: "pointer" }}
            />
            <span>
              <Icon name="warning" size="sm" /> {relinked.length}{" "}
              {relinked.length === 1 ? "copy belongs" : "copies belong"} to another purchase (
              {relinkedOrders.join(", ")}). Attaching{" "}
              {relinked.length === 1 ? "it" : "them"} here moves{" "}
              {relinked.length === 1 ? "it" : "them"} off that order. Confirm the move.
            </span>
          </label>
        </div>
      )}

      <DialogFooter>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        <div style={{ position: "relative", display: "flex", gap: "0.5rem" }}>
          <ErrorBubble>{error}</ErrorBubble>
          <DialogPrimaryButton
            type="button"
            onClick={submit}
            disabled={isPending || selectedIds.length === 0 || (needsConfirm && !confirmRelink)}
          >
            {isPending
              ? "Attaching…"
              : selectedIds.length > 1
                ? `Attach ${selectedIds.length} copies`
                : "Attach copy"}
          </DialogPrimaryButton>
        </div>
      </DialogFooter>
    </DialogShell>,
    document.body
  );
}
