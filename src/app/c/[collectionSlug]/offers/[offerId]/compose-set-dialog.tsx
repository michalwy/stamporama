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
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import { useTitleLanguages } from "@/app/c/[collectionSlug]/shared/use-title-languages";
import { TitlePreviewText, TitleFallbackNote } from "@/app/c/[collectionSlug]/shared/title-preview";
import {
  TranslationGapsPanel,
  TranslationGapPopover,
} from "@/app/c/[collectionSlug]/shared/translation-gaps";
import { languageLabel, normalizeLanguage } from "@/lib/languages";
import type { OfferTitlePreview } from "@/lib/offers";
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
  /** The platform's listing language (#293) — the language selector's default (#297). */
  platformTitleLanguage: string | null;
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
 *
 * With a title template configured, the footer previews the title the selection will be given and
 * (once the collection has more than one listing language) lets that one add be generated in
 * another language than the platform's (#297). The choice is not stored — only the titles it
 * produced, which stay editable (#209).
 */
export function ComposeSetDialog({
  collectionId,
  offerId,
  platformId,
  platformTitleLanguage,
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

  const areaIds = useMemo(() => {
    if (!areaId) return null;
    const ids = getDescendantIds(areas, areaId);
    ids.add(areaId);
    return [...ids];
  }, [areas, areaId]);

  const { data: copies = [], isLoading } = useComposableCopies(collectionId, offerId, areaIds, true);
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
  const { data: collisions = [] } = useOfferCollisions(
    collectionId,
    selectedIds,
    platformId,
    offerId,
    selectedIds.length > 0
  );

  const multi = selectedIds.length > 1;

  // Title language for this add (#297). The collection's languages come from its platforms; when
  // there is only the default one there is nothing to choose and no selector renders. "" means the
  // collection's default language.
  const { titleLanguages } = useTitleLanguages(collectionId);
  const [language, setLanguage] = useState(() => normalizeLanguage(platformTitleLanguage) ?? "");
  const choosable = titleLanguages.length > 0;
  const languageOverride = choosable ? language || null : undefined;

  // Live preview of the title the selection will get, rendered by the server (only it can resolve
  // translated entity text). Debounced, because it re-runs on every checkbox click.
  const [rawPreview, setPreview] = useState<OfferTitlePreview | null>(null);
  // Bumped after a translation is saved (#299), so the preview re-runs against the new text even
  // though neither the selection nor the language changed.
  const [previewNonce, setPreviewNonce] = useState(0);
  // Dropping the last copy clears the preview a beat before the debounce would.
  const preview = selectedIds.length > 0 ? rawPreview : null;
  const previewKey = `${language}:${selectedIds.join(",")}`;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (selectedIds.length === 0) {
        setPreview(null);
        return;
      }
      const { previewOfferTitleAction } = await import("@/app/actions/offers");
      const result = await previewOfferTitleAction(offerId, selectedIds, languageOverride);
      if (!cancelled) setPreview(result);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `previewKey` stands in for the selection + language; `selectedIds` is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId, previewKey, languageOverride, previewNonce]);

  // The token whose translation the popover is editing (#300), with where its run sits on screen.
  const [fixing, setFixing] = useState<{ field: string; anchor: { left: number; bottom: number } } | null>(null);
  // Filling a gap changes entity data, not the offer — so the only thing to do afterwards is
  // re-render the title it feeds. The gap leaves the list because the new preview no longer reports
  // it, which is also what keeps the panel honest if a save is rejected.
  const refreshPreview = useCallback(() => setPreviewNonce((n) => n + 1), []);
  const previewLanguage = preview?.language ?? null;
  const fixingGaps = useMemo(
    () => (fixing ? (preview?.gaps ?? []).filter((g) => g.field === fixing.field) : []),
    [fixing, preview]
  );
  // A token whose gaps were all just filled has nothing left to edit, so the popover closes itself
  // as soon as the refreshed preview stops reporting them.
  const openFix = fixing && fixingGaps.length > 0 ? fixing : null;

  function submit(perCopy: boolean) {
    if (selectedIds.length === 0) {
      setError("Pick at least one copy.");
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const { addOfferSetAction } = await import("@/app/actions/offers");
      const result = await addOfferSetAction(offerId, selectedIds, {
        perCopy: multi ? perCopy : false,
        ...(languageOverride !== undefined ? { language: languageOverride } : {}),
      });
      if (result.status === "success") onDone();
      else setError(result.message);
    });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    // The translation popover (#300) is not an Escape layer — it keeps its own listener — so this
    // dialog steps out of the stack while it is up instead of closing out from under it.
    <DialogShell
      title="Add set"
      onClose={onClose}
      dismissable={openFix === null}
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
                  ? "No copies available to add. Copies must be For sale and delivered (in hand), unsold, and not already in this offer."
                  : "No copies match your filter."}
              </p>
            ) : (
              visibleCopies.map((item, i) => {
                const checked = selected.has(item.id);
                const primaryVendorId = item.areaId ? (primaryVendorByArea.get(item.areaId) ?? null) : null;
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

      {collisions.length > 0 && (
        <div style={{ padding: "0.5rem 1rem", borderTop: "1px solid var(--color-warning-border, var(--color-border))", background: "var(--color-warning-soft)", color: "var(--color-warning)", fontSize: "0.8125rem" }}>
          ⚠ This platform already has an active offer sharing a copy — {collisions.map((c) => c.offerLabel).join(", ")}. You can still add it, but keep at most one active listing per copy on a platform.
        </div>
      )}

      {/* Title preview for the current selection (#297/#298) — absent when the platform has no
          title template, since then the sets keep their derived copy labels (#209). */}
      {(preview || choosable) && (
        <div
          style={{
            padding: "0.625rem 1rem",
            borderTop: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "flex-start",
            gap: "1rem",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--color-text-muted)" }}>
              Title preview
            </span>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text-primary)", wordBreak: "break-word", marginTop: "0.25rem" }}>
              {preview ? (
                <TitlePreviewText
                  segments={preview.segments}
                  onFixField={
                    previewLanguage
                      ? (field, anchor) => setFixing({ field, anchor })
                      : undefined
                  }
                />
              ) : (
                <span style={{ color: "var(--color-text-muted)", fontWeight: 400, fontSize: "0.8125rem" }}>
                  {selectedIds.length === 0
                    ? "Pick a copy to see the title it will be given."
                    : "This platform has no title template — sets keep their copy label."}
                </span>
              )}
            </div>
            {preview && <TitleFallbackNote tokens={preview.fallbackTokens} />}
            {/* Fill the gaps right here (#299) — each saves on its own, so they survive Cancel. */}
            {preview && (
              <div style={{ marginTop: "0.5rem" }}>
                <TranslationGapsPanel
                  collectionId={collectionId}
                  language={previewLanguage}
                  gaps={preview.gaps}
                  onSaved={refreshPreview}
                  note="Saved straight away — they stay even if you cancel this dialog."
                />
              </div>
            )}
            {preview && multi && (
              <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
                Adding as separate sets titles each one from its own copy.
              </p>
            )}
          </div>
          {choosable && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
              Language
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                style={{
                  padding: "0.25rem 0.4rem",
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "0.375rem",
                  fontSize: "0.75rem",
                  color: "var(--color-text-primary)",
                  background: "var(--color-bg-elevated)",
                }}
              >
                <option value="">— default language —</option>
                {titleLanguages.map((code) => (
                  <option key={code} value={code}>
                    {languageLabel(code)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {openFix && previewLanguage && (
        <TranslationGapPopover
          collectionId={collectionId}
          language={previewLanguage}
          gaps={fixingGaps}
          anchor={openFix.anchor}
          onSaved={refreshPreview}
          onClose={() => setFixing(null)}
        />
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
