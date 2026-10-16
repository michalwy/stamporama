"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ConfirmDialog } from "@/app/dialog-shell";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { STICKY_TOOLBAR_STYLE } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { useMeasuredHeight, usePinnedSelectionBar } from "@/app/c/[collectionSlug]/shared/sticky-header";
import {
  ListSearchBox,
  useDebouncedSearch,
} from "@/app/c/[collectionSlug]/shared/list-search-box";
import { SELECT_STRIP } from "@/app/c/[collectionSlug]/inventory/inventory-copy-list";
import { formatEntityNo } from "@/lib/quick-jump";
import { rowsInView, selectionInView } from "@/lib/rows-in-view";
import { keptAfterBulkRun, toggleRowsInView } from "@/lib/offer-selection";
import {
  assistantRunSummary,
  planAssistantRuns,
  type AssistantRunAct,
} from "@/lib/offer-assistant-runs";
import type { OfferListItem } from "@/lib/offers";
import {
  type ManualOfferTarget,
  OFFER_STATES,
  OFFER_STATE_LABEL,
  isFacebookPublish,
  isOfferState,
} from "@/lib/offer-rules";
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
import { parseFacebookPostNo } from "@/lib/facebook-post-rules";
import { offerListContextQuery } from "./list-context";
import { OffersSummaryBar } from "./offers-summary-bar";
import { OfferFormDialog } from "./offer-form-dialog";
import { DuplicateOfferDialog } from "./duplicate-offer-dialog";
import { SellOfferFlowDialog } from "./sell-offer-flow-dialog";
import { OfferRow } from "./offer-row";
import { ActivateOfferDialog, type PublishTarget } from "./activate-offer-dialog";
import { PostTogetherDialog } from "./post-together-dialog";
import { AddToPostDialog } from "./add-to-post-dialog";
import { QuickOfferFlow } from "./quick-offer-flow";
import { LISTING_ELEMENT_ID, useAssistantPresence } from "./assistant-handoff";
import { CLOSE_ELEMENT_ID } from "./assistant-close-handoff";
import { assistantHint } from "./assistant-listing";
import { useAssistantRuns } from "./use-assistant-runs";
import { useLastUsedPlatform } from "./use-last-used-platform";
import { useLastOfferDefaults, offerDefaultsFromForm } from "./use-last-offer-defaults";
import { useInvalidatePurchases } from "@/app/c/[collectionSlug]/purchases/use-purchases-query";
import type { StampConditionData } from "@/lib/conditions";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import { Icon } from "@/app/icons";
import { useToast } from "@/app/toast-provider";
import { CheckCell } from "@/app/c/[collectionSlug]/shared/cell-target";

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; offer: OfferListItem }
  | { kind: "duplicate"; offer: OfferListItem }
  | { kind: "sell"; offer: OfferListItem }
  | { kind: "withdraw"; offer: OfferListItem }
  /** Submitting a Ready offer for approval, or approving a Pending one (#1778): both ask for a link. */
  | { kind: "publish"; offer: OfferListItem; target: PublishTarget; approving: boolean }
  | { kind: "delete"; offer: OfferListItem }
  | { kind: "bulkWithdraw" }
  | { kind: "bulkDelete" }
  /** Several ticked Facebook offers becoming one post, which asks for its title (#1862). */
  | { kind: "postTogether" }
  /** Ticked Facebook offers joining a post not yet up as its next lots (#1870). */
  | { kind: "addToPost" }
  /** Update or close listings via the Assistant (#1969) — one row's, or the ticked ones it suits. */
  | { kind: "assistantRun"; act: AssistantRunAct; offers: OfferListItem[]; skipped: number }
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

/** A bulk action in the selection bar. None is drawn as the primary button on the screen — the
 * emphasis belongs to *New offer*, not to deleting a dozen listings. */
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

  // Active quick buys past their platform's refresh threshold (#1718). URL-only for the same reason:
  // it is the batch to go and post again, and it empties as that is done.
  const needsRefresh = searchParams.get("needsRefresh") === "1";

  // One multi-lot Facebook post's lots (#1842), narrowed to from a lot's *Post #N* chip or the post's
  // own screen. URL-only like the narrowings above: it is where a click took the collector, not the
  // shape the list should still have next time.
  const post = parseFacebookPostNo(searchParams.get("post"));

  const filters: OfferFilters = useMemo(
    () => ({
      platformId,
      states,
      needsAction,
      bidding,
      endedAuction,
      platformSale,
      listingOutOfDate,
      needsRefresh,
      includeClosed,
      search: search || undefined,
      post,
    }),
    [
      platformId,
      states,
      needsAction,
      bidding,
      endedAuction,
      platformSale,
      listingOutOfDate,
      needsRefresh,
      includeClosed,
      search,
      post,
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

  // Debounced search box (#465), now the shared one (#1091): settle the local input, then write it
  // to the URL and to the remembered value together. This screen kept its own copy of the box and
  // of the debounce — the copy `list-search-box.tsx` was extracted *from* (#484), and the last
  // tracked panel not to have moved onto it once #1055 took the sales list there.
  //
  // The migration is the fix rather than a tidy-up. `useState(search)` seeded the box once and
  // never looked again, which is enough only while the value in force comes from the URL: that is
  // there on the very first render, and a **remembered** one is not. `usePersistedCollectionValue`
  // reads through `useSyncExternalStore` with a null server snapshot (#844, `ui-patterns.md`), so
  // the first render after a reload sees no stored search whether or not one exists and the panel
  // adopts it a render later — leaving an empty field beside a narrowed list, which is exactly the
  // outcome #1028's rule forbids. `useDebouncedSearch` **follows** the value in force, with the
  // `pushedRef` guard that tells an echo of this box's own push apart from a change made
  // elsewhere.
  const [localSearch, setLocalSearch] = useDebouncedSearch(search, (value) => {
    rememberSearch(value);
    updateParams({ search: value });
  });

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
   * **A filter change no longer throws the selection away** (#1031). Until then the selection was
   * keyed on the filter set and reset during render, and the reason was written down beside it:
   *
   * > *"The copies list's rule (#373), applied to offers: the selection is keyed on the filter set
   * > and dropped when it changes (adjusted during render, never a `setState` in an effect),
   * > because a selection surviving a filter change would act on offers no longer on screen."*
   *
   * **That reasoning is superseded rather than overruled, and it cited a rule the copies list had
   * already stopped having** — #1021 removed exactly that reset there on 2026-09-10, on the user's
   * decision. Its fear was precise and it was right at the time: a surviving selection *would* have
   * withdrawn or deleted listings nobody was looking at. Under the rule the user chose it cannot —
   * the bar counts and acts on the ticked rows **in view** — so the hazard the reset existed to
   * prevent is gone, and what the reset was still costing was the whole selection every time a chip
   * was pressed or a character was typed into the search box. The rule and what it rejects are in
   * [`ui-patterns.md`](../../../../../docs/agents/ui-patterns.md). **A later reader finding a
   * selection that survives a filter change is meant to find this paragraph**: the hazard was
   * known, and it is handled by the narrowing below rather than by ignoring it.
   *
   * It holds the **offers themselves**, not their ids: a bulk run reports its refusals per offer,
   * and the row it names has to be identifiable after the list has been invalidated and refetched
   * — and now also after the filter has moved it off screen.
   *
   * *Select all* covers the **loaded** rows and says so. The list is cursor-paginated, so "all" over
   * the whole filtered set would be a promise about offers that have not been fetched — a click that
   * deletes three hundred listings, most of which were never on screen.
   */
  const filterSignature = JSON.stringify(filters);
  const [selection, setSelection] = useState<Map<string, OfferListItem>>(() => new Map());
  /** Every ticked offer, filter or no filter — what the bar counts *from*, and never what an
   * action is handed. */
  const selectedOffers = useMemo(() => [...selection.values()], [selection]);

  /**
   * The ticked offers **in view** — what the bar counts, labels and acts on (#1031).
   *
   * *In view* cannot be a predicate here the way it is on the card-scans strip: these filters are
   * resolved server-side (a search, a platform, a state chip), so nothing on the client can ask
   * whether an offer ticked ten minutes ago still matches. What the screen can say is which rows it
   * holds, and that is the same answer from the other end — a row is in view exactly when the
   * current filter set produced it.
   *
   * This list is flat and cursor-paginated, so it has **one reporter and its pages are right
   * here**: `rows` is the whole of what the screen holds. That is why it reuses `rows-in-view.ts`
   * — the arithmetic and the invariant that the narrowing never writes to the selection — and not
   * the Copies list's `use-rows-in-view.ts` register beside it, which exists to collect the members
   * a *group* row fetched through its own query (#398). There are no group rows here.
   *
   * The one thing it cannot see is the same one stated there: an offer matching the filter but
   * sitting in a page nobody has scrolled to is ticked, uncounted and out of reach until it loads.
   */
  const offersInView = useMemo(() => rowsInView([rows.map((r) => r.id)]), [rows]);
  const selectedInView = useMemo(
    () => selectionInView(selectedOffers, offersInView),
    [selectedOffers, offersInView]
  );
  /** Ticked, and hidden by the filter. The figure the bar's second line is about. */
  const hiddenSelectedCount = selectedOffers.length - selectedInView.length;

  // What the last bulk run could not do. Cleared whenever a new selection question is asked — and
  // on a filter change, which the selection itself now survives: the strip is a report of a run
  // against a list that is no longer on screen, while the ticks are the collector's own.
  const [bulkSkips, setBulkSkips] = useState<BulkSkip[]>([]);
  const [skipsSig, setSkipsSig] = useState(filterSignature);
  if (skipsSig !== filterSignature) {
    setSkipsSig(filterSignature);
    if (bulkSkips.length > 0) setBulkSkips([]);
  }

  const toggleSelected = useCallback((offer: OfferListItem) => {
    setSelection((prev) => {
      const offers = new Map(prev);
      if (offers.has(offer.id)) offers.delete(offer.id);
      else offers.set(offer.id, offer);
      return offers;
    });
  }, []);
  /** Clearing is the collector's own act and clears **everything**, rows the filter is hiding
   * included — unticking only what is on screen would empty the bar and leave ticks standing that
   * nothing on screen could then reach. The bar's hint says so while any are hidden. */
  const clearSelection = useCallback(() => {
    setSelection(new Map());
    setBulkSkips([]);
  }, []);
  const allLoadedSelected = rows.length > 0 && rows.every((r) => selection.has(r.id));
  // Ticks or unticks exactly the loaded rows and leaves the hidden ticks alone (`offer-selection.ts`
  // carries why replacing the whole map is wrong in both directions).
  const toggleAllLoaded = useCallback(() => {
    setBulkSkips([]);
    setSelection((prev) => toggleRowsInView(prev, rows));
  }, [rows]);

  /** Withdraw or delete the ticked offers **in view**. One path for both, because the two differ
   * only in the verb and the action they call: the refusal handling, the toast and what stays
   * ticked afterwards are the same question either way.
   *
   * The batch is `selectedInView` and not the whole selection (#1031): a bulk run must not take
   * down a listing the collector cannot see. Ticks the filter is hiding are simply not in it, and
   * are still ticked when the filter is released. */
  function runBulk(kind: "withdraw" | "delete") {
    const batch = selectedInView;
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
      // to run it a second time. A tick the filter was hiding stays too: it was never in the batch,
      // so the run settled nothing about it (`offer-selection.ts`).
      const refused = result.skipped.map((s) => s.offerId);
      setSelection((prev) =>
        keptAfterBulkRun(
          prev,
          batch.map((o) => o.id),
          refused
        )
      );
      const n = result.succeeded.length;
      toast({
        message:
          kind === "withdraw"
            ? `${n} offer${n === 1 ? "" : "s"} withdrawn`
            : `${n} offer${n === 1 ? "" : "s"} deleted — their copies are still in inventory`,
      });
    });
  }

  /** Mark the ticked **Preparing** offers in view ready (#1893), each as its own button would: one
   * whose photos are all that stands in the way has them generated and turns Ready once they are
   * done, anything else is refused and named against its row. Reversible, so no confirmation. Ticked
   * offers in other states are not in the batch and stay ticked — the run settled nothing about them. */
  function markReadyBulk() {
    const batch = selectedInView.filter((o) => o.state === "preparing");
    if (batch.length === 0) return;
    const noById = new Map(batch.map((o) => [o.id, o.offerNo] as const));
    setActionError(undefined);
    startTransition(async () => {
      const { markOffersReadyAction } = await import("@/app/actions/offers");
      const result = await markOffersReadyAction(batch.map((o) => o.id));
      invalidateAll(collectionId);
      setBulkSkips(
        result.skipped.map((s) => ({ offerNo: noById.get(s.offerId) ?? 0, message: s.message }))
      );
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

  /** Put the ticked Facebook offers **in view** into one post (#1544; ADR-0061 §2), numbered as
   * lots in the order they were ticked, under the title the dialog asked for (#1862). The server says
   * why when they cannot be — different groups, one already up, auctions and quick buys in a group
   * that keeps one type per post (#1671) — and nothing is written then, so the ticks stay to be
   * corrected; the dialog stays open with the reason. */
  function postTogether(title: string) {
    const batch = selectedInView;
    setActionError(undefined);
    startTransition(async () => {
      const { createFacebookPostAction } = await import("@/app/actions/facebook");
      const result = await createFacebookPostAction(
        collectionId,
        batch.map((o) => o.id),
        title
      );
      if (result.status === "error") {
        setActionError(result.message);
        return;
      }
      setDialog({ kind: "none" });
      invalidateAll(collectionId);
      setSelection((prev) => keptAfterBulkRun(prev, batch.map((o) => o.id), []));
      toast({
        message: `${batch.length} offers are now post #${result.postNo}, as lots 1–${batch.length}`,
        href: `/c/${collectionSlug}/offers/posts/${result.postNo}`,
        linkLabel: "Open post",
      });
    });
  }

  /** Add the ticked Facebook offers **in view** to a post not yet up, as its next lots in the order they
   * were ticked (#1870). An offer the post cannot take is turned away by number in the skipped strip and
   * stays ticked; the rest are added. When none can join, nothing is written and the dialog stays open
   * with the reason. */
  function addToPost(postId: string) {
    const batch = selectedInView;
    setActionError(undefined);
    startTransition(async () => {
      const { addFacebookLotsAction } = await import("@/app/actions/facebook");
      const result = await addFacebookLotsAction(
        postId,
        batch.map((o) => o.id)
      );
      if (result.status === "error") {
        setActionError(result.message);
        return;
      }
      setDialog({ kind: "none" });
      invalidateAll(collectionId);
      setBulkSkips(result.refused.map((r) => ({ offerNo: r.offerNo, message: r.reason })));
      setSelection((prev) =>
        keptAfterBulkRun(
          prev,
          batch.map((o) => o.id),
          result.refused.map((r) => r.offerId)
        )
      );
      const lots = result.added.map((a) => a.lotNo);
      const n = lots.length;
      toast({
        message: `${n === 1 ? "1 offer is" : `${n} offers are`} now post #${result.postNo}'s ${
          n === 1 ? `lot ${lots[0]}` : `lots ${lots[0]}–${lots[n - 1]}`
        }`,
        href: `/c/${collectionSlug}/offers/posts/${result.postNo}`,
        linkLabel: "Open post",
      });
    });
  }

  /* ── Update and close via the Assistant (#1969) ──────────────────────────────────────────────────
   * The offer screen's two handoffs, queued and run one after another from here. The rows show each
   * offer's progress; the list is re-read once the queue has drained rather than after every run, so
   * a closed offer stays on screen saying *Closed* instead of vanishing from a *Needs action* list
   * mid-run. */
  const assistantPresent = useAssistantPresence();
  const assistantUnavailable = assistantHint({ blockerCount: 0, present: assistantPresent, busy: false });
  const {
    listingNodeRef: assistantListingNodeRef,
    listingPayload: assistantListingPayload,
    closeNodeRef: assistantCloseNodeRef,
    closePayload: assistantClosePayload,
    ...assistantRuns
  } = useAssistantRuns(collectionId);
  const runByOffer = useMemo(
    () => new Map(assistantRuns.runs.map((r) => [r.offerId, r])),
    [assistantRuns.runs]
  );
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !assistantRuns.busy) {
      invalidateAll(collectionId);
      const summary = assistantRunSummary(assistantRuns.runs);
      if (summary) toast({ message: `Assistant: ${summary}` });
    }
    wasBusy.current = assistantRuns.busy;
  }, [assistantRuns.busy, assistantRuns.runs, collectionId, invalidateAll, toast]);

  /** One row's action: the one its *Needs action* calls for, or the other from its ⋮ — the
   *  collector's own choice, so it is not filtered by what the offer suits. */
  function askAssistantRun(offer: OfferListItem, act: AssistantRunAct) {
    setActionError(undefined);
    setDialog({ kind: "assistantRun", act, offers: [offer], skipped: 0 });
  }

  /** The ticked offers in view that `act` suits — a close where nothing is left to sell, an update
   *  otherwise — with the rest counted, so the confirmation can say how many of each. */
  function askAssistantRunBulk(act: AssistantRunAct) {
    const { run, skipped } = planAssistantRuns(selectedInView, act);
    if (run.length === 0) return;
    setActionError(undefined);
    setDialog({ kind: "assistantRun", act, offers: run, skipped });
  }

  function queueAssistantRuns(act: AssistantRunAct, offers: OfferListItem[]) {
    assistantRuns.enqueue(
      offers.map((o) => ({
        offerId: o.id,
        offerNo: o.offerNo,
        label: o.name ?? o.label,
        act,
        saleId: o.assistant?.closeSaleId ?? null,
        removeSetIds: act === "update" ? (o.assistant?.soldElsewhereSetIds ?? []) : [],
      }))
    );
    // Queued offers leave the selection — their rows now say how they are getting on; a ticked
    // offer the action did not suit stays ticked, untouched.
    setSelection((prev) => keptAfterBulkRun(prev, offers.map((o) => o.id), []));
    setBulkSkips([]);
    setDialog({ kind: "none" });
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
    // Waiting for approval records a link at both ends (#1778): the pending post's on the way in, the
    // final one on approval — so both go through the publish dialog rather than straight through. On
    // Facebook *Publish…* always does (#1847): the dialog is where live or waiting is chosen.
    if (
      next === "pending" ||
      (next === "active" && offer.state === "pending") ||
      isFacebookPublish(offer.state, next, offer.facebookGroupId !== null)
    ) {
      setDialog({
        kind: "publish",
        offer,
        target: next === "pending" ? "pending" : "active",
        approving: offer.state === "pending",
      });
      return;
    }
    setActionError(undefined);
    startTransition(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offer.id, next);
      if (result.status === "success") {
        invalidateAll(collectionId);
        toast({
          message: result.awaitingPhotos
            ? `Generating offer #${offer.offerNo}'s photos — it turns ready when they are done`
            : `Offer #${offer.offerNo} is now ${OFFER_STATE_LABEL[next].toLowerCase()}`,
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
    needsRefresh ||
    !!post ||
    !!search;

  // The selection bar pins right under the pinned toolbar (#1979), so ticking far down the list
  // keeps its actions in reach.
  const [toolbarRef, toolbarHeight] = useMeasuredHeight<HTMLDivElement>();
  const { sentinelRef: selectionBarSentinelRef, style: selectionBarPinStyle } = usePinnedSelectionBar(toolbarHeight);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Aggregate figures over the filtered set (#317) */}
      <OffersSummaryBar summary={summary} collectionId={collectionId} />

      {/* Toolbar — pinned while the rows scroll under it (#358). Unlike the card-embedded
          `ListToolbar`, this one sits on the page, so it carries the page background and a
          little padding of its own to stay opaque. */}
      <div
        ref={toolbarRef}
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
          <ListSearchBox
            value={localSearch}
            onChange={setLocalSearch}
            placeholder="Search title, #no, link, catalog no, ref…"
            label="Search offers"
          />
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
          <Tooltip content="Auctions that closed with a bid on them — on Facebook, every closed auction — and have not been resolved">
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
          {/* Quick buys up long enough on their platform to be seen by nobody (#1718) — posted again
              with *Repost* on the offer's screen. Not an alarm: nothing is wrong, it is housekeeping. */}
          <Tooltip content="Active quick buys up longer than their platform's refresh threshold — post them again to be seen">
            <FilterChip
              label="Needs refresh"
              count={counts?.needsRefresh}
              active={needsRefresh}
              onClick={() => updateParams({ needsRefresh: needsRefresh ? "" : "1" })}
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
          {/* Likewise while the list is narrowed to one Facebook post's lots (#1842). */}
          {post && <FilterChip label={`Post #${post}`} active onClick={() => updateParams({ post: "" })} />}
          <span style={{ width: "1px", height: "1.25rem", background: "var(--color-border)", margin: "0 0.25rem" }} />
          {/* Remembered toggle (#245): closed (sold / withdrawn) offers are hidden by default. */}
          <FilterChip
            label="Show sold/withdrawn"
            active={includeClosed}
            onClick={() => setIncludeClosed(!includeClosed)}
          />
        </div>

        <div style={{ marginLeft: "auto", flexShrink: 0, display: "flex", gap: "0.5rem" }}>
          {/* Price and ready the offers still being prepared (#1894), the platform filter carried
              across as Bulk listing's is. */}
          <Link
            href={`/c/${collectionSlug}/offers/prepare${platformId ? `?platform=${platformId}` : ""}`}
            style={{
              ...FILTER_CONTROL_STYLE,
              display: "inline-flex",
              alignItems: "center",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Prepare →
          </Link>
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
        {/* Mounted for the screen's life, so the selection bar's pin can tell when it is stuck. */}
        <div ref={selectionBarSentinelRef} style={{ height: 0 }} aria-hidden />
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
                whole feature undiscoverable. The actions appear with the selection.

                **It counts and acts on the ticked offers in view** (#1031), and it stays up while
                *anything* is ticked rather than while anything is in view — which this bar gets for
                free, being drawn whenever the list has rows at all. With every ticked offer hidden
                it reads `0 of 5` and keeps only *Clear*, which is the one place those five are
                visible and the one control that can still reach them.

                **It pins under the toolbar while the rows scroll** (#1979), so a tick far down the
                list is acted on where it was made rather than after a scroll back up. */}
            <div
              style={{
                ...selectionBarPinStyle,
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
                style={{ ...SELECT_STRIP, alignSelf: "stretch" }}
              >
                {/* The whole strip, to the bar's top and bottom edges, toggles it (#1589). */}
                <CheckCell bleed={{ top: "0.5rem", bottom: "0.5rem" }} style={{ flex: 1 }}>
                <input
                  type="checkbox"
                  checked={allLoadedSelected}
                  // A partial selection is neither on nor off, and a box reading "off" over a list
                  // with twelve rows ticked is the one thing it must not say. It asks the question
                  // **of the rows in view**, which is the set it acts on: over a filter hiding every
                  // ticked offer it reads plainly "off", because none of the rows under it is
                  // ticked. Asking it of the whole selection would report *partial* over a list
                  // whose every row is unticked — a box describing rows nobody is looking at.
                  ref={(el) => {
                    if (el) el.indeterminate = selectedInView.length > 0 && !allLoadedSelected;
                  }}
                  onChange={toggleAllLoaded}
                  aria-label="Select all loaded offers"
                  style={{ cursor: "pointer" }}
                />
                </CheckCell>
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
                    {hiddenSelectedCount > 0
                      ? `${selectedInView.length} of ${selectedOffers.length} ticked offers in view`
                      : `${selectedOffers.length} offer${selectedOffers.length === 1 ? "" : "s"} selected`}
                  </span>
                  {/* What became of the rest, in the two terms that stop the number reading as a
                      lost selection — still ticked, and back when the filter is released. Drawn
                      only while any are hidden, so a resting bar reads exactly as it always did. */}
                  {hiddenSelectedCount > 0 && (
                    <span style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                      {hiddenSelectedCount === 1
                        ? "The other one is still ticked and comes back when the filter is released."
                        : `The other ${hiddenSelectedCount} are still ticked and come back when the filter is released.`}
                    </span>
                  )}
                  {/* Clearing is the collector's own act and reaches the hidden rows too, so the
                      hint says so while there are any. Empty content draws no bubble, which is what
                      keeps this one code path rather than two. */}
                  <Tooltip
                    content={
                      hiddenSelectedCount > 0
                        ? `Untick all ${selectedOffers.length}, including the ${hiddenSelectedCount} the filter is hiding`
                        : ""
                    }
                  >
                    <button type="button" onClick={clearSelection} style={LINK_BTN}>
                      Clear
                    </button>
                  </Tooltip>
                  {/* Both actions act on the offers **in view**, which is why the pair is absent
                      when none of the ticked ones are. There is nothing that could honestly be
                      offered over listings the collector cannot see, and a dead button beside a
                      live *Clear* reads as a fault (#1031). Where the headline carries two figures
                      the buttons name the one they will act on, which a two-number headline can no
                      longer do on its own. */}
                  {selectedInView.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginLeft: "auto",
                      }}
                    >
                      {/* Several Facebook offers in one group become one post (#1544): offered
                          only while every ticked offer in view is a Facebook offer. */}
                      {selectedInView.length >= 2 &&
                        selectedInView.every((o) => o.facebookGroupId !== null) && (
                          <Tooltip content="One Facebook post holding these offers as lots, numbered in the order you ticked them — you give it a title.">
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(undefined);
                                setDialog({ kind: "postTogether" });
                              }}
                              disabled={isPending}
                              style={BULK_BTN}
                            >
                              Post together…
                            </button>
                          </Tooltip>
                        )}
                      {/* …or join a post already made, while it is not yet up (#1870): offered on the
                          same condition, from one offer up. */}
                      {selectedInView.every((o) => o.facebookGroupId !== null) && (
                        <Tooltip content="Add these offers to a Facebook post not yet up, as its next lots in the order you ticked them.">
                          <button
                            type="button"
                            onClick={() => {
                              setActionError(undefined);
                              setBulkSkips([]);
                              setDialog({ kind: "addToPost" });
                            }}
                            disabled={isPending}
                            style={BULK_BTN}
                          >
                            Add to post…
                          </button>
                        </Tooltip>
                      )}
                      {/* Mark ready (#1893), offered while a ticked offer in view is Preparing; it
                          runs on those alone, and says how many when the others are ticked too. */}
                      {(() => {
                        const preparing = selectedInView.filter((o) => o.state === "preparing").length;
                        if (preparing === 0) return null;
                        return (
                          <Tooltip content="Mark the ticked Preparing offers ready. Missing or out-of-date photos are generated first, and the offer turns ready once they are done.">
                            <button
                              type="button"
                              onClick={markReadyBulk}
                              disabled={isPending}
                              style={BULK_BTN}
                            >
                              <Icon name="check" size="sm" />{" "}
                              {preparing < selectedOffers.length ? `Mark ${preparing} ready` : "Mark ready"}
                            </button>
                          </Tooltip>
                        );
                      })()}
                      {/* Update and close via the Assistant (#1969), each offered while a ticked offer
                          in view is a *Needs action* listing it suits, and naming how many. */}
                      {(["close", "update"] as const).map((act) => {
                        const n = planAssistantRuns(selectedInView, act).run.length;
                        if (n === 0) return null;
                        return (
                          <Tooltip
                            key={act}
                            content={
                              assistantUnavailable ??
                              (act === "close"
                                ? "Close the ticked listings with nothing left to sell on Colnect, one after another, and withdraw them here. You confirm first."
                                : "Update the ticked listings that still have something to sell, one after another: sets sold elsewhere come off first, then each edit form opens on Colnect for you to save. You confirm first.")
                            }
                          >
                            <button
                              type="button"
                              onClick={() => askAssistantRunBulk(act)}
                              disabled={isPending || assistantUnavailable !== null}
                              style={{
                                ...BULK_BTN,
                                ...(assistantUnavailable !== null ? { opacity: 0.55, cursor: "default" } : {}),
                              }}
                            >
                              <Icon name={act === "close" ? "withdraw" : "refresh"} size="sm" />{" "}
                              {act === "close" ? `Close ${n} via Assistant` : `Update ${n} via Assistant`}
                            </button>
                          </Tooltip>
                        );
                      })}
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
                          <Icon name="withdraw" size="sm" />{" "}
                          {hiddenSelectedCount > 0
                            ? `Withdraw ${selectedInView.length}`
                            : "Withdraw"}
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
                          <Icon name="delete" size="sm" />{" "}
                          {hiddenSelectedCount > 0 ? `Delete ${selectedInView.length}` : "Delete"}
                        </button>
                      </Tooltip>
                    </div>
                  )}
                </>
              ) : (
                <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                  Select offers to mark ready, withdraw or delete them together
                </span>
              )}
            </div>

            {assistantRuns.runs.length > 0 && (
              <AssistantQueueStrip
                runs={assistantRuns}
                onCancel={assistantRuns.cancel}
                onStopWaiting={assistantRuns.stopWaiting}
                onClear={assistantRuns.clearFinished}
              />
            )}

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
                onNarrowToPost={post ? undefined : (postNo) => updateParams({ post: String(postNo) })}
                onAssistantRun={askAssistantRun}
                assistantRun={runByOffer.get(offer.id) ?? null}
                assistantUnavailable={assistantUnavailable}
                selection={{
                  selected: selection.has(offer.id),
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
          // An empty offer has no generated title, but the collector can still give it one (#1794).
          titleItemIds={dialog.kind === "add" ? [] : undefined}
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
          message={
            // A post still waiting for approval is taken back whole (#1779).
            dialog.offer.state === "pending" && dialog.offer.facebookPostId
              ? "This takes the post back from the group: every lot of it still waiting for approval is withdrawn with this one. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
              : "This takes the listing down on the platform. Withdrawn is final — to sell here again, create a new offer. The copies are untouched."
          }
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

      {dialog.kind === "publish" && (
        <ActivateOfferDialog
          offerLabel={dialog.offer.name ?? dialog.offer.label}
          platformName={dialog.offer.platformName}
          initialUrl={dialog.offer.url}
          initialTarget={dialog.target}
          approving={dialog.approving}
          offerId={dialog.offer.id}
          askPostTitle={dialog.offer.facebookGroupId !== null && dialog.offer.facebookPostId === null}
          isPending={isPending}
          error={actionError}
          onClose={closeDialog}
          onConfirm={(url, target, endsAt, postTitle) => {
            startTransition(async () => {
              const { publishOfferAction } = await import("@/app/actions/offers");
              const offer = dialog.offer;
              const result = await publishOfferAction(offer.id, url, target, endsAt, postTitle);
              if (result.status === "success") {
                handleSuccess();
                toast({
                  message: `Offer #${offer.offerNo} is now ${OFFER_STATE_LABEL[target].toLowerCase()}`,
                  href: `/c/${collectionSlug}/offers/${offer.id}`,
                  linkLabel: "Open offer",
                });
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
          to happen is not a matter of remembering what was ticked. It is the **in view** count,
          which is what the run takes (#1031): a title naming the ticks the filter is hiding would
          promise something the run then does not do. */}
      {dialog.kind === "postTogether" && (
        <PostTogetherDialog
          count={selectedInView.length}
          isPending={isPending}
          error={actionError}
          onCancel={closeDialog}
          onSubmit={postTogether}
        />
      )}

      {dialog.kind === "addToPost" && (
        <AddToPostDialog
          collectionId={collectionId}
          groupIds={[...new Set(selectedInView.map((o) => o.facebookGroupId!))]}
          count={selectedInView.length}
          isPending={isPending}
          error={actionError}
          onCancel={closeDialog}
          onSubmit={addToPost}
        />
      )}

      {(dialog.kind === "bulkWithdraw" || dialog.kind === "bulkDelete") && (
        <ConfirmDialog
          title={
            dialog.kind === "bulkWithdraw"
              ? `Withdraw ${selectedInView.length} offer${selectedInView.length === 1 ? "" : "s"}`
              : `Delete ${selectedInView.length} offer${selectedInView.length === 1 ? "" : "s"}`
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

      {dialog.kind === "assistantRun" && (
        <AssistantRunDialog
          act={dialog.act}
          offers={dialog.offers}
          skipped={dialog.skipped}
          queueBusy={assistantRuns.busy}
          onClose={closeDialog}
          onConfirm={() => queueAssistantRuns(dialog.act, dialog.offers)}
        />
      )}

      {/* The two handoffs the queue drives (#1969): machine-readable, never shown — the offer
          screen's own nodes (#407/#729), read and answered by the Assistant. */}
      {assistantListingPayload && (
        <div ref={assistantListingNodeRef} id={LISTING_ELEMENT_ID} hidden>
          {assistantListingPayload}
        </div>
      )}
      {assistantClosePayload && (
        <div ref={assistantCloseNodeRef} id={CLOSE_ELEMENT_ID} hidden>
          {assistantClosePayload}
        </div>
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

/** The confirmation before anything is queued (#1969): how many offers, what each run does, and how
 *  many ticked offers the action leaves alone. */
function AssistantRunDialog({
  act,
  offers,
  skipped,
  queueBusy,
  onClose,
  onConfirm,
}: {
  act: AssistantRunAct;
  offers: OfferListItem[];
  skipped: number;
  queueBusy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const n = offers.length;
  const one = n === 1;
  const removed = act === "update" ? offers.reduce((sum, o) => sum + (o.assistant?.soldElsewhereSetIds.length ?? 0), 0) : 0;
  const what =
    act === "close"
      ? `The Assistant closes ${one ? "this listing" : `these ${n} listings`} on Colnect, in your own signed-in Colnect session${one ? "" : ", one after another"}, and withdraws ${one ? "the offer" : "each offer"} here once Colnect confirms. Withdrawn is final here — to sell again, create a new offer. On Colnect a listing can be reopened from its own page. The copies are untouched.`
      : `${removed > 0 ? `First ${removed === 1 ? "1 set" : `${removed} sets`} sold elsewhere ${removed === 1 ? "comes" : "come"} off. ` : ""}The Assistant then opens ${one ? "this listing's" : "each listing's"} edit form on Colnect${one ? "" : ", one after another"}, re-filled from the offer as it now stands, with its pictures replaced. Nothing is saved for you — check ${one ? "the form" : "each form"} and save it on Colnect${one ? "" : "; the next one opens after that"}.`;
  const left =
    skipped > 0
      ? ` ${skipped === 1 ? "1 other ticked offer is" : `${skipped} other ticked offers are`} left alone: nothing about ${skipped === 1 ? "it" : "them"} calls for ${act === "close" ? "a close" : "an update"}.`
      : "";
  const after = queueBusy ? " They join the end of the queue already running." : "";
  return (
    <ConfirmDialog
      title={
        act === "close"
          ? one
            ? "Close the listing on Colnect"
            : `Close ${n} listings on Colnect`
          : one
            ? "Update the listing on Colnect"
            : `Update ${n} listings on Colnect`
      }
      message={`${what}${left}${after}`}
      actionLabel={act === "close" ? (one ? "Close and withdraw" : `Close ${n} and withdraw`) : one ? "Update" : `Update ${n}`}
      variant={act === "close" ? "destructive" : "primary"}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

/** The queue's own line (#1969): how far it has got, and the two ways to stop it — *Cancel* drops
 *  what has not started, *Stop waiting* gives up on an update whose form was never saved. Each
 *  offer's own progress is on its row. */
function AssistantQueueStrip({
  runs,
  onCancel,
  onStopWaiting,
  onClear,
}: {
  runs: Pick<ReturnType<typeof useAssistantRuns>, "runs" | "running" | "busy" | "awaitingSave">;
  onCancel: () => void;
  onStopWaiting: () => void;
  onClear: () => void;
}) {
  const queued = runs.runs.filter((r) => r.status === "queued").length;
  const finished = runs.runs.filter((r) => r.status === "done" || r.status === "failed").length;
  const summary = assistantRunSummary(runs.runs);
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.5rem 1.25rem 0.5rem 2.5rem",
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-page)",
        fontSize: "0.8125rem",
        color: "var(--color-text-secondary)",
      }}
    >
      <Icon name="assistant" size="sm" />
      <span style={{ color: "var(--color-text-primary)" }}>
        {runs.running
          ? `${formatEntityNo(runs.running.offerNo)}: ${runs.running.message ?? (runs.running.act === "close" ? "Closing…" : "Updating…")}`
          : "Assistant queue finished"}
      </span>
      {(queued > 0 || finished > 0) && (
        <span>
          {[...(queued > 0 ? [`${queued} queued`] : []), ...(summary ? [summary] : [])].join(" · ")}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {runs.awaitingSave && (
        <Tooltip content="Move on without this one. Its form stays open on Colnect; if you save it later, mark the listing up to date on its offer.">
          <button type="button" onClick={onStopWaiting} style={LINK_BTN}>
            Stop waiting
          </button>
        </Tooltip>
      )}
      {queued > 0 && (
        <Tooltip content="Drop the offers not started yet — they stay as they were. The one running finishes.">
          <button type="button" onClick={onCancel} style={LINK_BTN}>
            Cancel queue
          </button>
        </Tooltip>
      )}
      {!runs.busy && (
        <Tooltip content="Clear the results from the rows">
          <button type="button" onClick={onClear} style={LINK_BTN}>
            Dismiss
          </button>
        </Tooltip>
      )}
    </div>
  );
}
