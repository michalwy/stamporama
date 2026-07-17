"use client";

import { useMemo, useState, useTransition } from "react";
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
  removeStampFromIssueAction,
  moveStampNodeAction,
  type IssueActionState,
} from "@/app/actions/issues";
import type { IssueListItem, IssueCatalogNumberData } from "@/lib/issues";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import { AddStampDialog } from "./add-stamp-dialog";
import {
  useIssuesInfinite,
  useInvalidateIssues,
} from "@/app/c/[collectionSlug]/issues/use-issues-query";
import {
  IssueRow,
  InfiniteScrollSentinel,
  type IssueRowCallbacks,
} from "@/app/c/[collectionSlug]/issues/issue-row";

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
  | { kind: "edit-issue"; issue: IssueListItem }
  | { kind: "delete-issue"; issue: IssueListItem }
  | {
      kind: "add-stamp";
      issueId?: string;
      parentStampId?: string;
      parentCatalogNumbers?: { catalogVendorId: string; number: string }[];
    }
  | { kind: "move-stamp"; issueId: string; stampId: string };

interface IssuesPanelProps {
  collectionId: string;
  collectionSlug: string;
  area: CollectionAreaData;
}

export function IssuesPanel({
  collectionId,
  area,
}: IssuesPanelProps) {
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<IssueActionState>({
    status: "idle",
  });
  const [isPending, startTransition] = useTransition();
  const { invalidateList, invalidateMembers } = useInvalidateIssues();

  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading,
  } = useIssuesInfinite(collectionId, [area.id]);

  const allIssues = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data]
  );

  const areaVendors = useMemo(
    () =>
      Array.from(
        new Map(
          area.catalogEntries.map((e) => [e.catalogVendorId, e])
        ).values()
      ),
    [area.catalogEntries]
  );

  const vendorMap = useMemo(
    () => new Map(areaVendors.map((v) => [v.catalogVendorId, v])),
    [areaVendors]
  );

  const primaryVendorId = useMemo(() => {
    if (!area.primaryCatalogNameId) return null;
    const entry = area.catalogEntries.find(
      (e) => e.catalogNameId === area.primaryCatalogNameId
    );
    return entry?.catalogVendorId ?? null;
  }, [area]);

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
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

  function handleRemoveStamp(issueId: string, stampId: string) {
    if (!confirm("Remove this stamp from the issue?")) return;
    startTransition(async () => {
      await removeStampFromIssueAction(collectionId, issueId, stampId);
      handleStampSuccess(issueId);
    });
  }

  function handleAddStampSubmit(issueId: string, fd: FormData) {
    const newIssueName = fd.get("newIssueName") as string | null;
    const newIssueYear = fd.get("newIssueYear") as string | null;

    startTransition(async () => {
      const targetIssueId = issueId;

      if (!issueId && (newIssueName !== null || newIssueYear !== null)) {
        const issueForm = new FormData();
        if (newIssueName) issueForm.set("name", newIssueName);
        if (newIssueYear) issueForm.set("year", newIssueYear);
        const createResult = await createIssueAction(
          collectionId,
          area.id,
          issueForm
        );
        if (createResult.status !== "success") {
          setActionState(createResult);
          return;
        }
        setDialog({ kind: "none" });
        invalidateList(collectionId);
        return;
      }

      if (!targetIssueId) {
        setActionState({
          status: "error",
          message: "Please select or create an issue.",
        });
        return;
      }

      const result = await addStampToIssueAction(
        collectionId,
        targetIssueId,
        fd
      );
      setActionState(result);
      if (result.status === "success") handleStampSuccess(targetIssueId);
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
    onRemoveStamp: handleRemoveStamp,
    onMoveStamp: (issueId, stampId) =>
      openDialog({ kind: "move-stamp", issueId, stampId }),
  };

  return (
    <>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <button
          type="button"
          onClick={() => openDialog({ kind: "create-issue" })}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--color-action-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          + Add issue
        </button>

        <button
          type="button"
          onClick={() => openDialog({ kind: "add-stamp" })}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          + Add stamp
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          Loading issues...
        </p>
      )}

      {/* Empty state */}
      {!isLoading && allIssues.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No issues yet. Add one to get started.
        </p>
      )}

      {/* Issue list */}
      {allIssues.length > 0 && (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          {allIssues.map((issue, idx) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              collectionId={collectionId}
              primaryVendorId={primaryVendorId}
              vendorMap={vendorMap}
              isLast={idx === allIssues.length - 1 && !hasNextPage}
              callbacks={callbacks}
            />
          ))}
          <InfiniteScrollSentinel
            onLoadMore={fetchNextPage}
            hasMore={!!hasNextPage}
            isLoading={isFetchingNextPage}
          />
        </div>
      )}

      {/* ── Dialogs ── */}

      {dialog.kind === "create-issue" && (
        <DialogShell title="Add issue" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction(
                (fd) => createIssueAction(collectionId, area.id, fd),
                e
              )
            }
          >
            <DialogBody>
              <IssueForm
                vendors={areaVendors}
                primaryVendorId={primaryVendorId}
                isPending={isPending}
                autoFocusName
              />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit-issue" && (
        <DialogShell title="Edit issue" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction(
                (fd) =>
                  updateIssueAction(collectionId, dialog.issue.id, fd),
                e
              )
            }
          >
            <DialogBody>
              <IssueForm
                vendors={areaVendors}
                primaryVendorId={primaryVendorId}
                defaultName={dialog.issue.name ?? ""}
                defaultYear={dialog.issue.year ?? undefined}
                defaultCatalogNumbers={dialog.issue.catalogNumbers}
                isPending={isPending}
              />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete-issue" &&
        (() => {
          const { issue } = dialog;
          return (
            <DialogShell title="Delete issue" onClose={closeDialog}>
              <DialogBody>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.9375rem",
                    color: "var(--color-text-primary)",
                    lineHeight: 1.6,
                  }}
                >
                  Delete issue{" "}
                  <strong>{issue.name ?? "(unnamed)"}</strong>?
                  {issue.memberCount > 0 && (
                    <>
                      {" "}
                      This will also remove all{" "}
                      <strong>
                        {issue.memberCount} stamp member
                        {issue.memberCount !== 1 ? "s" : ""}
                      </strong>{" "}
                      from this issue.
                    </>
                  )}{" "}
                  This cannot be undone.
                </p>
              </DialogBody>
              <DialogActions
                actionLabel={isPending ? "Deleting…" : "Delete"}
                variant="destructive"
                onCancel={closeDialog}
                onAction={() => {
                  startTransition(async () => {
                    const result = await deleteIssueAction(
                      collectionId,
                      issue.id
                    );
                    setActionState(result);
                    if (result.status === "success") handleSuccess();
                  });
                }}
                disabled={isPending}
                error={error}
              />
            </DialogShell>
          );
        })()}

      {dialog.kind === "add-stamp" && (
        <AddStampDialog
          collectionId={collectionId}
          issues={allIssues}
          areaVendors={areaVendors}
          prefilledIssueId={dialog.issueId}
          prefilledParentStampId={dialog.parentStampId}
          defaultCatalogNumbers={dialog.parentCatalogNumbers}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={handleAddStampSubmit}
        />
      )}

      {dialog.kind === "move-stamp" &&
        (() => {
          const { issueId, stampId } = dialog;
          const otherIssues = allIssues.filter((i) => i.id !== issueId);
          return (
            <DialogShell title="Move stamp to issue" onClose={closeDialog}>
              <form
                style={FORM_STYLE}
                onSubmit={(e) => {
                  e.preventDefault();
                  startTransition(async () => {
                    const fd = new FormData(e.currentTarget);
                    const result = await moveStampNodeAction(
                      collectionId,
                      issueId,
                      stampId,
                      fd
                    );
                    setActionState(result);
                    if (result.status === "success") {
                      const targetIssueId = fd.get("targetIssueId") as string;
                      setDialog({ kind: "none" });
                      invalidateMembers(collectionId, issueId);
                      invalidateMembers(collectionId, targetIssueId);
                      invalidateList(collectionId);
                    }
                  });
                }}
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
    </>
  );
}

// ── IssueForm ───────────────────────────────────────────────────────────────

interface IssueFormProps {
  vendors: AreaCatalogEntry[];
  primaryVendorId?: string | null;
  defaultName?: string;
  defaultYear?: number;
  defaultCatalogNumbers?: IssueCatalogNumberData[];
  isPending: boolean;
  autoFocusName?: boolean;
}

function IssueForm({
  vendors,
  primaryVendorId,
  defaultName,
  defaultYear,
  defaultCatalogNumbers = [],
  isPending,
  autoFocusName,
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
      <div
        style={{
          marginBottom: sortedVendors.length > 0 ? "1rem" : undefined,
        }}
      >
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
        <div>
          <LabelWithError>Catalog numbers</LabelWithError>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {sortedVendors.map((v) => {
              const isPrimary = v.catalogVendorId === primaryVendorId;
              const existing = defaultCatalogNumbers?.find(
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
                        fontFamily: "monospace",
                        fontWeight: 600,
                      }}
                    >
                      {v.vendorAbbreviation}
                      {v.prefix ? `·${v.prefix}` : ""}
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
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      alignItems: "center",
                    }}
                  >
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
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
