"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { DialogShell, PICKER_DIALOG_HEIGHT, type DialogAsideProps } from "@/app/dialog-shell";
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
import type { SpanningChecklistSummary } from "@/lib/checklists";
import { checklistColorMap } from "@/lib/checklist-colors";
import { checklistBranches, countOffChecklist } from "@/lib/checklist-branches";
import { getIssueChecklistHeadlinesAction } from "@/app/actions/checklists";
import {
  createIssueAction,
  addStampToIssueAction,
  addVariantRangeAction,
} from "@/app/actions/issues";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { usePersistedSearch } from "@/app/c/[collectionSlug]/shared/use-persisted-search";
import { IssueDialog } from "@/app/c/[collectionSlug]/shared/issue-form-dialog";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { ChecklistsDialog } from "@/app/c/[collectionSlug]/shared/use-checklists-action";
import { useInvalidateStampsAndIssues } from "@/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues";
import { AddVariantRangeDialog } from "@/app/c/[collectionSlug]/shared/add-variant-range-dialog";
import { resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { CREATE_LINK_STYLE } from "@/app/c/[collectionSlug]/shared/chip-styles";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import {
  buildStampTree,
  ChecklistTreeFilter,
  filterStampTreeBy,
  IssueTitle,
  IssueCatalogChips,
  ChecklistsBadge,
  type StampTreeNodeData,
  type VendorMap,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  issueKeys,
  useIssuesInfinite,
  useIssueYears,
  useIssueAreaFacets,
  type IssueListFilters,
  type IssueYearFacetFilters,
  type IssueAreaFacetFilters,
} from "@/app/c/[collectionSlug]/issues/use-issues-query";
import { ChecklistBranch } from "@/app/c/[collectionSlug]/issues/checklist-branch";
import {
  ChecklistDisplaySwitcher,
  useChecklistDisplayMode,
  type ChecklistDisplayMode,
} from "@/app/c/[collectionSlug]/issues/checklist-display-switcher";
import type { ChecklistChipData } from "@/app/c/[collectionSlug]/shared/checklist-chip";
import {
  SpecialisedChecklistsToggle,
  SpecialisedMark,
} from "@/app/c/[collectionSlug]/shared/specialised-checklists";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { useDebouncedValue } from "@/app/c/[collectionSlug]/shared/autocomplete";
import type { CatalogVendorOption } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { useIssueMembers, useInvalidateInventory } from "./use-inventory-query";
import { issueLabel, pickedCatalogLabels, type PickedStamp } from "./stamp-picker-shared";
import { SelectableStampNode } from "./selectable-stamp-node";
import { usePickerTreeState, type PickerTree } from "./use-picker-tree-state";
import { PhotoThumb } from "./photo-thumb";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { useUmbrellaPricesQuestion, withUmbrellaAnswer } from "@/app/c/[collectionSlug]/shared/umbrella-prices-question";
import { CaretCell } from "@/app/c/[collectionSlug]/shared/cell-target";
import {
  IssueBlockBar,
  issueBlockStyle,
  issueHeaderBackground,
} from "@/app/c/[collectionSlug]/shared/expanded-issue-block";

/** An in-progress inline create from the picker popup (#105): a new issue in an
 * area, a new stamp / variant (parent set) in an issue, or a whole lettered run of variants
 * under one base stamp (#722). */
type CreateState =
  | { kind: "issue"; areaId: string | null }
  | { kind: "stamp"; issue: IssueListItem; parent?: StampNodeData }
  | { kind: "variant-range"; issue: IssueListItem; parent: StampNodeData };

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

/**
 * Browsing for the checklist a ticked run of scan tiles is built on (#1220, #1225). `onPick` is handed
 * the checklist and the row it was picked from — the row is where a stamp added during the run goes.
 */
export interface IssueRunPick {
  tileCount: number;
  onPick: (checklistId: string, issue: IssueListItem) => void;
}

/** A checklist a run can be built on, as an issue row offers it. */
interface RunChecklistOption {
  id: string;
  name: string;
  /** Standard or specialised (#1617) — a specialised one is offered only while switched on, marked. */
  kind: string;
  stampCount: number;
  /** A checklist that spans issues, offered on each issue it covers. */
  spans: boolean;
}

/** What a row offers a run: the issue's own checklists, then the ones spanning issues that reach it. */
function runChecklistOptions(
  issue: IssueListItem,
  spanning: readonly SpanningChecklistSummary[]
): RunChecklistOption[] {
  return [
    ...issue.checklists.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      stampCount: c.stampCount,
      spans: false,
    })),
    ...spanning
      .filter((c) => c.issueIds.includes(issue.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        stampCount: c.stampIds.length,
        spans: true,
      })),
  ];
}

export function StampPickerBrowser({
  collectionId,
  areas,
  title = "Browse stamps",
  onPick,
  onPickIssue,
  issueRun,
  marked,
  onCompare,
  aside,
  asideWidth,
  onClose,
}: DialogAsideProps & {
  collectionId: string;
  areas: CollectionAreaData[];
  /** The popup's heading — what it is being browsed *for*, where that is not a stamp. */
  title?: string;
  onPick: (picked: PickedStamp) => void;
  /** When provided, each issue row offers one "add this whole set" button per checklist
   *  (lot intake, #121; #531). */
  onPickIssue?: (picked: PickedIssue) => void;
  /**
   * Identifying a ticked run of scan tiles **as the stamps of a checklist** (#1220, #1225): the picker
   * is browsed for a checklist rather than a stamp, and every issue row offers its checklists — one
   * button when the issue has one, since there is then no choice to make, and one per checklist when
   * it has several (the #531 row's own answer). A checklist spanning issues is offered on every issue
   * it covers. An issue with none offers the checklist editor, so the run is not a dead end.
   *
   * It is this picker rather than a chooser of its own because this is where an issue is **created**
   * in the middle of an identification (#105) and where its stamps are added right after — a set met
   * on a card whose issue is not in the catalogue yet is exactly the case, and a second chooser would
   * have to grow both. A stamp pressed on a row picks the checklist it names without doubt: the
   * row's only one, or the only one of the row's that holds the stamp.
   */
  issueRun?: IssueRunPick;
  /**
   * Stamps the caller has **already taken**, marked on their rows (#607) — see
   * `SelectableStampNode`. Only a picker that does not close on the pick needs it: the tile
   * shortlist stays open across several picks, and without this the collector is comparing the tree
   * against a list elsewhere on screen and pressing the same stamp twice to be sure.
   */
  marked?: { stampIds: ReadonlySet<string>; label: string; hint: string };
  /**
   * Open the reference comparison on a stamp row (#1005) — given only by an identification that has a
   * piece to compare, which is also what puts the piece beside this picker. The caller owns the
   * comparison; the picker only says which stamp, and on which issue its tree is read.
   */
  onCompare?: (stamp: { stampId: string; issueId: string }) => void;
  onClose: () => void;
}) {
  // Area + year come from the picker's own per-collection memory (#1659) — one for every place the
  // picker opens, as its tree is (#1616), and never the lists' (#143): sharing theirs made narrowing
  // the picker for a card re-narrow the Issues list, and the other way round.
  // Year values: "none" = no-year bucket, a numeric string = a year, null = all.
  // The store rather than the URL, as everywhere else in a dialog: a popup has no address.
  const { storedAreaId, storedYear, writeStore } = useCollectionFilterStore(
    collectionId,
    "stamp-picker"
  );
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
  /** The issue whose checklists are being edited over the picker, so a run has one to be built on
   *  (#1225). */
  const [checklistsFor, setChecklistsFor] = useState<IssueListItem | null>(null);
  // Checklists spanning issues, offered beside each covered issue's own (#1225). One read per open,
  // and only when a run is what the picker is for.
  const { data: spanningChecklists = [] } = useQuery({
    queryKey: ["checklists", collectionId, "spanning"] as const,
    queryFn: async () => {
      const { listSpanningChecklistsAction } = await import("@/app/actions/checklists");
      return listSpanningChecklistsAction(collectionId);
    },
    enabled: !!issueRun,
  });
  const [justCreatedIssueId, setJustCreatedIssueId] = useState<string | null>(null);
  // Which issues and checklist branches are open, and the issue last picked from (#1616): one
  // remembered state for every use of the picker, so reopening it shows the tree it was left on.
  const pickerTree = usePickerTreeState(collectionId);
  const [isPending, startTransition] = useTransition();
  const askUmbrella = useUmbrellaPricesQuestion();
  const { invalidatePickerData } = useInvalidateInventory();
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  const router = useRouter();

  // **Opening the picker is what makes its answer current** (#654). Its two halves go stale in
  // different ways and both read to the collector as *the thing I just created is not here*: the
  // area tree arrives as a **server prop**, so nothing short of a navigation ever replaces it, and
  // the issue rows are the issues list's own client query under the shared 30s stale time. Neither
  // notices an area or an Issue created anywhere else — another tab, most often, which is exactly
  // how a country first met halfway through identifying a scan sheet gets added. So refresh both
  // here rather than on a timer or on window focus: the open is the collector's own act and the one
  // moment the tree has to be right, and it is bounded (a picker is opened, used, closed), where a
  // focus handler would fire on every alt-tab through a sitting. `router.refresh()` re-pulls the
  // server tree the areas ride on — every write on these screens already pays that — and the
  // invalidation refetches the issue caches **behind the rows already drawn**, so nothing blanks.
  useEffect(() => {
    router.refresh();
    invalidatePickerData(collectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open, not on every render
  }, []);

  // Only for the inline create dialogs' catalog-number labels: an issue may override its area's
  // prefix (#377), and the input a number is typed into should be labelled with the prefix that
  // number will carry. The list below resolves its own for the rows it renders.
  const { vendorMapFor, primaryVendorByArea } = useAreaVendorMaps(areas, collectionId);

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
    yearFacetFilters,
    { areaId, includeSubAreas }
  );

  // The same rule one axis over (#843): the area counts drop the area and keep the year, so a row
  // says what picking that area would leave.
  const areaFacetFilters: IssueAreaFacetFilters = useMemo(
    () => ({
      search: search || undefined,
      searchCatalogVendorId: parsedSearch.vendorId ?? undefined,
      searchCatalogNumber: parsedSearch.number || undefined,
      year: year || undefined,
    }),
    [search, parsedSearch, year]
  );

  const { data: areaFacets } = useIssueAreaFacets(collectionId, areaFacetFilters);

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useIssuesInfinite(collectionId, filters, { areaId, includeSubAreas });
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
        if (result.issueId) {
          setJustCreatedIssueId(result.issueId);
          // A new issue opens on its (empty) tree, where its first stamp is added — and, like any
          // issue opened, it stays open the next time the picker is.
          pickerTree.setIssueExpanded(result.issueId, true);
        }
        setCreate(null);
        setCreateError(undefined);
        invalidatePickerData(collectionId);
        void invalidateStampsAndIssues(collectionId);
      } else if (result.status === "error") {
        setCreateError(result.message);
      }
    });
  }

  function handleCreateStamp(issueId: string, fd: FormData) {
    startTransition(async () => {
      const result = await askUmbrella((answer) =>
        addStampToIssueAction(collectionId, issueId, withUmbrellaAnswer(fd, answer))
      );
      if (result.status === "success" && result.stampId) {
        // #182: creating a stamp inline just adds it to the picker — refresh so it appears
        // in its issue's (already-expanded) tree, then close the create dialog. It is not
        // auto-selected, and the browser stays open, so the user still picks it explicitly
        // (or keeps browsing), mirroring inline issue creation.
        setCreate(null);
        setCreateError(undefined);
        invalidatePickerData(collectionId);
        // The stamp exists everywhere, not only in this picker (#918): `invalidatePickerData`
        // covers the issue caches the rows are drawn from and nothing at all on the Stamps list.
        void invalidateStampsAndIssues(collectionId);
      } else if (result.status === "error") {
        setCreateError(result.message);
      }
    });
  }

  function handleCreateVariantRange(issueId: string, parentStampId: string, fd: FormData) {
    startTransition(async () => {
      const result = await askUmbrella((answer) =>
        addVariantRangeAction(collectionId, issueId, parentStampId, withUmbrellaAnswer(fd, answer))
      );
      if (result.status === "success") {
        // Same as the single create above (#182): the run joins the issue's tree and the collector
        // picks from it themselves — a range is added *so that* the right variant can be chosen,
        // and which of the six that is, is the question the picker was opened to answer.
        setCreate(null);
        setCreateError(undefined);
        invalidatePickerData(collectionId);
        void invalidateStampsAndIssues(collectionId);
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
        title={title}
        onClose={onClose}
        // A create dialog stacks above this one; while it is up this dialog must stop dismissing
        // itself, or one Esc would close both.
        dismissable={!create && !checklistsFor}
        maxWidth="min(96vw, 110rem)"
        height={PICKER_DIALOG_HEIGHT}
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
            areaFacets={areaFacets}
            yearFacets={yearFacets}
            yearsLoading={yearsLoading}
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
              pickerTree={pickerTree}
              onPick={onPick}
              onPickIssue={onPickIssue}
              issueRun={issueRun}
              spanningChecklists={spanningChecklists}
              onNewChecklist={setChecklistsFor}
              marked={marked}
              onCompare={onCompare}
              onNewIssue={(a) => openCreate({ kind: "issue", areaId: a })}
              onNewStamp={(issue) => openCreate({ kind: "stamp", issue })}
              onNewVariant={(issue, parent) => openCreate({ kind: "stamp", issue, parent })}
              onNewVariantRange={(issue, parent) =>
                openCreate({ kind: "variant-range", issue, parent })
              }
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

          {create.kind === "variant-range" &&
            (() => {
              const { issue, parent } = create;
              return (
                <AddVariantRangeDialog
                  aside={aside}
                  asideWidth={asideWidth}
                  collectionId={collectionId}
                  issueId={issue.id}
                  issueName={issueLabel(issue.name, issue.year)}
                  areaId={issue.collectionAreaId}
                  parent={{
                    stampId: parent.stampId,
                    name: parent.name,
                    catalogNumbers: parent.catalogNumbers,
                  }}
                  vendors={[...vendorMapFor(issue.collectionAreaId, issue.id).values()]}
                  primaryVendorId={primaryVendorByArea.get(issue.collectionAreaId) ?? null}
                  isPending={isPending}
                  error={createError}
                  onClose={closeCreate}
                  onSubmit={(fd) => handleCreateVariantRange(issue.id, parent.stampId, fd)}
                />
              );
            })()}
        </div>
      )}

      {/* A run's issue with no checklist yet (#1225): the issue's own checklist editor, over the
          picker. Closing it leaves the row offering whatever was made. */}
      {checklistsFor && (
        <ChecklistsDialog
          scope={{
            collectionId,
            issueId: checklistsFor.id,
            issueLabel: issueLabel(checklistsFor.name, checklistsFor.year),
            vendorMap: vendorMapFor(checklistsFor.collectionAreaId, checklistsFor.id),
            primaryVendorId: primaryVendorByArea.get(checklistsFor.collectionAreaId) ?? null,
          }}
          onClose={() => setChecklistsFor(null)}
        />
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
  pickerTree,
  onPick,
  onPickIssue,
  issueRun,
  spanningChecklists,
  onNewChecklist,
  marked,
  onCompare,
  onNewIssue,
  onNewStamp,
  onNewVariant,
  onNewVariantRange,
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
  /** The remembered tree (#1616): what is open, and the issue last picked from. */
  pickerTree: PickerTree;
  onPick: (picked: PickedStamp) => void;
  onPickIssue?: (picked: PickedIssue) => void;
  /** Browsing for the checklist a run of tiles is identified as (#1220, #1225). */
  issueRun?: IssueRunPick;
  /** Checklists spanning issues, offered on the rows of the issues they cover. */
  spanningChecklists: readonly SpanningChecklistSummary[];
  /** Open the checklist editor for an issue that has none to build a run on. */
  onNewChecklist: (issue: IssueListItem) => void;
  /** Stamps already taken by the caller, marked on their rows (#607). */
  marked?: { stampIds: ReadonlySet<string>; label: string; hint: string };
  /** Open the reference comparison on a stamp (#1005). */
  onCompare?: (stamp: { stampId: string; issueId: string }) => void;
  onNewIssue: (areaId: string | null) => void;
  onNewStamp: (issue: IssueListItem) => void;
  onNewVariant: (issue: IssueListItem, parent: StampNodeData) => void;
  onNewVariantRange: (issue: IssueListItem, parent: StampNodeData) => void;
}) {
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  // Effective vendor entries + primary vendor per area (ancestor-inherited), matching how the main
  // issues list builds them — a parent/"All areas" mixes many areas — and applying each issue's own
  // prefix override (#377), so the picker's chips and its search keys read like the list's.
  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  // Tree or Flat for an issue with several checklists (#1585): the Issues list's own remembered
  // choice (#1520), so it is made once and read the same on both.
  const [checklistDisplay, setChecklistDisplay] = useChecklistDisplayMode(collectionId);

  const expandedIds = useMemo(
    () => new Set(pickerTree.state.expanded),
    [pickerTree.state.expanded]
  );

  // **The picker opens on the issue last picked from** (#1616), so the branch left open is on screen
  // rather than somewhere down the list. Once per open, on the first rows drawn: an issue not among
  // them (filtered out, or on a page not loaded yet) is not chased — jumping there later, as the
  // collector scrolls, would move the list under them.
  //
  // The issues above it may still be loading the trees they were left open on, and each one that
  // arrives pushes the row down; the browser's scroll anchoring holds it where it is, but not every
  // browser anchors, so the row is also **pinned** while the list settles — until the collector
  // touches the list, after which where it is scrolled is theirs.
  const listRef = useRef<HTMLDivElement>(null);
  const scrollSpent = useRef(false);
  const releasePin = useRef<(() => void) | null>(null);
  const lastPickedIssueId = pickerTree.state.lastPickedIssueId;
  useEffect(() => {
    if (isLoading || scrollSpent.current) return;
    scrollSpent.current = true;
    const list = listRef.current;
    const row =
      list && lastPickedIssueId
        ? list.querySelector<HTMLElement>(`[data-picker-issue="${CSS.escape(lastPickedIssueId)}"]`)
        : null;
    if (!list || !row) return;
    const observer = new ResizeObserver(() => pin());
    const release = () => {
      observer.disconnect();
      releasePin.current = null;
      for (const type of RELEASE_EVENTS) list.removeEventListener(type, release);
    };
    function pin() {
      if (!row!.isConnected) return release();
      list!.scrollTop += row!.getBoundingClientRect().top - list!.getBoundingClientRect().top;
    }
    pin();
    if (list.firstElementChild) observer.observe(list.firstElementChild);
    for (const type of RELEASE_EVENTS) list.addEventListener(type, release, { passive: true });
    releasePin.current = release;
    return release;
  }, [isLoading, lastPickedIssueId]);
  // A new search or area is the collector moving on too: the list is theirs from there.
  useEffect(() => () => releasePin.current?.(), [filter, selectedAreaId]);

  function handlePick(node: StampNodeData, unknownVariant: boolean, issue: IssueListItem) {
    // Browsing for a checklist (#1225): the stamp pressed picks one only where that says which — the
    // row's only checklist, or the only one of the row's that holds this stamp. Otherwise the press
    // leaves the choice to the row's own buttons.
    if (issueRun) {
      const options = runChecklistOptions(issue, spanningChecklists);
      const holding = options.filter((c) =>
        c.spans
          ? spanningChecklists.some((s) => s.id === c.id && s.stampIds.includes(node.stampId))
          : node.checklistIds.includes(c.id)
      );
      const picked = options.length === 1 ? options[0] : holding.length === 1 ? holding[0] : null;
      if (picked) {
        pickerTree.setLastPickedIssue(issue.id);
        issueRun.onPick(picked.id, issue);
      }
      return;
    }
    pickerTree.setLastPickedIssue(issue.id);
    const vm = vendorMapFor(issue.collectionAreaId, issue.id);
    const labels = pickedCatalogLabels(
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
      ...labels,
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
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <TextInput
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder={selectedAreaId ? "Filter issues in this area…" : "Filter issues…"}
          style={{ ...SEARCH_STYLE, flex: 1 }}
          aria-label="Filter issues"
          // Focus + select the remembered filter text on open, so typing overwrites it (#183).
          data-autofocus-select
        />
        <ChecklistDisplaySwitcher value={checklistDisplay} onChange={setChecklistDisplay} />
        {/* Specialised checklists (#1617): out of the rows, the branches and the set buttons until on. */}
        <SpecialisedChecklistsToggle />
        <button
          type="button"
          onClick={() => onNewIssue(selectedAreaId)}
          style={NEW_ISSUE_BUTTON_STYLE}
        >
          + New issue
        </button>
      </div>
      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {isLoading ? (
          <p style={HINT_STYLE}>Loading issues…</p>
        ) : issues.length === 0 ? (
          <p style={HINT_STYLE}>
            {search ? "No issues match your filter." : "No issues here yet."}
          </p>
        ) : (
          <div>
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
              userExpanded={expandedIds.has(issue.id)}
              onSetExpanded={(open) => pickerTree.setIssueExpanded(issue.id, open)}
              branchToggles={pickerTree.state.branches[issue.id] ?? NO_BRANCH_TOGGLES}
              onSetBranch={(key, open) => pickerTree.setBranchOpen(issue.id, key, open)}
              justAdded={issue.id === justCreatedIssueId}
              search={search}
              checklistDisplay={checklistDisplay}
              onPick={handlePick}
              marked={marked}
              onCompare={onCompare}
              issueRun={
                issueRun
                  ? {
                      tileCount: issueRun.tileCount,
                      checklists: runChecklistOptions(issue, spanningChecklists),
                      onPick: (checklistId) => {
                        pickerTree.setLastPickedIssue(issue.id);
                        issueRun.onPick(checklistId, issue);
                      },
                      onNewChecklist: () => onNewChecklist(issue),
                    }
                  : undefined
              }
              onPickIssue={
                onPickIssue
                  ? (checklist) => {
                      pickerTree.setLastPickedIssue(issue.id);
                      onPickIssue({
                        checklistId: checklist.id,
                        label:
                          issue.checklists.length > 1
                            ? `${issueLabel(issue.name, issue.year)} — ${checklist.name}`
                            : issueLabel(issue.name, issue.year),
                        requiredCount: checklist.stampCount,
                      });
                    }
                  : undefined
              }
              onNewStamp={() => onNewStamp(issue)}
              onNewVariant={(parent) => onNewVariant(issue, parent)}
              onNewVariantRange={(parent) => onNewVariantRange(issue, parent)}
            />
          ))}
          <InfiniteScrollSentinel
            onLoadMore={onLoadMore}
            hasMore={hasMore}
            isLoading={isFetchingMore}
          />
          </div>
        )}
      </div>
    </>
  );
}

/** A run's checklist button: accented, since it is the one press the picker is open for. */
const RUN_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  padding: "0.25rem 0.5rem",
  background: "var(--color-accent-soft)",
  color: "var(--color-accent)",
  border: "1px solid var(--color-accent)",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** What ends the scroll-to-last-picked pin (#1616): the collector's own hand on the list. */
const RELEASE_EVENTS = ["wheel", "pointerdown", "keydown", "touchstart"] as const;

/** No branch toggled by hand — one object, so a row's props hold across renders. */
const NO_BRANCH_TOGGLES: Record<string, boolean> = {};

/** No checklist narrowing — one array, so the tree's memo holds across renders. */
const NO_CHECKLIST_IDS: string[] = [];

/** A lot's whole-checklist button (#121; #531). */
const LOT_BUTTON_STYLE: React.CSSProperties = {
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
};

/** Take a checklist for a run of tiles (#1225) — on the issue row, or on the checklist's branch. */
function RunChecklistButton({
  checklist,
  tileCount,
  label,
  onPick,
}: {
  checklist: RunChecklistOption;
  tileCount: number;
  label: string;
  onPick: () => void;
}) {
  return (
    <Tooltip
      content={`Give the ${tileCount} ticked tiles the stamps of “${checklist.name}” (${checklist.stampCount}), in its own order${checklist.spans ? " — it spans issues" : ""}`}
      align="end"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
        style={{ ...RUN_BUTTON_STYLE, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
      >
        {label}
        <SpecialisedMark kind={checklist.kind} />
      </button>
    </Tooltip>
  );
}

/** Add a whole checklist to the lot (#121; #531) — on the issue row, or on the checklist's branch. */
function LotChecklistButton({
  checklist,
  label,
  onPick,
}: {
  checklist: IssueChecklistSummary;
  label: string;
  onPick: () => void;
}) {
  return (
    <Tooltip content={`Add every stamp on “${checklist.name}” to the lot`} align="end">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
        style={{ ...LOT_BUTTON_STYLE, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
      >
        {label}
        <SpecialisedMark kind={checklist.kind} />
      </button>
    </Tooltip>
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
  userExpanded,
  onSetExpanded,
  branchToggles,
  onSetBranch,
  justAdded,
  search,
  checklistDisplay,
  onPick,
  onPickIssue,
  issueRun,
  marked,
  onCompare,
  onNewStamp,
  onNewVariant,
  onNewVariantRange,
}: {
  collectionId: string;
  issue: IssueListItem;
  areaName: string | null;
  showArea: boolean;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  isLast: boolean;
  /** Whether the collector has this issue open (#1616) — remembered across opens of the picker. */
  userExpanded: boolean;
  onSetExpanded: (open: boolean) => void;
  /** The branches opened or closed by hand, by checklist id (`none` for the off-checklist one). */
  branchToggles: Record<string, boolean>;
  onSetBranch: (key: string, open: boolean) => void;
  /** Flash this row once right after the issue is created inline (#158). */
  justAdded: boolean;
  /** The search the page was fetched with, empty when there is none. The row decides for itself
   *  whether its own header explains the hit and, when it does not, which of its stamps did (#186). */
  search: string;
  /** How an issue with several checklists shows its stamps (#1585): branches, or one run. */
  checklistDisplay: ChecklistDisplayMode;
  onPick: (node: StampNodeData, unknownVariant: boolean, issue: IssueListItem) => void;
  /** When set, an "Add whole issue" button appears on the row header (lot intake, #121). */
  /** Called with the checklist whose button was pressed (#531). */
  onPickIssue?: (checklist: IssueChecklistSummary) => void;
  /** Take one of this issue's checklists for a run of tiles (#1220, #1225). */
  issueRun?: {
    tileCount: number;
    checklists: RunChecklistOption[];
    onPick: (checklistId: string) => void;
    onNewChecklist: () => void;
  };
  /** Stamps already taken by the caller, marked on their rows (#607). */
  marked?: { stampIds: ReadonlySet<string>; label: string; hint: string };
  /** Open the reference comparison on a stamp (#1005). */
  onCompare?: (stamp: { stampId: string; issueId: string }) => void;
  onNewStamp: () => void;
  onNewVariant: (parent: StampNodeData) => void;
  onNewVariantRange: (parent: StampNodeData) => void;
}) {
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
  // surfaced through its stamps narrows the rest of its tree.
  const matchedStampIds = useMemo(
    () => matchedStampsInIssue(issue, members, { search }, vendorMap),
    [issue, members, search, vendorMap]
  );
  // An inner-stamp match forces the issue open (so the matching stamp is visible, #186); when the
  // filter clears, the row falls back to the user's own toggle.
  const isExpanded = userExpanded || matchedStampIds !== null;
  // Several checklists are drawn as branches in tree mode, as on the Issues list (#1520, #1585), and
  // the chip filter has nothing to do beside them, the branches already separating the checklists.
  const multiChecklist = issue.checklists.length > 1;
  const asBranches = checklistDisplay === "tree" && multiChecklist;
  // Narrowing the tree by checklist (#531), as on the issues list and the issue detail page.
  // Local to the row and not remembered: a picker is opened to answer one question.
  const [treeChecklistIds, setTreeChecklistIds] = useState<string[]>([]);
  const effectiveChecklistIds = asBranches ? NO_CHECKLIST_IDS : treeChecklistIds;
  const fullTree = useMemo(() => buildStampTree(members), [members]);
  // Both narrowings in one walk, the Issues list' own call (#631): the stamps the search did not
  // match are **hidden**, not faded, and the ancestors they hang under come back in `contextIds`
  // to be dimmed.
  const { tree, contextIds } = useMemo(
    () => filterStampTreeBy(fullTree, effectiveChecklistIds, matchedStampIds),
    [fullTree, effectiveChecklistIds, matchedStampIds]
  );
  const branches = useMemo(
    () => (asBranches ? checklistBranches(fullTree, issue.checklists, matchedStampIds) : null),
    [asBranches, fullTree, issue.checklists, matchedStampIds]
  );

  // Each checklist's colour by its place in the issue's order (#1519): the row chips, the filter
  // chips and the branch headings read it from here, as on the Issues list.
  const checklistColors = useMemo(() => checklistColorMap(issue.checklists), [issue.checklists]);
  const checklistChips = useMemo<ChecklistChipData[] | null>(
    () =>
      multiChecklist
        ? issue.checklists.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            tokens: checklistColors.get(c.id)!,
          }))
        : null,
    [multiChecklist, issue.checklists, checklistColors]
  );

  // Which branches are open: collapsed by default, open while the search narrowed the tree (#631's
  // reason — a match behind a collapsed arrow is a match nobody sees). The collector's own toggle
  // wins either way, and lasts while the issue stays open — across opens of the picker since #1616;
  // folding the issue forgets them.
  // A row only the search opened is not the collector's to remember, so its branches are held here,
  // for as long as the row is on screen, as every branch was before.
  const [searchBranchToggles, setSearchBranchToggles] = useState<Record<string, boolean>>({});
  const toggles = userExpanded ? branchToggles : searchBranchToggles;
  const branchOpen = (key: string) => toggles[key] ?? !!matchedStampIds;
  const toggleBranch = (key: string) => {
    if (userExpanded) onSetBranch(key, !branchOpen(key));
    else setSearchBranchToggles((prev) => ({ ...prev, [key]: !branchOpen(key) }));
  };
  const toggleIssue = () => {
    if (isExpanded) setSearchBranchToggles({});
    onSetExpanded(!isExpanded);
  };

  // The branch headings' completeness, the Issues list's own read under its own key, so the two
  // share it and whatever refreshes this issue refreshes it.
  const { data: checklistHeadlines } = useQuery({
    queryKey: [...issueKeys.members(collectionId, issue.id).slice(0, 4), "checklist-headlines"],
    queryFn: () => getIssueChecklistHeadlinesAction(collectionId, issue.id),
    enabled: isExpanded && asBranches,
  });

  // A checklist's own presses move to its branch where there is one (#1585); a run's checklist
  // spanning issues has no branch here, so it stays on the row.
  const headerRunChecklists = issueRun
    ? asBranches
      ? issueRun.checklists.filter((c) => c.spans)
      : issueRun.checklists
    : [];
  const headerLotChecklists = onPickIssue && !asBranches ? issue.checklists : [];

  const renderNodes = (
    nodes: StampTreeNodeData[],
    depth: number,
    nodeContextIds: Set<string>,
    lastIsLast: boolean
  ) =>
    nodes.map((treeNode, i) => (
      <SelectableStampNode
        key={treeNode.node.stampId}
        treeNode={treeNode}
        depth={depth}
        contextIds={nodeContextIds}
        collectionId={issue.collectionId}
        vendorMap={vendorMap}
        primaryVendorId={primaryVendorId}
        isLast={lastIsLast && i === nodes.length - 1}
        onPick={(node, unknownVariant) => onPick(node, unknownVariant, issue)}
        // The create dialog prefills from the parent's own numbers and year (#386/#360),
        // so it takes the node rather than its id — the row holds the tree it came from.
        onNewVariant={(parentStampId) => {
          const parent = members.find((m) => m.stampId === parentStampId);
          if (parent) onNewVariant(parent);
        }}
        // The range dialog numbers the run off the base stamp's own number in the area's
        // primary catalogue, so it takes the node for the same reason.
        onNewVariantRange={(parentStampId) => {
          const parent = members.find((m) => m.stampId === parentStampId);
          if (parent) onNewVariantRange(parent);
        }}
        marked={marked}
        onCompare={
          onCompare
            ? (node) => onCompare({ stampId: node.stampId, issueId: issue.id })
            : undefined
        }
        narrowed={!!matchedStampIds}
        checklistChips={checklistChips}
      />
    ));

  const emptyNote = (text: string) => (
    <div
      style={{
        padding: "0.875rem 0 0.875rem 0.5rem",
        fontSize: "0.875rem",
        color: "var(--color-text-muted)",
        fontStyle: "italic",
      }}
    >
      {text}
    </div>
  );

  return (
    <div data-picker-issue={issue.id} style={issueBlockStyle(isExpanded, isLast)}>
      {/* An open issue is one block, set apart from its neighbours (#1729). */}
      {isExpanded && <IssueBlockBar />}
      <div
        className={justAdded ? "just-added-flash" : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={toggleIssue}
        style={{
          padding: "0.875rem 1.25rem",
          background: issueHeaderBackground(isExpanded, hovered),
          transition: "background 0.1s ease",
          cursor: "pointer",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}
      >
        {/* Expand/collapse toggle sits first, before the photo, in a full-height cell (#1589). */}
        <CaretCell
          expanded={isExpanded}
          onToggle={toggleIssue}
          bleed={{ top: "0.875rem", bottom: "0.875rem", left: "1.25rem", right: "0.375rem" }}
        />

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

          {/* The press this picker is open for when a run of tiles is being identified (#1220):
              the checklist it is built on (#1225). On every row, a new issue included — one with no
              checklist yet offers the editor to make one, since there is nothing else to build on.
              An issue drawn as branches carries its own checklists' presses on the branches (#1585). */}
          {issueRun &&
            (issueRun.checklists.length === 0 ? (
              <Tooltip
                content="This issue has no checklist to build the run on. Make one, then pick it here"
                align="end"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    issueRun.onNewChecklist();
                  }}
                  style={RUN_BUTTON_STYLE}
                >
                  New checklist…
                </button>
              </Tooltip>
            ) : (
              headerRunChecklists.map((checklist) => (
                <RunChecklistButton
                  key={checklist.id}
                  checklist={checklist}
                  tileCount={issueRun.tileCount}
                  label={
                    issueRun.checklists.length === 1
                      ? "Its stamps, in turn"
                      : `${checklist.name}, in turn`
                  }
                  onPick={() => issueRun.onPick(checklist.id)}
                />
              ))
            ))}

          {/* One button per checklist (#531). With one it reads as it always did; with several
              each names its own set, which is better than a chooser the collector has to open to
              answer a question the row can already ask. On the branches instead where there are
              branches (#1585). */}
          {onPickIssue &&
            headerLotChecklists
              .filter((c) => c.stampCount > 0)
              .map((checklist) => (
                <LotChecklistButton
                  key={checklist.id}
                  checklist={checklist}
                  label={`+ ${issue.checklists.length === 1 ? "Whole issue" : checklist.name} (${checklist.stampCount})`}
                  onPick={() => onPickIssue(checklist)}
                />
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
            // On the block's tint, not a surface of its own.
            borderTop: "1px solid var(--color-border)",
            marginLeft: "1.25rem",
            borderLeft: "2px solid var(--color-border)",
          }}
        >
          {/* Narrowing by checklist — only where there is a choice to make, and not beside
              branches, which already separate the checklists. */}
          {multiChecklist && !asBranches && (
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
                colors={checklistColors}
              />
            </div>
          )}
          {members.length === 0
            ? emptyNote(membersLoading ? "Loading stamps…" : "No stamps in this issue yet.")
            : branches
              ? branches
                  // A branch the search emptied says nothing; the rest are what matched.
                  .filter((b) => !matchedStampIds || b.tree.length > 0)
                  .map((branch) => {
                    const key = branch.checklistId ?? "none";
                    const checklist = branch.checklistId
                      ? (issue.checklists.find((c) => c.id === branch.checklistId) ?? null)
                      : null;
                    const runChecklist =
                      checklist && issueRun?.checklists.find((c) => c.id === checklist.id && !c.spans);
                    return (
                      <ChecklistBranch
                        key={key}
                        checklist={checklist}
                        stampCount={checklist ? checklist.stampCount : countOffChecklist(fullTree)}
                        tokens={checklist ? checklistColors.get(checklist.id) : undefined}
                        headline={checklist ? checklistHeadlines?.[checklist.id] : undefined}
                        open={branchOpen(key)}
                        onToggle={() => toggleBranch(key)}
                        // The picker's own checklist presses, not the Issues list's `⋮`: the
                        // picker is for choosing (#1585).
                        actions={
                          checklist && (
                            <>
                              {issueRun && runChecklist && (
                                <RunChecklistButton
                                  checklist={runChecklist}
                                  tileCount={issueRun.tileCount}
                                  label="Its stamps, in turn"
                                  onPick={() => issueRun.onPick(checklist.id)}
                                />
                              )}
                              {onPickIssue && checklist.stampCount > 0 && (
                                <LotChecklistButton
                                  checklist={checklist}
                                  label={`+ Whole checklist (${checklist.stampCount})`}
                                  onPick={() => onPickIssue(checklist)}
                                />
                              )}
                            </>
                          )
                        }
                      >
                        {branch.tree.length === 0 ? (
                          <div
                            style={{
                              padding: "0.5rem 0 0.5rem 2.25rem",
                              fontSize: "0.8125rem",
                              color: "var(--color-text-muted)",
                              fontStyle: "italic",
                              borderBottom: "1px solid var(--color-border)",
                            }}
                          >
                            No stamps on this checklist yet.
                          </div>
                        ) : (
                          // One level in, under the heading; every row keeps its rule, since the
                          // next branch's heading follows the last of them.
                          renderNodes(branch.tree, 1, branch.contextIds, false)
                        )}
                      </ChecklistBranch>
                    );
                  })
              : tree.length === 0
                ? // Said explicitly rather than shown as an empty row: with a text search also on
                  // (which is what forces a row open, #186), an unexplained blank reads as "this
                  // issue has nothing", when in fact the checklist filter is what emptied it.
                  emptyNote("No stamp on the checklists you picked.")
                : renderNodes(tree, 0, contextIds, true)}
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
