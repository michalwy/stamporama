"use client";

import { useState } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import type { LocationGroupRow as LocationGroupRowData } from "@/lib/items";
import {
  NO_LOCATION,
  NO_LOCATION_REF,
  type LocationGroupBy,
} from "@/lib/location-groups";
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

/** The in-location ref, in the monospace the copy rows already show it in — it is an identifier
 * read off a shelf, not a name. */
const REF_CHIP: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.25rem",
  padding: "0.05rem 0.4rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/**
 * One filing group on the Copies list (#421): a storage location — or, in `ref` mode, one ref inside
 * one location — collapsed to a single row over the copies filed there.
 *
 * Deliberately far plainer than the duplicate row: a filing group is a *place*, and everything worth
 * saying about it is where it is and how many copies are in it. What those copies are is the
 * question the member rows answer, and repeating a summary of them here would be a second, shakier
 * answer to it.
 */
export function LocationGroupRow({
  collectionId,
  group,
  by,
  baseFilters,
  areas,
  locations,
  baseCurrency,
  isLast,
  selection,
  rowActions,
}: {
  collectionId: string;
  group: LocationGroupRowData;
  by: LocationGroupBy;
  /** The panel's own filters — the members narrow by these *plus* the group's place, so an expanded
   * group can never show a copy the count did not include. */
  baseFilters: InventoryItemFilters;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  isLast: boolean;
  selection: CopySelection;
  /** The member rows' own `⋮` menu (#125/#516) — the very actions the ungrouped list offers.
   * Grouping is a way of *reading* the stock, not a mode with fewer things one may do to a copy. */
  rowActions?: CopyRowActions;
}) {
  const [open, setOpen] = useState(false);

  const memberFilters = locationGroupMemberFilters(group, by, baseFilters);
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
    onWant: () => setOpen(true),
  });

  const path = group.locationPath;
  // The path's last segment is the box itself; what leads up to it is context, so the two are
  // typed differently — a klaser deep in a cupboard should still read as "Klaser A".
  const parentPath = path && group.locationName ? path.slice(0, -group.locationName.length).trim() : null;

  return (
    <CopyGroupShell
      open={open}
      onToggle={() => setOpen((o) => !o)}
      isLast={isLast}
      selectAll={{
        checked: allSelected,
        partial: partiallySelected,
        onChange: setAllSelected,
        label: "Select every copy filed here that can be listed — for sale and in hand",
      }}
      header={
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <Tooltip
            content={`${group.count} cop${group.count === 1 ? "y" : "ies"} filed here, of the ones this list is showing`}
          >
            <span style={COUNT_CHIP}>×{group.count}</span>
          </Tooltip>
          {by === "ref" &&
            (group.locationRef ? (
              <span style={REF_CHIP}>{group.locationRef}</span>
            ) : (
              <Tooltip content="These copies are in this location but carry no in-location ref.">
                <span style={{ ...REF_CHIP, color: "var(--color-text-muted)", fontStyle: "italic" }}>
                  no ref
                </span>
              </Tooltip>
            ))}
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: group.locationId ? "var(--color-text-primary)" : "var(--color-text-muted)",
              fontStyle: group.locationId ? undefined : "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {group.locationName ?? "No location"}
          </span>
          {parentPath && <span style={MUTED}>in {parentPath}</span>}
          {!group.locationId && (
            <span style={MUTED}>— these copies have not been filed anywhere yet</span>
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
 * The filters addressing one filing group's members: the panel's own filters, plus the group's
 * location pinned **exactly** (a nested location is its own group, #421, so the subtree reading
 * would pull in the groups listed below this one) and, in `ref` mode, its ref. The two sentinels do
 * the work an absent filter cannot: `NO_LOCATION` is "filed nowhere" and `NO_LOCATION_REF` is
 * "nothing written on it", both of which are values rather than the absence of a question.
 */
export function locationGroupMemberFilters(
  group: LocationGroupRowData,
  by: LocationGroupBy,
  baseFilters: InventoryItemFilters
): InventoryItemFilters {
  return {
    ...baseFilters,
    locationId: group.locationId ?? NO_LOCATION,
    locationExact: true,
    ...(by === "ref" ? { locationRef: group.locationRef ?? NO_LOCATION_REF } : {}),
  };
}
