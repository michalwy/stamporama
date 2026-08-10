"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  getChecklistsForIssueAction,
  createChecklistAction,
  renameChecklistAction,
  deleteChecklistAction,
  reorderChecklistsAction,
  setChecklistStampsAction,
  type ChecklistActionState,
} from "@/app/actions/checklists";
import type { ChecklistData } from "@/lib/checklists";
import type { StampNodeData } from "@/lib/issues";
import type { RowAction } from "./row-actions-menu";
import { RowActionsMenu } from "./row-actions-menu";
import { buildStampTree, type StampTreeNodeData } from "./issue-view";
import { useIssueMembers } from "@/app/c/[collectionSlug]/issues/use-issues-query";
import { formatIssuedDate } from "@/app/stamp-display";
import {
  useReorderList,
  InsertionLine,
  DragGrip,
  showLineAt,
  dragStyle,
} from "./reorder-list";
import { NO_AUTOFILL } from "./no-autofill";
import { Tooltip } from "./tooltip";
import { Icon } from "@/app/icons";

// The checklists of one issue, edited from that issue's row (#531; ADR-0031). The anchor is never a
// field: the screen this was opened from already answered "which issue", which is ADR-0020 §7's
// rule for every issue-scoped editor.
//
// Order is the collector's, and it is load-bearing rather than cosmetic — the **first** checklist is
// the one a single-checklist row shows its badge and total for, and the one a new stamp joins when
// the stamp form's box is ticked. So the list is drag-reorderable through the shared kit.

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

const COUNT_BADGE: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
  whiteSpace: "nowrap",
};

export interface ChecklistsScope {
  collectionId: string;
  issueId: string;
  /** Names the issue in the dialog title. */
  issueLabel: string;
}

/** Row-menu entry opening the checklists editor, following the `{ action, dialog }` convention so
 *  the dialog survives the menu closing. */
export function useChecklistsAction(scope: ChecklistsScope): {
  action: RowAction;
  dialog: React.ReactNode;
} {
  const [open, setOpen] = useState(false);

  const action: RowAction = {
    key: "checklists",
    label: "Checklists…",
    icon: "list",
    onSelect: () => setOpen(true),
  };

  return {
    action,
    dialog: open ? <ChecklistsDialog scope={scope} onClose={() => setOpen(false)} /> : null,
  };
}

type Editing =
  | { kind: "add" }
  | { kind: "rename"; checklist: ChecklistData }
  | { kind: "stamps"; checklist: ChecklistData };

export function ChecklistsDialog({
  scope,
  onClose,
}: {
  scope: ChecklistsScope;
  onClose: () => void;
}) {
  const { collectionId, issueId, issueLabel } = scope;
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<ChecklistData | null>(null);
  const [error, setError] = useState<string | undefined>();

  const queryKey = ["checklists", collectionId, issueId] as const;
  const { data: checklists = [], isLoading } = useQuery<ChecklistData[]>({
    queryKey,
    queryFn: () => getChecklistsForIssueAction(collectionId, issueId),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey });
    // Every issue surface reads checklists — the row's badge and total, the detail page's grid.
    void queryClient.invalidateQueries({ queryKey: ["issues"] });
  }

  function run(fn: () => Promise<ChecklistActionState>, onDone: () => void) {
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        setError(undefined);
        refresh();
        onDone();
      } else if (result.status === "error") {
        setError(result.message);
      }
    });
  }

  function move(from: number, to: number) {
    const ids = checklists.map((c) => c.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    run(() => reorderChecklistsAction(collectionId, issueId, ids), () => {});
  }

  const drag = useReorderList(checklists.length > 1 && !isPending, move, { handleOnly: true });

  // The typed name, mirrored so the duplicate check can read it. The input itself stays
  // uncontrolled, as the issue form's does — the value is read off the form on submit.
  const [nameText, setNameText] = useState("");

  // Two checklists of one issue with the same name are indistinguishable everywhere they are
  // listed — the badge tooltip, the filter, the stamp form's boxes, the price-details entries.
  // Advisory rather than blocking, following #178's rule for duplicate issue names: the collector
  // may have a reason, and the list behind this dialog already says what is there.
  const duplicateName =
    editing !== null &&
    editing.kind !== "stamps" &&
    nameText.trim() !== "" &&
    checklists.some(
      (c) =>
        c.id !== (editing.kind === "rename" ? editing.checklist.id : null) &&
        c.name.trim().toLowerCase() === nameText.trim().toLowerCase()
    );

  function submitName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = ((new FormData(e.currentTarget).get("name") as string | null) ?? "").trim();
    if (!name) {
      setError("A checklist needs a name.");
      return;
    }
    const current = editing;
    run(
      () =>
        current?.kind === "rename"
          ? renameChecklistAction(current.checklist.id, name)
          : createChecklistAction(collectionId, issueId, name),
      () => setEditing(null)
    );
  }

  return (
    <>
      <DialogShell
        title={`Checklists — ${issueLabel}`}
        onClose={() => {
          if (!isPending) onClose();
        }}
        dismissable={editing === null && deleting === null}
      >
        <DialogBody>
          <p
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-text-muted)",
              margin: "0 0 1rem",
            }}
          >
            A checklist is a list of stamps that counts as one complete set. Most issues need one;
            add a second when the same publication is collected two ways — a basic set beside a
            specialized one, perforated beside imperforate. The <strong>first</strong> checklist is
            the one this issue&apos;s row shows, and the one a new stamp joins by default.
          </p>

          {isLoading ? (
            <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading…</p>
          ) : checklists.length === 0 ? (
            <p style={{ fontSize: "0.9375rem", color: "var(--color-text-muted)" }}>
              No checklist yet — nothing in this issue is a goal to complete.
            </p>
          ) : (
            <div
              {...(drag?.containerProps ?? {})}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "0.75rem",
                overflow: "hidden",
              }}
            >
              {checklists.map((checklist, i) => (
                <div key={checklist.id}>
                  {showLineAt(drag, i) && <InsertionLine />}
                  <div
                    {...(drag?.itemProps(i) ?? {})}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.625rem 0.875rem",
                      background: "var(--color-bg-elevated)",
                      borderBottom:
                        i < checklists.length - 1 ? "1px solid var(--color-border)" : "none",
                      ...dragStyle(drag, i),
                    }}
                  >
                    {drag && (
                      <span {...drag.handleProps(i)}>
                        <DragGrip label="Reorder checklist" />
                      </span>
                    )}
                    <span
                      style={{
                        flex: 1,
                        fontSize: "0.9375rem",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {checklist.name}
                    </span>
                    <span style={COUNT_BADGE}>{checklist.stampIds.length}</span>
                    <RowActionsMenu
                      ariaLabel="Checklist actions"
                      actions={[
                        {
                          key: "stamps",
                          label: "Choose stamps…",
                          icon: "list",
                          onSelect: () => setEditing({ kind: "stamps", checklist }),
                        },
                        {
                          key: "rename",
                          label: "Rename…",
                          icon: "edit",
                          onSelect: () => {
                            setNameText(checklist.name);
                            setEditing({ kind: "rename", checklist });
                          },
                        },
                        {
                          key: "delete",
                          label: "Delete",
                          icon: "delete",
                          danger: true,
                          separatorBefore: true,
                          onSelect: () => setDeleting(checklist),
                        },
                      ]}
                    />
                  </div>
                </div>
              ))}
              {showLineAt(drag, checklists.length) && <InsertionLine />}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setNameText("");
              setEditing({ kind: "add" });
            }}
            disabled={isPending}
            style={{
              marginTop: "1rem",
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
            + Add checklist
          </button>
          {error && !editing && !deleting && (
            <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginTop: "0.75rem" }}>
              {error}
            </p>
          )}
        </DialogBody>
      </DialogShell>

      {editing && editing.kind !== "stamps" && (
        <DialogShell
          title={editing.kind === "add" ? "Add checklist" : "Rename checklist"}
          onClose={() => {
            if (!isPending) {
              setEditing(null);
              setError(undefined);
            }
          }}
        >
          <form style={FORM_STYLE} onSubmit={submitName}>
            <DialogBody>
              <LabelWithError htmlFor="cl-name">Name</LabelWithError>
              <div style={{ position: "relative" }}>
                <input
                  id="cl-name"
                  name="name"
                  type="text"
                  autoFocus
                  defaultValue={editing.kind === "rename" ? editing.checklist.name : ""}
                  disabled={isPending}
                  placeholder="e.g. Basic set, Imperforate, With tabs"
                  style={{ ...INPUT_STYLE, paddingRight: duplicateName ? "2rem" : undefined }}
                  onChange={(e) => setNameText(e.target.value)}
                  {...NO_AUTOFILL}
                />
                {duplicateName && (
                  <span
                    style={{
                      position: "absolute",
                      right: "0.5rem",
                      top: "50%",
                      transform: "translateY(-50%)",
                      display: "inline-flex",
                    }}
                  >
                    <Tooltip
                      align="end"
                      content={
                        <span>
                          A checklist called{" "}
                          <span style={{ fontWeight: 600 }}>{nameText.trim()}</span> is already on
                          this issue. You can still save it, but the two will read alike wherever
                          checklists are listed.
                        </span>
                      }
                    >
                      <span
                        role="img"
                        aria-label="A checklist with this name is already on this issue"
                        style={{
                          color: "var(--color-warning)",
                          lineHeight: 1,
                          cursor: "help",
                        }}
                      >
                        <Icon name="warning" size="sm" />
                      </span>
                    </Tooltip>
                  </span>
                )}
              </div>
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={() => {
                setEditing(null);
                setError(undefined);
              }}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {editing?.kind === "stamps" && (
        <ChecklistStampsDialog
          collectionId={collectionId}
          issueId={issueId}
          checklist={editing.checklist}
          isPending={isPending}
          error={error}
          onCancel={() => {
            setEditing(null);
            setError(undefined);
          }}
          onSave={(stampIds) =>
            run(
              () => setChecklistStampsAction(editing.checklist.id, stampIds),
              () => setEditing(null)
            )
          }
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete checklist"
          message={
            <>
              Delete <strong>{deleting.name}</strong>? The stamps stay in the issue — only the goal
              they were a set for goes, along with its completeness figures.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={() => {
            if (!isPending) {
              setDeleting(null);
              setError(undefined);
            }
          }}
          onConfirm={() => run(() => deleteChecklistAction(deleting.id), () => setDeleting(null))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

/**
 * Which of the issue's stamps are on one checklist. The whole tree is shown with a box each and
 * saved as a **set**, not as a diff — the collector ticks what the set contains and that is what is
 * stored, so nothing can drift between the boxes on screen and the rows written.
 */
function ChecklistStampsDialog({
  collectionId,
  issueId,
  checklist,
  isPending,
  error,
  onCancel,
  onSave,
}: {
  collectionId: string;
  issueId: string;
  checklist: ChecklistData;
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (stampIds: string[]) => void;
}) {
  const { data: members = [], isLoading } = useIssueMembers(collectionId, issueId, true);
  // The stored membership is the starting point; it is already here when this opens, and a later
  // refetch must not overwrite boxes the collector has been ticking.
  const [picked, setPicked] = useState<Set<string>>(new Set(checklist.stampIds));

  const tree = buildStampTree(members);

  function toggle(stampId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(stampId)) next.delete(stampId);
      else next.add(stampId);
      return next;
    });
  }

  return (
    <DialogShell
      title={`Stamps on “${checklist.name}”`}
      onClose={() => {
        if (!isPending) onCancel();
      }}
      maxWidth="min(96vw, 40rem)"
    >
      <form
        style={FORM_STYLE}
        onSubmit={(e) => {
          e.preventDefault();
          onSave([...picked]);
        }}
      >
        <DialogBody>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
              marginBottom: "0.75rem",
            }}
          >
            <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", margin: 0 }}>
              Tick the stamps this set is made of. An extra nobody counts — a block, a variety — is
              simply left unticked.
            </p>
            <span style={COUNT_BADGE}>
              {picked.size}/{members.length}
            </span>
          </div>

          {isLoading ? (
            <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading stamps…</p>
          ) : members.length === 0 ? (
            <p style={{ fontSize: "0.9375rem", color: "var(--color-text-muted)" }}>
              This issue has no stamps yet.
            </p>
          ) : (
            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "0.75rem",
                overflow: "hidden",
              }}
            >
              {tree.map((node) => (
                <StampCheckRow
                  key={node.node.stampId}
                  node={node}
                  depth={0}
                  picked={picked}
                  onToggle={toggle}
                  disabled={isPending}
                />
              ))}
            </div>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Save"}
          onCancel={onCancel}
          disabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

/** One stamp of the tree with its box, then its variants indented beneath it. */
function StampCheckRow({
  node,
  depth,
  picked,
  onToggle,
  disabled,
}: {
  node: StampTreeNodeData;
  depth: number;
  picked: Set<string>;
  onToggle: (stampId: string) => void;
  disabled: boolean;
}) {
  const stamp = node.node;
  return (
    <>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          padding: "0.4rem 0.75rem",
          paddingLeft: `${0.75 + depth * 1.25}rem`,
          background: "var(--color-bg-elevated)",
          borderTop: "1px solid var(--color-border)",
          fontSize: "0.875rem",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={picked.has(stamp.stampId)}
          onChange={() => onToggle(stamp.stampId)}
          disabled={disabled}
        />
        <span style={{ flex: 1, minWidth: 0 }}>{stampLabel(stamp)}</span>
      </label>
      {node.children.map((child) => (
        <StampCheckRow
          key={child.node.stampId}
          node={child}
          depth={depth + 1}
          picked={picked}
          onToggle={onToggle}
          disabled={disabled}
        />
      ))}
    </>
  );
}

/** Enough to tell one stamp of an issue from another: its numbers, then its name or date. Bare
 *  numbers rather than prefixed labels — every row here belongs to the same issue, so the vendor
 *  and area context is the dialog's, not the row's. */
function stampLabel(stamp: StampNodeData): string {
  const numbers = stamp.catalogNumbers.map((cn) => cn.number).join(" · ");
  const date = formatIssuedDate(stamp.issuedDay, stamp.issuedMonth, stamp.issuedYear);
  const rest = stamp.name ?? date ?? "";
  if (numbers && rest) return `${numbers} — ${rest}`;
  return numbers || rest || "(unnamed)";
}
