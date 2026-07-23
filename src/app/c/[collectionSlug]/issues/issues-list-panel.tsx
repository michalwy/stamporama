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
  moveStampNodeAction,
  moveIssueToAreaAction,
  type IssueActionState,
} from "@/app/actions/issues";
import { MoveIssueAreaDialog } from "./move-issue-area-dialog";
import type { IssueListItem, IssueSortBy, StampNodeData } from "@/lib/issues";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
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
import { IssueRow, InfiniteScrollSentinel, type IssueRowCallbacks } from "./issue-row";
import { ListFilterSidebar } from "@/app/c/[collectionSlug]/shared/list-filter-sidebar";
import { useCollectionFilterStore } from "@/app/c/[collectionSlug]/shared/use-collection-filter-store";
import { ListToolbar, type SortOption, type CatalogVendorOption } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { usePersistedSort } from "@/app/c/[collectionSlug]/shared/use-persisted-sort";
import { ConditionPriceSwitcher } from "@/app/c/[collectionSlug]/shared/condition-price-switcher";
import { useDisplayCondition } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { effectiveVendorsForArea, getDescendantIds } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { parseCatalogSearch } from "@/lib/catalog-number";

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
      parentStampId?: string;
      parentCatalogNumbers?: { catalogVendorId: string; number: string }[];
    }
  | { kind: "edit-stamp"; issueId: string; stamp: StampNodeData }
  | { kind: "move-issue-area"; issue: IssueListItem }
  | { kind: "move-stamp"; issueId: string; stampId: string }
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

  const filterAreaIds = useMemo(() => {
    if (!filterAreaId) return undefined;
    const ids = getDescendantIds(areas, filterAreaId);
    ids.add(filterAreaId);
    return [...ids];
  }, [filterAreaId, areas]);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<IssueActionState>({
    status: "idle",
  });
  const [isPending, startTransition] = useTransition();
  const [autoExpandIssueId, setAutoExpandIssueId] = useState<string | null>(null);
  const { invalidateList, invalidateMembers } = useInvalidateIssues();

  const search = searchParams.get("search") ?? "";
  const { sortBy, sortDir, persistSort } = usePersistedSort<IssueSortBy>(
    "issues", "year", "asc",
    searchParams.get("sortBy"),
    searchParams.get("sortDir"),
    ["year", "name", "catalogNumber"]
  );
  const catalogVendorId = searchParams.get("catalogVendorId") ?? "";
  const catalogNumber = searchParams.get("catalogNumber") ?? "";

  const { conditions, displayConditionId, setDisplayConditionId } =
    useDisplayCondition(collectionId);

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

  const filters: IssueListFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: effectiveCatalogVendorId || undefined,
      catalogNumber: effectiveCatalogNumber || undefined,
      year: year || undefined,
      displayConditionId: displayConditionId || undefined,
      sortBy,
      sortDir,
    }),
    [filterAreaIds, search, effectiveCatalogVendorId, effectiveCatalogNumber, year, displayConditionId, sortBy, sortDir]
  );

  const yearFacetFilters: IssueYearFacetFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: effectiveCatalogVendorId || undefined,
      catalogNumber: effectiveCatalogNumber || undefined,
    }),
    [filterAreaIds, search, effectiveCatalogVendorId, effectiveCatalogNumber]
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

  const { primaryVendorByArea, vendorMapByArea } = useAreaVendorMaps(areas);

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
      if (result.status === "success") handleStampSuccess(issueId);
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

  function handleCreateIssueSubmit(areaId: string, fd: FormData) {
    startTransition(async () => {
      const result = await createIssueAction(collectionId, areaId, fd);
      setActionState(result);
      if (result.status === "success") {
        if (result.issueId) setAutoExpandIssueId(result.issueId);
        handleSuccess();
      }
    });
  }

  const error =
    actionState.status === "error" ? actionState.message : undefined;

  const callbacks: IssueRowCallbacks = {
    onEdit: (issue) => openDialog({ kind: "edit-issue", issue }),
    onDelete: (issue) => openDialog({ kind: "delete-issue", issue }),
    onMoveIssueArea: (issue) => openDialog({ kind: "move-issue-area", issue }),
    onAddStamp: (issueId, parentStampId, parentCatalogNumbers) =>
      openDialog({
        kind: "add-stamp",
        issueId,
        parentStampId,
        parentCatalogNumbers,
      }),
    onEditStamp: (issueId, stamp) =>
      openDialog({ kind: "edit-stamp", issueId, stamp }),
    onDeleteStamp: (issueId, stampId, stampName) =>
      openDialog({ kind: "delete-stamp", issueId, stampId, stampName }),
    onMoveStamp: (issueId, stampId) =>
      openDialog({ kind: "move-stamp", issueId, stampId }),
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
          onCatalogSearchChange={(vid, num) =>
            updateParams({ catalogVendorId: vid, catalogNumber: num })
          }
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
              const vendorMap =
                vendorMapByArea.get(issue.collectionAreaId) ??
                new Map<string, AreaCatalogEntry>();

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
                  displayConditionId={displayConditionId || undefined}
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
              const result = await updateIssueAction(collectionId, dialog.issue.id, fd);
              setActionState(result);
              if (result.status === "success") handleSuccess();
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
              const result = await deleteIssueAction(
                collectionId,
                dialog.issue.id
              );
              setActionState(result);
              if (result.status === "success") handleSuccess();
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
          const areaVendors = effectiveVendorsForArea(
            areas,
            issue.collectionAreaId
          );
          return (
            <StampFormDialog
              mode="edit"
              stampId={stamp.stampId}
              collectionId={collectionId}
              stamp={{
                ...stamp,
                issues: [{ requiredForCompleteness: stamp.requiredForCompleteness }],
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
          const areaVendors = effectiveVendorsForArea(
            areas,
            issue.collectionAreaId
          );
          const uniqueAreaVendors = Array.from(
            new Map(
              areaVendors.map((v) => [v.catalogVendorId, v])
            ).values()
          );
          return (
            <StampFormDialog
              mode="add"
              collectionId={collectionId}
              issues={[issue]}
              areaVendors={uniqueAreaVendors}
              prefilledIssueId={issue.id}
              prefilledParentStampId={dialog.parentStampId}
              defaultCatalogNumbers={dialog.parentCatalogNumbers}
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
                handleStampSuccess(dialog.issue.id);
              }
            })
          }
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
    </div>
  );
}
