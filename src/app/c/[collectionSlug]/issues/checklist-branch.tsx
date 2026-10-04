"use client";

import { useState } from "react";
import type { IssueChecklistTotals, IssueListItem } from "@/lib/issues";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import type { TagColorTokens } from "@/lib/tag-colors";
import type { ChecklistHeadline } from "@/app/actions/checklists";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { CELL_GLYPH, cellBleedStyle } from "@/app/c/[collectionSlug]/shared/cell-target";
import {
  SET_COMPLETENESS_CHIP,
  SET_COMPLETENESS_CHIP_COMPLETE,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useChecklistPriceActions } from "@/app/c/[collectionSlug]/shared/use-price-details-action";
import { useChecklistEditActions } from "@/app/c/[collectionSlug]/shared/use-checklists-action";
import { useApplySizePresetAction } from "@/app/c/[collectionSlug]/shared/apply-size-preset-dialog";
import { useVariantPriceGrid } from "@/app/c/[collectionSlug]/shared/use-variant-price-grid";
import { useCatalogNumberGrid } from "@/app/c/[collectionSlug]/shared/use-catalog-number-grid";
import { useInvalidateStampsAndIssues } from "@/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues";
import { useOffersPopupAction } from "@/app/c/[collectionSlug]/offers/use-offers-popup-action";
import {
  useInventoryPopupAction,
  useInventoryAddAction,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-copy-actions";
import { useAddIssueWantsAction } from "@/app/c/[collectionSlug]/wants/use-add-issue-wants-action";
import { useInvalidateIssues } from "./use-issues-query";

// One checklist of an expanded issue as a branch of the Issues list's tree (#1520): a heading that
// names it in its colour (#1519) with its stamp count and how complete it is, and under it — once
// opened — the stamps it lists. The stamps on none of the issue's checklists get a branch of the
// same shape, without the actions: there is no checklist for them to act on.
//
// The stamp picker draws an issue's checklists with the same branch (#1585). What sits at the end of
// the heading is the caller's: the list's `⋮` (`ChecklistBranchMenu`), or the picker's own checklist
// presses — the picker is for choosing, so the list's menu is not brought over.

const HEADING: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.45rem 1rem 0.45rem 0.5rem",
  fontSize: "0.8125rem",
  borderBottom: "1px solid var(--color-border)",
};

const COUNT_TEXT: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const OFF_CHECKLIST_TOKENS: TagColorTokens = {
  color: "var(--color-text-muted)",
  border: "var(--color-border)",
  background: "var(--color-bg-page)",
};

export interface ChecklistBranchContext {
  issue: IssueListItem;
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  vendorMap: Map<string, AreaCatalogEntry>;
  primaryVendorId: string | null;
  /** The issue row's own add-stamp and add-range callbacks, here with this checklist to join. */
  onAddStamp: (checklistId: string) => void;
  onAddStampRange: (checklistId: string) => void;
}

export function ChecklistBranch({
  checklist,
  stampCount,
  tokens,
  headline,
  open,
  onToggle,
  actions,
  children,
}: {
  /** The checklist, or null for the branch of stamps on none. */
  checklist: IssueChecklistTotals | null;
  /** Its stamp count as the issue's checklists state it — or, for the stamps on none, theirs. */
  stampCount: number;
  tokens: TagColorTokens | undefined;
  /** How complete it is, once read; absent for the stamps on none, which are no set. */
  headline: ChecklistHeadline | undefined;
  open: boolean;
  onToggle: () => void;
  /** What the heading ends on — the list's `⋮`, or the picker's checklist presses. */
  actions?: React.ReactNode;
  /** The branch's stamps, drawn only while it is open. */
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const tint = tokens ?? OFF_CHECKLIST_TOKENS;
  const name = checklist?.name ?? "Not on a checklist";
  const complete = !!headline && stampCount > 0 && headline.owned === stampCount;

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          ...HEADING,
          // The checklist's colour as the band the branch's heading sits on — what its stamp rows'
          // chips and the flat mode's filter chip wear, so the three read as one checklist.
          background: hovered ? "var(--color-bg-row-hover)" : tint.background,
          boxShadow: `inset 3px 0 0 ${tint.color}`,
          transition: "background 0.1s ease",
        }}
      >
        {/* The caret and the name are one toggle, run to the heading's full height and left edge
            (#1589); hovering it anywhere lights the caret. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
          className="cell-target"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flex: 1,
            minWidth: 0,
            alignSelf: "stretch",
            background: "none",
            border: "none",
            padding: 0,
            ...cellBleedStyle({ top: "0.45rem", bottom: "0.45rem", left: "0.5rem" }),
            cursor: "pointer",
            textAlign: "left",
            color: "inherit",
            fontSize: "inherit",
          }}
        >
          <span className="cell-target-glyph" style={{ ...CELL_GLYPH, color: "var(--color-text-muted)" }}>
            <Icon name={open ? "collapse" : "expand"} size="sm" />
          </span>
          <span
            style={{
              fontWeight: 600,
              color: checklist ? tint.color : "var(--color-text-secondary)",
              fontStyle: checklist ? undefined : "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {name}
          </span>
          <span style={COUNT_TEXT}>
            {stampCount} stamp{stampCount !== 1 ? "s" : ""}
          </span>
        </button>

        {/* The issue page's own completeness figure for this checklist (#1278): the any × any cell. */}
        {checklist && headline && stampCount > 0 && (
          <Tooltip
            content={`${headline.owned} of ${stampCount} stamps held, in any disposition and condition · ${
              headline.completeSets
            } complete ${headline.completeSets === 1 ? "set" : "sets"}.`}
          >
            <span style={complete ? SET_COMPLETENESS_CHIP_COMPLETE : SET_COMPLETENESS_CHIP}>
              {complete && <Icon name="check" size="sm" style={{ marginRight: "0.2rem" }} />}
              {headline.owned}/{stampCount}
              {headline.completeSets > 0 && ` ×${headline.completeSets}`}
            </span>
          </Tooltip>
        )}

        {actions}
      </div>
      {open && children}
    </>
  );
}

/**
 * The branch's `⋮` (#1520): the issue row's actions that make sense for one checklist, each reaching
 * only this checklist's stamps, then the checklist's own. Not offered, as they belong to the issue
 * as a whole: moving or merging it, recomputing its declared range, its format multipliers, its own
 * edit and delete, and opening its page.
 */
export function ChecklistBranchMenu({
  checklist,
  context,
}: {
  checklist: IssueChecklistTotals;
  context: ChecklistBranchContext;
}) {
  const { issue, collectionId, areas, baseCurrency, vendorMap, primaryVendorId } = context;
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();
  const { invalidateMembers } = useInvalidateIssues();
  const issueLabel = issue.name ?? (issue.year ? String(issue.year) : "(unnamed issue)");
  const label = `${issueLabel} — ${checklist.name}`;
  const refresh = async () => {
    await invalidateStampsAndIssues(collectionId);
    await invalidateMembers(collectionId, issue.id);
  };

  const addCopy = useInventoryAddAction({
    collectionId,
    areas,
    target: {
      kind: "issue",
      issue: {
        id: issue.id,
        name: issue.name,
        year: issue.year,
        collectionAreaId: issue.collectionAreaId,
        checklist: { id: checklist.id, name: checklist.name },
      },
    },
  });
  const wants = useAddIssueWantsAction({
    collectionId,
    issueId: issue.id,
    checklistCount: 1,
    checklistId: checklist.id,
  });
  const copies = useInventoryPopupAction({
    collectionId,
    areas,
    baseCurrency,
    target: { kind: "checklist", checklistId: checklist.id, label },
  });
  const offers = useOffersPopupAction({
    collectionId,
    target: { kind: "checklist", checklistId: checklist.id, label },
  });
  const prices = useChecklistPriceActions({ collectionId, checklists: [checklist] });
  const variantPrices = useVariantPriceGrid({
    defaultScope: { kind: "issue", issueId: issue.id, checklistId: checklist.id },
    onSaved: refresh,
  });
  const catalogNumbers = useCatalogNumberGrid({
    issueId: issue.id,
    checklistId: checklist.id,
    onSaved: refresh,
  });
  const sizePreset = useApplySizePresetAction({
    collectionId,
    subject: { kind: "checklist", checklistId: checklist.id },
    subjectLabel: checklist.name,
  });
  const own = useChecklistEditActions(
    { collectionId, issueId: issue.id, issueLabel, vendorMap, primaryVendorId },
    checklist.id
  );

  const actions: RowAction[] = [
    {
      key: "add-stamp",
      label: "Add stamp",
      icon: "add",
      onSelect: () => context.onAddStamp(checklist.id),
    },
    {
      key: "add-stamp-range",
      label: "Add stamp range…",
      icon: "more",
      onSelect: () => context.onAddStampRange(checklist.id),
    },
    addCopy.action,
    wants.action,
    copies.action,
    offers.action,
    ...prices.actions,
    variantPrices.action,
    catalogNumbers.action,
    sizePreset.action,
    // The checklist's own, after a rule: everything above acts *through* the checklist on its
    // stamps, these act on the checklist itself.
    { ...own.actions[0], separatorBefore: true },
    ...own.actions.slice(1),
  ];

  return (
    <>
      <RowActionsMenu actions={actions} ariaLabel={`Actions for ${checklist.name}`} />
      {addCopy.dialog}
      {wants.dialog}
      {copies.dialog}
      {offers.dialog}
      {prices.dialog}
      {variantPrices.dialog}
      {catalogNumbers.dialog}
      {sizePreset.dialog}
      {own.dialog}
    </>
  );
}
