"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { CollectionAreaData } from "@/lib/areas";
import type { PrepareOffer } from "@/lib/offers";
import { pricingReadyFor } from "@/lib/offer-rules";
import { isCoverReadinessBlocker } from "@/lib/offer-photo-readiness";
import { formatEntityNo } from "@/lib/quick-jump";
import { rowsInView, selectionInView } from "@/lib/rows-in-view";
import { keptAfterBulkRun, toggleRowsInView } from "@/lib/offer-selection";
import { AreaFilterSidebar } from "@/app/c/[collectionSlug]/shared/area-filter-sidebar";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { useListAreaYearFilter } from "@/app/c/[collectionSlug]/shared/use-list-area-year-filter";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { FilterChip, FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { CheckCell } from "@/app/c/[collectionSlug]/shared/cell-target";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { usePinnedSelectionBar } from "@/app/c/[collectionSlug]/shared/sticky-header";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import { Icon } from "@/app/icons";
import { useToast } from "@/app/toast-provider";
import {
  useInvalidateOffers,
  useOfferPlatforms,
  usePrepareOffersInfinite,
  type PrepareFilters,
} from "../use-offers-query";
import { OffersCoverWalk } from "../[offerId]/offer-cover-walk";
import { PrepareOfferRow } from "./prepare-offer-row";

// The Prepare screen (#1894). Preparing offers used to be priced one at a time — filter the Offers
// list to Preparing, open an offer, set its price, generate its photos, Mark ready, Next — which after
// a bulk generation (#1287) is hundreds of round trips. This is that work on one screen: each row's
// price typed in place with the figures it is weighed against beside it, and the ticked rows priced
// at their estimate or marked ready together.
//
// It is the Offers list's selection model (#1031), not a new one: a filter never unticks anything,
// and every bulk action reaches only the ticked rows in view (`rows-in-view.ts`, `offer-selection.ts`).
//
// Covers are checked from here too (#1942): a row opens its offer's walk, and *Check covers* walks the
// ticked offers' unchecked photos in one pass.

const BULK_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.3125rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  fontWeight: 600,
  cursor: "pointer",
};

const LINK_BTN: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  textDecoration: "underline",
};

/** What a bulk run could not do, named against its row (#323's rule). */
interface BulkSkip {
  offerNo: number;
  message: string;
}

/** The offer has no stated price yet — the figure *Use estimated price* fills. */
function unpriced(offer: PrepareOffer): boolean {
  return !pricingReadyFor(offer.listingType, "ready", offer.price, offer.startingPrice);
}

/** How many of the offer's photos its ready gate still wants checked for symbols (#1665). */
function uncheckedCovers(offer: PrepareOffer): number {
  return offer.readyBlockers.find(isCoverReadinessBlocker)?.count ?? 0;
}

export function PreparePanel({
  collectionId,
  collectionSlug,
  areas,
}: {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const { invalidateAll, settlePreparePrice } = useInvalidateOffers();

  const { data: platforms = [] } = useOfferPlatforms(collectionId);
  // The platform is the Offers list's own remembered filter (#325), as the bulk listing workspace's
  // is: the URL wins where it names one.
  const [storedPlatform, rememberPlatform] = usePersistedCollectionValue("offers-platform", collectionId);
  const platformFromUrl = searchParams.has("platform") ? (searchParams.get("platform") ?? "") : null;
  const platformId =
    (platformFromUrl ??
      (storedPlatform && platforms.some((p) => p.id === storedPlatform) ? storedPlatform : "")) ||
    undefined;
  // The Facebook group, only while the platform is Facebook (#1544) — URL-only, being a narrowing
  // of the platform rather than a filter of its own.
  const groupParam = searchParams.get("group") || undefined;
  const { data: groupChoices } = useQuery({
    queryKey: ["facebook-group-choices", collectionId, platformId ?? "", null],
    queryFn: async () => {
      const { facebookGroupChoicesAction } = await import("@/app/actions/facebook");
      return facebookGroupChoicesAction(collectionId, platformId!, null);
    },
    enabled: !!platformId,
    staleTime: 30_000,
  });
  const groups = groupChoices?.isFacebook ? groupChoices.groups : [];
  const groupId = platformId ? groupParam : undefined;
  const noPrice = searchParams.get("noPrice") === "1";

  // The area, the selection every list rail shares (#143, #844); the year half is not asked here.
  const { filterAreaId } = useListAreaYearFilter(collectionId, areas);
  const [includeSubAreas] = useSubtreeScope("area");
  const areaIds = useMemo(
    () => resolveAreaFilterIds(areas, filterAreaId, includeSubAreas) ?? undefined,
    [areas, filterAreaId, includeSubAreas]
  );

  const filters: PrepareFilters = useMemo(
    () => ({ platformId, groupId, areaIds, noPrice }),
    [platformId, groupId, areaIds, noPrice]
  );

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/offers/prepare${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = usePrepareOffersInfinite(
    collectionId,
    filters
  );
  const rows = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  /* ── Selection — the Offers list's (#1031) ─────────────────────────────────────────────────────── */
  const filterSignature = JSON.stringify(filters);
  const [selection, setSelection] = useState<Map<string, PrepareOffer>>(() => new Map());
  const selectedOffers = useMemo(() => [...selection.values()], [selection]);
  const inView = useMemo(() => rowsInView([rows.map((r) => r.id)]), [rows]);
  // The ticked offers in view, **as the rows now read** — a price typed since the tick counts.
  const selectedInView = useMemo(() => {
    const current = new Map(rows.map((r) => [r.id, r]));
    return selectionInView(selectedOffers, inView).map((o) => current.get(o.id) ?? o);
  }, [selectedOffers, inView, rows]);
  const hiddenSelectedCount = selectedOffers.length - selectedInView.length;
  const allLoadedSelected = rows.length > 0 && rows.every((r) => selection.has(r.id));

  const [bulkSkips, setBulkSkips] = useState<BulkSkip[]>([]);
  const [skipsSig, setSkipsSig] = useState(filterSignature);
  if (skipsSig !== filterSignature) {
    setSkipsSig(filterSignature);
    if (bulkSkips.length > 0) setBulkSkips([]);
  }

  const toggleSelected = useCallback((offer: PrepareOffer) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(offer.id)) next.delete(offer.id);
      else next.set(offer.id, offer);
      return next;
    });
  }, []);

  /** Ticked, without a price, and with an estimate to take — what *Use estimated price* acts on. */
  const estimable = selectedInView.filter((o) => unpriced(o) && o.suggestedPrice !== null);

  /** Ticked and with photos left to check, in the list's order — what *Check covers* walks (#1942). */
  const toCover = rows.filter((r) => selection.has(r.id) && uncheckedCovers(r) > 0);
  const coverCount = toCover.reduce((sum, o) => sum + uncheckedCovers(o), 0);
  const [walking, setWalking] = useState<{ id: string; offerNo: number }[] | null>(null);

  function applyEstimates() {
    const batch = estimable;
    if (batch.length === 0) return;
    const noById = new Map(batch.map((o) => [o.id, o.offerNo] as const));
    startTransition(async () => {
      const { applyEstimatedPricesAction } = await import("@/app/actions/offers");
      const result = await applyEstimatedPricesAction(
        collectionId,
        batch.map((o) => o.id)
      );
      invalidateAll(collectionId);
      setBulkSkips(result.skipped.map((s) => ({ offerNo: noById.get(s.offerId) ?? 0, message: s.message })));
      const n = result.succeeded.length;
      if (n > 0) toast({ message: `${n} offer${n === 1 ? "" : "s"} priced at ${n === 1 ? "its" : "their"} estimated value` });
    });
  }

  /** Mark the ticked offers in view ready (#1893): missing photos are generated first and the offer
   *  turns Ready once they are done; anything else is refused and named against its row. */
  function markReady() {
    const batch = selectedInView;
    if (batch.length === 0) return;
    const noById = new Map(batch.map((o) => [o.id, o.offerNo] as const));
    startTransition(async () => {
      const { markOffersReadyAction } = await import("@/app/actions/offers");
      const result = await markOffersReadyAction(batch.map((o) => o.id));
      invalidateAll(collectionId);
      setBulkSkips(result.skipped.map((s) => ({ offerNo: noById.get(s.offerId) ?? 0, message: s.message })));
      setSelection((prev) =>
        keptAfterBulkRun(
          prev,
          batch.map((o) => o.id),
          result.skipped.map((s) => s.offerId)
        )
      );
      const waiting = result.awaitingPhotos.length;
      const ready = result.succeeded.length - waiting;
      const parts = [
        ...(ready > 0 ? [`${ready} offer${ready === 1 ? "" : "s"} marked ready`] : []),
        ...(waiting > 0
          ? [`${waiting} ${waiting === 1 ? "turns" : "turn"} ready once ${waiting === 1 ? "its" : "their"} photos are done`]
          : []),
      ];
      if (parts.length > 0) toast({ message: parts.join(" · ") });
    });
  }

  /* ── Enter moves down the price column ─────────────────────────────────────────────────────────── */
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focusAfter = useCallback(
    (offerId: string) => {
      const index = rows.findIndex((r) => r.id === offerId);
      const next = index >= 0 ? rows[index + 1] : undefined;
      const el = next ? inputs.current.get(next.id) : undefined;
      if (el) {
        el.focus();
        el.select();
      } else {
        // The last loaded row: leaving the field is what saves it.
        inputs.current.get(offerId)?.blur();
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      }
    },
    [rows, hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  const hasFilters = !!platformId || !!filterAreaId || noPrice;

  // The selection bar pins at the top edge while the rows scroll (#1979) — nothing above it on
  // this screen is pinned, so there is no toolbar height to sit under.
  const { sentinelRef: selectionBarSentinelRef, style: selectionBarPinStyle } = usePinnedSelectionBar(0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", flex: 1 }}>
      {/* Toolbar: the platform (and its Facebook group), and only the offers with no price yet. */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
        <select
          aria-label="Filter by platform"
          value={platformId ?? ""}
          onChange={(e) => {
            rememberPlatform(e.target.value);
            updateParams({ platform: e.target.value, group: "" });
          }}
          style={{ ...FILTER_CONTROL_STYLE, cursor: "pointer" }}
        >
          <option value="">All platforms</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {groups.length > 0 && (
          <select
            aria-label="Filter by Facebook group"
            value={groupId ?? ""}
            onChange={(e) => updateParams({ group: e.target.value })}
            style={{ ...FILTER_CONTROL_STYLE, cursor: "pointer" }}
          >
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.archived ? `${g.name} (archived)` : g.name}
              </option>
            ))}
          </select>
        )}
        <FilterChip
          label="No price yet"
          active={noPrice}
          onClick={() => updateParams({ noPrice: noPrice ? "" : "1" })}
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 0,
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          flex: 1,
          minHeight: "24rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        <AreaFilterSidebar
          areas={areas}
          filterAreaId={filterAreaId}
          onNavigate={(id) => updateParams({ areaId: id ?? "all" })}
        />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            borderLeft: "1px solid var(--color-border)",
          }}
        >
          {/* Mounted for the screen's life, so the selection bar's pin can tell when it is stuck. */}
          <div ref={selectionBarSentinelRef} style={{ height: 0 }} aria-hidden />
          {isLoading && <Empty>Loading the offers being prepared…</Empty>}

          {!isLoading && rows.length === 0 && (
            <Empty>
              {hasFilters
                ? "No offer being prepared matches these filters."
                : "No offers are being prepared. New offers start here, and leave once they are marked ready."}
            </Empty>
          )}

          {rows.length > 0 && (
            <>
              {/* The selection bar, drawn while there are rows: the select-all box lives in it.
                  Pinned while the rows scroll (#1979). */}
              <div
                style={{
                  ...selectionBarPinStyle,
                  display: "flex",
                  alignItems: "center",
                  gap: "0.625rem",
                  padding: "0.5rem 1.25rem 0.5rem 0",
                  background: selectedOffers.length ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                }}
              >
                <Tooltip
                  content={
                    allLoadedSelected
                      ? "Deselect all"
                      : `Select the ${rows.length} offer${rows.length === 1 ? "" : "s"} loaded so far`
                  }
                  style={{ ...SELECT_STRIP, alignSelf: "stretch" }}
                >
                  <CheckCell bleed={{ top: "0.5rem", bottom: "0.5rem" }} style={{ flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={allLoadedSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selectedInView.length > 0 && !allLoadedSelected;
                      }}
                      onChange={() => {
                        setBulkSkips([]);
                        setSelection((prev) => toggleRowsInView(prev, rows));
                      }}
                      aria-label="Select all loaded offers"
                      style={{ cursor: "pointer" }}
                    />
                  </CheckCell>
                </Tooltip>
                {selectedOffers.length > 0 ? (
                  <>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--color-accent)" }}>
                      {hiddenSelectedCount > 0
                        ? `${selectedInView.length} of ${selectedOffers.length} ticked offers in view`
                        : `${selectedOffers.length} offer${selectedOffers.length === 1 ? "" : "s"} selected`}
                    </span>
                    {hiddenSelectedCount > 0 && (
                      <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                        {hiddenSelectedCount === 1
                          ? "The other one is still ticked and comes back when the filter is released."
                          : `The other ${hiddenSelectedCount} are still ticked and come back when the filter is released.`}
                      </span>
                    )}
                    <Tooltip
                      content={
                        hiddenSelectedCount > 0
                          ? `Untick all ${selectedOffers.length}, including the ${hiddenSelectedCount} the filter is hiding`
                          : ""
                      }
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelection(new Map());
                          setBulkSkips([]);
                        }}
                        style={LINK_BTN}
                      >
                        Clear
                      </button>
                    </Tooltip>
                    {selectedInView.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "auto" }}>
                        <Tooltip
                          content={
                            estimable.length > 0
                              ? "Give the ticked offers that have no price yet their estimated value — catalogue × the learned realisation ratio. Offers with a price keep it."
                              : "None of the ticked offers is without a price and has an estimated value to take."
                          }
                        >
                          <button
                            type="button"
                            onClick={applyEstimates}
                            disabled={isPending || estimable.length === 0}
                            style={{
                              ...BULK_BTN,
                              ...(estimable.length === 0 ? { cursor: "default", color: "var(--color-text-muted)" } : {}),
                            }}
                          >
                            Use estimated price{estimable.length > 0 ? ` (${estimable.length})` : ""}
                          </button>
                        </Tooltip>
                        <Tooltip
                          content={
                            toCover.length > 0
                              ? "Go through the ticked offers' photos not yet checked for symbols, offer after offer in one walk — covers carry on from photo to photo."
                              : "None of the ticked offers has photos left to check for symbols."
                          }
                        >
                          <button
                            type="button"
                            onClick={() => setWalking(toCover.map((o) => ({ id: o.id, offerNo: o.offerNo })))}
                            disabled={isPending || toCover.length === 0}
                            style={{
                              ...BULK_BTN,
                              ...(toCover.length === 0 ? { cursor: "default", color: "var(--color-text-muted)" } : {}),
                            }}
                          >
                            Check covers{coverCount > 0 ? ` (${coverCount})` : ""}
                          </button>
                        </Tooltip>
                        <Tooltip content="Mark the ticked offers ready. Missing or out-of-date photos are generated first, and the offer turns ready once they are done; an offer that cannot be readied is named below.">
                          <button type="button" onClick={markReady} disabled={isPending} style={BULK_BTN}>
                            <Icon name="check" size="sm" />{" "}
                            {hiddenSelectedCount > 0 ? `Mark ${selectedInView.length} ready` : "Mark ready"}
                          </button>
                        </Tooltip>
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                    Type each price — Enter moves to the next — or tick offers to price them at their
                    estimate or mark them ready together
                  </span>
                )}
              </div>

              {bulkSkips.length > 0 && (
                <div
                  role="status"
                  style={{
                    padding: "0.5rem 1.25rem 0.5rem 2.5rem",
                    borderTop: "1px solid var(--color-border)",
                    background: "var(--color-bg-page)",
                    fontSize: "0.8125rem",
                    color: "var(--color-warning)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  {bulkSkips.map((s, i) => (
                    <span key={`${s.offerNo}-${i}`}>
                      <strong style={{ fontWeight: 600 }}>{formatEntityNo(s.offerNo)}</strong> {s.message}
                    </span>
                  ))}
                </div>
              )}

              {rows.map((offer) => (
                <PrepareOfferRow
                  key={offer.id}
                  ref={(el) => {
                    if (el) inputs.current.set(offer.id, el);
                    else inputs.current.delete(offer.id);
                  }}
                  collectionId={collectionId}
                  collectionSlug={collectionSlug}
                  areas={areas}
                  offer={offer}
                  selected={selection.has(offer.id)}
                  onToggle={toggleSelected}
                  onEnter={() => focusAfter(offer.id)}
                  onSaved={(field, value) => void settlePreparePrice(collectionId, offer.id, field, value)}
                  onChanged={() => void invalidateAll(collectionId)}
                />
              ))}
              <InfiniteScrollSentinel
                onLoadMore={fetchNextPage}
                hasMore={!!hasNextPage}
                isLoading={isFetchingNextPage}
              />
            </>
          )}
        </div>
      </div>
      {walking && (
        <OffersCoverWalk
          collectionId={collectionId}
          offers={walking}
          onClose={() => setWalking(null)}
          onChanged={() => void invalidateAll(collectionId)}
        />
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>{children}</div>
  );
}
