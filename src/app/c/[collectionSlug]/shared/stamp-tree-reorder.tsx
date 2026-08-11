"use client";

import { Fragment, useCallback, useState, useTransition } from "react";
import type { StampNodeData } from "@/lib/issues";
import { moveInOrder } from "@/lib/issue-member-order";
import {
  DragGrip,
  InsertionLine,
  dragStyle,
  showLineAt,
  useReorderList,
  type DragList,
} from "./reorder-list";
import type { StampTreeNodeData } from "./issue-view";
import { Icon } from "@/app/icons";

// ── Manual ordering of an issue's stamp tree (#549) ──────────────────────────────────────────
//
// Reordering is **not always on**: a tree of thirty stamps carrying a permanent grip on every row
// reads as a list you are expected to be rearranging, which is not what looking one up is. A
// toggle above the tree turns the grips on; leaving it returns the ordinary read/edit tree.
//
// A drag stays inside **one sibling group** — the issue's roots, or one parent's variants — because
// that is what the order means: a variant does not have a position among the roots, and dragging
// one out of its parent would be a *move*, which the row's own menu already offers.

/** What a tree needs to be reorderable, or null when the mode is off. */
export interface StampTreeReorder {
  /** Persist one whole sibling group's new order. */
  onReorder: (parentStampId: string | null, orderedStampIds: string[]) => void;
  /** True while a save is in flight — drags are refused rather than queued. */
  busy: boolean;
}

/** What one row spreads to become a drag source. Null on a row that cannot move. */
export interface StampNodeDragProps {
  item: ReturnType<DragList["itemProps"]>;
  handle: ReturnType<DragList["handleProps"]>;
  style: React.CSSProperties;
}

/**
 * The grab affordance, in the row's leading slot. Rendered in the same place whether or not the
 * row can actually move, so a tree does not shift sideways as groups of one come and go.
 */
export function StampDragGrip({ drag }: { drag: StampNodeDragProps | null }) {
  // `alignSelf` because the rows themselves are `flex-start` aligned — the text and the photo want
  // a common top edge, but a grip hanging off the top of a three-line row reads as belonging to
  // the gap above it rather than to the row.
  if (!drag) return <span style={{ width: "1.1rem", flexShrink: 0, alignSelf: "center" }} />;
  return (
    <span
      {...drag.handle}
      style={{ cursor: "grab", display: "inline-flex", flexShrink: 0, alignSelf: "center" }}
    >
      <DragGrip label="Drag to reorder" />
    </span>
  );
}

/**
 * One sibling group of the tree, wired as its own drag list.
 *
 * A component rather than a hook call at each level because a group's `useReorderList` has to be
 * one hook instance per group, and the groups are discovered by recursion. `renderNode` is what
 * each surface draws — the list row's editable node, the detail page's linked one.
 */
export function StampTreeGroup({
  nodes,
  parentStampId,
  reorder,
  indent = 0,
  renderNode,
}: {
  nodes: StampTreeNodeData[];
  /** The parent these nodes hang under, null for the issue's roots. */
  parentStampId: string | null;
  reorder: StampTreeReorder | null;
  /** How far the insertion line is inset, so it lines up with the rows it sits between. */
  indent?: number;
  renderNode: (args: {
    node: StampTreeNodeData;
    index: number;
    isLast: boolean;
    drag: StampNodeDragProps | null;
  }) => React.ReactNode;
}) {
  const onReorder = reorder?.onReorder;
  const move = useCallback(
    (from: number, to: number) => {
      onReorder?.(
        parentStampId,
        moveInOrder(nodes, from, to).map((n) => n.node.stampId)
      );
    },
    [nodes, onReorder, parentStampId]
  );
  // A group of one has nothing to reorder against, so it gets no grip at all.
  const drag = useReorderList(!!reorder && !reorder.busy && nodes.length > 1, move, {
    handleOnly: true,
  });

  return (
    <div {...(drag?.containerProps ?? {})}>
      {nodes.map((node, i) => (
        <Fragment key={node.node.stampId}>
          {showLineAt(drag, i) && <InsertionLine inset={indent} />}
          {renderNode({
            node,
            index: i,
            isLast: i === nodes.length - 1,
            drag: drag
              ? { item: drag.itemProps(i), handle: drag.handleProps(i), style: dragStyle(drag, i) }
              : null,
          })}
        </Fragment>
      ))}
      {showLineAt(drag, nodes.length) && <InsertionLine inset={indent} />}
    </div>
  );
}

/** The button that turns the mode on and off, for the header above a tree. */
export function ReorderModeButton({
  active,
  onToggle,
  disabled,
}: {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={active}
      title={
        active
          ? "Stop reordering and go back to the normal tree"
          : "Drag stamps to set the order they are listed in"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.2rem 0.5rem",
        border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border-strong)"}`,
        borderRadius: "0.375rem",
        fontSize: "0.75rem",
        background: active ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        whiteSpace: "nowrap",
      }}
    >
      <Icon name="dragGrip" size="sm" />
      {active ? "Done reordering" : "Reorder"}
    </button>
  );
}

/**
 * Reorder mode for one issue's tree: the toggle's state, the optimistic order the tree is drawn
 * in, and the write.
 *
 * The new order is shown **before** the server answers and rolled back if it refuses — a drag that
 * snapped back for a third of a second reads as a drag that did not take.
 */
export function useStampTreeReorder({
  collectionId,
  issueId,
  members,
  onSaved,
}: {
  collectionId: string;
  issueId: string;
  /** The order the server last reported. */
  members: StampNodeData[];
  /** Refresh the surface's own copy once a save landed. */
  onSaved: () => void;
}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // The server's answer, and the order on screen. Kept apart so a fresh load replaces the
  // optimistic copy rather than being ignored by it (the documented "adjust state on prop change"
  // pattern — an effect would draw the stale order for one frame first).
  const [serverMembers, setServerMembers] = useState(members);
  const [shown, setShown] = useState(members);
  if (serverMembers !== members) {
    setServerMembers(members);
    setShown(members);
  }

  const onReorder = useCallback(
    (parentStampId: string | null, orderedStampIds: string[]) => {
      const inGroup = new Set(orderedStampIds);
      const previous = shown;
      // Only the moved group is re-sequenced; every other member keeps the place it holds in the
      // list, which is what the server does to the stored values as well. `buildStampTree` reads
      // this array in order, so the flat list is where the tree's order actually lives.
      const groupSlots = previous
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => inGroup.has(m.stampId))
        .map(({ i }) => i);
      const next = [...previous];
      groupSlots.forEach((slot, k) => {
        const stampId = orderedStampIds[k];
        const member = previous.find((m) => m.stampId === stampId);
        if (member) next[slot] = member;
      });
      setShown(next);
      setError(null);

      startTransition(async () => {
        const { reorderIssueStampsAction } = await import("@/app/actions/issues");
        const result = await reorderIssueStampsAction(collectionId, issueId, orderedStampIds);
        if (result.status === "error") {
          setShown(previous);
          setError(result.message);
          return;
        }
        onSaved();
      });
    },
    [collectionId, issueId, onSaved, shown]
  );

  return {
    active,
    /** Leaving the mode also clears the last failure — the tree is back to being read. */
    toggle: () => {
      setActive((on) => !on);
      setError(null);
    },
    /** The tree to draw: the optimistic order while reordering, the server's otherwise. */
    members: shown,
    reorder: active ? ({ onReorder, busy: isPending } satisfies StampTreeReorder) : null,
    error,
  };
}
