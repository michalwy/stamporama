"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  toggleIssueMemberRequiredAction,
  removeStampFromIssueAction,
  moveStampNodeAction,
  type IssueActionState,
} from "@/app/actions/issues";
import type { IssueData, StampNodeData } from "@/lib/issues";
import type { CollectionAreaData } from "@/lib/areas";
import { AddStampDialog } from "./add-stamp-dialog";

// ── Shared styles ─────────────────────────────────────────────────────────────

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

const rowBtnStyle: React.CSSProperties = {
  padding: "0.25rem 0.625rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  border: "1px solid var(--color-border)",
  borderRadius: "0.3rem",
  cursor: "pointer",
  background: "transparent",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

const rowBtnDangerStyle: React.CSSProperties = {
  ...rowBtnStyle,
  color: "var(--color-error)",
  borderColor: "var(--color-error-border)",
};

const addBtnStyle: React.CSSProperties = {
  ...rowBtnStyle,
  color: "var(--color-text-muted)",
};

// ── Tree building ─────────────────────────────────────────────────────────────

interface TreeNode {
  node: StampNodeData;
  children: TreeNode[];
}

function buildStampTree(members: StampNodeData[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const m of members) byId.set(m.stampId, { node: m, children: [] });

  const roots: TreeNode[] = [];
  for (const [, treeNode] of byId) {
    const parentId = treeNode.node.parentId;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }
  return roots;
}

// ── Stamp tree node ───────────────────────────────────────────────────────────

interface StampTreeNodeProps {
  treeNode: TreeNode;
  depth: number;
  primaryVendorId: string | null;
  onAddChild: (parentStampId: string) => void;
  onRemove: (stampId: string) => void;
  onToggleRequired: (stampId: string, required: boolean) => void;
  onMove: (stampId: string) => void;
}

function StampTreeNode({
  treeNode,
  depth,
  primaryVendorId,
  onAddChild,
  onRemove,
  onToggleRequired,
  onMove,
}: StampTreeNodeProps) {
  const { node, children } = treeNode;

  const primaryCatalogNumber = primaryVendorId
    ? node.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId)?.number ?? null
    : null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 1rem",
          paddingLeft: `${1 + depth * 1.5}rem`,
          background: depth % 2 === 0 ? "var(--color-bg-page)" : "var(--color-bg-subtle)",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        {primaryCatalogNumber && (
          <span
            style={{
              fontFamily: "monospace",
              fontSize: "0.8125rem",
              color: "var(--color-accent)",
              fontWeight: 600,
              flexShrink: 0,
              minWidth: "3rem",
            }}
          >
            {primaryCatalogNumber}
          </span>
        )}

        <span
          style={{
            flex: 1,
            fontSize: "0.875rem",
            color: node.name ? "var(--color-text-primary)" : "var(--color-text-muted)",
            fontStyle: node.name ? undefined : "italic",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.name ?? "(unnamed)"}
          {node.issuedYear && (
            <span style={{ marginLeft: "0.375rem", color: "var(--color-text-muted)", fontWeight: 400 }}>
              {node.issuedYear}
            </span>
          )}
        </span>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            fontSize: "0.75rem",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
          title="Required for completeness"
        >
          <input
            type="checkbox"
            checked={node.requiredForCompleteness}
            onChange={(e) => onToggleRequired(node.stampId, e.target.checked)}
          />
          Required
        </label>

        <button type="button" onClick={() => onAddChild(node.stampId)} style={addBtnStyle}>
          + Child
        </button>

        <button type="button" onClick={() => onMove(node.stampId)} style={rowBtnStyle}>
          Move
        </button>

        <button type="button" onClick={() => onRemove(node.stampId)} style={rowBtnDangerStyle}>
          Remove
        </button>
      </div>

      {children.map((child) => (
        <StampTreeNode
          key={child.node.stampId}
          treeNode={child}
          depth={depth + 1}
          primaryVendorId={primaryVendorId}
          onAddChild={onAddChild}
          onRemove={onRemove}
          onToggleRequired={onToggleRequired}
          onMove={onMove}
        />
      ))}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

type DialogState =
  | { kind: "none" }
  | { kind: "create-issue" }
  | { kind: "edit-issue"; issue: IssueData }
  | { kind: "delete-issue"; issue: IssueData }
  | { kind: "add-stamp"; issueId?: string; parentStampId?: string }
  | { kind: "move-stamp"; issueId: string; stampId: string };

interface IssuesPanelProps {
  collectionId: string;
  collectionSlug: string;
  area: CollectionAreaData;
  initialIssues: IssueData[];
}

export function IssuesPanel({
  collectionId,
  area,
  initialIssues,
}: IssuesPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<IssueActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Deduplicate vendors for catalog number inputs (by catalogVendorId)
  const areaVendors = useMemo(
    () =>
      Array.from(
        new Map(area.catalogEntries.map((e) => [e.catalogVendorId, e])).values()
      ),
    [area.catalogEntries]
  );

  // The primary vendor for display (from primary catalog)
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
    router.refresh();
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

  function toggleExpanded(issueId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }

  function handleToggleRequired(issueId: string, stampId: string, required: boolean) {
    startTransition(async () => {
      await toggleIssueMemberRequiredAction(collectionId, issueId, stampId, required);
      router.refresh();
    });
  }

  function handleRemoveStamp(issueId: string, stampId: string) {
    if (!confirm("Remove this stamp from the issue?")) return;
    startTransition(async () => {
      await removeStampFromIssueAction(collectionId, issueId, stampId);
      router.refresh();
    });
  }

  function handleAddStampSubmit(issueId: string, fd: FormData) {
    const newIssueName = fd.get("newIssueName") as string | null;
    const newIssueYear = fd.get("newIssueYear") as string | null;

    startTransition(async () => {
      const targetIssueId = issueId;

      // If auto-creating a new issue, create it first then add stamp
      if (!issueId && (newIssueName !== null || newIssueYear !== null)) {
        const issueForm = new FormData();
        if (newIssueName) issueForm.set("name", newIssueName);
        if (newIssueYear) issueForm.set("year", newIssueYear);
        const createResult = await createIssueAction(collectionId, area.id, issueForm);
        if (createResult.status !== "success") {
          setActionState(createResult);
          return;
        }
        // We don't get the new issue id back from the action easily,
        // so we refresh and skip the stamp add for now — user can add from the new issue row.
        setDialog({ kind: "none" });
        router.refresh();
        return;
      }

      if (!targetIssueId) {
        setActionState({ status: "error", message: "Please select or create an issue." });
        return;
      }

      // Encode requiredForCompleteness checkbox properly
      const required = fd.get("requiredForCompleteness") === "true" ? "true" : "false";
      fd.set("requiredForCompleteness", required);

      const result = await addStampToIssueAction(collectionId, targetIssueId, fd);
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;

  return (
    <>
      {/* ── Toolbar ── */}
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

      {/* ── Issue list ── */}
      {initialIssues.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No issues yet. Add one to get started.
        </p>
      )}

      {initialIssues.length > 0 && (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          {initialIssues.map((issue, idx) => {
            const isExpanded = expandedIds.has(issue.id);
            const stampTree = buildStampTree(issue.members);
            const requiredCount = issue.completeness.required;

            return (
              <div
                key={issue.id}
                style={{
                  borderBottom:
                    idx < initialIssues.length - 1
                      ? "1px solid var(--color-border)"
                      : undefined,
                }}
              >
                {/* Issue row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.875rem 1.25rem",
                    background: "var(--color-bg-elevated)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleExpanded(issue.id)}
                    aria-label={isExpanded ? "Collapse" : "Expand"}
                    style={{
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
                    {isExpanded ? "▼" : "▶"}
                  </button>

                  <span
                    style={{
                      flex: 1,
                      fontSize: "0.9375rem",
                      fontWeight: 600,
                      color: issue.name ? "var(--color-text-primary)" : "var(--color-text-muted)",
                      fontStyle: issue.name ? undefined : "italic",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {issue.name ?? "(unnamed)"}
                  </span>

                  {issue.year && (
                    <span style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", flexShrink: 0 }}>
                      {issue.year}
                    </span>
                  )}

                  {/* Completeness indicator */}
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--color-text-muted)",
                      background: "var(--color-bg-muted)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "0.25rem",
                      padding: "0.125rem 0.5rem",
                      flexShrink: 0,
                    }}
                    title={requiredCount === 0 ? "No required stamps set" : "Completeness tracking requires inventory (#7)"}
                  >
                    {requiredCount === 0 ? "—" : `N/A (${requiredCount} req.)`}
                  </span>

                  <button
                    type="button"
                    onClick={() => openDialog({ kind: "add-stamp", issueId: issue.id })}
                    style={addBtnStyle}
                  >
                    + Stamp
                  </button>

                  <button
                    type="button"
                    onClick={() => openDialog({ kind: "edit-issue", issue })}
                    style={rowBtnStyle}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => openDialog({ kind: "delete-issue", issue })}
                    style={rowBtnDangerStyle}
                  >
                    Delete
                  </button>
                </div>

                {/* Expanded stamp tree */}
                {isExpanded && (
                  <div>
                    {stampTree.length === 0 ? (
                      <div
                        style={{
                          padding: "0.875rem 1.25rem",
                          background: "var(--color-bg-page)",
                          borderTop: "1px solid var(--color-border)",
                          fontSize: "0.875rem",
                          color: "var(--color-text-muted)",
                          fontStyle: "italic",
                        }}
                      >
                        No stamps in this issue yet.{" "}
                        <button
                          type="button"
                          onClick={() => openDialog({ kind: "add-stamp", issueId: issue.id })}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-accent)", fontSize: "inherit", padding: 0 }}
                        >
                          Add one
                        </button>
                      </div>
                    ) : (
                      stampTree.map((treeNode) => (
                        <StampTreeNode
                          key={treeNode.node.stampId}
                          treeNode={treeNode}
                          depth={0}
                          primaryVendorId={primaryVendorId}
                          onAddChild={(parentStampId) =>
                            openDialog({ kind: "add-stamp", issueId: issue.id, parentStampId })
                          }
                          onRemove={(stampId) => handleRemoveStamp(issue.id, stampId)}
                          onToggleRequired={(stampId, required) =>
                            handleToggleRequired(issue.id, stampId, required)
                          }
                          onMove={(stampId) => openDialog({ kind: "move-stamp", issueId: issue.id, stampId })}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Dialogs ── */}

      {dialog.kind === "create-issue" && (
        <DialogShell title="Add issue" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => createIssueAction(collectionId, area.id, fd), e)
            }
          >
            <DialogBody>
              <IssueForm isPending={isPending} />
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
              submitAction((fd) => updateIssueAction(collectionId, dialog.issue.id, fd), e)
            }
          >
            <DialogBody>
              <IssueForm
                defaultName={dialog.issue.name ?? ""}
                defaultYear={dialog.issue.year ?? undefined}
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

      {dialog.kind === "delete-issue" && (() => {
        const { issue } = dialog;
        const memberCount = issue.members.length;
        return (
          <DialogShell title="Delete issue" onClose={closeDialog}>
            <DialogBody>
              <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.6 }}>
                Delete issue <strong>{issue.name ?? "(unnamed)"}</strong>?
                {memberCount > 0 && (
                  <>
                    {" "}This will also remove all{" "}
                    <strong>{memberCount} stamp member{memberCount !== 1 ? "s" : ""}</strong> from this issue.
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
                  const result = await deleteIssueAction(collectionId, issue.id);
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

      {(dialog.kind === "add-stamp") && (
        <AddStampDialog
          issues={initialIssues}
          areaVendors={areaVendors}
          prefilledIssueId={dialog.issueId}
          prefilledParentStampId={dialog.parentStampId}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={handleAddStampSubmit}
        />
      )}

      {dialog.kind === "move-stamp" && (() => {
        const { issueId, stampId } = dialog;
        const otherIssues = initialIssues.filter((i) => i.id !== issueId);
        return (
          <DialogShell title="Move stamp to issue" onClose={closeDialog}>
            <form
              style={FORM_STYLE}
              onSubmit={(e) =>
                submitAction((fd) => moveStampNodeAction(collectionId, issueId, stampId, fd), e)
              }
            >
              <DialogBody>
                {otherIssues.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
                    No other issues in this area to move to.
                  </p>
                ) : (
                  <div>
                    <LabelWithError htmlFor="f-move-issue">Target issue</LabelWithError>
                    <select id="f-move-issue" name="targetIssueId" style={INPUT_STYLE} disabled={isPending}>
                      {otherIssues.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name ?? "(unnamed)"}{i.year ? ` (${i.year})` : ""}
                        </option>
                      ))}
                    </select>
                    <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                      Child stamps will move with this node.
                    </p>
                  </div>
                )}
              </DialogBody>
              {otherIssues.length === 0 ? (
                <div style={{ padding: "1rem 1.5rem", display: "flex", justifyContent: "flex-end" }}>
                  <DialogSecondaryButton onClick={closeDialog}>Close</DialogSecondaryButton>
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

// ── IssueForm ─────────────────────────────────────────────────────────────────

interface IssueFormProps {
  defaultName?: string;
  defaultYear?: number;
  isPending: boolean;
}

function IssueForm({ defaultName, defaultYear, isPending }: IssueFormProps) {
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
    </>
  );
}
