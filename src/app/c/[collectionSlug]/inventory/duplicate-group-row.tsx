"use client";

import { useState } from "react";
import { formatIssuedDate } from "@/app/stamp-display";
import type { CopyGroupRow } from "@/lib/items";
import type { CopyGroupAxes } from "@/lib/copy-groups";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { LocationData } from "@/lib/locations";
import {
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { CatalogNumberChip } from "@/app/c/[collectionSlug]/shared/catalog-number-chip";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  ColnectChip,
  colnectSearchQueryFor,
} from "@/app/c/[collectionSlug]/shared/colnect-chip";
import { SubtypeChip } from "@/app/c/[collectionSlug]/shared/subtype-chip";
import { buildAreaPath } from "@/app/c/[collectionSlug]/shared/area-helpers";
import {
  InventoryCopyList,
  type CopyRowActions,
  type CopySelection,
} from "./inventory-copy-list";
import { CopyGroupShell, useGroupMembers } from "./copy-group-shell";
import { CopyValue } from "./inventory-item-row";
import type { InventoryItemFilters } from "./use-inventory-query";

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const AREA_CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "20rem",
  flexShrink: 0,
};

const META_INLINE: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

/** How many copies the group holds — the whole point of the row, so it leads it. */
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

/** A member of the group differs on an axis left at *any*. Warning-tinted rather than plain,
 * because it is the one thing that makes the group not quite interchangeable. */
const MIXED_CHIP: React.CSSProperties = {
  ...CHIP,
  color: "var(--color-warning)",
  borderColor: "var(--color-warning-border, var(--color-border))",
  background: "var(--color-warning-soft, var(--color-bg-page))",
};

/**
 * One duplicate group on the Copies list (#372): a bag of interchangeable copies, collapsed to a
 * single row. Mirrors `InventoryItemRow`'s four-line layout — it describes the same stamp — and
 * adds what only a group has: how many, how many are already listed, and where its members
 * disagree. Expanding renders the members as ordinary copy rows, fetched then and not before: a page
 * of forty groups must not fetch four hundred copies to draw forty collapsed lines.
 *
 * The members carry the list's own selection checkboxes (#373), and the row's own box ticks them all
 * in one click (#398, moved out of the ⋮ menu by #422) — grouping is a way of *reading* the stock, so
 * what one does with a set of copies stays the one bulk flow the flat list already has rather than a
 * second listing dialog of its own. The shell it renders through (`CopyGroupShell`) is shared with
 * the filing groups (#421).
 */
export function DuplicateGroupRow({
  collectionId,
  group,
  axes,
  baseFilters,
  areas,
  locations,
  baseCurrency,
  primaryVendorId,
  vendorMap,
  isLast,
  selection,
  rowActions,
}: {
  collectionId: string;
  group: CopyGroupRow;
  axes: CopyGroupAxes;
  /** The panel's own filters — the member list narrows by these *plus* the group's key, so an
   * expanded group can never show a copy the count did not include. */
  baseFilters: InventoryItemFilters;
  areas: CollectionAreaData[];
  locations: LocationData[];
  baseCurrency: string;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  isLast: boolean;
  /** The panel's multi-select (#373), shared with the flat list: the group's members carry the very
   * same checkboxes, and the group row's quick select-all feeds this state rather than a flow of its
   * own (#398). */
  selection: CopySelection;
  /** The member rows' own `⋮` menu (#125/#516) — the very actions the ungrouped list offers.
   * Grouping is a way of *reading* the stock, not a mode with fewer things one may do to a copy. */
  rowActions?: CopyRowActions;
}) {
  const [open, setOpen] = useState(false);

  const memberFilters = groupMemberFilters(group, axes, baseFilters);
  const {
    members,
    membersLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    outliers,
    allSelected,
    partiallySelected,
    setAllSelected,
  } = useGroupMembers({
    collectionId,
    memberFilters,
    selection,
    axes,
    wanted: open,
    onWant: () => setOpen(true),
  });

  const primaryCN = primaryVendorId
    ? (group.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null)
    : null;
  const secondaryCNs = group.catalogNumbers.filter(
    (cn) => cn.catalogVendorId !== primaryVendorId
  );
  const areaPath = buildAreaPath(areas, group.areaId);
  const dateStr = formatIssuedDate(group.issuedDay, group.issuedMonth, group.issuedYear);
  const hasIssue = !!(group.issueName || group.issueYear);

  return (
    <CopyGroupShell
      open={open}
      onToggle={() => setOpen((o) => !o)}
      isLast={isLast}
      // One click ticks the whole bag of copies (#422) — the shortcut #398 introduced, moved out of
      // the ⋮ menu into the gutter the member copies' own boxes sit in.
      selectAll={{
        checked: allSelected,
        partial: partiallySelected,
        onChange: setAllSelected,
        label: "Select every copy in this group that can be listed — for sale and in hand",
      }}
      header={
        <>
          {/* Line 1: how many, the stamp's name */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Tooltip content={`${group.count} interchangeable copies in this group`}>
              <span style={COUNT_CHIP}>×{group.count}</span>
            </Tooltip>
            <span
              style={{
                flex: 1,
                fontSize: "0.9375rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {group.stampName ?? "(unnamed stamp)"}
            </span>
          </div>

          {/* Line 2: area path, date, issue */}
          {(areaPath || dateStr || hasIssue) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginTop: "0.2rem",
              }}
            >
              {areaPath && <span style={AREA_CHIP}>{areaPath}</span>}
              {(dateStr || hasIssue) && (
                <span style={META_INLINE}>
                  {dateStr}
                  {dateStr && hasIssue && ", "}
                  {hasIssue && (
                    <>
                      {group.issueName ?? "(unnamed issue)"}
                      {group.issueYear ? ` (${group.issueYear})` : ""}
                    </>
                  )}
                </span>
              )}
            </div>
          )}

          {/* Line 3: catalog numbers + the group's per-copy catalog value */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              marginTop: "0.6rem",
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
            <ColnectChip
              colnectId={group.colnectId}
              searchQuery={colnectSearchQueryFor(primaryCN ?? secondaryCNs[0], vendorMap)}
            />
            <SubtypeChip subtype={group.subtype} />
            {group.unknownVariant && (
              <Tooltip content="These copies link to the base stamp; the specific variant is unknown.">
                <span
                  style={{
                    ...CHIP,
                    color: "var(--color-warning)",
                    borderColor: "var(--color-warning-border, var(--color-border))",
                  }}
                >
                  unknown variant
                </span>
              </Tooltip>
            )}
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline" }}>
              {group.value ? (
                <CopyValue value={group.value} baseCurrency={baseCurrency} />
              ) : (
                <Tooltip
                  content={
                    group.valueVaries
                      ? "The copies in this group value differently — split the group by format or certificate to see one figure each."
                      : "No catalog price recorded for this condition."
                  }
                >
                  <span
                    style={{
                      fontSize: "0.8125rem",
                      color: "var(--color-text-muted)",
                      fontStyle: group.valueVaries ? "italic" : undefined,
                    }}
                  >
                    {group.valueVaries ? "varies" : "—"}
                  </span>
                </Tooltip>
              )}
            </span>
          </div>

          {/* Line 4: what the group is keyed on, where it is mixed, and what is already listed */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginTop: "0.6rem",
              flexWrap: "wrap",
            }}
          >
            <Tooltip content={group.conditionName}>
              <span style={CHIP}>{group.conditionAbbreviation}</span>
            </Tooltip>
            {axes.format && (
              <Tooltip content={group.formatName ?? "Single (no format recorded)"}>
                <span style={CHIP}>{group.formatAbbreviation ?? "single"}</span>
              </Tooltip>
            )}
            {axes.certificate && (
              <Tooltip content="Certificate status">
                <span style={CHIP}>{group.certificateStatusName ?? "no certificate"}</span>
              </Tooltip>
            )}
            {group.mixedFormat && (
              <Tooltip content="These copies are not all the same format. Turn on Split by format to group them apart.">
                <span style={MIXED_CHIP}>mixed formats</span>
              </Tooltip>
            )}
            {group.mixedCertificate && (
              <Tooltip content="These copies do not all carry the same certificate. Turn on Split by certificate to group them apart.">
                <span style={MIXED_CHIP}>mixed certificates</span>
              </Tooltip>
            )}
            {group.listedCount > 0 && (
              <Tooltip content="Copies of this group already sitting on a listing that has not closed — on any platform.">
                <span style={{ ...CHIP, color: "var(--color-text-muted)" }}>
                  {group.listedCount} of {group.count} already listed
                </span>
              </Tooltip>
            )}
          </div>
        </>
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
          differingIds={outliers}
        />
      )}
    </CopyGroupShell>
  );
}

/**
 * The filters addressing one group's members: the panel's own filters plus the group's key. Only
 * the axes that joined the key are pinned — one left at *any* must keep the panel's own value, or
 * the members shown would not be the members counted. The eligibility the grouping applies
 * (for sale, delivered, unsold) is repeated here for the same reason.
 */
export function groupMemberFilters(
  group: CopyGroupRow,
  axes: CopyGroupAxes,
  baseFilters: InventoryItemFilters
): InventoryItemFilters {
  return {
    ...baseFilters,
    stampId: group.stampId,
    // The one condition the group was keyed on, through the same list the panel's multi-select uses
    // (#425) — it replaces the panel's own selection rather than intersecting with it, since the
    // group's members are by definition all in this condition.
    conditionIds: [group.conditionId],
    // `"single"` / `"none"` are the sentinels for a null value — an absent filter means "any",
    // which is the opposite of what a key carrying null says. Like the condition, the format the
    // group was keyed on goes through the panel's own multi-select field as a single-entry list
    // (#427) and replaces its selection.
    ...(axes.format ? { formatIds: [group.formatId ?? "single"] } : {}),
    ...(axes.certificate
      ? { certificateStatusIds: [group.certificateStatusId ?? "none"] }
      : {}),
    forSale: true,
    deliveryStates: ["delivered"],
    includeSold: undefined,
  };
}
