"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
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
  type IssueActionState,
} from "@/app/actions/issues";
import type { IssueListItem, IssueCatalogNumberData, IssueSortBy, StampNodeData } from "@/lib/issues";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { DeleteIssueDialog } from "./delete-issue-dialog";
import { DeleteStampDialog } from "@/app/c/[collectionSlug]/shared/delete-stamp-dialog";
import { useIssuesInfinite, useInvalidateIssues, type IssueListFilters } from "./use-issues-query";
import { IssueRow, InfiniteScrollSentinel, type IssueRowCallbacks } from "./issue-row";
import { AreaFilterSidebar } from "@/app/c/[collectionSlug]/shared/area-filter-sidebar";
import { ListToolbar, type SortOption, type CatalogVendorOption } from "@/app/c/[collectionSlug]/shared/list-toolbar";
import { usePersistedSort } from "@/app/c/[collectionSlug]/shared/use-persisted-sort";
import { effectiveVendorsForArea, effectivePrimaryVendorId, flattenAreaTree } from "@/app/c/[collectionSlug]/shared/area-helpers";

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

// ── Section header ──────────────────────────────────────────────────────────

const SECTION_HEADER_STYLE: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: "0.75rem",
};

// ── IssueForm ───────────────────────────────────────────────────────────────

interface IssueFormProps {
  vendors: AreaCatalogEntry[];
  primaryVendorId?: string | null;
  defaultName?: string;
  defaultYear?: number;
  defaultCatalogNumbers?: IssueCatalogNumberData[];
  isPending: boolean;
  autoFocusName?: boolean;
  showAutoCreate?: boolean;
  autoCreate?: boolean;
  onAutoCreateChange?: (checked: boolean) => void;
}

function IssueForm({
  vendors,
  primaryVendorId,
  defaultName,
  defaultYear,
  defaultCatalogNumbers = [],
  isPending,
  autoFocusName,
  showAutoCreate,
  autoCreate,
  onAutoCreateChange,
}: IssueFormProps) {
  const sortedVendors = useMemo(() => {
    if (!primaryVendorId) return vendors;
    return [...vendors].sort((a, b) => {
      if (a.catalogVendorId === primaryVendorId) return -1;
      if (b.catalogVendorId === primaryVendorId) return 1;
      return 0;
    });
  }, [vendors, primaryVendorId]);

  return (
    <>
      <div style={SECTION_HEADER_STYLE}>Details</div>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-issue-name">Name (optional)</LabelWithError>
        <input
          id="f-issue-name"
          name="name"
          type="text"
          defaultValue={defaultName}
          disabled={isPending}
          placeholder="e.g. First Issue"
          style={INPUT_STYLE}
          data-autofocus={autoFocusName || undefined}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-issue-year">Year (optional)</LabelWithError>
        <input
          id="f-issue-year"
          name="year"
          type="number"
          defaultValue={defaultYear}
          disabled={isPending}
          placeholder="e.g. 1860"
          min={1840}
          max={2100}
          style={INPUT_STYLE}
        />
      </div>
      {sortedVendors.length > 0 && (
        <div
          style={{
            marginTop: "1.25rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            padding: "1rem",
          }}
        >
          <div style={SECTION_HEADER_STYLE}>Catalog numbers</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {sortedVendors.map((v) => {
              const isPrimary = v.catalogVendorId === primaryVendorId;
              const existing = defaultCatalogNumbers.find(
                (cn) => cn.catalogVendorId === v.catalogVendorId
              );
              return (
                <div key={v.catalogVendorId}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                      marginBottom: "0.25rem",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.8125rem",
                        color: "var(--color-text-muted)",
                        fontWeight: 600,
                      }}
                    >
                      {v.vendorName} ({v.vendorAbbreviation})
                      {v.prefix ? ` · ${v.prefix}` : ""}
                    </span>
                    {isPrimary && (
                      <span
                        style={{
                          fontSize: "0.6875rem",
                          color: "var(--color-accent)",
                          border: "1px solid var(--color-accent)",
                          borderRadius: "0.2rem",
                          padding: "0.05rem 0.3rem",
                          fontWeight: 600,
                          lineHeight: 1.5,
                        }}
                      >
                        Primary
                      </span>
                    )}
                  </span>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      name={`issueCatalogFirst_${v.catalogVendorId}`}
                      type="text"
                      defaultValue={existing?.firstNumber ?? ""}
                      disabled={isPending}
                      placeholder="First"
                      style={{ ...INPUT_STYLE, flex: 1 }}
                    />
                    <span
                      style={{
                        color: "var(--color-text-muted)",
                        fontSize: "0.875rem",
                        flexShrink: 0,
                      }}
                    >
                      –
                    </span>
                    <input
                      name={`issueCatalogLast_${v.catalogVendorId}`}
                      type="text"
                      defaultValue={existing?.lastNumber ?? ""}
                      disabled={isPending}
                      placeholder="Last (optional)"
                      style={{ ...INPUT_STYLE, flex: 1 }}
                    />
                  </div>
                  {showAutoCreate && (
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        marginTop: "0.25rem",
                        fontSize: "0.75rem",
                        color: "var(--color-text-muted)",
                        cursor: "pointer",
                        visibility: autoCreate ? "visible" : "hidden",
                      }}
                    >
                      <input
                        type="checkbox"
                        name={autoCreate ? `autoCreateVendor_${v.catalogVendorId}` : undefined}
                        defaultChecked={isPrimary}
                        disabled={isPending}
                      />
                      Assign to stamps
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {showAutoCreate && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                marginTop: "0.75rem",
                paddingTop: "0.75rem",
                borderTop: "1px solid var(--color-border)",
                fontSize: "0.8125rem",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                name="autoCreateStamps"
                value="true"
                checked={autoCreate}
                onChange={(e) => onAutoCreateChange?.(e.target.checked)}
                disabled={isPending}
              />
              Auto-create stamps from catalog number range
            </label>
          )}
        </div>
      )}
    </>
  );
}

// ── IssueDialog ─────────────────────────────────────────────────────────────

type IssueDialogProps =
  | {
      mode: "create";
      areas: CollectionAreaData[];
      defaultAreaId?: string;
      isPending: boolean;
      error?: string;
      onClose: () => void;
      onSubmit: (areaId: string, formData: FormData) => void;
    }
  | {
      mode: "edit";
      areas: CollectionAreaData[];
      issue: IssueListItem;
      isPending: boolean;
      error?: string;
      onClose: () => void;
      onSubmit: (formData: FormData) => void;
    };

function IssueDialog(props: IssueDialogProps) {
  const { areas, isPending, error, onClose } = props;
  const isCreate = props.mode === "create";

  const [selectedAreaId, setSelectedAreaId] = useState(() => {
    if (isCreate) return props.defaultAreaId ?? areas[0]?.id ?? "";
    return props.issue.collectionAreaId;
  });
  const [autoCreate, setAutoCreate] = useState(false);

  const vendors = useMemo(
    () => (selectedAreaId ? effectiveVendorsForArea(areas, selectedAreaId) : []),
    [areas, selectedAreaId]
  );

  const primaryVendorId = useMemo(
    () =>
      selectedAreaId ? effectivePrimaryVendorId(areas, selectedAreaId) : null,
    [areas, selectedAreaId]
  );

  const flatTree = useMemo(() => (isCreate ? flattenAreaTree(areas) : []), [isCreate, areas]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isCreate) {
      if (!selectedAreaId) return;
      props.onSubmit(selectedAreaId, new FormData(e.currentTarget));
    } else {
      props.onSubmit(new FormData(e.currentTarget));
    }
  }

  return (
    <DialogShell
      title={isCreate ? "Add issue" : "Edit issue"}
      onClose={onClose}
      minHeight="32rem"
    >
      <form style={FORM_STYLE} onSubmit={handleSubmit}>
        <DialogBody>
          {isCreate && (
            <div style={{ marginBottom: "1.25rem" }}>
              <LabelWithError htmlFor="f-issue-area">Area</LabelWithError>
              <select
                id="f-issue-area"
                value={selectedAreaId}
                onChange={(e) => setSelectedAreaId(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                {areas.length === 0 && (
                  <option value="">— No areas yet —</option>
                )}
                {flatTree.map(({ area, depth }) => (
                  <option key={area.id} value={area.id}>
                    {"  ".repeat(depth)}
                    {area.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <IssueForm
            vendors={vendors}
            primaryVendorId={primaryVendorId}
            defaultName={isCreate ? undefined : (props.issue.name ?? "")}
            defaultYear={isCreate ? undefined : (props.issue.year ?? undefined)}
            defaultCatalogNumbers={isCreate ? undefined : props.issue.catalogNumbers}
            isPending={isPending}
            autoFocusName={isCreate}
            showAutoCreate={isCreate && vendors.length > 0}
            autoCreate={autoCreate}
            onAutoCreateChange={setAutoCreate}
          />
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Save"}
          onCancel={onClose}
          disabled={isPending || (isCreate && !selectedAreaId)}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

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
  | { kind: "move-stamp"; issueId: string; stampId: string }
  | { kind: "delete-stamp"; issueId: string; stampId: string; stampName: string };

interface IssuesListPanelProps {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  filterAreaId: string | null;
  filterAreaIds: string[] | undefined;
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
  filterAreaId,
  filterAreaIds,
}: IssuesListPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
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

  const filters: IssueListFilters = useMemo(
    () => ({
      areaIds: filterAreaIds,
      search: search || undefined,
      catalogVendorId: catalogVendorId || undefined,
      catalogNumber: catalogNumber || undefined,
      sortBy,
      sortDir,
    }),
    [filterAreaIds, search, catalogVendorId, catalogNumber, sortBy, sortDir]
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

  const primaryVendorByArea = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of areas) {
      m.set(a.id, effectivePrimaryVendorId(areas, a.id));
    }
    return m;
  }, [areas]);

  const vendorMapByArea = useMemo(() => {
    const m = new Map<string, Map<string, AreaCatalogEntry>>();
    for (const a of areas) {
      const vendors = effectiveVendorsForArea(areas, a.id);
      const unique = new Map(vendors.map((v) => [v.catalogVendorId, v]));
      m.set(a.id, unique);
    }
    return m;
  }, [areas]);

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
    if (areaId) params.set("areaId", areaId);
    else params.delete("areaId");
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
        overflow: "hidden",
        minHeight: "24rem",
      }}
    >
      <AreaFilterSidebar
        areas={areas}
        filterAreaId={filterAreaId}
        onNavigate={handleNavigateFilter}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
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
            {search || catalogNumber
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
                  primaryVendorId={primaryVendorId}
                  vendorMap={vendorMap}
                  isLast={idx === allIssues.length - 1 && !hasNextPage}
                  showAreaChip
                  areaName={area?.name}
                  onFilterByArea={handleNavigateFilter}
                  callbacks={callbacks}
                  defaultExpanded={issue.id === autoExpandIssueId}
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
          areas={areas}
          defaultAreaId={filterAreaId ?? undefined}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={handleCreateIssueSubmit}
        />
      )}

      {dialog.kind === "edit-issue" && (
        <IssueDialog
          mode="edit"
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
              stamp={stamp}
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
