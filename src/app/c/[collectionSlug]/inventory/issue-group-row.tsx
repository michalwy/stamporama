"use client";

import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type {
  IssueGroupChecklistCompleteness,
  IssueGroupRow as IssueGroupRowData,
} from "@/lib/items";
import { NO_ISSUE } from "@/lib/issue-groups";
import { Icon } from "@/app/icons";
import {
  SET_COMPLETENESS_CHIP,
  SET_COMPLETENESS_CHIP_COMPLETE,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
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

/**
 * The hover behind a completeness chip (#670): what the chip is about, then its figures **in an
 * aligned two-column block**, then the caveat.
 *
 * It was one run-on sentence with the numbers set in bold inside it, and the numbers are the reason
 * anybody opens it — a fraction and a set count read out mid-clause are slower than the chip that
 * was already on screen. Label left, figure right and right-aligned, so `3/5` and `2` line up under
 * each other exactly as the issue page's own completeness grid sets them out; the scope sentence
 * follows in muted text, where a caveat belongs, rather than trailing the figures in the same voice.
 *
 * **The complete-set count prints even at zero.** On the chip line a zero is noise (#594 drops the
 * whole chip), but here the figure has been asked for: *held the set once over* and *held five of
 * the eight* are different answers, and a row that vanishes at zero makes the reader guess which one
 * they got.
 */
const TIP_TITLE: React.CSSProperties = { fontWeight: 600, marginBottom: "0.25rem" };

const TIP_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto auto",
  columnGap: "0.75rem",
  rowGap: "0.1rem",
  alignItems: "baseline",
};

const TIP_LABEL: React.CSSProperties = { color: "var(--color-text-secondary)" };

const TIP_FIGURE: React.CSSProperties = {
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
};

const TIP_NOTE: React.CSSProperties = {
  marginTop: "0.35rem",
  color: "var(--color-text-muted)",
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
 * A **complete** condition is filled and ticked rather than merely tinted (#671): the whole point of
 * scanning the list is finding the sets that are finished, so the finished ones are what the line
 * has to hand over without being read. The treatment is `SET_COMPLETENESS_CHIP_COMPLETE`, shared
 * with #563's lot header, which states the same fact about a different set of copies.
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
                <div style={TIP_TITLE}>
                  {entry.name} · {c.name} ({c.abbreviation})
                </div>
                <div style={TIP_GRID}>
                  <span style={TIP_LABEL}>Held</span>
                  <span style={TIP_FIGURE}>
                    {c.owned}/{entry.requiredCount}
                  </span>
                  <span style={TIP_LABEL}>Complete sets</span>
                  <span style={TIP_FIGURE}>{c.completeSets}</span>
                </div>
                <div style={TIP_NOTE}>
                  Counted over the copies this list is showing — every filter in force applies, so
                  narrowing the list narrows these figures too.
                </div>
              </>
            }
          >
            <span style={complete ? SET_COMPLETENESS_CHIP_COMPLETE : SET_COMPLETENESS_CHIP}>
              {complete && <Icon name="check" size="sm" style={{ marginRight: "0.2rem" }} />}
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
