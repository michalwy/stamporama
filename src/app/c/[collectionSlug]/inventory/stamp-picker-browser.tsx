"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { DialogShell, type DialogAsideProps } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import { parseCatalogSearch } from "@/lib/catalog-number";
import {
  matchedStampsInIssue,
  needsInnerStampMatch,
} from "@/lib/issue-stamp-match";
import type {
  IssueListItem,
  IssueChecklistSummary,
  StampNodeData,
} from "@/lib/issues";
import { createIssueAction, addStampToIssueAction } from "@/app/actions/issues";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { usePersistedSearch } from "@/app/c/[collectionSlug]/shared/use-persisted-search";
import { IssueDialog } from "@/app/c/[collectionSlug]/shared/issue-form-dialog";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { CREATE_LINK_STYLE } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import {
  buildStampTree,
  ChecklistTreeFilter,
  filterStampTreeByChecklists,
  IssueTitle,
  IssueCatalogChips,
  ChecklistsBadge,
  type VendorMap,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  useIssuesInfinite,
  useIssueYears,
  type IssueListFilters,
  type IssueYearFacetFilters,
} from "@/app/c/[collectionSlug]/issues/use-issues-query";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { useDebouncedValue } from "@/app/c/[collectionSlug]/shared/autocomplete";
import type { CatalogVendorOption } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { useIssueMembers, useInvalidateInventory } from "./use-inventory-query";
import { issueLabel, orderedCatalogLabels, type PickedStamp } from "./stamp-picker-shared";
import { SelectableStampNode } from "./selectable-stamp-node";
import { PhotoThumb } from "./photo-thumb";
import { Icon } from "@/app/icons";

/** An in-progress inline create from the picker popup (#105): a new issue in an
 * area, or a new stamp / variant (parent set) in an issue. */
type CreateState =
  | { kind: "issue"; areaId: string | null }
  | { kind: "stamp"; issue: IssueListItem; parent?: StampNodeData };

// ── Styles ──────────────────────────────────────────────────────────────────

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

const NEW_ISSUE_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  padding: "0.5rem 0.875rem",
  background: "var(--color-action-primary)",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** Popup area→issue→stamp browser for the inventory picker (#104). Left: the area
 * tree (reused `AreaFilterSidebar`); "All areas" (no selection) lists every issue,
 * a parent area includes its descendants. Right: the scope's issues, text-filterable,
 * each expandable to its stamp/variant tree — rendered with the same shared
 * presentation as the main issues list, minus action buttons; a click selects. */
/** A whole **checklist** picked for bulk intake (#121; #531): its id, a display label naming the
 * issue and the set, and how many stamps it carries (the copies that will be created). An issue may
 * hold several goals, so the button names one rather than saying "the whole issue". */
export interface PickedIssue {
  checklistId: string;
  label: string;
  requiredCount: number;
}

export function StampPickerBrowser({
  collectionId,
  areas,
  onPick,
  onPickIssue,
  marked,
  aside,
  asideWidth,
  onClose,
}: DialogAsideProps & {
  collectionId: string;
  areas: CollectionAreaData[];
  onPick: (picked: PickedStamp) => void;
  /** When provided, each issue row offers one "add this whole set" button per checklist
   *  (lot intake, #121; #531). */
  onPickIssue?: (picked: PickedIssue) => void;
  /**
   * Stamps the caller has **already taken**, marked on their rows (#607) — see
   * `SelectableStampNode`. Only a picker that does not close on the pick needs it: the tile
   * shortlist stays open across several picks, and without this the collector is comparing the tree
   * against a list elsewhere on screen and pressing the same stamp twice to be sure.
   */
  marked?: { stampIds: ReadonlySet<string>; label: string; hint: string };
  onClose: () => void;
}) {
  // Area + year come from the shared per-collection store (#143), so the picker
  // opens on the same filter as the lists and changes here carry back to them.
  // Year values: "none" = no-year bucket, a numeric string = a year, null = all.
  // The store rather than the URL, as everywhere else in a dialog: a popup has no address.
  const { storedAreaId, storedYear, writeStore } =
    useCollectionFilterStore(collectionId);
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
  const [create, setCreate] = useState<CreateState | null>(null);
  const [createError, setCreateError] = useState<string>();
  const [justCreatedIssueId, setJustCreatedIssueId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { invalidatePickerData } = useInvalidateInventory();
  // Only for the inline create dialogs' catalog-number labels: an issue may override its area's
  // prefix (#377), and the input a number is typed into should be labelled with the prefix that
  // number will carry. The list below resolves its own for the rows it renders.
  const { vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  // Selecting a parent area brings its descendants' issues with it, unless the collector has
  // narrowed the scope to the node alone (#385) — the toggle is in the sidebar rendered below.
  const [includeSubAreas] = useSubtreeScope("area");
  const areaIds = useMemo(
    () => resolveAreaFilterIds(areas, areaId, includeSubAreas),
    [areas, areaId, includeSubAreas]
  );

  // The search box lives up here rather than on the list (#604): it narrows the rows *and* the
  // year facets, and both are read from the server now, so one value has to feed both queries.
  // Persisted so the picker reopens on the filter it was left on (#183), debounced because every
  // keystroke would otherwise be a page request.
  const [filter, setFilter] = usePersistedSearch(`${collectionId}:issues`);
  const search = useDebouncedValue(filter);

  const catalogVendors = useMemo<CatalogVendorOption[]>(() => {
    const seen = new Map<string, CatalogVendorOption>();
    for (const area of areas) {
      for (const entry of area.catalogEntries) {
        if (!seen.has(entry.catalogVendorId)) {
          seen.set(entry.catalogVendorId, {
            id: entry.catalogVendorId,
            name: entry.vendorName,
            abbreviation: entry.vendorAbbreviation,
          });
        }
      }
    }
    return Array.from(seen.values());
  }, [areas]);

  // A prefixed number typed into the box ("Mi PL 200", "PL200", "BL31") never appears verbatim in
  // a stored number, so the bare number and the vendor its abbreviation named ride alongside the
  // raw text and the server ORs them in — the issues list's own handling (#146/#289).
  const parsedSearch = useMemo(
    () => parseCatalogSearch(search, catalogVendors),
    [search, catalogVendors]
  );

  const filters: IssueListFilters = useMemo(
    () => ({
      areaIds: areaIds ?? undefined,
      search: search || undefined,
      searchCatalogVendorId: parsedSearch.vendorId ?? undefined,
      searchCatalogNumber: parsedSearch.number || undefined,
      year: year || undefined,
    }),
    [areaIds, search, parsedSearch, year]
  );

  // The facets drop the year and keep everything else, so each count says what picking that year
  // would leave — the list's rule, and the reason they cannot count a row the page would not show.
  const yearFacetFilters: IssueYearFacetFilters = useMemo(
    () => ({
      areaIds: areaIds ?? undefined,
      search: search || undefined,
      searchCatalogVendorId: parsedSearch.vendorId ?? undefined,
      searchCatalogNumber: parsedSearch.number || undefined,
    }),
    [areaIds, search, parsedSearch]
  );

  const { data: yearFacets = [], isLoading: yearsLoading } = useIssueYears(
    collectionId,
    yearFacetFilters
  );

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useIssuesInfinite(collectionId, filters);
  const issues = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  const selectedYearNumber = year && year !== "none" ? Number(year) : undefined;

  function closeCreate() {
    if (!isPending) {
      setCreate(null);
      setCreateError(undefined);
    }
  }

  function openCreate(next: CreateState) {
    setCreateError(undefined);
    setCreate(next);
  }

  // This popup nests inside the item-form dialog, and a nested create dialog nests inside this
  // popup. Each is its own Escape layer (#361), so the topmost one closes and the parent form keeps
  // its in-progress edits — `dismissable={!create}` below is what steps this popup aside while the
  // create dialog is up.

  function handleCreateIssue(newAreaId: string, fd: FormData) {
    startTransition(async () => {
      const result = await createIssueAction(collectionId, newAreaId, fd);
      if (result.status === "success") {
        if (result.issueId) setJustCreatedIssueId(result.issueId);
        setCreate(null);
        setCreateError(undefined);
        invalidatePickerData(collectionId);
      } else if (result.status === "error") {
        setCreateError(result.message);
      }
    });
  }

  function handleCreateStamp(issueId: string, fd: FormData) {
    startTransition(async () => {
      const result = await addStampToIssueAction(collectionId, issueId, fd);
      if (result.status === "success" && result.stampId) {
        // #182: creating a stamp inline just adds it to the picker — refresh so it appears
        // in its issue's (already-expanded) tree, then close the create dialog. It is not
        // auto-selected, and the browser stays open, so the user still picks it explicitly
        // (or keeps browsing), mirroring inline issue creation.
        setCreate(null);
        setCreateError(undefined);
        invalidatePickerData(collectionId);
      } else if (result.status === "error") {
        setCreateError(result.message);
      }
    });
  }

  // The parent item-form dialog panel uses `transform` for centering, which makes
  // it the containing block for `position: fixed` descendants — so an un-portaled
  // popup gets clipped to that dialog's box. Portal to <body> to escape it. The
  // create dialogs are portaled as body-level siblings for the same reason (this
  // popup's own panel is also transform-centered).
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <DialogShell
        title="Browse stamps"
        onClose={onClose}
        // A create dialog stacks above this one; while it is up this dialog must stop dismissing
        // itself, or one Esc would close both.
        dismissable={!create}
        maxWidth="min(96vw, 110rem)"
        height="min(90vh, 60rem)"
        // Which stamp a piece *is* is read off the piece, so when this picker is one step of
        // identifying a scan tile the tile comes with it (#592) — leftmost, outside the area tree,
        // because it is the subject of the browsing rather than one more way of narrowing it.
        aside={aside}
        asideWidth={asideWidth}
      >
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* The sidebar is authored for the page layout (max-height: 100vh, sticky);
              wrap it so a long area tree scrolls within the dialog instead. */}
          <ListFilterSidebar
            variant="dialog"
            areas={areas}
            filterAreaId={areaId}
            onNavigateArea={setAreaId}
            yearFacets={yearFacets}
            yearsLoading={yearsLoading}
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
            <IssueBrowser
              collectionId={collectionId}
              areas={areas}
              selectedAreaId={areaId}
              issues={issues}
              isLoading={isLoading}
              filter={filter}
              onFilterChange={setFilter}
              search={search}
              hasMore={!!hasNextPage}
              isFetchingMore={isFetchingNextPage}
              onLoadMore={fetchNextPage}
              justCreatedIssueId={justCreatedIssueId}
              onPick={onPick}
              onPickIssue={onPickIssue}
              marked={marked}
              onNewIssue={(a) => openCreate({ kind: "issue", areaId: a })}
              onNewStamp={(issue) => openCreate({ kind: "stamp", issue })}
              onNewVariant={(issue, parent) => openCreate({ kind: "stamp", issue, parent })}
            />
          </div>
        </div>
      </DialogShell>

      {/* These dialogs are portaled to <body>, but in the React tree they remain
          descendants of the inventory item <form> (this picker lives inside it). React
          events follow the React tree, not the DOM, so a create dialog's submit would
          bubble to that form and fire its "A stamp must be selected" validation. Contain
          submit here so creating an issue/stamp never triggers the outer copy form. */}
      {create && (
        <div style={{ display: "contents" }} onSubmit={(e) => e.stopPropagation()}>
          {create.kind === "issue" && (
            <IssueDialog
              mode="create"
              // The picture goes deeper with the chain, not only as far as this popup: an issue is
              // created *because* of the piece on screen, and this dialog covers the one behind it.
              aside={aside}
              asideWidth={asideWidth}
              collectionId={collectionId}
              areas={areas}
              defaultAreaId={create.areaId ?? undefined}
              defaultYear={selectedYearNumber}
              isPending={isPending}
              error={createError}
              onClose={closeCreate}
              onSubmit={handleCreateIssue}
            />
          )}

          {create.kind === "stamp" &&
            (() => {
              const { issue, parent } = create;
              // Already deduplicated by vendor, and carrying the issue's own prefix override (#377).
              const uniqueVendors = [...vendorMapFor(issue.collectionAreaId, issue.id).values()];
              // The parent node comes from the row that offered the + variant link — the row holds
              // its own tree since #604, so there is nothing here to look the id up in.
              return (
                <StampFormDialog
                  mode="add"
                  aside={aside}
                  asideWidth={asideWidth}
                  collectionId={collectionId}
                  issues={[issue]}
                  areaVendors={uniqueVendors}
                  prefilledIssueId={issue.id}
                  prefilledParentStampId={parent?.stampId ?? null}
                  prefilledParentIssuedYear={parent?.issuedYear ?? null}
                  // A variant is numbered off its parent (`309` → `309A`), so the inputs open on
                  // the parent's numbers for the collector to suffix — the same prefill the
                  // issue list's add-variant entry does (#386).
                  defaultCatalogNumbers={parent?.catalogNumbers}
                  isPending={isPending}
                  error={createError}
                  onClose={closeCreate}
                  onSubmit={handleCreateStamp}
                />
              );
            })()}
        </div>
      )}
    </>,
    document.body
  );
}

function IssueBrowser({
  collectionId,
  areas,
  selectedAreaId,
  issues,
  isLoading,
  filter,
  onFilterChange,
  search,
  hasMore,
  isFetchingMore,
  onLoadMore,
  justCreatedIssueId,
  onPick,
  onPickIssue,
  marked,
  onNewIssue,
  onNewStamp,
  onNewVariant,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  selectedAreaId: string | null;
  /** The pages loaded so far, already narrowed by area, year and search on the server (#604). */
  issues: IssueListItem[];
  isLoading: boolean;
  /** What is in the search box right now — the input's value. */
  filter: string;
  onFilterChange: (value: string) => void;
  /** The debounced text the loaded rows were actually fetched with; what a row measures its own
   *  match against, so a row never dims itself on a query the server has not answered yet. */
  search: string;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  justCreatedIssueId: string | null;
  onPick: (picked: PickedStamp) => void;
  onPickIssue?: (picked: PickedIssue) => void;
  /** Stamps already taken by the caller, marked on their rows (#607). */
  marked?: { stampIds: ReadonlySet<string>; label: string; hint: string };
  onNewIssue: (areaId: string | null) => void;
  onNewStamp: (issue: IssueListItem) => void;
  onNewVariant: (issue: IssueListItem, parent: StampNodeData) => void;
}) {
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  // Effective vendor entries + primary vendor per area (ancestor-inherited), matching how the main
  // issues list builds them — a parent/"All areas" mixes many areas — and applying each issue's own
  // prefix override (#377), so the picker's chips and its search keys read like the list's.
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  function handlePick(node: StampNodeData, unknownVariant: boolean, issue: IssueListItem) {
    const vm = vendorMapFor(issue.collectionAreaId, issue.id);
    const catalogLabels = orderedCatalogLabels(
      node.catalogNumbers,
      vm,
      primaryVendorByArea.get(issue.collectionAreaId) ?? null
    );
    const areaName = areaById.get(issue.collectionAreaId)?.name ?? null;
    const context = [
      issue.name || issue.year ? issueLabel(issue.name, issue.year) : null,
      areaName,
    ]
      .filter(Boolean)
      .join(" · ");
    onPick({
      stampId: node.stampId,
      catalogLabels,
      name: node.name,
      secondary: context || null,
      unknownVariant,
    });
  }

  return (
    <>
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          gap: "0.5rem",
        }}
      >
        <input
          type="text"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={selectedAreaId ? "Filter issues in this area…" : "Filter issues…"}
          style={{ ...SEARCH_STYLE, flex: 1 }}
          aria-label="Filter issues"
          // Focus + select the remembered filter text on open, so typing overwrites it (#183).
          data-autofocus-select
        />
        <button
          type="button"
          onClick={() => onNewIssue(selectedAreaId)}
          style={NEW_ISSUE_BUTTON_STYLE}
        >
          + New issue
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {isLoading ? (
          <p style={HINT_STYLE}>Loading issues…</p>
        ) : issues.length === 0 ? (
          <p style={HINT_STYLE}>
            {search ? "No issues match your filter." : "No issues here yet."}
          </p>
        ) : (
          <>
          {issues.map((issue, i) => (
            <PickIssueRow
              key={issue.id}
              collectionId={collectionId}
              issue={issue}
              areaName={areaById.get(issue.collectionAreaId)?.name ?? null}
              showArea={selectedAreaId !== issue.collectionAreaId}
              vendorMap={vendorMapFor(issue.collectionAreaId, issue.id)}
              primaryVendorId={primaryVendorByArea.get(issue.collectionAreaId) ?? null}
              isLast={i === issues.length - 1 && !hasMore}
              defaultExpanded={issue.id === justCreatedIssueId}
              justAdded={issue.id === justCreatedIssueId}
              search={search}
              onPick={handlePick}
              marked={marked}
              onPickIssue={
                onPickIssue
                  ? (checklist) =>
                      onPickIssue({
                        checklistId: checklist.id,
                        label:
                          issue.checklists.length > 1
                            ? `${issueLabel(issue.name, issue.year)} — ${checklist.name}`
                            : issueLabel(issue.name, issue.year),
                        requiredCount: checklist.stampCount,
                      })
                  : undefined
              }
              onNewStamp={() => onNewStamp(issue)}
              onNewVariant={(parent) => onNewVariant(issue, parent)}
            />
          ))}
          <InfiniteScrollSentinel
            onLoadMore={onLoadMore}
            hasMore={hasMore}
            isLoading={isFetchingMore}
          />
          </>
        )}
      </div>
    </>
  );
}

function PickIssueRow({
  collectionId,
  issue,
  areaName,
  showArea,
  vendorMap,
  primaryVendorId,
  isLast,
  defaultExpanded,
  justAdded,
  search,
  onPick,
  onPickIssue,
  marked,
  onNewStamp,
  onNewVariant,
}: {
  collectionId: string;
  issue: IssueListItem;
  areaName: string | null;
  showArea: boolean;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  isLast: boolean;
  defaultExpanded: boolean;
  /** Flash this row once right after the issue is created inline (#158). */
  justAdded: boolean;
  /** The search the page was fetched with, empty when there is none. The row decides for itself
   *  whether its own header explains the hit and, when it does not, which of its stamps did (#186). */
  search: string;
  onPick: (node: StampNodeData, unknownVariant: boolean, issue: IssueListItem) => void;
  /** When set, an "Add whole issue" button appears on the row header (lot intake, #121). */
  /** Called with the checklist whose button was pressed (#531). */
  onPickIssue?: (checklist: IssueChecklistSummary) => void;
  /** Stamps already taken by the caller, marked on their rows (#607). */
  marked?: { stampIds: ReadonlySet<string>; label: string; hint: string };
  onNewStamp: () => void;
  onNewVariant: (parent: StampNodeData) => void;
}) {
  const [userExpanded, setUserExpanded] = useState(defaultExpanded);
  const [hovered, setHovered] = useState(false);
  // Where the row's own name/year/number does not account for the search that returned it, the hit
  // must have come from a stamp inside — so this row reads its stamps even while collapsed, which
  // is the one case #186 needs them for. Everything else waits for the collector to expand. The
  // rule itself is `issue-stamp-match.ts`, shared with the Issues list (#631).
  const probeForInnerMatch = needsInnerStampMatch(issue, { search }, vendorMap);
  const { data: members = [], isLoading: membersLoading } = useIssueMembers(
    collectionId,
    issue.id,
    userExpanded || probeForInnerMatch
  );
  // Null while the probe is still out or the header explained the hit: only a row that really
  // surfaced through its stamps dims the rest of its tree.
  const matchedStampIds = useMemo(
    () => matchedStampsInIssue(issue, members, { search }, vendorMap),
    [issue, members, search, vendorMap]
  );
  // An inner-stamp match forces the issue open (so the matching stamp is visible, #186); when the
  // filter clears, the row falls back to the user's own toggle.
  const isExpanded = userExpanded || matchedStampIds !== null;
  // Narrowing the tree by checklist (#531), as on the issues list and the issue detail page.
  // Local to the row and not remembered: a picker is opened to answer one question.
  const [treeChecklistIds, setTreeChecklistIds] = useState<string[]>([]);
  const { tree, contextIds } = useMemo(
    () => filterStampTreeByChecklists(buildStampTree(members), treeChecklistIds),
    [members, treeChecklistIds]
  );

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        className={justAdded ? "just-added-flash" : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setUserExpanded(!isExpanded)}
        style={{
          padding: "0.875rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          cursor: "pointer",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}
      >
        {/* Expand/collapse toggle sits first, before the photo. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setUserExpanded(!isExpanded);
          }}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          style={{
            alignSelf: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: "0.75rem",
            padding: "0.25rem",
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          <Icon name={isExpanded ? "collapse" : "expand"} size="sm" />
        </button>

        {/* Issue-level gallery as a left column, matching the inventory list. Reserved even when
            empty for alignment. Stop propagation so opening a thumbnail's lightbox doesn't toggle
            the issue row. */}
        <div onClick={(e) => e.stopPropagation()}>
          <PhotoThumb collectionId={issue.collectionId} photos={issue.photos} plain reserveWhenEmpty />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {showArea && areaName && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
                background: "var(--color-bg-page)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.25rem",
                padding: "0.1rem 0.4rem",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {areaName}
            </span>
          )}

          <span
            style={{
              flex: 1,
              fontSize: "0.9375rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <IssueTitle name={issue.name} year={issue.year} />
          </span>

          {/* One button per checklist (#531). With one it reads as it always did; with several
              each names its own set, which is better than a chooser the collector has to open to
              answer a question the row can already ask. */}
          {onPickIssue &&
            issue.checklists
              .filter((c) => c.stampCount > 0)
              .map((checklist) => (
                <Tooltip
                  key={checklist.id}
                  content={`Add every stamp on “${checklist.name}” to the lot`}
                  align="end"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPickIssue(checklist);
                    }}
                    style={{
                      flexShrink: 0,
                      padding: "0.25rem 0.5rem",
                      background: "transparent",
                      color: "var(--color-text-secondary)",
                      border: "1px solid var(--color-border-strong)",
                      borderRadius: "0.375rem",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    +{" "}
                    {issue.checklists.length === 1 ? "Whole issue" : checklist.name} (
                    {checklist.stampCount})
                  </button>
                </Tooltip>
              ))}
        </div>

        {(issue.catalogNumbers.length > 0 || issue.memberCount > 0) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              marginTop: "0.3rem",
              flexWrap: "wrap",
            }}
          >
            <IssueCatalogChips
              catalogNumbers={issue.catalogNumbers}
              vendorMap={vendorMap}
              primaryVendorId={primaryVendorId}
            />
            {issue.memberCount > 0 && (
              <ChecklistsBadge
                checklists={issue.checklists}
                requiredCount={issue.requiredCount}
                memberCount={issue.memberCount}
              />
            )}
          </div>
        )}
        </div>
      </div>

      {isExpanded && (
        <div
          style={{
            background: "var(--color-bg-elevated)",
            borderTop: "1px solid var(--color-border)",
            marginLeft: "1.25rem",
            borderLeft: "2px solid var(--color-border)",
          }}
        >
          {/* Narrowing by checklist — only where there is a choice to make. */}
          {issue.checklists.length > 1 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.5rem 0.5rem 0.75rem",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                Checklist
              </span>
              <ChecklistTreeFilter
                checklists={issue.checklists}
                selected={treeChecklistIds}
                onChange={setTreeChecklistIds}
              />
            </div>
          )}
          {tree.length === 0 ? (
            <div
              style={{
                padding: "0.875rem 0 0.875rem 0.5rem",
                fontSize: "0.875rem",
                color: "var(--color-text-muted)",
                fontStyle: "italic",
              }}
            >
              {/* Said explicitly rather than shown as an empty row: with a text search also on
                  (which is what forces a row open, #186), an unexplained blank reads as "this
                  issue has nothing", when in fact the checklist filter is what emptied it — or
                  the stamps are simply still on their way, the tree being read per row (#604). */}
              {membersLoading
                ? "Loading stamps…"
                : treeChecklistIds.length > 0 && members.length > 0
                  ? "No stamp on the checklists you picked."
                  : "No stamps in this issue yet."}
            </div>
          ) : (
            tree.map((treeNode, i) => (
              <SelectableStampNode
                key={treeNode.node.stampId}
                treeNode={treeNode}
                depth={0}
                contextIds={contextIds}
                collectionId={issue.collectionId}
                vendorMap={vendorMap}
                primaryVendorId={primaryVendorId}
                isLast={i === tree.length - 1}
                onPick={(node, unknownVariant) => onPick(node, unknownVariant, issue)}
                // The create dialog prefills from the parent's own numbers and year (#386/#360),
                // so it takes the node rather than its id — the row holds the tree it came from.
                onNewVariant={(parentStampId) => {
                  const parent = members.find((m) => m.stampId === parentStampId);
                  if (parent) onNewVariant(parent);
                }}
                marked={marked}
                matchedStampIds={matchedStampIds}
              />
            ))
          )}
          <div style={{ padding: "0.625rem 1rem 0.75rem 0.5rem" }}>
            <button type="button" onClick={onNewStamp} style={CREATE_LINK_STYLE}>
              + New stamp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
