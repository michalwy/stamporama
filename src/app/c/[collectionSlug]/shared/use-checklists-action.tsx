"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogFooter,
  DialogPrimaryButton,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  getChecklistsForIssueAction,
  createChecklistAction,
  renameChecklistAction,
  deleteChecklistAction,
  reorderChecklistsAction,
  reorderChecklistStampsAction,
  setChecklistStampsAction,
  type ChecklistActionState,
} from "@/app/actions/checklists";
import type { ChecklistData } from "@/lib/checklists";
import type { StampNodeData } from "@/lib/issues";
import type { RowAction } from "./row-actions-menu";
import { RowActionsMenu } from "./row-actions-menu";
import { buildStampTree, type StampTreeNodeData, type VendorMap } from "./issue-view";
import { CatalogNumberChip } from "./catalog-number-chip";
import { STAMP_PRIMARY_CHIP, STAMP_SECONDARY_CHIP } from "./chip-styles";
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
  /** The issue's area catalog entries, resolved through its own prefix overrides (#377) — what
   *  turns a stored `200` into the `Mi·PL 200` the composition checklist reads by (#547). */
  vendorMap: VendorMap;
  /** The area's leading catalog, so the chip that names the stamp is the accented one, exactly as
   *  it is on the row this dialog was opened from. */
  primaryVendorId: string | null;
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
  | { kind: "stamps"; checklist: ChecklistData }
  | { kind: "order"; checklist: ChecklistData };

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
    editing.kind !== "order" &&
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
                          key: "order",
                          label: "Order stamps…",
                          icon: "reorder",
                          onSelect: () => setEditing({ kind: "order", checklist }),
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

      {editing && editing.kind !== "stamps" && editing.kind !== "order" && (
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
          vendorMap={scope.vendorMap}
          primaryVendorId={scope.primaryVendorId}
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

      {editing?.kind === "order" && (
        <ChecklistStampOrderDialog
          collectionId={collectionId}
          issueId={issueId}
          vendorMap={scope.vendorMap}
          primaryVendorId={scope.primaryVendorId}
          checklist={editing.checklist}
          isPending={isPending}
          error={error}
          onClose={() => {
            setEditing(null);
            setError(undefined);
          }}
          onReorder={(stampIds) =>
            run(() => reorderChecklistStampsAction(editing.checklist.id, stampIds), () => {})
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
  vendorMap,
  primaryVendorId,
  checklist,
  isPending,
  error,
  onCancel,
  onSave,
}: {
  collectionId: string;
  issueId: string;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
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
                  vendorMap={vendorMap}
                  primaryVendorId={primaryVendorId}
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
  vendorMap,
  primaryVendorId,
  picked,
  onToggle,
  disabled,
}: {
  node: StampTreeNodeData;
  depth: number;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
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
        <StampLabel stamp={stamp} vendorMap={vendorMap} primaryVendorId={primaryVendorId} />
      </label>
      {node.children.map((child) => (
        <StampCheckRow
          key={child.node.stampId}
          node={child}
          depth={depth + 1}
          vendorMap={vendorMap}
          primaryVendorId={primaryVendorId}
          picked={picked}
          onToggle={onToggle}
          disabled={disabled}
        />
      ))}
    </>
  );
}

/** How a stamp is named on both of this editor's stamp lists: the same catalog-number chips the
 *  issue's own rows draw (#227), the leading catalogue accented, then whatever is left of the name. */
function StampLabel({
  stamp,
  vendorMap,
  primaryVendorId,
}: {
  stamp: StampNodeData;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
}) {
  const primaryCN = primaryVendorId
    ? stamp.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null
    : null;
  const secondaryCNs = stamp.catalogNumbers.filter((cn) => cn !== primaryCN);
  return (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
        flexWrap: "wrap",
      }}
    >
      {primaryCN && (
        <CatalogNumberChip
          number={primaryCN.number}
          vendor={vendorMap.get(primaryCN.catalogVendorId)}
          style={STAMP_PRIMARY_CHIP}
        />
      )}
      {secondaryCNs.map((cn) => (
        <CatalogNumberChip
          key={cn.catalogVendorId}
          number={cn.number}
          vendor={vendorMap.get(cn.catalogVendorId)}
          style={STAMP_SECONDARY_CHIP}
        />
      ))}
      {stampRest(stamp)}
    </span>
  );
}

/**
 * The order one checklist's stamps read in (#764).
 *
 * A checklist had no order of its own: every surface that listed one fell back to the catalog sort
 * key — right almost always, and wrong exactly where a catalogue's numbering does not match how the
 * set is laid out. This is the **collection-wide** answer, and every reader of the checklist takes
 * it; an album page may override it for one page, and the base order is the one set here.
 *
 * A **flat** list, unlike the tree next door: a checklist has no parents and no variants, only the
 * stamps it names, so a drag moves a row against the whole list and nothing has to stay inside a
 * sibling group. Reordering is the shared kit's, grip-only.
 *
 * Each drop **saves** — a drag is a gesture, not a form, and it is how every other reorder in the
 * app behaves, the checklists one row up included. The list on screen is the local one, moved
 * optimistically, so a slow write never drags a row back under the pointer.
 */
function ChecklistStampOrderDialog({
  collectionId,
  issueId,
  vendorMap,
  primaryVendorId,
  checklist,
  isPending,
  error,
  onClose,
  onReorder,
}: {
  collectionId: string;
  issueId: string;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  checklist: ChecklistData;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onReorder: (stampIds: string[]) => void;
}) {
  const { data: members = [], isLoading } = useIssueMembers(collectionId, issueId, true);
  const [order, setOrder] = useState<string[]>(checklist.stampIds);
  const byStamp = new Map(members.map((m) => [m.stampId, m]));

  function move(from: number, to: number) {
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    onReorder(next);
  }

  const drag = useReorderList(order.length > 1 && !isPending, move, { handleOnly: true });

  return (
    <DialogShell
      title={`Order of “${checklist.name}”`}
      onClose={() => {
        if (!isPending) onClose();
      }}
      maxWidth="min(96vw, 40rem)"
    >
      <DialogBody>
        <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", margin: "0 0 0.75rem" }}>
          Drag the ⠿ grip to say what order this set reads in. It starts in catalog order, which is
          what every screen showed before — change it where the catalogue&apos;s numbering is not how
          the set is laid out. Every screen that lists this checklist follows it.
        </p>

        {order.length === 0 ? (
          <p style={{ fontSize: "0.9375rem", color: "var(--color-text-muted)" }}>
            Nothing on this checklist yet — tick its stamps under <strong>Choose stamps…</strong>{" "}
            first.
          </p>
        ) : isLoading ? (
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading stamps…</p>
        ) : (
          <div
            {...(drag?.containerProps ?? {})}
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "0.75rem",
              overflow: "hidden",
            }}
          >
            {order.map((stampId, i) => {
              const stamp = byStamp.get(stampId);
              return (
                <div key={stampId}>
                  {showLineAt(drag, i) && <InsertionLine />}
                  <div
                    {...(drag?.itemProps(i) ?? {})}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                      padding: "0.4rem 0.75rem",
                      background: "var(--color-bg-elevated)",
                      borderTop: i > 0 ? "1px solid var(--color-border)" : "none",
                      fontSize: "0.875rem",
                      ...dragStyle(drag, i),
                    }}
                  >
                    {drag && (
                      <span {...drag.handleProps(i)}>
                        <DragGrip label="Reorder stamp" />
                      </span>
                    )}
                    <span style={{ ...COUNT_BADGE, minWidth: "1.75rem", textAlign: "right" }}>
                      {i + 1}
                    </span>
                    {stamp ? (
                      <StampLabel
                        stamp={stamp}
                        vendorMap={vendorMap}
                        primaryVendorId={primaryVendorId}
                      />
                    ) : (
                      // A checklist may name a stamp this issue no longer holds. It still has a
                      // place in the set, so it keeps its row rather than vanishing from the order.
                      <span style={{ flex: 1, color: "var(--color-text-muted)" }}>
                        (not among this issue&apos;s stamps)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {showLineAt(drag, order.length) && <InsertionLine />}
          </div>
        )}

        {error && (
          <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginTop: "0.75rem" }}>
            {error}
          </p>
        )}
      </DialogBody>
      {/* One button: each drop is already saved, so this dialog has nothing to commit. */}
      <DialogFooter>
        <DialogPrimaryButton type="button" onClick={onClose} disabled={isPending}>
          Done
        </DialogPrimaryButton>
      </DialogFooter>
    </DialogShell>
  );
}

/**
 * What is left of a stamp's label once its numbers are chips: the name, or the issue date when it
 * has none.
 *
 * The numbers used to be printed here too, bare and dot-separated, on the reading that every row
 * belongs to one issue so the vendor is the dialog's context (#547). It is not: an issue carries a
 * number in *each* catalogue it is listed in, so `445 · 412 · 500` was three catalogues' answers
 * for one stamp with nothing saying which was whose. They are the same chips the issue's own rows
 * draw (#227), which also makes the leading catalogue the accented one and each number copyable
 * (#420) — the state this dialog is ticked against is read off those rows.
 *
 * A stamp with neither name nor date still gets a row worth reading when it has chips, so the
 * "(unnamed)" fallback is only for the one that has nothing at all.
 */
function stampRest(stamp: StampNodeData): string | null {
  const date = formatIssuedDate(stamp.issuedDay, stamp.issuedMonth, stamp.issuedYear);
  const rest = stamp.name ?? date ?? null;
  if (rest) return rest;
  return stamp.catalogNumbers.length > 0 ? null : "(unnamed)";
}
