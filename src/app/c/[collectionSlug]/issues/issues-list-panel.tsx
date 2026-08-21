"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import {
  createIssueAction,
  updateIssueAction,
  deleteIssueAction,
  addStampToIssueAction,
  addStampRangeToIssueAction,
  moveStampNodeAction,
  reparentStampNodeAction,
  moveIssueToAreaAction,
  mergeIssuesAction,
  getIssueRangeSuggestionsAction,
  applyIssueRangeSuggestionAction,
  type IssueActionState,
} from "@/app/actions/issues";
import { MoveIssueAreaDialog } from "./move-issue-area-dialog";
import { AddStampRangeDialog } from "./add-stamp-range-dialog";
import { MergeIssueDialog } from "./merge-issue-dialog";
import { useToast } from "@/app/toast-provider";
import { RangeExtendedDialog } from "./range-extended-dialog";
import { ReparentStampDialog } from "./reparent-stamp-dialog";
import type { IssueListItem, IssueSortBy, StampNodeData, IssueRangeSuggestion } from "@/lib/issues";
import type { CollectionAreaData } from "@/lib/areas";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { IssueDialog } from "@/app/c/[collectionSlug]/shared/issue-form-dialog";
import { DeleteIssueDialog } from "./delete-issue-dialog";
import { DeleteStampDialog } from "@/app/c/[collectionSlug]/shared/delete-stamp-dialog";
import {
  useIssuesInfinite,
  useIssueYears,
  useInvalidateIssues,
  type IssueListFilters,
  type IssueYearFacetFilters,
} from "./use-issues-query";
import {
  IssueRow,
  InfiniteScrollSentinel,
  type AddStampParent,
  type ExpandStampSignal,
  type IssueRowCallbacks,
} from "./issue-row";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { usePersistedCollectionValue } from "@/app/c/[collectionSlug]/shared/use-persisted-collection-value";
import { ListToolbar, type SortOption, type CatalogVendorOption } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { usePersistedSort } from "@/app/c/[collectionSlug]/shared/use-persisted-sort";
import { ConditionPriceSwitcher } from "@/app/c/[collectionSlug]/shared/condition-price-switcher";
import { useDisplayCondition } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { FormatPriceSwitcher } from "@/app/c/[collectionSlug]/shared/format-price-switcher";
import { useDisplayFormat } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { effectivePrimaryVendorId, resolveAreaFilterIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useSubtreeScope } from "@/app/c/[collectionSlug]/shared/subtree-scope";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { parseCatalogSearch } from "@/lib/catalog-number";
import type { StampFilterQuery } from "@/lib/issue-stamp-match";

// ── Styles ──────────────────────────────────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

// ── Panel ───────────────────────────────────────────────────────────────────

type DialogState =
  | { kind: "none" }
  | { kind: "create-issue" }
  | {
      kind: "edit-issue";
      issue: IssueListItem;
    }
  | {
      kind: "delete-issue";
      issue: IssueListItem;
    }
  | {
      kind: "add-stamp";
      issueId?: string;
      parent?: AddStampParent;
    }
  | { kind: "edit-stamp"; issueId: string; stamp: StampNodeData }
  | { kind: "move-issue-area"; issue: IssueListItem }
  | { kind: "add-stamp-range"; issue: IssueListItem }
  | { kind: "merge-issue"; issue: IssueListItem }
  | {
      kind: "range-extended";
      issueId: string;
      issueLabel: string;
      suggestions: IssueRangeSuggestion[];
    }
  | { kind: "move-stamp"; issueId: string; stampId: string }
  | { kind: "reparent-stamp"; issueId: string; stampId: string }
  | { kind: "delete-stamp"; issueId: string; stampId: string; stampName: string };

interface IssuesListPanelProps {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
}

const ISSUE_SORT_OPTIONS: SortOption[] = [
  { value: "year", label: "Year" },
  { value: "name", label: "Name" },
  { value: "catalogNumber", label: "Catalog number" },
];

export function IssuesListPanel({
  collectionId,
  collectionSlug,
  areas,
  baseCurrency,
}: IssuesListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Area + year are shared across the lists (#143). The URL keeps priority: when
  // the `areaId` / `year` param is present it wins (an explicit "all" is carried
  // as the `all` sentinel so it is distinguishable from an absent param); when
  // absent — a fresh navigation to this list — we fall back to the per-collection
  // store. The effective selection is mirrored back into the store below.
  const { storedAreaId, storedYear, writeStore } =
    useCollectionFilterStore(collectionId);
  const urlAreaId = searchParams.get("areaId");
  const urlYear = searchParams.get("year");
  const filterAreaId =
    urlAreaId !== null ? (urlAreaId === "all" ? null : urlAreaId) : storedAreaId;
  const year =
    urlYear !== null ? (urlYear === "all" ? "" : urlYear) : (storedYear ?? "");

  useEffect(() => {
    writeStore({ areaId: filterAreaId, year: year || null });
  }, [filterAreaId, year, writeStore]);

  // Whether a selected area brings its sub-areas with it is the collector's choice (#385); the
  // toggle lives in the area sidebar and the resolution is shared so every list agrees.
  const [includeSubAreas] = useSubtreeScope("area");
  const filterAreaIds = useMemo(
    () => resolveAreaFilterIds(areas, filterAreaId, includeSubAreas) ?? undefined,
    [filterAreaId, areas, includeSubAreas]
  );
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<IssueActionState>({
    status: "idle",
  });
  const [isPending, startTransition] = useTransition();
  const [autoExpandIssueId, setAutoExpandIssueId] = useState<string | null>(null);
  // The parent a sub-stamp was just added under (#359) — the tree expands it so the new child is
  // visible instead of disappearing behind a collapsed arrow. The nonce makes a repeat add under
  // the same parent a fresh signal.
  const [autoExpandStamp, setAutoExpandStamp] = useState<ExpandStampSignal | null>(null);
  const { invalidateList, invalidateMembers } = useInvalidateIssues();

  const search = searchParams.get("search") ?? "";
  const { sortBy, sortDir, persistSort } = usePersistedSort<IssueSortBy>(
    "issues", "year", "asc",
    searchParams.get("sortBy"),
    searchParams.get("sortDir"),
    ["year", "name", "catalogNumber"]
  );
  // Catalog vendor filter, remembered per collection (#115): the URL param wins when present
  // (shareable), else fall back to the last-selected vendor on a fresh visit. Shared across the
  // stamp and issue lists so a chosen catalog carries between them.
  const [storedCatalogVendor, rememberCatalogVendor] = usePersistedCollectionValue(
    "list-catalog-vendor",
    collectionId
  );
  const catalogVendorId = searchParams.has("catalogVendorId")
    ? (searchParams.get("catalogVendorId") ?? "")
    : (storedCatalogVendor ?? "");
  const catalogNumber = searchParams.get("catalogNumber") ?? "";

  const { conditions, displayConditionId, setDisplayConditionId } =
    useDisplayCondition(collectionId);
  const { formats, displayFormatId, setDisplayFormatId } = useDisplayFormat(collectionId);

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

  // Prefixed catalog search (#146): a vendor abbreviation typed into the number box
  // ("Mi PL 200") resolves and overrides the dropdown; a bare number falls back to
  // the dropdown vendor, or searches across all vendors when none is selected.
  const parsedCatalog = useMemo(
    () => parseCatalogSearch(catalogNumber, catalogVendors),
    [catalogNumber, catalogVendors]
  );
  const effectiveCatalogVendorId = parsedCatalog.vendorId ?? catalogVendorId;
  const effectiveCatalogNumber = parsedCatalog.number;

  // The quick search box gets the same prefix parsing (#289): "Mi PL 200" or "BL31" is
  // never stored verbatim, so alongside the plain text we send the parsed vendor (when an
  // abbreviation led the input) and the bare number, which the server ORs into the search.
  const parsedSearch = useMemo(
    () => parseCatalogSearch(search, catalogVendors),
    [search, catalogVendors]
  );

  const filters: IssueListFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      searchCatalogVendorId: parsedSearch.vendorId ?? undefined,
      searchCatalogNumber: parsedSearch.number || undefined,
      catalogVendorId: effectiveCatalogVendorId || undefined,
      catalogNumber: effectiveCatalogNumber || undefined,
      year: year || undefined,
      displayConditionId: displayConditionId || undefined,
      displayFormatId: displayFormatId || undefined,
      sortBy,
      sortDir,
    }),
    [filterAreaIds, search, parsedSearch, effectiveCatalogVendorId, effectiveCatalogNumber, year, displayConditionId, displayFormatId, sortBy, sortDir]
  );

  // The half of the filter set a stamp *inside* an issue can satisfy (#631). Handed to every row so
  // an expanded tree shows the variants that matched and the numbering they hang under, rather than
  // the whole tree an Infla-shaped issue would bury them in. Area and year are the issue's own.
  const stampFilter: StampFilterQuery = useMemo(
    () => ({
      search: search || undefined,
      catalogNumber: effectiveCatalogNumber || undefined,
      catalogVendorId: effectiveCatalogVendorId || undefined,
    }),
    [search, effectiveCatalogNumber, effectiveCatalogVendorId]
  );

  const yearFacetFilters: IssueYearFacetFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      searchCatalogVendorId: parsedSearch.vendorId ?? undefined,
      searchCatalogNumber: parsedSearch.number || undefined,
      catalogVendorId: effectiveCatalogVendorId || undefined,
      catalogNumber: effectiveCatalogNumber || undefined,
    }),
    [filterAreaIds, search, parsedSearch, effectiveCatalogVendorId, effectiveCatalogNumber]
  );

  const { data: yearFacets, isLoading: yearsLoading } = useIssueYears(
    collectionId,
    yearFacetFilters
  );

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.push(`/c/${collectionSlug}/issues${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, searchParams]
  );

  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading,
  } = useIssuesInfinite(collectionId, filters);

  const allIssues = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );

  const areaById = useMemo(
    () => new Map(areas.map((a) => [a.id, a])),
    [areas]
  );

  const { primaryVendorByArea, vendorMapFor } = useAreaVendorMaps(areas, collectionId);

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setAutoExpandIssueId(null);
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    invalidateList(collectionId);
  }

  function handleStampSuccess(issueId: string) {
    setDialog({ kind: "none" });
    invalidateMembers(collectionId, issueId);
    invalidateList(collectionId);
  }

  /** After a bulk add-range (#219) or merge (#218), refresh the issue and — if the new
   *  stamps push its declared catalog range beyond its bounds — prompt to widen or keep
   *  it, mirroring the Add-stamp widen-vs-keep choice. Otherwise just close. */
  async function finishWithRangeCheck(issueId: string, issueLabel: string) {
    invalidateMembers(collectionId, issueId);
    invalidateList(collectionId);
    setAutoExpandIssueId(issueId);
    const suggestions = await getIssueRangeSuggestionsAction(collectionId, issueId);
    if (suggestions.length > 0) {
      setActionState({ status: "idle" });
      setDialog({ kind: "range-extended", issueId, issueLabel, suggestions });
    } else {
      setDialog({ kind: "none" });
    }
  }

  function submitAction(
    action: (fd: FormData) => Promise<IssueActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function handleAddStampSubmit(issueId: string, fd: FormData) {
    const newIssueName = fd.get("newIssueName") as string | null;
    const newIssueYear = fd.get("newIssueYear") as string | null;
    // Read the parent before the dialog closes, so the tree can expand it on success (#359).
    const parentStampId =
      dialog.kind === "add-stamp" ? (dialog.parent?.stampId ?? null) : null;

    startTransition(async () => {
      if (!issueId && (newIssueName !== null || newIssueYear !== null)) {
        setDialog({ kind: "none" });
        invalidateList(collectionId);
        return;
      }
      if (!issueId) {
        setActionState({
          status: "error",
          message: "Please select or create an issue.",
        });
        return;
      }
      const result = await addStampToIssueAction(collectionId, issueId, fd);
      setActionState(result);
      if (result.status === "success") {
        if (parentStampId) {
          setAutoExpandStamp((prev) => ({
            stampId: parentStampId,
            nonce: (prev?.nonce ?? 0) + 1,
          }));
        }
        handleStampSuccess(issueId);
      }
    });
  }

  function handleNavigateFilter(areaId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    // Set the `all` sentinel (not delete) so an explicit "all areas" on this list
    // is distinguishable from an absent param that falls back to the store (#143).
    params.set("areaId", areaId ?? "all");
    const qs = params.toString();
    router.push(`/c/${collectionSlug}/issues${qs ? `?${qs}` : ""}`);
  }

  // Confirmation toasts (#541). This screen is a tree scoped to one area, and its three most
  // consequential actions — move to another area, merge into another issue, delete — take the issue
  // out of the branch the collector is looking at. The link matters most there: the issue still
  // exists, it is simply somewhere else, and the toast is the way back to it.
  const { toast } = useToast();

  const issueHref = (issueId: string) => `/c/${collectionSlug}/issues/${issueId}`;

  function handleCreateIssueSubmit(areaId: string, fd: FormData) {
    startTransition(async () => {
      const result = await createIssueAction(collectionId, areaId, fd);
      setActionState(result);
      if (result.status === "success") {
        if (result.issueId) setAutoExpandIssueId(result.issueId);
        handleSuccess();
        toast({
          message: `${(fd.get("name") as string) || "Issue"} created`,
          ...(result.issueId
            ? { href: issueHref(result.issueId), linkLabel: "Open issue" }
            : {}),
        });
      }
    });
  }

  const error =
    actionState.status === "error" ? actionState.message : undefined;

  const callbacks: IssueRowCallbacks = {
    onEdit: (issue) => openDialog({ kind: "edit-issue", issue }),
    onDelete: (issue) => openDialog({ kind: "delete-issue", issue }),
    onMoveIssueArea: (issue) => openDialog({ kind: "move-issue-area", issue }),
    onAddStampRange: (issue) => openDialog({ kind: "add-stamp-range", issue }),
    onMergeIssue: (issue) => openDialog({ kind: "merge-issue", issue }),
    onAddStamp: (issueId, parent) => openDialog({ kind: "add-stamp", issueId, parent }),
    onEditStamp: (issueId, stamp) =>
      openDialog({ kind: "edit-stamp", issueId, stamp }),
    onDeleteStamp: (issueId, stampId, stampName) =>
      openDialog({ kind: "delete-stamp", issueId, stampId, stampName }),
    onMoveStamp: (issueId, stampId) =>
      openDialog({ kind: "move-stamp", issueId, stampId }),
    onReparentStamp: (issueId, stampId) =>
      openDialog({ kind: "reparent-stamp", issueId, stampId }),
  };

  return (
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
        filterAreaId={filterAreaId}
        onNavigateArea={handleNavigateFilter}
        yearFacets={yearFacets}
        yearsLoading={yearsLoading}
        selectedYear={year || null}
        onSelectYear={(y) => updateParams({ year: y ?? "all" })}
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
        {/* Toolbar */}
        <ListToolbar
          search={search}
          onSearchChange={(v) => updateParams({ search: v })}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={(sb, sd) => { persistSort(sb as IssueSortBy, sd); updateParams({ sortBy: sb, sortDir: sd }); }}
          sortOptions={ISSUE_SORT_OPTIONS}
          catalogVendors={catalogVendors}
          catalogVendorId={catalogVendorId}
          catalogNumber={catalogNumber}
          onCatalogSearchChange={(vid, num) => {
            rememberCatalogVendor(vid);
            updateParams({ catalogVendorId: vid, catalogNumber: num });
          }}
        >
          <button
            type="button"
            onClick={() => openDialog({ kind: "create-issue" })}
            style={{
              padding: "0.375rem 0.875rem",
              background: "var(--color-action-primary)",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "0.8125rem",
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            + Add issue
          </button>
          <ConditionPriceSwitcher
            conditions={conditions}
            value={displayConditionId}
            onChange={setDisplayConditionId}
          />
          {/* Condition and format together name one cell of the price grid (#343); the format
              control renders nothing at all when the collection defines no formats. */}
          <FormatPriceSwitcher
            formats={formats}
            value={displayFormatId}
            onChange={setDisplayFormatId}
          />
        </ListToolbar>

        {/* Issues list */}
        {isLoading && (
          <div
            style={{
              padding: "2rem",
              color: "var(--color-text-muted)",
              fontSize: "0.9375rem",
            }}
          >
            Loading issues...
          </div>
        )}

        {!isLoading && allIssues.length === 0 && (
          <div
            style={{
              padding: "2rem",
              color: "var(--color-text-muted)",
              fontSize: "0.9375rem",
            }}
          >
            {search || catalogNumber || year
              ? "No issues match your search."
              : filterAreaId
                ? "No issues in this area."
                : "No issues yet. Add one to get started."}
          </div>
        )}

        {allIssues.length > 0 && (
          <div style={{ flex: 1 }}>
            {allIssues.map((issue, idx) => {
              const area = areaById.get(issue.collectionAreaId);
              const primaryVendorId =
                primaryVendorByArea.get(issue.collectionAreaId) ?? null;
              // The issue's own prefix overrides win over its area's (#377).
              const vendorMap = vendorMapFor(issue.collectionAreaId, issue.id);

              return (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  collectionId={collectionId}
                  areas={areas}
                  baseCurrency={baseCurrency}
                  primaryVendorId={primaryVendorId}
                  vendorMap={vendorMap}
                  isLast={idx === allIssues.length - 1 && !hasNextPage}
                  showAreaChip
                  areaName={area?.name}
                  onFilterByArea={handleNavigateFilter}
                  callbacks={callbacks}
                  defaultExpanded={issue.id === autoExpandIssueId}
                  expandStamp={autoExpandStamp}
                  displayConditionId={displayConditionId || undefined}
                  displayFormatId={displayFormatId}
                  formats={formats}
                  stampFilter={stampFilter}
                />
              );
            })}
            <InfiniteScrollSentinel
              onLoadMore={fetchNextPage}
              hasMore={!!hasNextPage}
              isLoading={isFetchingNextPage}
            />
          </div>
        )}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "create-issue" && (
        <IssueDialog
          mode="create"
          collectionId={collectionId}
          areas={areas}
          defaultAreaId={filterAreaId ?? undefined}
          defaultYear={year && year !== "none" ? Number(year) : undefined}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={handleCreateIssueSubmit}
        />
      )}

      {dialog.kind === "edit-issue" && (
        <IssueDialog
          mode="edit"
          collectionId={collectionId}
          areas={areas}
          issue={dialog.issue}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={(fd) => {
            startTransition(async () => {
              const issueId = dialog.issue.id;
              const result = await updateIssueAction(collectionId, issueId, fd);
              setActionState(result);
              if (result.status === "success") {
                handleSuccess();
                toast({
                  message: `${(fd.get("name") as string) || "Issue"} saved`,
                  href: issueHref(issueId),
                  linkLabel: "Open issue",
                });
              }
            });
          }}
        />
      )}

      {dialog.kind === "delete-issue" && (
        <DeleteIssueDialog
          collectionId={collectionId}
          issueId={dialog.issue.id}
          issueName={dialog.issue.name ?? "(unnamed)"}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onConfirm={() => {
            startTransition(async () => {
              const name = dialog.issue.name ?? "Issue";
              const result = await deleteIssueAction(
                collectionId,
                dialog.issue.id
              );
              setActionState(result);
              if (result.status === "success") {
                handleSuccess();
                toast({ message: `${name} deleted` });
              }
            });
          }}
        />
      )}

      {dialog.kind === "delete-stamp" && (
        <DeleteStampDialog
          stampId={dialog.stampId}
          stampName={dialog.stampName}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onConfirm={(mode) => {
            startTransition(async () => {
              const { deleteStampAction } = await import("@/app/actions/stamps");
              const result = await deleteStampAction(dialog.stampId, mode);
              if (result.status === "success") handleStampSuccess(dialog.issueId);
              else if (result.status === "error") setActionState(result);
            });
          }}
        />
      )}

      {dialog.kind === "edit-stamp" &&
        (() => {
          const { issueId, stamp } = dialog;
          const issue = allIssues.find((i) => i.id === issueId);
          if (!issue) return null;
          // Resolved through the issue, so a per-issue prefix override (#377) labels the
          // catalog-number inputs with the prefix the numbers will actually carry.
          const areaVendors = [...vendorMapFor(issue.collectionAreaId, issue.id).values()];
          return (
            <StampFormDialog
              mode="edit"
              stampId={stamp.stampId}
              collectionId={collectionId}
              stamp={{
                ...stamp,
                // The issue's checklists, each ticked where this stamp is on it (#531) — the row
                // carries only the ids it belongs to, and the picker needs the boxes it does not.
                issues: [
                  {
                    issueId,
                    checklists: issue.checklists.map((c) => ({
                      id: c.id,
                      name: c.name,
                      on: stamp.checklistIds.includes(c.id),
                    })),
                  },
                ],
              }}
              areaVendors={areaVendors}
              isPending={isPending}
              error={error}
              onClose={closeDialog}
              onSubmit={(fd) => {
                startTransition(async () => {
                  const { updateStampWithCatalogAction } = await import(
                    "@/app/actions/stamps"
                  );
                  const result = await updateStampWithCatalogAction(
                    stamp.stampId,
                    fd
                  );
                  if (result.status === "success")
                    handleStampSuccess(issueId);
                  else if (result.status === "error")
                    setActionState(result);
                });
              }}
            />
          );
        })()}

      {dialog.kind === "add-stamp" &&
        dialog.issueId &&
        (() => {
          const issue = allIssues.find((i) => i.id === dialog.issueId);
          if (!issue) return null;
          // Already deduplicated by vendor, and carrying the issue's own prefix override (#377).
          const uniqueAreaVendors = [...vendorMapFor(issue.collectionAreaId, issue.id).values()];
          return (
            <StampFormDialog
              mode="add"
              collectionId={collectionId}
              issues={[issue]}
              areaVendors={uniqueAreaVendors}
              prefilledIssueId={issue.id}
              prefilledParentStampId={dialog.parent?.stampId}
              prefilledParentIssuedYear={dialog.parent?.issuedYear ?? null}
              defaultCatalogNumbers={dialog.parent?.catalogNumbers}
              isPending={isPending}
              error={error}
              onClose={closeDialog}
              onSubmit={handleAddStampSubmit}
            />
          );
        })()}

      {dialog.kind === "add-stamp" && !dialog.issueId && (
        <StampFormDialog
          mode="add"
          collectionId={collectionId}
          issues={allIssues}
          areaVendors={[]}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={handleAddStampSubmit}
        />
      )}

      {dialog.kind === "move-issue-area" && (
        <MoveIssueAreaDialog
          collectionId={collectionId}
          issue={dialog.issue}
          areas={areas}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={(fd) =>
            startTransition(async () => {
              const result = await moveIssueToAreaAction(
                collectionId,
                dialog.issue.id,
                fd
              );
              setActionState(result);
              if (result.status === "success") {
                const issueId = dialog.issue.id;
                handleStampSuccess(issueId);
                // The one toast on this screen that is genuinely load-bearing: the issue has just
                // left the area branch on screen, so without the link there is no way back to it
                // short of finding it again.
                toast({
                  message: `${dialog.issue.name ?? "Issue"} moved to another area`,
                  href: issueHref(issueId),
                  linkLabel: "Open issue",
                });
              }
            })
          }
        />
      )}

      {dialog.kind === "add-stamp-range" &&
        (() => {
          const areaId = dialog.issue.collectionAreaId;
          const issueLabel =
            (dialog.issue.name ?? "(unnamed)") +
            (dialog.issue.year ? ` (${dialog.issue.year})` : "");
          return (
            <AddStampRangeDialog
              collectionId={collectionId}
              issueId={dialog.issue.id}
              issueName={issueLabel}
              areaId={areaId}
              vendors={[...vendorMapFor(areaId, dialog.issue.id).values()]}
              primaryVendorId={effectivePrimaryVendorId(areas, areaId)}
              isPending={isPending}
              error={error}
              onClose={closeDialog}
              onSubmit={(fd) =>
                startTransition(async () => {
                  const result = await addStampRangeToIssueAction(
                    collectionId,
                    dialog.issue.id,
                    fd
                  );
                  setActionState(result);
                  if (result.status === "success") {
                    await finishWithRangeCheck(dialog.issue.id, issueLabel);
                  }
                })
              }
            />
          );
        })()}

      {dialog.kind === "merge-issue" &&
        (() => {
          const source = dialog.issue;
          const sourceLabel =
            (source.name ?? "(unnamed)") + (source.year ? ` (${source.year})` : "");
          const targets = allIssues
            .filter(
              (i) => i.id !== source.id && i.collectionAreaId === source.collectionAreaId
            )
            .map((i) => ({
              id: i.id,
              label: (i.name ?? "(unnamed)") + (i.year ? ` (${i.year})` : ""),
            }));
          return (
            <MergeIssueDialog
              collectionId={collectionId}
              sourceIssueId={source.id}
              sourceLabel={sourceLabel}
              targets={targets}
              isPending={isPending}
              error={error}
              onClose={closeDialog}
              onSubmit={(fd) =>
                startTransition(async () => {
                  const result = await mergeIssuesAction(collectionId, source.id, fd);
                  setActionState(result);
                  if (result.status === "success" && result.issueId) {
                    invalidateMembers(collectionId, source.id);
                    const targetLabel =
                      targets.find((t) => t.id === result.issueId)?.label ?? "the issue";
                    const targetId = result.issueId;
                    await finishWithRangeCheck(targetId, targetLabel);
                    toast({
                      message: `${sourceLabel} merged into ${targetLabel}`,
                      href: issueHref(targetId),
                      linkLabel: "Open issue",
                    });
                  }
                })
              }
            />
          );
        })()}

      {dialog.kind === "range-extended" && (
        <RangeExtendedDialog
          issueLabel={dialog.issueLabel}
          suggestions={dialog.suggestions}
          isPending={isPending}
          error={error}
          onKeep={() => setDialog({ kind: "none" })}
          onWiden={() => {
            const { issueId, suggestions } = dialog;
            startTransition(async () => {
              for (const s of suggestions) {
                await applyIssueRangeSuggestionAction(
                  collectionId,
                  issueId,
                  s.catalogVendorId,
                  s.proposedFirst,
                  s.proposedLast
                );
              }
              invalidateList(collectionId);
              setDialog({ kind: "none" });
            });
          }}
        />
      )}

      {dialog.kind === "move-stamp" &&
        (() => {
          const { issueId, stampId } = dialog;
          const currentIssue = allIssues.find((i) => i.id === issueId);
          const otherIssues = allIssues.filter(
            (i) =>
              i.id !== issueId &&
              i.collectionAreaId === currentIssue?.collectionAreaId
          );
          return (
            <DialogShell title="Move stamp to issue" onClose={closeDialog}>
              <form
                style={FORM_STYLE}
                onSubmit={(e) =>
                  submitAction(
                    (fd) =>
                      moveStampNodeAction(
                        collectionId,
                        issueId,
                        stampId,
                        fd
                      ),
                    e
                  )
                }
              >
                <DialogBody>
                  {otherIssues.length === 0 ? (
                    <p
                      style={{
                        margin: 0,
                        color: "var(--color-text-muted)",
                        fontSize: "0.9375rem",
                      }}
                    >
                      No other issues in this area to move to.
                    </p>
                  ) : (
                    <div>
                      <LabelWithError htmlFor="f-move-issue">
                        Target issue
                      </LabelWithError>
                      <select
                        id="f-move-issue"
                        name="targetIssueId"
                        style={INPUT_STYLE}
                        disabled={isPending}
                      >
                        {otherIssues.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name ?? "(unnamed)"}
                            {i.year ? ` (${i.year})` : ""}
                          </option>
                        ))}
                      </select>
                      <p
                        style={{
                          marginTop: "0.75rem",
                          fontSize: "0.8125rem",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        Child stamps will move with this node.
                      </p>
                    </div>
                  )}
                </DialogBody>
                {otherIssues.length === 0 ? (
                  <div
                    style={{
                      padding: "1rem 1.5rem",
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <DialogSecondaryButton onClick={closeDialog}>
                      Close
                    </DialogSecondaryButton>
                  </div>
                ) : (
                  <DialogActions
                    actionLabel={isPending ? "Moving…" : "Move"}
                    onCancel={closeDialog}
                    disabled={isPending}
                    error={error}
                  />
                )}
              </form>
            </DialogShell>
          );
        })()}

      {/* Where the stamp hangs *within* the issue (#656) — the same correction as the move above it,
          one level down. Its own dialog because the choice is over a tree rather than a flat list of
          issues, and because the answer may be "no parent at all". */}
      {dialog.kind === "reparent-stamp" && (
        <ReparentStampDialog
          collectionId={collectionId}
          issueId={dialog.issueId}
          stampId={dialog.stampId}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={(fd) => {
            const { issueId, stampId } = dialog;
            startTransition(async () => {
              const result = await reparentStampNodeAction(
                collectionId,
                issueId,
                stampId,
                fd
              );
              setActionState(result);
              // The tree's own shape changed, so the issue's members are re-read — and the list with
              // them, since a stamp that has just become a variant changes what its new parent's row
              // says about itself (#238/#239).
              if (result.status === "success") handleStampSuccess(issueId);
            });
          }}
        />
      )}
    </div>
  );
}
