"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CollectionAreaData } from "@/lib/areas";
import { buildAreaPath } from "@/lib/area-path";
import {
  MIXED_GROUP,
  buildOfferGroups,
  offerMatchesFilters,
  offerYearFacets,
  type GroupKey,
} from "@/lib/listing-groups";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { flattenAreaTree, getDescendantIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import type { ListingWorkspaceOffer } from "@/lib/offers";
import { useListingOffers, useOfferPlatforms, useInvalidateOffers } from "../use-offers-query";
import { ListingOfferCard } from "./listing-offer-card";
import { ActivateOfferDialog } from "./activate-offer-dialog";

// The bulk listing workspace (#322): one posting session on one marketplace. Most platforms have no
// listing API (#154), so publishing a prepared batch means opening the platform's own form once per
// offer and carrying the title, price, description and photos across by hand. This screen is that
// carrying surface — the Offers list is where offers are *prepared*, this is where they *go live*.
//
// Everything about its shape follows from the session it serves:
//
//   * **One platform, `ready` only.** Both are fixed rather than filters: a batch spanning platforms
//     would mix listings whose title templates, description formats and photo limits differ, and an
//     offer that is not `ready` is not prepared to be posted.
//   * **Grouped by area and year**, because that is the order a collector posts in — a run of one
//     area's 1960s, then the next. An offer whose copies span areas or years has no single pair to
//     be filed under and goes to **Mixed**, the last group; the rail carries Mixed as its own entry
//     so a narrowed session can still get to those.
//   * **The filter is stricter than the grouping.** An offer matches an area only when *every* copy
//     is inside it, so a filtered session never contains a listing that is half from somewhere else.
//     A year-spanning offer inside one area is therefore Mixed, yet still appears under that area.
//
// Grouping, filtering and the year facets are all client-side (`listing-groups.ts`, unit-tested) over
// one unpaginated read: a `ready` batch is bounded by how many listings a person is about to type in,
// and instant facets matter more here than a page boundary would.

const CONTROL_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minHeight: "2rem",
};

export function ListingWorkspacePanel({
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
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | undefined>();
  const [publishing, setPublishing] = useState<ListingWorkspaceOffer | null>(null);
  // Which card is open. `undefined` means "nothing chosen for this batch yet", which opens the first
  // offer — the session starts on the listing you are about to post, not on a wall of shut cards.
  // `null` is the collector having closed the open one, and is left alone.
  const [expandedId, setExpandedId] = useState<string | null | undefined>(undefined);
  const { invalidateAll } = useInvalidateOffers();

  const { data: platforms = [] } = useOfferPlatforms(collectionId);
  // The platform is remembered per collection like the Offers list's own filter (#325), and the URL
  // wins when it carries one — which is how the Offers toolbar hands the current filter over.
  const [storedPlatform, rememberPlatform] = usePersistedCollectionValue(
    "offers-platform",
    collectionId
  );
  const platformFromUrl = searchParams.get("platform");
  const platformId =
    (platformFromUrl ??
      (storedPlatform && platforms.some((p) => p.id === storedPlatform) ? storedPlatform : "")) ||
    undefined;

  // Area + year are the shared list selection (#143): the URL wins, else the per-collection store.
  const { storedAreaId, storedYear, writeStore } = useCollectionFilterStore(collectionId);
  const urlAreaId = searchParams.get("areaId");
  const urlYear = searchParams.get("year");
  const mixedOnly = searchParams.get("group") === MIXED_GROUP;
  const filterAreaId =
    urlAreaId !== null ? (urlAreaId === "all" ? null : urlAreaId) : storedAreaId;
  const year = urlYear !== null ? (urlYear === "all" ? "" : urlYear) : (storedYear ?? "");

  useEffect(() => {
    writeStore({ areaId: filterAreaId, year: year || null });
  }, [filterAreaId, year, writeStore]);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/offers/listing${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const { data: offers = [], isLoading } = useListingOffers(collectionId, platformId);

  const areaIds = useMemo(() => {
    if (!filterAreaId) return undefined;
    const ids = getDescendantIds(areas, filterAreaId);
    ids.add(filterAreaId);
    return [...ids];
  }, [filterAreaId, areas]);

  const parsedYear = year === "" ? undefined : year === "none" ? ("none" as const) : Number(year);

  // The rail's facets are counted against the *area* selection but not their own dimension, so each
  // count says what clicking it would show. A Mixed selection replaces both, so its facets go quiet.
  const yearFacets = useMemo(
    () => (mixedOnly ? [] : offerYearFacets(offers, { areaIds })),
    [offers, areaIds, mixedOnly]
  );
  const mixedCount = useMemo(
    () => offers.filter((o) => offerMatchesFilters(o, { mixedOnly: true })).length,
    [offers]
  );

  const visible = useMemo(
    () =>
      offers.filter((o) =>
        offerMatchesFilters(o, {
          areaIds: mixedOnly ? undefined : areaIds,
          year: mixedOnly ? undefined : parsedYear,
          mixedOnly,
        })
      ),
    [offers, areaIds, parsedYear, mixedOnly]
  );

  // The rail's order is the list's order, so the page reads down the same tree the rail shows.
  const areaOrder = useMemo(() => flattenAreaTree(areas).map(({ area }) => area.id), [areas]);
  const groups = useMemo(() => buildOfferGroups(visible, areaOrder), [visible, areaOrder]);

  // The batch in the order it is shown, which is the order it gets posted in — what "the next offer"
  // means after a publication.
  const ordered = useMemo(() => groups.flatMap((g) => g.offers), [groups]);

  // Which card is actually open, derived rather than stored: the first offer of the batch when
  // nothing has been chosen for it yet, and the first again whenever the open card leaves the list
  // some way other than being published (a filter or platform change, an offer sent back to
  // preparing). `null` — the collector shut the open card — is honoured as itself, and a publication
  // names its own successor below, so neither falls back to the top.
  const openId =
    expandedId === undefined || (expandedId !== null && !ordered.some((o) => o.id === expandedId))
      ? (ordered[0]?.id ?? null)
      : expandedId;

  const areaNames = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const platformName = platforms.find((p) => p.id === platformId)?.name ?? "this platform";

  function groupHeading(key: GroupKey): { label: string; hint?: string } {
    if (key.mixed) {
      return {
        label: "Mixed",
        hint: "These offers hold copies from more than one area or year",
      };
    }
    const area = key.areaId ? areaNames.get(key.areaId) : undefined;
    const areaLabel = area
      ? (buildAreaPath(areas, area.id) ?? area.name)
      : key.areaId
        ? "Unknown area"
        : "No area";
    return { label: `${areaLabel} · ${key.year ?? "No year"}` };
  }

  function publish(url: string) {
    const offer = publishing;
    if (!offer) return;
    setActionError(undefined);
    // Posting runs down the list, so publishing one offer opens the next: the collector's hands go
    // straight back to copying rather than to hunting for where they were. Resolved *before* the
    // mutation, while the published offer is still in the list — afterwards there is no "next" to it.
    const at = ordered.findIndex((o) => o.id === offer.id);
    // No next one (that was the last of the batch, or of this filtered slice): hand the choice back
    // to the effect above, which opens the first of whatever is left.
    const next = at >= 0 ? (ordered[at + 1]?.id ?? undefined) : undefined;
    startTransition(async () => {
      const { publishOfferAction } = await import("@/app/actions/offers");
      const result = await publishOfferAction(offer.id, url);
      if (result.status === "success") {
        setPublishing(null);
        // The offer has left this batch — it is `active` now, so the workspace, the Offers list and
        // the toolbar counts all want re-reading.
        invalidateAll(collectionId);
        setExpandedId(next);
      } else setActionError(result.message);
    });
  }

  /** Step an offer back to `preparing` (#246): something turned out to be missing, and it should not
   * sit in the posting batch until it is fixed. Reversible from the Offers list, so no confirmation —
   * the offer simply leaves the session. */
  function sendBack(offer: ListingWorkspaceOffer) {
    setActionError(undefined);
    startTransition(async () => {
      const { setOfferStateAction } = await import("@/app/actions/offers");
      const result = await setOfferStateAction(offer.id, "preparing");
      if (result.status === "success") invalidateAll(collectionId);
      else setActionError(result.message);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "1rem" }}>
      {/* Toolbar: the platform this session posts to, and what the batch amounts to. */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          Posting to
        </label>
        <select
          aria-label="Platform to post to"
          value={platformId ?? ""}
          onChange={(e) => {
            rememberPlatform(e.target.value);
            // A new batch starts on its first offer, not on whatever was open in the last one.
            setExpandedId(undefined);
            updateParams({ platform: e.target.value });
          }}
          style={{ ...CONTROL_STYLE, cursor: "pointer" }}
        >
          <option value="">Pick a platform…</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span style={{ ...CONTROL_STYLE, border: "none", background: "none", color: "var(--color-text-muted)" }}>
          {platformId
            ? isLoading
              ? "Loading…"
              : `${visible.length} of ${offers.length} ready ${offers.length === 1 ? "offer" : "offers"}`
            : "Ready offers are scoped to one platform"}
        </span>
      </div>

      {/* A failed action outside the publish dialog (sending an offer back) has nowhere else to be
          said, and a silent no-op would read as though the offer had simply not moved. */}
      {actionError && !publishing && (
        <p
          style={{
            margin: 0,
            padding: "0.5rem 0.75rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--color-error)",
            background: "var(--color-error-soft)",
            color: "var(--color-error)",
            fontSize: "0.8125rem",
          }}
        >
          {actionError}
        </p>
      )}

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
        <ListFilterSidebar
          areas={areas}
          filterAreaId={mixedOnly ? null : filterAreaId}
          onNavigateArea={(id) => updateParams({ areaId: id ?? "all", group: "" })}
          areaExtraEntry={{
            label: "Mixed",
            title: "Offers whose copies span more than one area or year",
            count: mixedCount,
            selected: mixedOnly,
            onSelect: () =>
              updateParams(
                mixedOnly
                  ? { group: "" }
                  : // A Mixed session is not an area/year one: clearing both keeps the rail honest
                    // about what is being shown.
                    { group: MIXED_GROUP, areaId: "all", year: "all" }
              ),
          }}
          yearFacets={yearFacets}
          yearsLoading={isLoading}
          selectedYear={mixedOnly ? null : year || null}
          onSelectYear={(y) => updateParams({ year: y ?? "all", group: "" })}
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
          {!platformId && (
            <Empty>
              Pick the platform you are posting to. The workspace shows the offers you have marked
              ready for it, with everything the platform&rsquo;s form needs.
            </Empty>
          )}

          {platformId && isLoading && <Empty>Loading ready offers…</Empty>}

          {platformId && !isLoading && offers.length === 0 && (
            <Empty>
              Nothing is ready for {platformName} yet. Prepare offers on the Offers screen and mark
              them ready.
            </Empty>
          )}

          {platformId && !isLoading && offers.length > 0 && visible.length === 0 && (
            <Empty>
              {mixedOnly
                ? "No ready offer spans more than one area or year."
                : "No ready offer falls entirely within this area and year."}
            </Empty>
          )}

          {groups.map((group) => {
            const heading = groupHeading(group.key);
            return (
              <section key={group.id}>
                <h3
                  title={heading.hint}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    margin: 0,
                    padding: "0.5rem 1rem",
                    borderBottom: "1px solid var(--color-border)",
                    background: "var(--color-bg-page)",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--color-text-muted)",
                    fontStyle: group.key.mixed ? "italic" : "normal",
                  }}
                >
                  {heading.label}
                  <span style={{ fontWeight: 400, fontStyle: "normal" }}>
                    {group.offers.length === 1 ? "1 offer" : `${group.offers.length} offers`}
                  </span>
                </h3>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    padding: "0.625rem 1rem 0.875rem",
                  }}
                >
                  {group.offers.map((offer) => (
                    <ListingOfferCard
                      key={offer.id}
                      collectionId={collectionId}
                      collectionSlug={collectionSlug}
                      offer={offer}
                      expanded={openId === offer.id}
                      onToggle={() => setExpandedId(openId === offer.id ? null : offer.id)}
                      onPublish={() => {
                        setActionError(undefined);
                        setPublishing(offer);
                      }}
                      onSendBack={() => sendBack(offer)}
                      isPublishing={isPending && publishing?.id === offer.id}
                      isPending={isPending}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {publishing && (
        <ActivateOfferDialog
          offerLabel={publishing.name ?? publishing.label}
          platformName={platformName}
          initialUrl={publishing.url}
          isPending={isPending}
          error={actionError}
          onClose={() => {
            if (!isPending) {
              setPublishing(null);
              setActionError(undefined);
            }
          }}
          onConfirm={publish}
        />
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "2rem",
        color: "var(--color-text-muted)",
        fontSize: "0.9375rem",
        lineHeight: 1.6,
        maxWidth: "40rem",
      }}
    >
      {children}
    </div>
  );
}
