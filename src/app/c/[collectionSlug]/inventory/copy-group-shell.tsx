"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { outlierCopyIds, type CopyGroupAxes } from "@/lib/copy-groups";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { SELECT_STRIP, type CopySelection } from "./inventory-copy-list";
import { useInventoryItemsInfinite, type InventoryItemFilters } from "./use-inventory-query";

/**
 * What every grouped row of the Copies list is made of — the duplicate groups (#372) and the filing
 * groups (#421) alike: a select-all box, an expand arrow, the row's own lines, and the members
 * underneath. It lives here because #422's two fixes are about *the group row*, not about one kind
 * of grouping, and a shell each would have meant fixing them twice and drifting once.
 *
 * The two fixes:
 *  • the arrow is **vertically centred** — a group row is four lines tall, and an arrow pinned to
 *    the top read as belonging to the first line rather than to the row;
 *  • select-all is a **checkbox in the same `SELECT_STRIP` gutter the member copies use**, so
 *    ticking a whole group is one click. It used to be a `⋮` entry (#398), which is two clicks and
 *    a menu to read for the one thing the row is most often used for. The gutter is also where the
 *    eye already is: the group's box sits directly above its members' boxes.
 */
export function CopyGroupShell({
  open,
  onToggle,
  selectAll,
  isLast,
  header,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** Absent where nothing in the group can be selected — a read-only surface. */
  selectAll?: {
    checked: boolean;
    /** Some but not all of the group's selectable copies are ticked. */
    partial: boolean;
    onChange: (next: boolean) => void;
    /** Why the box is not offered, when it is not. */
    disabledHint?: string;
    label: string;
  };
  isLast: boolean;
  /** The row's own lines — everything that describes *this* group. */
  header: React.ReactNode;
  /** The member copies, rendered only while the row is open. */
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ borderBottom: isLast && !open ? undefined : "1px solid var(--color-border)" }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: "0.75rem 1.25rem 0.75rem 0",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          display: "flex",
          // Stretch, so both gutters run the row's full height and centre their control in it.
          alignItems: "stretch",
          gap: "0.25rem",
        }}
      >
        {selectAll ? (
          // The strip's layout rides on the tooltip's own wrapper — it is the flex item here, and a
          // hint around a full-height gutter would otherwise collapse it (see the `Tooltip` rules).
          <Tooltip content={selectAll.disabledHint ?? selectAll.label} style={SELECT_STRIP}>
            {/* A `<label>` filling the strip, so the whole gutter is the hit area rather than the
                13px box in it — the same target a member copy's checkbox gets. */}
            <label style={GROUP_SELECT_LABEL}>
              <input
                type="checkbox"
                checked={selectAll.checked}
                disabled={!!selectAll.disabledHint}
                ref={(el) => {
                  // "Some of them" is a third state the DOM only exposes as a property.
                  if (el) el.indeterminate = selectAll.partial && !selectAll.checked;
                }}
                onChange={(e) => selectAll.onChange(e.target.checked)}
                aria-label={selectAll.label}
                style={{ cursor: selectAll.disabledHint ? "not-allowed" : "pointer" }}
              />
            </label>
          </Tooltip>
        ) : (
          <span style={{ ...SELECT_STRIP, cursor: "default" }} />
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Hide copies" : "Show copies"}
          aria-expanded={open}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "1.5rem",
            flexShrink: 0,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: "0.75rem",
            padding: 0,
          }}
        >
          <span
            style={{
              display: "inline-block",
              transform: open ? "rotate(90deg)" : undefined,
              transition: "transform 0.12s ease",
            }}
          >
            ▶
          </span>
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>{header}</div>
      </div>

      {open && (
        <div style={{ background: "var(--color-bg-page)", paddingLeft: "2.25rem" }}>{children}</div>
      )}
    </div>
  );
}

/**
 * The members of one group, and the quick select-all over them (#398), for both kinds of group row.
 *
 * The members are fetched through the ordinary items query with the group's own key pinned, so no
 * per-group endpoint exists — and only once the row is **wanted**: open, or with a select-all
 * pending. A page of forty groups must not fetch four hundred copies to draw forty collapsed lines.
 *
 * A select-all asked for while the group was collapsed is held as a **nonce** until every member has
 * arrived, walking the pages first: a partly loaded group would tick a subset and call it "all".
 * Which nonce has already been served is a `ref` — it is bookkeeping about a request, not something
 * the row renders, and a second piece of state would be a `setState` inside the effect discharging
 * it.
 */
export function useGroupMembers({
  collectionId,
  memberFilters,
  selection,
  axes,
  wanted,
  onWant,
}: {
  collectionId: string;
  memberFilters: InventoryItemFilters;
  selection: CopySelection;
  /** The duplicate grouping's axes, when this is a duplicate group: what is left at *any* is what a
   * member can be an **outlier** on (#372). Filing groups have no such axis. */
  axes?: CopyGroupAxes;
  /** The row is open, so the members are on screen anyway. */
  wanted: boolean;
  /** Opening the row: the copies about to be acted on should be visible when they are ticked. */
  onWant: () => void;
}) {
  const [selectAllNonce, setSelectAllNonce] = useState(0);
  const servedNonce = useRef(0);

  const fetchMembers = wanted || selectAllNonce > 0;
  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading: membersLoading,
  } = useInventoryItemsInfinite(collectionId, memberFilters, fetchMembers);
  const members = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  // Copies differing from the group's *most common* value on an axis left at *any* (#372). They keep
  // their marking on the member rows and stay out of quick select-all — a group's odd one out would
  // make a quantity listing misleading — but they are ticked individually like any other copy.
  const outliers = useMemo(
    () => (axes ? outlierCopyIds(members, axes) : EMPTY_IDS),
    [members, axes]
  );
  // What a quick select-all covers: every member that is not an outlier and that the list would give
  // a checkbox to at all (`isEligible` — for sale, in hand, still held), so the shortcut can never
  // tick a copy a hand could not.
  const quickSelectable = members.filter(
    (m) => !outliers.has(m.id) && selection.isEligible(m)
  );
  const selectedCount = quickSelectable.filter((m) => selection.selected.has(m.id)).length;
  // Derived from the copies actually ticked, never from the request: a select-all asked for while
  // the group was collapsed walks its pages first, and a box reporting "all" before the members
  // have arrived would be claiming something that is not true yet.
  const allSelected = quickSelectable.length > 0 && selectedCount === quickSelectable.length;
  const partiallySelected = !allSelected && selectedCount > 0;

  useEffect(() => {
    if (selectAllNonce === 0 || servedNonce.current === selectAllNonce) return;
    if (membersLoading || isFetchingNextPage) return;
    if (hasNextPage) {
      fetchNextPage();
      return;
    }
    servedNonce.current = selectAllNonce;
    selection.onSetMany(quickSelectable, true);
  }, [
    selectAllNonce,
    membersLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    quickSelectable,
    selection,
  ]);

  function setAllSelected(next: boolean) {
    if (!next) {
      // Untick what is loaded and cancel any pending request, so a group ticked while collapsed can
      // be unticked before its pages have even arrived.
      servedNonce.current = selectAllNonce;
      selection.onSetMany(quickSelectable, false);
      return;
    }
    onWant();
    // Bumped rather than set, so asking twice re-ticks a group the collector has since unticked.
    setSelectAllNonce((n) => n + 1);
  }

  return {
    members,
    membersLoading,
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    outliers,
    allSelected,
    partiallySelected,
    setAllSelected,
  };
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

const GROUP_SELECT_LABEL: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
  cursor: "pointer",
};
