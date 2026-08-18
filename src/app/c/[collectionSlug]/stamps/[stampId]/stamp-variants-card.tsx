"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { IssueListItem } from "@/lib/issues";
import type { StampListItem, StampRelatives } from "@/lib/stamps";
import { moveInOrder } from "@/lib/issue-member-order";
import { DetailCard, EmptyNote, DETAIL_BUTTON } from "@/app/c/[collectionSlug]/shared/detail-page";
import { StampIdentity } from "@/app/c/[collectionSlug]/shared/stamp-identity";
import { CopyCountBadge } from "@/app/c/[collectionSlug]/shared/copy-count-badge";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { RowQuickActions, pickRowActions } from "@/app/c/[collectionSlug]/shared/row-quick-actions";
import { useDetailPageAction } from "@/app/c/[collectionSlug]/shared/use-detail-page-action";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
import { DeleteStampDialog } from "@/app/c/[collectionSlug]/shared/delete-stamp-dialog";
import { ReorderModeButton } from "@/app/c/[collectionSlug]/shared/stamp-tree-reorder";
import {
  DragGrip,
  InsertionLine,
  dragStyle,
  showLineAt,
  useReorderList,
} from "@/app/c/[collectionSlug]/shared/reorder-list";
import type { useAreaVendorMaps } from "@/app/c/[collectionSlug]/shared/use-area-vendor-maps";
import { Icon } from "@/app/icons";

// The variant tree, managed from the stamp's own screen (#630).
//
// #518 left this card as navigation — parent above, children below, a link each way — because *a
// detail page reads; it does not become a second editor*. That rule is about a record's **fields**:
// a second form over one stamp's name and dates is a second place to keep honest. A variant tree is
// not a field of anything. It is the relationship *between* stamps, it has no other home on this
// screen, and working one out (`309 → 309A → 309AP → 309APa`) means adding four stamps one under
// the next — which until now meant leaving for the Issues list, finding the row again, and
// expanding back to where you were. So the card gains the tree's own operations and **not one
// field of its own**: every write here goes through the very dialog the Issues list opens (#54),
// so there is still exactly one editor per record.
//
// Everything a tree operation touches is scoped to an **issue** — `IssueMember.sortOrder` is
// per-issue (#549), and a new stamp is filed under one — so the card settles on the stamp's *first*
// issue membership, `toStampListItem`'s own rule and the one the edit dialog already picks
// checklists by. It **names** that issue in the header rather than assuming it, so a stamp on two
// issues says which one is about to change; a stamp on none keeps the read-only card it had.

/** An issue named the way every other surface names it: year first, then name. */
function issueLabel(issue: IssueListItem): string {
  return [issue.year, issue.name].filter(Boolean).join(", ") || "(unnamed issue)";
}

export function StampVariantsCard({
  collectionId,
  collectionSlug,
  stamp,
  relatives,
  treeIssue,
  maps,
}: {
  collectionId: string;
  collectionSlug: string;
  stamp: StampListItem;
  relatives: StampRelatives;
  /** The issue named by {@link StampRelatives.treeIssueId}, enriched as its list row so the add
   *  dialog offers the same checklists and range prompt it does on the Issues list. */
  treeIssue: IssueListItem | null;
  maps: ReturnType<typeof useAreaVendorMaps>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [dialog, setDialog] = useState<
    | { kind: "none" }
    | { kind: "add" }
    | { kind: "edit"; child: StampListItem }
    | { kind: "delete"; child: StampListItem }
  >({ kind: "none" });

  const [reordering, setReordering] = useState(false);
  // The server's answer, and the order on screen. Kept apart so a rejected save can put the rows
  // back — a row that snapped into place and then out again reads as a drag that failed silently —
  // and so a fresh load *replaces* the optimistic copy rather than being shadowed by it. Adjusted
  // during render against the array's identity, the documented "state from props" pattern that
  // `useStampTreeReorder` follows for the issue tree; an effect would draw the stale order first.
  const [serverChildren, setServerChildren] = useState(relatives.children);
  const [children, setChildren] = useState(relatives.children);
  if (serverChildren !== relatives.children) {
    setServerChildren(relatives.children);
    setChildren(relatives.children);
  }

  const canWrite = !!treeIssue;
  const canReorder = relatives.childrenOrderable;

  function closeDialog() {
    setDialog({ kind: "none" });
    setError(undefined);
  }

  /** A write landed: the page is a server component, so the tree comes back through a refresh. */
  function onSaved() {
    closeDialog();
    router.refresh();
  }

  const move = (from: number, to: number) => {
    if (!treeIssue) return;
    const previous = children;
    const next = moveInOrder(previous, from, to);
    setChildren(next);
    setError(undefined);
    startTransition(async () => {
      const { reorderIssueStampsAction } = await import("@/app/actions/issues");
      const result = await reorderIssueStampsAction(
        collectionId,
        treeIssue.id,
        next.map((c) => c.id)
      );
      if (result.status === "error") {
        setChildren(previous);
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };
  const drag = useReorderList(reordering && canReorder && !isPending, move, { handleOnly: true });

  // Resolved through the tree issue, so a per-issue prefix override (#377) labels the catalog-number
  // inputs with the prefix the numbers will actually carry — the Issues list' own resolution.
  const areaVendors = [
    ...maps
      .vendorMapFor(treeIssue?.collectionAreaId ?? stamp.areaId, treeIssue?.id ?? null)
      .values(),
  ];

  const empty = !relatives.parent && children.length === 0 && !canWrite;

  return (
    <>
      <DetailCard
        title="Variants"
        count={children.length || null}
        empty={empty}
        actions={
          canWrite ? (
            <>
              {canReorder && (
                <ReorderModeButton
                  active={reordering}
                  onToggle={() => {
                    setReordering((on) => !on);
                    setError(undefined);
                  }}
                  disabled={isPending}
                />
              )}
              {!reordering && (
                <button
                  type="button"
                  onClick={() => setDialog({ kind: "add" })}
                  disabled={isPending}
                  style={DETAIL_BUTTON}
                >
                  <Icon name="add" size="sm" />
                  Add variant
                </button>
              )}
            </>
          ) : undefined
        }
      >
        {/* Where this stamp sits among the variants beside it, and — because every operation below
            is filed under one issue — which issue that is. Both are one muted line: a stamp on one
            issue (the ordinary case) has nothing to choose, and a control there would be a question
            asked on every stamp to be answered on almost none. */}
        {(relatives.position || treeIssue) && (
          <div
            style={{
              marginBottom: "0.625rem",
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
            }}
          >
            {[
              relatives.position
                ? `Variant ${relatives.position.index} of ${relatives.position.total}`
                : null,
              treeIssue ? `Filed under ${issueLabel(treeIssue)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{ marginBottom: "0.5rem", fontSize: "0.8125rem", color: "var(--color-error)" }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {relatives.parent && (
            <RelativeRow
              role="Base stamp"
              stamp={relatives.parent}
              collectionSlug={collectionSlug}
              maps={maps}
            />
          )}
          <div {...(drag?.containerProps ?? {})}>
            {children.map((child, i) => (
              <div key={child.id}>
                {showLineAt(drag, i) && <InsertionLine inset={relatives.parent ? 16 : 0} />}
                <RelativeRow
                  role="Variant"
                  stamp={child}
                  collectionSlug={collectionSlug}
                  maps={maps}
                  indented={!!relatives.parent}
                  showCopies
                  onEdit={canWrite ? () => setDialog({ kind: "edit", child }) : undefined}
                  onDelete={canWrite ? () => setDialog({ kind: "delete", child }) : undefined}
                  drag={
                    drag
                      ? {
                          item: drag.itemProps(i),
                          handle: drag.handleProps(i),
                          style: dragStyle(drag, i),
                        }
                      : null
                  }
                  reordering={reordering && canReorder}
                />
              </div>
            ))}
            {showLineAt(drag, children.length) && (
              <InsertionLine inset={relatives.parent ? 16 : 0} />
            )}
          </div>
          {children.length === 0 && (
            <EmptyNote>
              {relatives.parent
                ? "No variants under this stamp yet."
                : "No variants yet — add one to start the tree."}
            </EmptyNote>
          )}
          {/* Said only where it is the reason a control is missing: a tree whose variants sit on
              some other issue (or on none) cannot be reordered here, because the server takes a
              whole sibling group of one issue and would be handed a partial one. */}
          {canWrite && children.length > 1 && !canReorder && (
            <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              Reordering is done on the issue these variants belong to — not all of them are on{" "}
              {treeIssue ? issueLabel(treeIssue) : "this issue"}.
            </div>
          )}
        </div>
      </DetailCard>

      {dialog.kind === "add" && treeIssue && (
        <StampFormDialog
          mode="add"
          collectionId={collectionId}
          issues={[treeIssue]}
          areaVendors={areaVendors}
          prefilledIssueId={treeIssue.id}
          prefilledParentStampId={stamp.id}
          // A variant is dated from the stamp it hangs under, not from the issue (#360).
          prefilledParentIssuedYear={stamp.issuedYear}
          // And numbered off it (`309` → `309A`), so the inputs open on this stamp's numbers for
          // the collector to suffix — the Issues list' own prefill (#386).
          defaultCatalogNumbers={stamp.catalogNumbers}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={(issueId, fd) =>
            startTransition(async () => {
              const { addStampToIssueAction } = await import("@/app/actions/issues");
              const result = await addStampToIssueAction(collectionId, issueId, fd);
              if (result.status === "success") onSaved();
              else if (result.status === "error") setError(result.message);
            })
          }
        />
      )}

      {dialog.kind === "edit" && (
        <StampFormDialog
          mode="edit"
          stampId={dialog.child.id}
          collectionId={collectionId}
          stamp={{
            name: dialog.child.name,
            issuedDay: dialog.child.issuedDay,
            issuedMonth: dialog.child.issuedMonth,
            issuedYear: dialog.child.issuedYear,
            catalogNumbers: dialog.child.catalogNumbers,
            colnectId: dialog.child.colnectId,
            // Its memberships as they are: the dialog edits the first one's checklists, which is
            // the issue this card is working in.
            issues: dialog.child.issues.map((m) => ({
              issueId: m.issueId,
              checklists: m.checklists,
            })),
          }}
          areaVendors={areaVendors}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={(fd) =>
            startTransition(async () => {
              const { updateStampWithCatalogAction } = await import("@/app/actions/stamps");
              const result = await updateStampWithCatalogAction(dialog.child.id, fd);
              if (result.status === "success") onSaved();
              else if (result.status === "error") setError(result.message);
            })
          }
        />
      )}

      {dialog.kind === "delete" && (
        <DeleteStampDialog
          stampId={dialog.child.id}
          stampName={dialog.child.name ?? "(unnamed)"}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onConfirm={(mode) =>
            startTransition(async () => {
              const { deleteStampAction } = await import("@/app/actions/stamps");
              const result = await deleteStampAction(dialog.child.id, mode);
              if (result.status === "success") onSaved();
              else if (result.status === "error") setError(result.message);
            })
          }
        />
      )}
    </>
  );
}

/**
 * A neighbour in the variant tree: what it is to this stamp, its identity, and the same dimmed
 * icon every row in the app carries to reach a record's own screen. A child also carries the tree's
 * own operations — in one `⋮` menu, with *Open stamp page* and *Edit* promoted to the hover icons
 * through `pickRowActions`, so a shortcut and its menu entry cannot drift.
 */
function RelativeRow({
  role,
  stamp,
  collectionSlug,
  maps,
  indented = false,
  showCopies = false,
  onEdit,
  onDelete,
  drag = null,
  reordering = false,
}: {
  /** How this stamp relates to the one on screen — "Base stamp" or "Variant". */
  role: string;
  stamp: StampListItem;
  collectionSlug: string;
  maps: ReturnType<typeof useAreaVendorMaps>;
  indented?: boolean;
  showCopies?: boolean;
  /** Absent on the parent row and on a stamp whose tree this card may not write to. */
  onEdit?: () => void;
  onDelete?: () => void;
  drag?: {
    item: React.HTMLAttributes<HTMLElement> & { ref: (el: HTMLElement | null) => void };
    handle: { onMouseDown: () => void; onMouseUp: () => void };
    style: React.CSSProperties;
  } | null;
  reordering?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const detailPage = useDetailPageAction("stamp", stamp.id);
  const vendorMap = maps.vendorMapFor(stamp.areaId, stamp.issues[0]?.issueId ?? null);
  const primaryVendorId = maps.primaryVendorByArea.get(stamp.areaId ?? "") ?? null;

  const actions: RowAction[] = [
    detailPage,
    ...(onEdit ? [{ key: "edit", label: "Edit", icon: "edit" as const, onSelect: onEdit }] : []),
    ...(onDelete
      ? [
          {
            key: "delete",
            label: "Delete",
            icon: "delete" as const,
            danger: true,
            separatorBefore: true,
            onSelect: onDelete,
          },
        ]
      : []),
  ];

  return (
    <div
      {...(drag?.item ?? {})}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.125rem 0",
        paddingLeft: indented ? "1rem" : 0,
        ...(drag?.style ?? {}),
      }}
    >
      {/* Kept in the row whether or not it can move, so the list does not shift sideways as the
          mode goes on and off — `StampDragGrip`'s own rule on the issue tree. */}
      {reordering && (
        <span
          {...(drag?.handle ?? {})}
          style={{ cursor: drag ? "grab" : "default", display: "inline-flex", flexShrink: 0 }}
        >
          <DragGrip label="Drag to reorder" />
        </span>
      )}
      <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", flexShrink: 0 }}>
        {role}
      </span>
      <StampIdentity
        stamp={stamp}
        vendorMap={vendorMap}
        primaryVendorId={primaryVendorId}
        size="small"
        href={`/c/${collectionSlug}/stamps/${stamp.id}`}
      />
      {showCopies && <CopyCountBadge copies={stamp.copies} variantCopies={stamp.variantCopies} />}
      <span
        style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}
      >
        {actions.length > 1 ? (
          <>
            <RowQuickActions
              actions={pickRowActions(actions, ["detail-page", "edit"])}
              visible={hovered}
            />
            <RowActionsMenu actions={actions} ariaLabel="Variant actions" />
          </>
        ) : (
          <RowQuickActions actions={actions} visible={hovered} />
        )}
      </span>
    </div>
  );
}
