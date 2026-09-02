"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ConfirmDialog } from "@/app/dialog-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { SEARCH_INPUT_STYLE, useDebouncedValue } from "@/app/c/[collectionSlug]/shared/autocomplete";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import { formatEntityNo } from "@/lib/quick-jump";
import type { OfferListItem } from "@/lib/offers";
import { type ManualOfferTarget, OFFER_STATES, OFFER_STATE_LABEL, isOfferState } from "@/lib/offer-rules";
import { usePersistedFlag } from "@/app/c/[collectionSlug]/shared/use-persisted-flag";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import {
  useOffersInfinite,
  useOfferPlatforms,
  useOfferFilterCounts,
  useOffersSummary,
  useInvalidateOffers,
  type OfferFilters,
} from "./use-offers-query";
import { FilterChip, FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { offerListContextQuery } from "./list-context";
import { OffersSummaryBar } from "./offers-summary-bar";
import { OfferFormDialog } from "./offer-form-dialog";
import { DuplicateOfferDialog } from "./duplicate-offer-dialog";
import { SellOfferFlowDialog } from "./sell-offer-flow-dialog";
import { OfferRow } from "./offer-row";
import { QuickOfferFlow } from "./quick-offer-flow";
import { useLastUsedPlatform } from "./use-last-used-platform";
import { useLastOfferDefaults, offerDefaultsFromForm } from "./use-last-offer-defaults";
import { useInvalidatePurchases } from "@/app/c/[collectionSlug]/purchases/use-purchases-query";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { Icon } from "@/app/icons";
import { useToast } from "@/app/toast-provider";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; offer: OfferListItem }
  | { kind: "duplicate"; offer: OfferListItem }
  | { kind: "sell"; offer: OfferListItem }
  | { kind: "withdraw"; offer: OfferListItem }
  | { kind: "delete"; offer: OfferListItem }
  | { kind: "bulkWithdraw" }
  | { kind: "bulkDelete" }
  | { kind: "quickOffer" };

/** What a bulk run refused, named against the row it belongs to. Kept as a list rather than a
 * count: each refusal is fixed somewhere different — a sold set is removed on the offer's own
 * screen, a closed listing is nothing to withdraw at all — so "3 offers were skipped" is a number
 * with no next step behind it. */
interface BulkSkip {
  offerNo: number;
  message: string;
}

/** The bar's plain textual control (Clear) — a link in a row of buttons, since it undoes the
 * selection rather than acting on it. */
const LINK_BTN: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  textDecoration: "underline",
};

/** A bulk action in the selection bar. Both are destructive, so neither is drawn as the primary
 * button on the screen — the emphasis belongs to *New offer*, not to deleting a dozen listings. */
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

/** The stored value standing for the derived "needs action" overlay, which is not an `OfferState`
 *  and shares its slot with one (#325). No offer state can collide with it. */
const NEEDS_ACTION = "needsAction";

interface OffersListPanelProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  /** Today's date (server-computed), for the quick-sell flow's new-sale step (#225). */
  today: string;
  /** Taxonomy for the quick-offer flow's add-copy step (#241). */
  areas: CollectionAreaData[];
  locations: LocationData[];
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
}

export function OffersListPanel({
  collectionId,
  collectionSlug,
  baseCurrency,
  today,
  areas,
  locations,
  conditions,
  certificateStatuses,
}: OffersListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const { invalidateAll } = useInvalidateOffers();
  // Confirmation toasts (#541). Every action on this screen closes its dialog or menu and changes a
  // row that may well have just left the filter — the withdrawn offer under a "not closed" list, the
  // one just marked ready under a "preparing" chip — so the list itself cannot be the confirmation.
  const { toast } = useToast();
  // A first offer for a platform sets that platform's currency (#196); the platform picker reads the
  // currency from the cached contact search, so it must be invalidated too or the next create still
  // sees the platform as currency-less (#212).
  const { invalidateContacts } = useInvalidatePurchases();
  const { data: platforms = [] } = useOfferPlatforms(collectionId);
  const [lastPlatformId, rememberPlatform] = useLastUsedPlatform(collectionId);
  const [, rememberOfferDefaults] = useLastOfferDefaults(collectionId);

  // Remembered filter selections (#325), per collection, mirroring the catalog-vendor and
  // "not offered on" filters (#115, #275): the URL param wins whenever the URL carries one, so a
  // shared link still means exactly what it says, and a fresh visit falls back to what was last
  // picked here. Every change writes both, so clearing a filter clears the memory of it too.
  //
  // State and "needs action" share one stored value because they are one choice in the toolbar —
  // picking either clears the other — and storing them apart would let the two disagree. The state
  // half is still *parsed* as a comma-separated set, even though the chips write one value since
  // #735: a value stored while #475's multi-select was in force, or a link somebody kept, must go on
  // meaning what it said. "needs action" stays a single value, being a derived overlay rather than a
  // state (ADR-0013 §4).
  const [storedPlatform, rememberPlatformFilter] = usePersistedCollectionValue(
    "offers-platform",
    collectionId
  );
  const [storedStatus, rememberStatusFilter] = usePersistedCollectionValue(
    "offers-status",
    collectionId
  );
  const [storedSearch, rememberSearch] = usePersistedCollectionValue("offers-search", collectionId);

  const statusFromUrl =
    searchParams.has("state") || searchParams.has("needsAction")
      ? searchParams.get("needsAction") === "1"
        ? NEEDS_ACTION
        : (searchParams.get("state") ?? "")
      : null;
  const status = statusFromUrl ?? storedStatus ?? "";
  const needsAction = status === NEEDS_ACTION;
  const states = useMemo(
    () => (needsAction ? [] : status.split(",").filter(isOfferState)),
    [needsAction, status]
  );

  // Only the *stored* platform is checked against the loaded list: one that has since been removed
  // would silently narrow the list to nothing, and unlike a link nobody typed it this time. A
  // platform named in the URL is left alone, as it always was.
  const platformFromUrl = searchParams.has("platform") ? (searchParams.get("platform") ?? "") : null;
  const platformId =
    (platformFromUrl ??
      (storedPlatform && platforms.some((p) => p.id === storedPlatform) ? storedPlatform : "")) ||
    undefined;

  // Seed a new offer's platform from the current filter, falling back to the last platform an offer
  // was created on (#241). Resolved against the loaded platforms so it carries the name + currency
  // the form needs; undefined until the list arrives or when neither is known.
  const preferredPlatform = useMemo(
    () =>
      platforms.find((p) => p.id === platformId) ??
      (lastPlatformId ? platforms.find((p) => p.id === lastPlatformId) : undefined),
    [platforms, platformId, lastPlatformId]
  );

  // Remembered client preference (#245): closed (sold / withdrawn) offers are hidden until opted in.
  const [includeClosed, setIncludeClosed] = usePersistedFlag(
    `stamporama:offers:includeClosed:${collectionId}`
  );

  // Search box (#465), remembered alongside the other filters and, like them, overridden by the URL
  // whenever it carries one — so a link to a searched list still means what it says.
  const search = (searchParams.has("search") ? searchParams.get("search") : storedSearch) || "";

  // Narrowed to the offers under the hammer (#215) when a link says so — the notification centre's
  // "bidding started" group (#481) is the one that does. URL-only and never remembered: it is where
  // a link landed the collector, not a filter they chose here, and a remembered one would go on
  // narrowing the list long after they had forgotten following it.
  const bidding = searchParams.get("bidding") === "1";

  // Auctions that ended with a bid and are waiting to be resolved (#490). URL-only, like the two
  // above: it is a batch of work to sit down to — and one that empties as it is done — not the shape
  // the list should still have tomorrow.
  const endedAuction = searchParams.get("endedAuction") === "1";

  // Listings the marketplace has already sold with no sale recorded here (#499). URL-only for the
  // same reason: it is a list that empties as it is worked through.
  const platformSale = searchParams.get("platformSale") === "1";

  // Live listings changed since they went up (#542). URL-only like the three above, and for exactly
  // their reason: it is a sitting of work — the offers to go and re-post — that empties as it is
  // done, not the shape the list should still have tomorrow.
  const listingOutOfDate = searchParams.get("listingOutOfDate") === "1";

  const filters: OfferFilters = useMemo(
    () => ({
      platformId,
      states,
      needsAction,
      bidding,
      endedAuction,
      platformSale,
      listingOutOfDate,
      includeClosed,
      search: search || undefined,
    }),
    [
      platformId,
      states,
      needsAction,
      bidding,
      endedAuction,
      platformSale,
      listingOutOfDate,
      includeClosed,
      search,
    ]
  );

  // What every row hands to the offer it opens (#429): the filters this list is showing, so the
  // detail screen can step through them instead of sending the collector back here each time.
  const listContextQuery = useMemo(() => offerListContextQuery(filters), [filters]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/offers${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  // Debounced search box (#465), mirroring the sales list's (#193): settle the local input, then
  // push it to the URL and the remembered value together, skipping the initial mount so an empty
  // box never clears what was remembered before it is typed in.
  const [localSearch, setLocalSearch] = useState(search);
  const debouncedSearch = useDebouncedValue(localSearch);
  const updateParamsRef = useRef(updateParams);
  useEffect(() => {
    updateParamsRef.current = updateParams;
  });
  const rememberSearchRef = useRef(rememberSearch);
  useEffect(() => {
    rememberSearchRef.current = rememberSearch;
  });
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    rememberSearchRef.current(debouncedSearch);
    updateParamsRef.current({ search: debouncedSearch });
  }, [debouncedSearch]);

  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } = useOffersInfinite(
    collectionId,
    filters
  );
  // Faceted counts for the toolbar (#332): each control's count ignores its own dimension, so a
  // badge says how many offers clicking it would show. Absent until the first fetch lands — the
  // chips render without badges rather than flashing zeros.
  const { data: counts } = useOfferFilterCounts(collectionId, filters);
  // Aggregate figures over the same filtered set (#317), read whole rather than summed from the
  // loaded pages — a total that grows as you scroll would be worse than none.
  const { data: summary } = useOffersSummary(collectionId, filters);
  const rows = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  /* ── Bulk selection ────────────────────────────────────────────────────────────────────────────
   * The copies list's rule (#373), applied to offers: the selection is keyed on the filter set and
   * dropped when it changes (adjusted during render, never a `setState` in an effect), because a
   * selection surviving a filter change would act on offers no longer on screen — and here that
   * means withdrawing or deleting listings nobody is looking at.
   *
   * It holds the **offers themselves**, not their ids: a bulk run reports its refusals per offer,
   * and the row it names has to be identifiable after the list has been invalidated and refetched.
   *
   * *Select all* covers the **loaded** rows and says so. The list is cursor-paginated, so "all" over
   * the whole filtered set would be a promise about offers that have not been fetched — a click that
   * deletes three hundred listings, most of which were never on screen.
   */
  const filterSignature = JSON.stringify(filters);
  const [selection, setSelection] = useState<{ sig: string; offers: Map<string, OfferListItem> }>({
    sig: filterSignature,
    offers: new Map(),
  });
  // What the last bulk run could not do. Cleared whenever a new selection question is asked.
  const [bulkSkips, setBulkSkips] = useState<BulkSkip[]>([]);
  if (selection.sig !== filterSignature) {
    setSelection({ sig: filterSignature, offers: new Map() });
    setBulkSkips([]);
  }
  const selectedOffers = useMemo(() => [...selection.offers.values()], [selection]);
  const toggleSelected = useCallback((offer: OfferListItem) => {
    setSelection((prev) => {
      const offers = new Map(prev.offers);
      if (offers.has(offer.id)) offers.delete(offer.id);
      else offers.set(offer.id, offer);
      return { sig: prev.sig, offers };
    });
  }, []);
  const clearSelection = useCallback(() => {
    setSelection((prev) => ({ sig: prev.sig, offers: new Map() }));
    setBulkSkips([]);
  }, []);
  const allLoadedSelected = rows.length > 0 && rows.every((r) => selection.offers.has(r.id));
  const toggleAllLoaded = useCallback(() => {
    setBulkSkips([]);
    setSelection((prev) => ({
      sig: prev.sig,
      offers: rows.every((r) => prev.offers.has(r.id))
        ? new Map()
        : new Map(rows.map((r) => [r.id, r] as const)),
    }));
  }, [rows]);

  /** Withdraw or delete the whole selection. One path for both, because the two differ only in the
   * verb and the action they call: the refusal handling, the toast and what stays ticked afterwards
   * are the same question either way. */
  function runBulk(kind: "withdraw" | "delete") {
    const batch = selectedOffers;
    const noById = new Map(batch.map((o) => [o.id, o.offerNo] as const));
    setActionError(undefined);
    startTransition(async () => {
      const { withdrawOffersAction, deleteOffersAction } = await import("@/app/actions/offers");
      const result =
        kind === "withdraw"
          ? await withdrawOffersAction(batch.map((o) => o.id))
          : await deleteOffersAction(batch.map((o) => o.id));
      invalidateAll(collectionId);
      const skips = result.skipped.map((s) => ({
        offerNo: noById.get(s.offerId) ?? 0,
        message: s.message,
      }));
      setBulkSkips(skips);
      // Nothing happened at all: the dialog stays open with the reason in it. A blocking failure
      // belongs next to the decision that caused it, not in a strip behind a dialog nobody closed.
      if (result.succeeded.length === 0) {
        setActionError(
          result.skipped.length === 1
            ? result.skipped[0].message
            : `None of these ${batch.length} offers could be ${kind === "withdraw" ? "withdrawn" : "deleted"}.`
        );
        return;
      }
      setDialog({ kind: "none" });
      setActionError(undefined);
      // Exactly the refused offers stay ticked — they are what is left to deal with, and the ones
      // that went through are gone or closed. A selection left whole after the fact is an invitation
      // to run it a second time.
      const refused = new Set(result.skipped.map((s) => s.offerId));
      setSelection((prev) => ({
        sig: prev.sig,
        offers: new Map([...prev.offers].filter(([id]) => refused.has(id))),
      }));
      const n = result.succeeded.length;
      toast({
        message:
          kind === "withdraw"
            ? `${n} offer${n === 1 ? "" : "s"} withdrawn`
            : `${n} offer${n === 1 ? "" : "s"} deleted — their copies are still in inventory`,
      });
    });
  }

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setActionError(undefined);
    }
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    setActionError(undefined);
    invalidateAll(collectionId);
  }

  function setOfferBidding(offer: OfferListItem, value: boolean) {
    setActionError(undefined);
    startTransition(async () => {
      const { setOfferInActiveBiddingAction } = await import("@/app/actions/offers");
      const result = await setOfferInActiveBiddingAction(offer.id, value);
      if (result.status === "success") {
        invalidateAll(collectionId);
        toast({
          message: value
            ? `Offer #${offer.offerNo} marked in active bidding — take its copies off other platforms`
            : `Offer #${offer.offerNo} is no longer in active bidding`,
          href: `/c/${collectionSlug}/offers/${offer.id}`,
          linkLabel: "Open offer",
        });
      } else setActionError(result.message);
    });
  }

  function setOfferState(offer: OfferListItem, next: ManualOfferTarget) {
    if (next === "withdrawn") {
      setDialog({ kind: "withdraw", offer });
      return;
    }
    setActionError(undefined);
    startTransition(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offer.id, next);
      if (result.status === "success") {
        invalidateAll(collectionId);
        toast({
          message: `Offer #${offer.offerNo} is now ${OFFER_STATE_LABEL[next].toLowerCase()}`,
          href: `/c/${collectionSlug}/offers/${offer.id}`,
          linkLabel: "Open offer",
        });
      } else setActionError(result.message);
    });
  }

  const hasActiveFilters =
    !!platformId ||
    states.length > 0 ||
    needsAction ||
    bidding ||
    endedAuction ||
    platformSale ||
    listingOutOfDate ||
    !!search;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Aggregate figures over the filtered set (#317) */}
      <OffersSummaryBar summary={summary} collectionId={collectionId} />

      {/* Toolbar — pinned while the rows scroll under it (#358). Unlike the card-embedded
          `ListToolbar`, this one sits on the page, so it carries the page background and a
          little padding of its own to stay opaque. */}
      <div
        style={{
          ...STICKY_TOOLBAR_STYLE,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          padding: "0.5rem 0",
          background: "var(--color-bg-page)",
        }}
      >
        {/* The filter half **grows into the row** (#558). Without `flex: 1 1 auto` it sat at its
            content width while the actions beside it took every spare pixel as an auto margin — so
            the filters wrapped onto a second line with a visible gap of unused space to their
            right, which reads as a toolbar breaking for no reason. Growing hands that space to the
            controls that can use it, and `minWidth: 0` lets the half shrink below its content when
            the row really is full, which is when wrapping is the honest answer. */}
        <div style={{ display: "flex", flex: "1 1 auto", minWidth: 0, gap: "0.375rem", alignItems: "center", flexWrap: "wrap" }}>
          {/* Find one offer among hundreds by what is known about it (#465): its title, its own
              number, a catalog number or filing ref of a copy in it, or the marketplace link a sale
              notification carried. Server-side — the list is cursor-paginated, so it cannot be a
              client facet. */}
          <div style={{ position: "relative", flex: "0 1 18rem", minWidth: "11rem" }}>
            <input
              type="text"
              placeholder="Search title, #no, link, catalog no, ref…"
              aria-label="Search offers"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              style={{ ...SEARCH_INPUT_STYLE, width: "100%", paddingRight: "1.75rem" }}
            />
            {localSearch && (
              <Tooltip
                content="Clear search"
                style={{
                  position: "absolute",
                  right: "0.375rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                }}
              >
                <button
                  type="button"
                  onClick={() => setLocalSearch("")}
                  aria-label="Clear search"
                  tabIndex={-1}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--color-text-muted)",
                    fontSize: "0.75rem",
                    padding: "0 0.25rem",
                  }}
                >
                  <Icon name="close" size="sm" />
                </button>
              </Tooltip>
            )}
          </div>
          <select
            aria-label="Filter by platform"
            value={platformId ?? ""}
            onChange={(e) => {
              rememberPlatformFilter(e.target.value);
              updateParams({ platform: e.target.value });
            }}
            style={{ ...FILTER_CONTROL_STYLE, cursor: "pointer" }}
          >
            <option value="">
              {counts ? `All platforms (${counts.total})` : "All platforms"}
            </option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {counts ? `${p.name} (${counts.platforms[p.id] ?? 0})` : p.name}
              </option>
            ))}
          </select>
          <span style={{ width: "1px", height: "1.25rem", background: "var(--color-border)", margin: "0 0.25rem" }} />
          {/* Single-select (#735, reverting #475's multi-select on this list only): a chip switches
              the list to its own state, and clicking the active one clears it. The offers list is
              worked through **a state at a time** — what is preparing, then what is ready to post —
              so a click that *added* to a set left the collector clearing the previous chip by hand
              on the way to every one of those passes. The sale list keeps multi-select, which is the
              divergence #475 got wrong: a sale is read as a batch of work spanning states, while an
              offer's state is where in the pipeline it has got to. `states` stays a *list* on
              `OfferFilters` and in the list context — one axis keeps one filter on it — so a
              remembered or linked multi-value still reads, and simply collapses to one on the next
              click. Picking a state still clears "needs action", which is an overlay rather than a
              state (ADR-0013 §4). */}
          {OFFER_STATES.map((value) => {
            // Lit for any state in force, so a link or a remembered value carrying two of them is
            // described honestly rather than showing a narrowed list with no chip on.
            const active = states.includes(value);
            const onlyThis = active && states.length === 1;
            return (
              <FilterChip
                key={value}
                label={OFFER_STATE_LABEL[value]}
                count={counts ? (counts.states[value] ?? 0) : undefined}
                active={active}
                onClick={() => {
                  // Clicking one of two lit chips *replaces* the pair rather than subtracting from
                  // it — subtracting is the multi-select behaviour this reverts. Only the sole
                  // active chip clears.
                  const next = onlyThis ? "" : value;
                  rememberStatusFilter(next);
                  updateParams({ state: next, needsAction: "" });
                }}
              />
            );
          })}
          <span style={{ width: "1px", height: "1.25rem", background: "var(--color-border)", margin: "0 0.25rem" }} />
          {/* The overlay for **a live listing that is wrong** — both ways it can be (ADR-0013 §4,
              #542): it holds a set that sold elsewhere, or it has changed since it was posted and
              nothing has been pushed back to the platform. One chip, because it is one question. */}
          <Tooltip content="Live listings that need putting right — holding a set that sold elsewhere, or changed since they were posted">
            <FilterChip
              label="Needs action"
              count={counts?.needsAction}
              // Anything needing action is a problem on a live platform, so the chip alarms until
              // the count is back to zero. The badge is the *union*, so it alarms for a changed
              // listing too — which is the point of folding the two together: one number to clear.
              alarm={!!counts && counts.needsAction > 0}
              active={needsAction}
              onClick={() => {
                rememberStatusFilter(needsAction ? "" : NEEDS_ACTION);
                updateParams({ needsAction: needsAction ? "" : "1", state: "" });
              }}
            />
          </Tooltip>
          {/* Auctions whose moment has passed with a bid on them and nothing recorded (#490).
              Beside "Needs action" because it is the same kind of thing — an overlay across states,
              and stock committed where the app cannot see it — and it alarms on the same terms:
              every one of these is a buyer waiting on a decision only the collector can make. */}
          <Tooltip content="Auctions that closed with a bid on them and have not been resolved — record the sale, or mark them unsold and relist">
            <FilterChip
              label="Ended auctions"
              count={counts?.endedAuction}
              alarm={!!counts && counts.endedAuction > 0}
              active={endedAuction}
              onClick={() => updateParams({ endedAuction: endedAuction ? "" : "1" })}
            />
          </Tooltip>
          {/* The end of the same road (#499): the marketplace has taken an order and the sale is not
              on the books here, so the copies are committed while every other listing holding them
              is still up. Beside the two above because it is the same kind of overlay, and the most
              committed of the three. */}
          <Tooltip content="Listings sold on a connected platform with no sale recorded here yet — record the sale, and take these copies off every other listing">
            <FilterChip
              label="Sold, not recorded"
              count={counts?.platformSale}
              alarm={!!counts && counts.platformSale > 0}
              active={platformSale}
              onClick={() => updateParams({ platformSale: platformSale ? "" : "1" })}
            />
          </Tooltip>
          {/* Only while a link has narrowed the list to the offers under the hammer (#481). It is
              shown *because* it is on: a filter arrived at by following a link and with no way back
              off it is a list quietly lying about what it holds. */}
          {bidding && (
            <FilterChip label="In bidding" active onClick={() => updateParams({ bidding: "" })} />
          )}
          {/* Likewise for the changed-since-listed narrowing (#542). It has **no chip of its own**:
              a listing changed after it was posted is the same category of problem as one holding a
              set that sold elsewhere — a live marketplace entry that is wrong and only the collector
              can put right — so *Needs action* selects both, and a second permanent control would
              have split one question across two. This one exists only while a link (the notification
              centre's own group) has narrowed the list to it, so the way back off it is visible. */}
          {listingOutOfDate && (
            <FilterChip
              label="Changed since listed"
              active
              onClick={() => updateParams({ listingOutOfDate: "" })}
            />
          )}
          <span style={{ width: "1px", height: "1.25rem", background: "var(--color-border)", margin: "0 0.25rem" }} />
          {/* Remembered toggle (#245): closed (sold / withdrawn) offers are hidden by default. */}
          <FilterChip
            label="Show sold/withdrawn"
            active={includeClosed}
            onClick={() => setIncludeClosed(!includeClosed)}
          />
        </div>

        <div style={{ marginLeft: "auto", flexShrink: 0, display: "flex", gap: "0.5rem" }}>
          {/* Post a prepared batch (#322). Carries the platform filter across: the workspace posts to
              one platform, and the one being looked at here is the one meant. */}
          <Link
            href={`/c/${collectionSlug}/offers/listing${platformId ? `?platform=${platformId}` : ""}`}
            title="Post the offers you have marked ready to their platform, one after another"
            style={{
              ...FILTER_CONTROL_STYLE,
              display: "inline-flex",
              alignItems: "center",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Bulk listing →
          </Link>
          {/* The other end of the lifecycle (#467): what has sold on Allegro and is still waiting to
              be recorded here. Beside Bulk listing because the two are the same step at opposite
              ends — posting a batch, and clearing what came back. */}
          <Link
            href={`/c/${collectionSlug}/offers/allegro`}
            title="Offers that have sold on Allegro with no sale recorded here yet"
            style={{
              ...FILTER_CONTROL_STYLE,
              display: "inline-flex",
              alignItems: "center",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Sold on Allegro →
          </Link>
          {/* Sell a new item end-to-end (#241): create the stamp, copy, and offer in one pass. */}
          <Tooltip content="Create the stamp, inventory copy, and offer in one flow">
            <button
              type="button"
              onClick={() => setDialog({ kind: "quickOffer" })}
              style={{
                ...FILTER_CONTROL_STYLE,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Sell a new item
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={() => setDialog({ kind: "add" })}
            style={{
              ...FILTER_CONTROL_STYLE,
              cursor: "pointer",
              fontWeight: 600,
              color: "#fff",
              background: "var(--color-action-primary)",
              border: "none",
              padding: "0.375rem 0.875rem",
            }}
          >
            New offer
          </button>
        </div>
      </div>

      {/* List */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "clip",
          flex: 1,
          minHeight: "20rem",
          background: "var(--color-bg-elevated)",
        }}
      >
        {isLoading && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            Loading offers…
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {search
              ? "No offers match your search."
              : needsAction
                ? "Nothing needs action — no live listing holds a set that sold elsewhere, and none has changed since it was posted."
                : hasActiveFilters
                ? "No offers match this filter."
                : "No offers yet. Create one and compose its sets from your inventory."}
          </div>
        )}

        {rows.length > 0 && (
          <>
            {/* The selection bar (bulk withdraw / delete). Always drawn while there are rows, not
                only once something is ticked: the select-all box lives in it, aligned with the
                rows' own gutter, and a bar that appears only after the first tick would leave the
                whole feature undiscoverable. The actions appear with the selection. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                padding: "0.5rem 1.25rem 0.5rem 0",
                borderBottom: "1px solid var(--color-border)",
                background: selectedOffers.length
                  ? "var(--color-accent-soft)"
                  : "var(--color-bg-elevated)",
              }}
            >
              <Tooltip
                content={
                  allLoadedSelected
                    ? "Deselect all"
                    : `Select the ${rows.length} offer${rows.length === 1 ? "" : "s"} loaded so far`
                }
                style={SELECT_STRIP}
              >
                <input
                  type="checkbox"
                  checked={allLoadedSelected}
                  // A partial selection is neither on nor off, and a box reading "off" over a list
                  // with twelve rows ticked is the one thing it must not say.
                  ref={(el) => {
                    if (el) el.indeterminate = selectedOffers.length > 0 && !allLoadedSelected;
                  }}
                  onChange={toggleAllLoaded}
                  aria-label="Select all loaded offers"
                  style={{ cursor: "pointer" }}
                />
              </Tooltip>
              {selectedOffers.length > 0 ? (
                <>
                  <span
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      color: "var(--color-accent)",
                    }}
                  >
                    {selectedOffers.length} offer{selectedOffers.length === 1 ? "" : "s"} selected
                  </span>
                  <button type="button" onClick={clearSelection} style={LINK_BTN}>
                    Clear
                  </button>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginLeft: "auto",
                    }}
                  >
                    <Tooltip content="Take these listings down. Withdrawn is final — to sell here again, create a new offer.">
                      <button
                        type="button"
                        onClick={() => {
                          setActionError(undefined);
                          setDialog({ kind: "bulkWithdraw" });
                        }}
                        disabled={isPending}
                        style={BULK_BTN}
                      >
                        <Icon name="withdraw" size="sm" /> Withdraw
                      </button>
                    </Tooltip>
                    <Tooltip content="Permanently remove these offers and their sets. The copies stay in your inventory.">
                      <button
                        type="button"
                        onClick={() => {
                          setActionError(undefined);
                          setDialog({ kind: "bulkDelete" });
                        }}
                        disabled={isPending}
                        style={{ ...BULK_BTN, color: "var(--color-error)" }}
                      >
                        <Icon name="delete" size="sm" /> Delete
                      </button>
                    </Tooltip>
                  </div>
                </>
              ) : (
                <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                  Select offers to withdraw or delete them together
                </span>
              )}
            </div>

            {/* What the last run refused, one line each (#323's rule): each is fixed somewhere
                different, so a count would be a number with no next step behind it. The offers
                named here are the ones still ticked. */}
            {bulkSkips.length > 0 && (
              <div
                role="status"
                style={{
                  padding: "0.5rem 1.25rem 0.5rem 2.5rem",
                  borderBottom: "1px solid var(--color-border)",
                  background: "var(--color-bg-page)",
                  fontSize: "0.8125rem",
                  color: "var(--color-warning)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
                }}
              >
                {bulkSkips.map((s) => (
                  <span key={s.offerNo}>
                    <strong style={{ fontWeight: 600 }}>{formatEntityNo(s.offerNo)}</strong>{" "}
                    {s.message}
                  </span>
                ))}
              </div>
            )}

            {rows.map((offer, idx) => (
              <OfferRow
                key={offer.id}
                offer={offer}
                collectionSlug={collectionSlug}
                listContextQuery={listContextQuery}
                isLast={idx === rows.length - 1 && !hasNextPage}
                onEdit={(row) => setDialog({ kind: "edit", offer: row })}
                onSetState={setOfferState}
                onDuplicate={(row) => setDialog({ kind: "duplicate", offer: row })}
                onSell={(row) => setDialog({ kind: "sell", offer: row })}
                onSetInActiveBidding={setOfferBidding}
                onDelete={(row) => setDialog({ kind: "delete", offer: row })}
                selection={{
                  selected: selection.offers.has(offer.id),
                  onToggle: toggleSelected,
                }}
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

      {/* Create / edit the offer header. */}
      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <OfferFormDialog
          collectionId={collectionId}
          baseCurrency={baseCurrency}
          offer={dialog.kind === "edit" ? dialog.offer : undefined}
          initialPlatform={dialog.kind === "add" ? preferredPlatform : undefined}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onSubmit={(fd) => {
            const submittedPlatformId = (fd.get("platformId") as string | null) ?? "";
            startTransition(async () => {
              if (dialog.kind === "add") {
                const { createOfferAction } = await import("@/app/actions/offers");
                const result = await createOfferAction(collectionId, fd);
                if (result.status === "success") {
                  if (submittedPlatformId) rememberPlatform(submittedPlatformId);
                  rememberOfferDefaults(offerDefaultsFromForm(fd));
                  invalidateAll(collectionId);
                  invalidateContacts(collectionId);
                  // Straight to the compose screen — a fresh offer has no sets yet.
                  router.push(`/c/${collectionSlug}/offers/${result.id}`);
                } else setActionError(result.message);
              } else if (dialog.kind === "edit") {
                const { updateOfferAction } = await import("@/app/actions/offers");
                const offerId = dialog.offer.id;
                const offerNo = dialog.offer.offerNo;
                const result = await updateOfferAction(collectionId, offerId, fd);
                if (result.status === "success") {
                  handleSuccess();
                  toast({
                    message: `Offer #${offerNo} saved`,
                    href: `/c/${collectionSlug}/offers/${offerId}`,
                    linkLabel: "Open offer",
                  });
                } else setActionError(result.message);
              }
            });
          }}
        />
      )}

      {/* Duplicate onto another platform (#200) */}
      {dialog.kind === "duplicate" && (
        <DuplicateOfferDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          baseCurrency={baseCurrency}
          source={{ id: dialog.offer.id, label: dialog.offer.label, setCount: dialog.offer.setCount, price: dialog.offer.price, currency: dialog.offer.currency }}
          onClose={closeDialog}
        />
      )}

      {/* Quick-sell (#225): record a sale straight from the offer list. */}
      {dialog.kind === "sell" && (
        <SellOfferFlowDialog
          collectionId={collectionId}
          collectionSlug={collectionSlug}
          baseCurrency={baseCurrency}
          today={today}
          offer={dialog.offer}
          onClose={closeDialog}
        />
      )}

      {/* Withdraw confirmation */}
      {dialog.kind === "withdraw" && (
        <ConfirmDialog
          title="Withdraw offer"
          message="This takes the listing down on the platform. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
          actionLabel="Withdraw"
          pendingLabel="Withdrawing…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { setOfferStateAction } = await import("@/app/actions/offers");
              const offerNo = dialog.offer.offerNo;
              const result = await setOfferStateAction(dialog.offer.id, "withdrawn");
              if (result.status === "success") {
                handleSuccess();
                // No link: a withdrawn offer is not somewhere the collector is being sent, and the
                // row is still in the list under "Show sold/withdrawn".
                toast({ message: `Offer #${offerNo} withdrawn` });
              } else setActionError(result.message);
            });
          }}
        />
      )}

      {/* Delete confirmation */}
      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete offer"
          message="This permanently removes the offer and its sets. The copies stay in your inventory. This cannot be undone."
          actionLabel="Delete offer"
          pendingLabel="Deleting…"
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const { deleteOfferAction } = await import("@/app/actions/offers");
              const offerNo = dialog.offer.offerNo;
              const result = await deleteOfferAction(dialog.offer.id);
              if (result.status === "success") {
                handleSuccess();
                // Nothing to link to — the record is gone. The copies staying put is the part worth
                // saying, because deleting a *listing* sounds like it might not be.
                toast({ message: `Offer #${offerNo} deleted — its copies are still in inventory` });
              } else setActionError(result.message);
            });
          }}
        />
      )}

      {/* Bulk withdraw / delete confirmation. Same words as the single-row dialogs above — the act
          is the same one, asked of a selection — with the count named in the title so what is about
          to happen is not a matter of remembering what was ticked. */}
      {(dialog.kind === "bulkWithdraw" || dialog.kind === "bulkDelete") && (
        <ConfirmDialog
          title={
            dialog.kind === "bulkWithdraw"
              ? `Withdraw ${selectedOffers.length} offer${selectedOffers.length === 1 ? "" : "s"}`
              : `Delete ${selectedOffers.length} offer${selectedOffers.length === 1 ? "" : "s"}`
          }
          message={
            dialog.kind === "bulkWithdraw"
              ? "This takes these listings down on their platforms. Withdrawn is final — to sell here again, create a new offer. The copies are untouched. An offer that is already closed is skipped and named."
              : "This permanently removes these offers and their sets. The copies stay in your inventory. This cannot be undone. An offer with a sold set is skipped and named — withdraw it instead."
          }
          actionLabel={dialog.kind === "bulkWithdraw" ? "Withdraw" : "Delete offers"}
          pendingLabel={dialog.kind === "bulkWithdraw" ? "Withdrawing…" : "Deleting…"}
          variant="destructive"
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={() => runBulk(dialog.kind === "bulkWithdraw" ? "withdraw" : "delete")}
        />
      )}

      {/* End-to-end quick-offer flow (#241): stamp + copy + offer in one pass. */}
      {dialog.kind === "quickOffer" && (
        <QuickOfferFlow
          collectionId={collectionId}
          areas={areas}
          locations={locations}
          conditions={conditions}
          certificateStatuses={certificateStatuses}
          baseCurrency={baseCurrency}
          initialPlatform={preferredPlatform}
          onPlatformUsed={rememberPlatform}
          onClose={closeDialog}
          onOfferDone={handleSuccess}
        />
      )}
    </div>
  );
}
