"use client";

import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type {
  IssueGroupChecklistCompleteness,
  IssueGroupRow as IssueGroupRowData,
} from "@/lib/items";
import { NO_ISSUE } from "@/lib/issue-groups";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  InventoryCopyList,
  type CopyRowActions,
  type CopySelection,
} from "./inventory-copy-list";
import { CopyGroupShell, useGroupMembers } from "./copy-group-shell";
import type { InventoryItemFilters } from "./use-inventory-query";

const COUNT_CHIP: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  color: "var(--color-accent)",
  background: "var(--color-accent-soft)",
  border: "1px solid var(--color-accent)",
  borderRadius: "0.375rem",
  padding: "0.125rem 0.5rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const COMPLETENESS_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  fontVariantNumeric: "tabular-nums",
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

/**
 * *How much of this series you have, condition by condition* (#594), on the group header of the
 * Copies list grouped by issue.
 *
 * **One chip per condition, spelled out rather than folded into a hover.** #563's lot header states
 * a single fraction and puts the detail in a popover, and the difference is what the two screens are
 * for: a sorting pass asks *can I list this set*, one question with one answer, while a collector
 * browsing their own inventory by series is asking which conditions the set is thin in — a question
 * whose answer *is* the breakdown, and one that is asked of every row on screen at once. A hover per
 * row is the wrong shape for something read by scanning down a list.
 *
 * The chips are **sparse**: only the conditions the checklist is actually held in get one, the
 * format axis's own rule (#133). A dictionary of eight conditions against a series held in two
 * would otherwise put six zeros on every row, and a zero here is not the information the row exists
 * to carry — the missing conditions are the white space.
 *
 * A **complete** condition is tinted `success` and says so, #563's chip again: the whole point of
 * scanning the list is finding the sets that are finished.
 *
 * The figures are counted over **the copies this list is showing**, filters and all, which is the
 * decision that separates this from every other completeness reading in the app and is why the
 * hover states it outright. A group header describes the rows under it: a list narrowed to one
 * klaser must not report a series as complete out of copies filed elsewhere. The consequence is
 * that the fraction moves as the filters do, so the sentence naming its scope is not optional.
 *
 * **Complete sets** — how many times over the whole checklist can be assembled — stay in the hover.
 * They are the grid's second figure (#519) and the one that says whether a duplicate is a spare,
 * but they are a second number per condition, and a chip line carrying two of each is a line nobody
 * reads.
 */
function ChecklistCompletenessChips({
  entry,
  named,
}: {
  entry: IssueGroupChecklistCompleteness;
  /** Print the checklist's name — true only where the issue carries more than one (ADR-0031). */
  named: boolean;
}) {
  return (
    <>
      {named && (
        <span style={{ ...MUTED, fontSize: "0.75rem" }}>{entry.name}</span>
      )}
      {entry.conditions.map((c) => {
        const complete = c.owned === entry.requiredCount;
        return (
          <Tooltip
            key={c.conditionId}
            content={
              <>
                <strong>
                  {c.owned}/{entry.requiredCount}
                </strong>{" "}
                of <strong>{entry.name}</strong> held in {c.name} ({c.abbreviation})
                {c.completeSets > 0 && (
                  <>
                    {" — "}
                    <strong>{c.completeSets}</strong> complete set
                    {c.completeSets === 1 ? "" : "s"}
                  </>
                )}
                .{" "}
                Counted over <strong>the copies this list is showing</strong>: every filter in force
                applies, so narrowing the list narrows this figure too.
              </>
            }
          >
            <span
              style={{
                ...COMPLETENESS_CHIP,
                borderColor: complete ? "var(--color-success)" : undefined,
                color: complete ? "var(--color-success)" : "var(--color-text-secondary)",
              }}
            >
              {c.abbreviation || c.name} {c.owned}/{entry.requiredCount}
            </span>
          </Tooltip>
        );
      })}
    </>
  );
}

/**
 * One issue group on the Copies list (#424): a series collapsed to a single row over the copies
 * held of it.
 *
 * As plain as a filing row (#421), and for the same reason: an issue is a *subject*, so the row
 * names it and says how many copies are under it. Which stamps those are is precisely the question
 * the member rows answer, and a summary of them here would be a second, shakier answer to it. The
 * year is stated apart from the name rather than folded into the label, since a series is routinely
 * looked up by it.
 */
export function IssueGroupRow({
  collectionId,
  group,
  baseFilters,
  areas,
  locations,
  baseCurrency,
  isLast,
  open,
  onToggle,
  selection,
  rowActions,
  completeness,
}: {
  collectionId: string;
  group: IssueGroupRowData;
  /** The panel's own filters — the members narrow by these *plus* the group's issue, so an expanded
   * group can never show a copy the count did not include. */
  baseFilters: InventoryItemFilters;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  isLast: boolean;
  /** Owned by the panel (#538), so Expand all / Collapse all can speak for the whole list. */
  open: boolean;
  onToggle: () => void;
  selection: CopySelection;
  /** The member rows' own `⋮` menu (#125/#516) — the very actions the ungrouped list offers.
   * Grouping is a way of *reading* the stock, not a mode with fewer things one may do to a copy. */
  rowActions?: CopyRowActions;
  /** This issue's checklists and how complete each is per condition (#594) — absent while the read
   *  is still in flight, and on the issue-less group, which is no set. */
  completeness?: IssueGroupChecklistCompleteness[];
}) {
  const memberFilters = issueGroupMemberFilters(group, baseFilters);
  const {
    members,
    membersLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    allSelected,
    partiallySelected,
    setAllSelected,
  } = useGroupMembers({
    collectionId,
    memberFilters,
    selection,
    wanted: open,
    // A select-all wants the copies on screen; with the row already open there is nothing to do, and
    // toggling would shut it.
    onWant: () => {
      if (!open) onToggle();
    },
  });

  const named = group.issueId !== null;
  // A checklist with nothing held of it says nothing on a header: the chips *are* the statement, so
  // an empty checklist and an untouched one both fall away rather than printing `0/0`.
  const sets = (completeness ?? []).filter(
    (c) => c.requiredCount > 0 && c.conditions.length > 0
  );

  return (
    <CopyGroupShell
      open={open}
      onToggle={onToggle}
      isLast={isLast}
      selectAll={{
        checked: allSelected,
        partial: partiallySelected,
        onChange: setAllSelected,
        label: "Select every copy of this issue that can be listed — for sale and in hand",
      }}
      header={
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <Tooltip
            content={`${group.count} cop${group.count === 1 ? "y" : "ies"} of this issue, of the ones this list is showing`}
          >
            <span style={COUNT_CHIP}>×{group.count}</span>
          </Tooltip>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: named ? "var(--color-text-primary)" : "var(--color-text-muted)",
              fontStyle: named ? undefined : "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {named ? (group.issueName?.trim() || "Untitled issue") : "No issue"}
          </span>
          {named && group.issueYear != null && <span style={MUTED}>{group.issueYear}</span>}
          {!named && (
            <span style={MUTED}>— these copies&rsquo; stamps do not belong to an issue</span>
          )}
        </div>
        {sets.length > 0 && (
          // A line of its own rather than a tail on the title: the title is a name and these are
          // figures about it, and the row wraps at a width where a series name and eight chips
          // would break in the middle of the sentence.
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}
          >
            {sets.map((entry) => (
              <ChecklistCompletenessChips
                key={entry.checklistId}
                entry={entry}
                named={sets.length > 1}
              />
            ))}
          </div>
        )}
        </div>
      }
    >
      {membersLoading ? (
        <p style={{ padding: "1rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Loading copies…
        </p>
      ) : (
        <InventoryCopyList
          collectionId={collectionId}
          copies={members}
          areas={areas}
          locations={locations}
          baseCurrency={baseCurrency}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={fetchNextPage}
          {...rowActions}
          selection={selection}
        />
      )}
    </CopyGroupShell>
  );
}

/**
 * The filters addressing one issue group's members: the panel's own filters plus the group's issue.
 * `NO_ISSUE` does the work an absent filter cannot — "belongs to no series" is a value on this axis,
 * not the lack of a question — exactly as the filing groups' `NO_LOCATION` does (#421).
 */
export function issueGroupMemberFilters(
  group: IssueGroupRowData,
  baseFilters: InventoryItemFilters
): InventoryItemFilters {
  return { ...baseFilters, issueId: group.issueId ?? NO_ISSUE };
}
