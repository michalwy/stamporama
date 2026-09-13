"use client";

import { useMemo, useState } from "react";
import { moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
import { matchedStampsInIssue, type StampFilterQuery } from "@/lib/issue-stamp-match";
import { useIssueMembers, useInvalidateIssues } from "./use-issues-query";
import { useInvalidateStampsAndIssues } from "@/app/c/[collectionSlug]/shared/use-invalidate-stamps-and-issues";
import { RecomputeRangeDialog } from "./recompute-range-dialog";
import type { IssueListItem, StampNodeData } from "@/lib/issues";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import {
  PRICE_MAIN,
  PRICE_CONVERTED,
  PRICE_STALE_ICON,
  CREATE_LINK_STYLE,
} from "@/app/c/[collectionSlug]/shared/chip-styles";
import {
  buildStampTree,
  IssueTitle,
  IssueCatalogChips,
  ChecklistsBadge,
  ChecklistTreeFilter,
  filterStampTreeBy,
  StampTitle,
  StampDetailLine,
  type StampTreeNodeData,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import { StampAttributesLine } from "@/app/c/[collectionSlug]/shared/stamp-attributes-line";
import {
  ReorderModeButton,
  StampDragGrip,
  StampTreeGroup,
  useStampTreeReorder,
  type StampNodeDragProps,
  type StampTreeReorder,
} from "@/app/c/[collectionSlug]/shared/stamp-tree-reorder";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { TagChips } from "@/app/c/[collectionSlug]/shared/tag-chip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import {
  RowQuickActions,
  pickRowActions,
} from "@/app/c/[collectionSlug]/shared/row-quick-actions";
import {
  usePriceDetailsAction,
  useChecklistPriceActions,
} from "@/app/c/[collectionSlug]/shared/use-price-details-action";
import { useChecklistsAction } from "@/app/c/[collectionSlug]/shared/use-checklists-action";
import { useApplySizePresetAction } from "@/app/c/[collectionSlug]/shared/apply-size-preset-dialog";
import { useDetailPageAction } from "@/app/c/[collectionSlug]/shared/use-detail-page-action";
import type { AddVariantRangeParent } from "@/app/c/[collectionSlug]/shared/add-variant-range-dialog";
import { useOffersPopupAction } from "@/app/c/[collectionSlug]/offers/use-offers-popup-action";
import { useFormatFactorsAction } from "@/app/c/[collectionSlug]/shared/use-format-factors-action";
import { useVariantPriceGrid } from "@/app/c/[collectionSlug]/shared/use-variant-price-grid";
import { useQuickPriceDialog } from "@/app/c/[collectionSlug]/shared/use-quick-price-dialog";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import type { StampFormatData } from "@/lib/stamp-formats";
import {
  useInventoryPopupAction,
  useInventoryAddAction,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-copy-actions";
import {
  orderedCatalogLabels,
  type PickedStamp,
} from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { useAddWantAction } from "@/app/c/[collectionSlug]/wants/use-add-want-action";
import { useAddIssueWantsAction } from "@/app/c/[collectionSlug]/wants/use-add-issue-wants-action";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";
import {
  useReportRowsInView,
  type RowsInView,
} from "@/app/c/[collectionSlug]/inventory/use-rows-in-view";
import { descendantsAmongMembers, stampIdsInTree } from "@/lib/stamp-tree-selection";
import { Icon } from "@/app/icons";

// ── Stamp tree ──────────────────────────────────────────────────────────────

/** "This stamp just gained a child — show it" (#359). The `nonce` makes a *repeat* add under the
 *  same parent a new signal, so a node the collector collapsed in between opens again. */
export interface ExpandStampSignal {
  stampId: string;
  nonce: number;
}

/** The condition the list's price column is showing, so a quick-add prices what's on screen. */
export interface DisplayConditionRef {
  id: string;
  abbreviation: string;
}

/** The format the list's price column is showing (#343), or null for the single — what a
 * quick-added catalog value is recorded against. */
export interface DisplayFormatRef {
  id: string;
  abbreviation: string;
}

interface StampTreeNodeProps {
  treeNode: StampTreeNodeData;
  depth: number;
  /** Stamps the checklist filter kept only as context for a matching descendant (#531) — drawn
   *  dimmed, because they are the numbering the match hangs under and not part of the set. */
  contextIds: Set<string>;
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  isLast: boolean;
  /** Issue context shown in the quick-add catalog value dialog (#341). */
  issueName: string | null;
  issueYear: number | null;
  areaName: string | null;
  /** Condition a quick-added catalog value is recorded at — the one the list displays (#341). */
  displayCondition: DisplayConditionRef | null;
  /** Format a quick-added catalog value is recorded at — the one the list displays, null for the
   *  single (#343). */
  displayFormat: DisplayFormatRef | null;
  onPriceSaved: () => void | Promise<unknown>;
  /** See {@link IssueRowProps.expandStamp} — matched against this node's own id (#359). */
  expandStamp?: ExpandStampSignal | null;
  onEdit: (stampId: string) => void;
  onAddChild: (parentStampId: string) => void;
  /** Add a whole lettered run of variants under this stamp at once (#722). */
  onAddVariantRange: (parentStampId: string) => void;
  onDelete: (stampId: string, stampName: string) => void;
  onMove: (stampId: string) => void;
  /** Refile this stamp under a different stamp of the same issue, or at its top level (#656). */
  onReparent: (stampId: string) => void;
  /** True when the active list filter narrowed this tree (#631) — everything left is a match or
   *  the numbering one hangs under, so a node with children starts open rather than collapsed. */
  narrowed: boolean;
  /** Reorder mode (#549), passed down so this node's own children become a drag list too. */
  reorder: StampTreeReorder | null;
  /** This row's place in its sibling group's drag list, or null when it cannot move. */
  drag: StampNodeDragProps | null;
  /** The list's stamp selection (#808), or null where the tree carries none. */
  selection: StampTreeSelection | null;
  /** True when a stamp above this one in the tree is ticked, so this one is carried with it. */
  ancestorSelected: boolean;
  onToggleTick: (stampId: string) => void;
}

function StampTreeNode({
  treeNode,
  depth,
  contextIds,
  collectionId,
  areas,
  baseCurrency,
  primaryVendorId,
  vendorMap,
  isLast,
  issueName,
  issueYear,
  areaName,
  displayCondition,
  displayFormat,
  expandStamp,
  onPriceSaved,
  onEdit,
  onAddChild,
  onAddVariantRange,
  onDelete,
  onMove,
  onReparent,
  narrowed,
  reorder,
  drag,
  selection,
  ancestorSelected,
  onToggleTick,
}: StampTreeNodeProps) {
  const [hovered, setHovered] = useState(false);
  const { node, children } = treeNode;
  const hasChildren = children.length > 0;
  const reordering = !!reorder;
  const indent = `${depth * 1.25}rem`;
  const isContextOnly = contextIds.has(node.stampId);
  // A tick carries the whole subtree (#808, ADR-0048 §7). *Carried* is read two ways that agree: the
  // tree itself for an ancestor drawn above this row, and the server's walk for one in another issue
  // — a variant whose base belongs elsewhere is drawn as a root here, with its parent off this tree.
  const ticked = selection?.ticked.has(node.stampId) ?? false;
  const carried = ancestorSelected || (selection?.carried.has(node.stampId) ?? false);
  const selected = ticked || carried;

  // Expansion is *derived*, never a setState-in-effect: a node is open when it just gained a
  // sub-stamp (#359), when a filter narrowed the tree around it (#631), or when the collector
  // opened it themselves. The user's own toggle is remembered against the signal it was made
  // under, so a manual collapse sticks — until the next add under this same node, whose fresh
  // nonce supersedes it.
  const autoExpandNonce = expandStamp?.stampId === node.stampId ? expandStamp.nonce : null;
  const [userToggle, setUserToggle] = useState<{
    forNonce: number | null;
    collapsed: boolean;
  } | null>(null);
  const collapsed =
    userToggle && userToggle.forNonce === autoExpandNonce
      ? userToggle.collapsed
      : autoExpandNonce === null && !narrowed;
  const setCollapsed = (next: boolean) =>
    setUserToggle({ forNonce: autoExpandNonce, collapsed: next });

  const popupLabel =
    node.name ??
    node.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId)?.number ??
    node.catalogNumbers[0]?.number ??
    "(stamp)";

  /** This node's stamp, shaped for a picker summary. Built once and handed to every dialog opened
   *  from the row, so the add-copy form and the want form cannot summarise one stamp two ways. */
  const pickedStamp: PickedStamp = {
    stampId: node.stampId,
    catalogLabels: orderedCatalogLabels(node.catalogNumbers, vendorMap, primaryVendorId),
    name: node.name,
    secondary: null,
    // Umbrella only when a child acts as a variant (ADR-0010 §3), not for a base stamp whose
    // children are all distinct entries.
    unknownVariant: children.some((c) => c.node.actsAsVariant),
  };

  const addCopy = useInventoryAddAction({
    collectionId,
    areas,
    target: { kind: "stamp", stampId: node.stampId, initial: pickedStamp },
  });
  const addWant = useAddWantAction({ collectionId, areas, stamp: pickedStamp });
  const copies = useInventoryPopupAction({
    collectionId,
    areas,
    baseCurrency,
    target: { kind: "stamp", stampId: node.stampId, label: popupLabel },
  });
  // Every offer holding a copy of this stamp (#349) — per stamp exactly, never rolled up from the
  // variant children below it, which carry their own entry.
  const offers = useOffersPopupAction({
    collectionId,
    target: { kind: "stamp", stampId: node.stampId, label: popupLabel },
  });
  const prices = usePriceDetailsAction({ kind: "stamp", stampId: node.stampId });
  // Quick-add a catalog value for exactly the condition the list is showing (#341): a
  // "+ catalog value" link in the price slot, as on the Copies list (#228), shown only while
  // this stamp has no price at that condition. The certificate axis is "none", matching the
  // headline price the row renders.
  const quickPrice = useQuickPriceDialog({
    collectionId,
    subject: displayCondition
      ? {
          stampId: node.stampId,
          stampName: node.name,
          issueName,
          issueYear,
          conditionId: displayCondition.id,
          conditionAbbreviation: displayCondition.abbreviation,
          certificateStatusId: null,
          certificateStatusName: null,
          // Record against the format the column is showing (#343), never silently against the
          // single — otherwise typing a value while a block column is up would write the wrong row.
          formatId: displayFormat?.id ?? null,
          formatAbbreviation: displayFormat?.abbreviation ?? null,
          catalogNumbers: node.catalogNumbers,
          photos: node.photos,
        }
      : null,
    areaName,
    primaryVendorId,
    vendorMap,
    onSaved: onPriceSaved,
  });

  const detailPage = useDetailPageAction("stamp", node.stampId);

  const actions: RowAction[] = [
    detailPage,
    { key: "add-child", label: "Add child stamp", icon: "add", onSelect: () => onAddChild(node.stampId) },
    // Right below its one-at-a-time sibling: the same addition, for the case where the catalogue
    // splits this stamp into a lettered run (#722).
    {
      key: "add-variant-range",
      label: "Add variant range…",
      icon: "range",
      onSelect: () => onAddVariantRange(node.stampId),
    },
    { key: "move", label: "Move to another issue…", icon: "move", onSelect: () => onMove(node.stampId) },
    // Beside the move, because the two are the same correction at two scales (#656): one says this
    // stamp belongs to another issue, the other that it belongs *under another stamp* of this one.
    {
      key: "reparent",
      label: "Reassign to another parent…",
      icon: "variant",
      onSelect: () => onReparent(node.stampId),
    },
    addCopy.action,
    addWant.action,
    copies.action,
    offers.action,
    ...(node.mainCatalogPrice ? [prices.action] : []),
    { key: "edit", label: "Edit", icon: "edit", onSelect: () => onEdit(node.stampId) },
    {
      key: "delete",
      label: "Delete",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete(node.stampId, node.name ?? "(unnamed)"),
    },
  ];

  return (
    <>
      <div
        {...(drag?.item ?? {})}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: `0.4rem 1rem 0.55rem calc(0.5rem + ${indent})`,
          fontSize: "0.8125rem",
          // A selected stamp leads, as a ticked copy does on the Copies list: it is what the bar is
          // about to act on — and a carried one is shaded too, because it will be acted on as well.
          background: hovered
            ? "var(--color-bg-row-hover)"
            : selected && selection
              ? "var(--color-accent-soft)"
              : undefined,
          transition: "background 0.1s ease",
          borderBottom: isLast ? undefined : "1px solid var(--color-border)",
          // Context, not a member of the filtered set — legible enough to read the number off,
          // faint enough that it never reads as part of what was asked for.
          opacity: isContextOnly ? 0.5 : undefined,
          ...(drag?.style ?? {}),
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
          {/* The grip leads the row while reordering — ahead of the caret, since the whole
              subtree travels with the row it is on. */}
          {reordering && <StampDragGrip drag={drag} />}
          {/* Expand/collapse toggle sits first, before the photo. */}
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand" : "Collapse"}
              style={{
                alignSelf: "center",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-muted)",
                fontSize: "0.625rem",
                padding: "0.125rem",
                flexShrink: 0,
                lineHeight: 1,
                width: "0.875rem",
                textAlign: "center",
              }}
            >
              <Icon name={collapsed ? "expand" : "collapse"} size="sm" />
            </button>
          ) : (
            <span style={{ width: "0.875rem", flexShrink: 0 }} />
          )}

          {/* The selection box (#808), after the caret so it indents with the node: a child's box
              sits under its parent's, which is the shape a tick carries. A carried stamp is drawn
              ticked and locked, and says why on hover — the rule shown where it acts. Put away while
              reordering, where the grip is what the row is for; the ticks stay. */}
          {selection && !reordering && (
            <Tooltip
              content={
                carried
                  ? "Selected with the ticked stamp above it — a ticked stamp brings all its variants and child stamps with it."
                  : ""
              }
              style={{ alignSelf: "center", flexShrink: 0 }}
            >
              <input
                type="checkbox"
                checked={selected}
                disabled={carried}
                onChange={() => onToggleTick(node.stampId)}
                aria-label={carried ? "Selected with the stamp above it" : "Select this stamp"}
                style={{ margin: 0, cursor: carried ? "default" : "pointer" }}
              />
            </Tooltip>
          )}

          {/* Catalog-level photo of this stamp (#137) as a left column, so the row reads as
              [arrow][photo][text] like the inventory list. Reserved even when empty for alignment. */}
          <PhotoThumb collectionId={collectionId} photos={node.photos} reserveWhenEmpty />

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <StampTitle node={node} />
              </span>

              {/* Edit · add the lettered run the catalogue splits this stamp into · add a copy
                  of it · put it on the want list — what a collector repeats while working through
                  an issue, on hover beside the menu. The *range* rather than its one-at-a-time
                  sibling (#1150): a catalogue that splits a stamp into a run splits it into
                  several at once, so `Add child stamp` is the exception and keeps to the menu.
                  Wanting sits beside adding a copy because the two are the same reflex pointed
                  opposite ways: this one I have, that one I am after. */}
              <RowQuickActions
                actions={pickRowActions(actions, [
                  "detail-page",
                  "edit",
                  "add-variant-range",
                  "add-copy",
                  "add-want",
                ])}
                // Nothing pops out from under the pointer while the row is being dragged — the
                // grip is what the hover means in this mode.
                visible={hovered && !reordering}
              />
              <RowActionsMenu actions={actions} ariaLabel="Stamp actions" />
              {addCopy.dialog}
              {addWant.dialog}
              {copies.dialog}
              {offers.dialog}
              {prices.dialog}
              {quickPrice.dialog}
            </div>

            <StampDetailLine
              node={node}
              vendorMap={vendorMap}
              primaryVendorId={primaryVendorId}
              onSetPrice={quickPrice.open ?? undefined}
              // The copy count chip opens the very dialog the `⋮` entry above does (#721) — the
              // chip is already pointing at those copies, so it should be the way to them.
              onOpenCopies={copies.open}
            />

            {/* The stamp's attributes (#737) on a line of their own under the chips, rather than as
                four more columns the tree row has no width for: within one issue they are exactly
                what distinguishes one variant from the next. */}
            <StampAttributesLine attributes={node.attributes} />
          </div>
        </div>
      </div>
      {!collapsed && (
        <StampTreeGroup
          nodes={children}
          parentStampId={node.stampId}
          reorder={reorder}
          indent={(depth + 1) * 20}
          renderNode={({ node: child, isLast: lastChild, drag: childDrag }) => (
            <StampTreeNode
              treeNode={child}
              depth={depth + 1}
              contextIds={contextIds}
              collectionId={collectionId}
              areas={areas}
              baseCurrency={baseCurrency}
              primaryVendorId={primaryVendorId}
              vendorMap={vendorMap}
              isLast={isLast && lastChild}
              issueName={issueName}
              issueYear={issueYear}
              areaName={areaName}
              displayCondition={displayCondition}
              displayFormat={displayFormat}
              expandStamp={expandStamp}
              onPriceSaved={onPriceSaved}
              onEdit={onEdit}
              onAddChild={onAddChild}
              onAddVariantRange={onAddVariantRange}
              onDelete={onDelete}
              onMove={onMove}
              onReparent={onReparent}
              narrowed={narrowed}
              reorder={reorder}
              drag={childDrag}
              selection={selection}
              ancestorSelected={selected}
              onToggleTick={onToggleTick}
            />
          )}
        />
      )}
    </>
  );
}

/**
 * The Issues list's stamp selection (#808), handed to every row. The panel owns it — a selection
 * spans issues — and a row only draws it and reports which stamps it is showing.
 */
export interface StampTreeSelection {
  /** Every ticked stamp, filter or no filter. */
  ticked: ReadonlySet<string>;
  /** Stamps below an in-view tick, from the server's walk — drawn ticked and locked. */
  carried: ReadonlySet<string>;
  /** Tick or untick one stamp; `absorbed` is what a tick on a parent takes over (its descendants
   *  in this issue), so the branch clears with the click that visibly clears it. */
  onToggle: (stampId: string, absorbed: string[]) => void;
  /** Where a row reports the stamps its tree is drawing, for the bar's *in view* count. */
  registerInView: RowsInView["register"];
}

const NO_REGISTER: RowsInView["register"] = () => {};

// ── IssueRow ────────────────────────────────────────────────────────────────

/** The node a new stamp is being hung under, when adding from a tree row: what the add dialog
 *  seeds itself from — the parent's catalog numbers and its own year (#360) — carried together
 *  so the panel needs no second lookup. */
export interface AddStampParent {
  stampId: string;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  issuedYear: number | null;
}

export interface IssueRowCallbacks {
  onEdit: (issue: IssueListItem) => void;
  onDelete: (issue: IssueListItem) => void;
  onMoveIssueArea: (issue: IssueListItem) => void;
  onAddStampRange: (issue: IssueListItem) => void;
  onMergeIssue: (issue: IssueListItem) => void;
  onAddStamp: (issueId: string, parent?: AddStampParent) => void;
  /** A whole run of variants under one stamp (#722). Takes the issue rather than its id, because
   *  the dialog needs the area and prefix context the row already resolved. */
  onAddVariantRange: (issue: IssueListItem, parent: AddVariantRangeParent) => void;
  onEditStamp: (issueId: string, stamp: StampNodeData) => void;
  onDeleteStamp: (issueId: string, stampId: string, stampName: string) => void;
  onMoveStamp: (issueId: string, stampId: string) => void;
  onReparentStamp: (issueId: string, stampId: string) => void;
}

interface IssueRowProps {
  issue: IssueListItem;
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  isLast: boolean;
  showAreaChip?: boolean;
  areaName?: string;
  onFilterByArea?: (areaId: string) => void;
  callbacks: IssueRowCallbacks;
  defaultExpanded?: boolean;
  /** The parent a sub-stamp was just added under (#359) — the tree opens that node so the new
   *  child is visible. Collapse state is per-node, so this is the tree's only way in. */
  expandStamp?: ExpandStampSignal | null;
  /** Condition whose price fills each member's headline price, matching the list's
   *  price column so the expanded rows track the condition switcher (#238). */
  displayConditionId?: string | null;
  /** Format whose price fills each member's headline price, tracking the format switcher the same
   *  way (#343). Null is the single. */
  displayFormatId?: string | null;
  /** The collection's formats, for naming {@link displayFormatId} on the quick-price badge. */
  formats?: StampFormatData[];
  /** The half of the list's filter set a *stamp inside this issue* can satisfy (#631) — the quick
   *  search and the catalog number. Where the row's own header does not account for it, the tree
   *  is narrowed to the stamps that do; area and year are the issue's own and are not here. */
  stampFilter?: StampFilterQuery;
  /** The list's stamp selection (#808); absent draws no boxes. */
  selection?: StampTreeSelection;
}

export function IssueRow({
  issue,
  collectionId,
  areas,
  baseCurrency,
  primaryVendorId,
  vendorMap,
  isLast,
  showAreaChip,
  areaName,
  onFilterByArea,
  callbacks,
  defaultExpanded,
  expandStamp,
  displayConditionId,
  displayFormatId,
  formats,
  stampFilter,
  selection,
}: IssueRowProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? false);
  const [hovered, setHovered] = useState(false);

  const { data: members, isLoading: membersLoading } = useIssueMembers(
    collectionId,
    issue.id,
    isExpanded,
    displayConditionId,
    displayFormatId
  );

  // The condition the price column is filled from — the switcher's choice, or (when the list
  // left it to the server) the first condition, which is the server's own fallback. A quick-add
  // records its value there, so what's entered is what the row then shows (#341).
  const { data: conditions } = useCollectionConditions(collectionId);
  const displayCondition = useMemo(() => {
    const list = conditions ?? [];
    const chosen = displayConditionId
      ? list.find((c) => c.id === displayConditionId)
      : list[0];
    return chosen ? { id: chosen.id, abbreviation: chosen.abbreviation } : null;
  }, [conditions, displayConditionId]);

  // The format the price column is filled from. Null — the single — is the default and needs no
  // lookup; a chosen one is named so the quick-price badge can spell out what it will write (#343).
  const displayFormat = useMemo<DisplayFormatRef | null>(() => {
    const chosen = displayFormatId ? formats?.find((f) => f.id === displayFormatId) : undefined;
    return chosen ? { id: chosen.id, abbreviation: chosen.abbreviation } : null;
  }, [formats, displayFormatId]);

  // Which checklists the expanded tree is narrowed to (#531). Local rather than URL state: the
  // list shows many issues at once, so there is no single parameter this could be, and the detail
  // page keeps its own copy for the same rule.
  const [treeChecklistIds, setTreeChecklistIds] = useState<string[]>([]);
  const { invalidateMembers } = useInvalidateIssues();
  const { invalidateStampsAndIssues } = useInvalidateStampsAndIssues();

  // Manual ordering (#549). The hook owns the optimistic order, so the tree below is built from
  // *its* members rather than the query's — a drag has to show before the round trip.
  const loadedMembers = useMemo(() => members ?? [], [members]);
  const treeReorder = useStampTreeReorder({
    collectionId,
    issueId: issue.id,
    members: loadedMembers,
    onSaved: () => invalidateMembers(collectionId, issue.id),
  });
  // Which stamps the list's own filter picked out (#631). Null — the ordinary case — when nothing
  // narrows on a stamp, when the row's header already explains the hit, or when no stamp matched
  // after all; the tree is then drawn whole.
  const matchedStampIds = useMemo(
    () => (stampFilter ? matchedStampsInIssue(issue, loadedMembers, stampFilter, vendorMap) : null),
    [issue, loadedMembers, stampFilter, vendorMap]
  );
  // Both narrowings are dropped while reordering: dragging inside a narrowed tree would move a
  // stamp past a sibling that was never on screen, and the server refuses a partial group.
  const effectiveChecklistIds = treeReorder.active ? [] : treeChecklistIds;
  const effectiveMatchedIds = treeReorder.active ? null : matchedStampIds;
  const { tree: stampTree, contextIds: treeContextIds } = filterStampTreeBy(
    buildStampTree(treeReorder.members),
    effectiveChecklistIds,
    effectiveMatchedIds
  );

  // The stamps this row is drawing, reported for the bar's *in view* count (#808). The narrowed tree
  // and not the members: a stamp the checklist chips or the list's search hid is ticked and out of
  // view, exactly as a copy under a chip is. A collapsed issue or node still reports what it holds —
  // a fold is not a filter (`ui-patterns.md`) — and an issue never expanded holds nothing yet.
  useReportRowsInView(selection?.registerInView ?? NO_REGISTER, stampIdsInTree(stampTree));
  const toggleTick = (stampId: string) =>
    selection?.onToggle(stampId, descendantsAmongMembers(loadedMembers, stampId));

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
      },
    },
  });
  const copies = useInventoryPopupAction({
    collectionId,
    areas,
    baseCurrency,
    target: {
      kind: "issue",
      issueId: issue.id,
      label: issue.name ?? "(unnamed issue)",
    },
  });
  // Every offer holding a copy of any stamp in this issue (#349) — the issue-level counterpart of
  // the copies popup beside it.
  const offers = useOffersPopupAction({
    collectionId,
    target: {
      kind: "issue",
      issueId: issue.id,
      label: issue.name ?? "(unnamed issue)",
    },
  });
  // One entry per checklist that has a total (#531): an issue may hold several goals, and there is
  // no single "the prices for this issue" to open when it does.
  const prices = useChecklistPriceActions({ collectionId, checklists: issue.checklists });
  // Going after a whole set in one step (#548) — the bulk counterpart of the per-stamp "Add to
  // want list" the tree under this row carries.
  const issueWants = useAddIssueWantsAction({
    collectionId,
    issueId: issue.id,
    checklistCount: issue.checklists.length,
  });
  // The issue's checklists are edited here for the same reason its format multipliers are: the row
  // already answers which issue, and a flat collection-wide list would not (ADR-0020 §7).
  const checklists = useChecklistsAction({
    collectionId,
    issueId: issue.id,
    issueLabel: issue.name ?? (issue.year ? String(issue.year) : "(unnamed issue)"),
    // The composition checklist draws the same catalog chips the tree under this row does (#547),
    // so it takes the row's own maps — already resolved through this issue's prefixes (#377).
    vendorMap,
    primaryVendorId,
  });
  // A size preset onto the whole issue (#806; ADR-0048 §4) — the Germania case for a series already
  // entered. The tree under this row draws no sizes, so nothing here needs refreshing after it.
  const sizePreset = useApplySizePresetAction({
    collectionId,
    subject: { kind: "issue", issueId: issue.id },
    subjectLabel: issue.name ?? (issue.year ? String(issue.year) : "(unnamed issue)"),
  });
  // An issue's format multipliers are edited here rather than in Settings: the issue is the
  // narrowest anchor a factor can take, and it is the one a catalog actually prints them against.
  const formatFactors = useFormatFactorsAction({
    collectionId,
    scope: { kind: "issue", id: issue.id },
    scopeLabel: issue.name ?? (issue.year ? String(issue.year) : "(unnamed issue)"),
  });

  // The whole issue's stamp tree priced in one pass (#618), opened from the row for the same reason
  // the multipliers above are: the printed catalogue's page *is* an issue, and the row already
  // answers which one. Writing prices moves the row's own totals and every member's headline price,
  // so both caches are refreshed once the grid closes.
  const variantPrices = useVariantPriceGrid({
    defaultScope: { kind: "issue", issueId: issue.id },
    onSaved: async () => {
      await invalidateStampsAndIssues(collectionId);
      await invalidateMembers(collectionId, issue.id);
    },
  });

  const rangeSuggestions = issue.rangeSuggestions;
  // Recomputing the declared range (#333) is an explicit, always-available action that confirms
  // before writing — the list row's warning chip is a hint, not the only way in.
  const [recomputeOpen, setRecomputeOpen] = useState(false);

  const detailPage = useDetailPageAction("issue", issue.id);

  const actions: RowAction[] = [
    detailPage,
    { key: "add-stamp", label: "Add stamp", icon: "add", onSelect: () => callbacks.onAddStamp(issue.id) },
    { key: "add-stamp-range", label: "Add stamp range…", icon: "more", onSelect: () => callbacks.onAddStampRange(issue) },
    addCopy.action,
    issueWants.action,
    copies.action,
    offers.action,
    ...prices.actions,
    variantPrices.action,
    checklists.action,
    sizePreset.action,
    formatFactors.action,
    {
      key: "recompute-range",
      label: "Recompute declared range…",
      icon: "range",
      onSelect: () => setRecomputeOpen(true),
    },
    { key: "move-area", label: "Move to another area…", icon: "move", onSelect: () => callbacks.onMoveIssueArea(issue) },
    { key: "merge", label: "Merge into another issue…", icon: "merge", onSelect: () => callbacks.onMergeIssue(issue) },
    { key: "edit", label: "Edit", icon: "edit", onSelect: () => callbacks.onEdit(issue) },
    {
      key: "delete",
      label: "Delete",
      icon: "delete",
      danger: true,
      separatorBefore: true,
      onSelect: () => callbacks.onDelete(issue),
    },
  ];

  return (
    <div
      style={{
        borderBottom: isLast ? undefined : "1px solid var(--color-border)",
      }}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: "0.875rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}
      >
        {/* Expand/collapse toggle sits first, before the photo. */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          style={{
            alignSelf: "center",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            fontSize: "0.75rem",
            padding: "0.25rem",
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          <Icon name={isExpanded ? "collapse" : "expand"} size="sm" />
        </button>

        {/* Issue-level gallery (#137): the main photos of the required-for-completeness stamps,
            shown as a left column so the issue reads as [arrow][photo][text] like inventory. The
            column is reserved even when empty so every issue's text lines up. */}
        <PhotoThumb collectionId={collectionId} photos={issue.photos} plain reserveWhenEmpty />

        <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          {showAreaChip && areaName && (
            <Tooltip content={`Filter by ${areaName}`} style={{ flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => onFilterByArea?.(issue.collectionAreaId)}
                style={{
                  fontSize: "0.75rem",
                  color: "var(--color-text-muted)",
                  background: "var(--color-bg-page)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.25rem",
                  padding: "0.1rem 0.4rem",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {areaName}
              </button>
            </Tooltip>
          )}

          <span
            style={{
              flex: 1,
              fontSize: "0.9375rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <IssueTitle name={issue.name} year={issue.year} />
          </span>

          {/* The issue-level counterparts: edit · add a stamp to it · add a copy · want the whole
              set. The last pairs with adding a copy exactly as it does on a stamp row (#548) —
              this one I have, that one I am after — only over a set rather than a stamp. */}
          <RowQuickActions
            actions={pickRowActions(actions, [
              "detail-page",
              "edit",
              "add-stamp",
              "add-copy",
              "add-issue-wants",
            ])}
            visible={hovered}
          />
          <RowActionsMenu actions={actions} ariaLabel="Issue actions" />
          {addCopy.dialog}
          {issueWants.dialog}
          {copies.dialog}
          {offers.dialog}
          {prices.dialog}
          {variantPrices.dialog}
          {checklists.dialog}
          {sizePreset.dialog}
          {formatFactors.dialog}
          {recomputeOpen && (
            <RecomputeRangeDialog
              collectionId={collectionId}
              issueId={issue.id}
              issueLabel={issue.name ?? "(unnamed issue)"}
              onApplied={async () => {
                setRecomputeOpen(false);
                await invalidateStampsAndIssues(collectionId);
              }}
              onClose={() => setRecomputeOpen(false)}
            />
          )}
        </div>

        {/* Unconditional since #432: the issue number is always there, and it is the row's own
            identifier — an issue with no catalog numbers and no members yet is exactly the one a
            collector is most likely to want to reach by number. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            marginTop: "0.3rem",
            flexWrap: "wrap",
          }}
        >
          <EntityNoChip entity="issue" no={issue.issueNo} prefix="iss" />
          {/* The collector's own labels on the issue (#152), beside its number. They say nothing
              about the stamps inside it — those carry their own. */}
          <TagChips tags={issue.tags} />
          {(issue.catalogNumbers.length > 0 || issue.memberCount > 0) && (
            <>
            <IssueCatalogChips
              catalogNumbers={issue.catalogNumbers}
              vendorMap={vendorMap}
              primaryVendorId={primaryVendorId}
              rangeSuggestions={rangeSuggestions}
            />

            {issue.memberCount > 0 && (
              <ChecklistsBadge
                checklists={issue.checklists}
                requiredCount={issue.requiredCount}
                memberCount={issue.memberCount}
              />
            )}

            {/* One checklist's total reads as the row's own figure, as it did when an issue had
                exactly one set. With several, the totals live in the badge's tooltip instead: a
                row carrying three money chips is no longer a row anybody scans. */}
            {issue.checklists.length === 1 && issue.checklists[0].priceTotal && (() => {
              const t = issue.checklists[0].priceTotal!;
              const incomplete = t.pricedCount < t.requiredCount;
              const unpriced = t.requiredCount - t.pricedCount - t.olderEditionExcludedCount;
              const showWarning = t.usesOlderEdition || incomplete;
              // Both ways a total stops being a plain sum of recorded figures (#238, #343). One
              // marker, one tooltip listing whichever applies.
              const estimated = t.estimatedCount > 0 || t.derivedCount > 0;
              const secondary = moneySecondaryText(t);
              const warningLabel = t.usesOlderEdition ? "Older-edition prices" : "Partial total";
              return (
                <Tooltip
                  content={
                    showWarning ? undefined : `Total of "${issue.checklists[0].name}" (main catalog)`
                  }
                  align="end"
                  style={{ marginLeft: "auto" }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                    }}
                  >
                    {estimated && (
                      <Tooltip
                        align="end"
                        content={
                          <>
                            <div style={{ fontWeight: 600, marginBottom: "0.15rem" }}>
                              Includes an estimate
                            </div>
                            {t.estimatedCount > 0 && (
                              <div style={{ color: "var(--color-text-secondary)" }}>
                                {t.estimatedCount} required stamp{t.estimatedCount !== 1 ? "s" : ""} priced
                                from the lowest variant (no own price).
                              </div>
                            )}
                            {t.derivedCount > 0 && (
                              <div style={{ color: "var(--color-text-secondary)" }}>
                                {t.derivedCount} required stamp{t.derivedCount !== 1 ? "s" : ""} priced
                                from the single by this format&apos;s multiplier.
                              </div>
                            )}
                          </>
                        }
                      >
                        <span
                          aria-label="Includes an estimate"
                          style={{ ...PRICE_MAIN, color: "var(--color-text-muted)", cursor: "help" }}
                        >
                          ~
                        </span>
                      </Tooltip>
                    )}
                    {showWarning && (
                      <Tooltip
                        align="end"
                        content={
                          <>
                            <div style={{ fontWeight: 600, marginBottom: "0.15rem" }}>
                              {warningLabel}
                            </div>
                            {t.usesOlderEdition ? (
                              <div style={{ color: "var(--color-text-secondary)" }}>
                                No required stamp is priced on the current edition — the total uses
                                older-edition prices.
                              </div>
                            ) : (
                              <div style={{ color: "var(--color-text-secondary)" }}>
                                {t.pricedCount} of {t.requiredCount} required stamps priced on the
                                current edition
                              </div>
                            )}
                            {!t.usesOlderEdition && t.olderEditionExcludedCount > 0 && (
                              <div style={{ color: "var(--color-text-muted)" }}>
                                {t.olderEditionExcludedCount} priced only on an older edition (not
                                counted)
                              </div>
                            )}
                            {unpriced > 0 && (
                              <div style={{ color: "var(--color-text-muted)" }}>
                                {unpriced} without any catalog price
                              </div>
                            )}
                          </>
                        }
                      >
                        <span aria-label={warningLabel} style={PRICE_STALE_ICON}>
                          <Icon name="warning" size="sm" />
                        </span>
                      </Tooltip>
                    )}
                    {secondary && <span style={PRICE_CONVERTED}>{secondary}</span>}
                    <span style={PRICE_MAIN}>{moneyPrimaryText(t)}</span>
                  </span>
                </Tooltip>
              );
            })()}
            </>
          )}
        </div>
        </div>
      </div>

      {isExpanded && (
        <div
          style={{
            background: "var(--color-bg-elevated)",
            borderTop: "1px solid var(--color-border)",
            marginLeft: "1.25rem",
            borderLeft: "2px solid var(--color-border)",
          }}
        >
          {membersLoading ? (
            <div
              style={{
                padding: "0.875rem 0 0.875rem 0.5rem",
                fontSize: "0.875rem",
                color: "var(--color-text-muted)",
                fontStyle: "italic",
              }}
            >
              Loading stamps...
            </div>
          ) : stampTree.length === 0 ? (
            <div
              style={{
                padding: "0.875rem 0 0.875rem 0.5rem",
                fontSize: "0.875rem",
                color: "var(--color-text-muted)",
                fontStyle: "italic",
              }}
            >
              No stamps in this issue yet.{" "}
              <button
                type="button"
                onClick={() => callbacks.onAddStamp(issue.id)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-accent)",
                  fontSize: "inherit",
                  padding: 0,
                }}
              >
                Add one
              </button>
            </div>
          ) : (
            <>
              {/* Narrowing the tree by checklist (#531) — only where there is a choice to make.
                  Hidden while reordering: a drag inside a narrowed tree would move a stamp past a
                  sibling that was never on screen. */}
              {issue.checklists.length > 1 && !treeReorder.active && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem 0.5rem 0.5rem 0.75rem",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                    Checklist
                  </span>
                  <ChecklistTreeFilter
                    checklists={issue.checklists}
                    selected={treeChecklistIds}
                    onChange={setTreeChecklistIds}
                  />
                </div>
              )}
              <StampTreeGroup
                nodes={stampTree}
                parentStampId={null}
                reorder={treeReorder.reorder}
                renderNode={({ node: treeNode, isLast, drag }) => (
                <StampTreeNode
                  treeNode={treeNode}
                  depth={0}
                  contextIds={treeContextIds}
                  collectionId={collectionId}
                  areas={areas}
                  baseCurrency={baseCurrency}
                  primaryVendorId={primaryVendorId}
                  vendorMap={vendorMap}
                  isLast={isLast}
                  issueName={issue.name}
                  issueYear={issue.year}
                  areaName={
                    areaName ??
                    areas.find((a) => a.id === issue.collectionAreaId)?.name ??
                    null
                  }
                  displayCondition={displayCondition}
                  displayFormat={displayFormat}
                  expandStamp={expandStamp}
                  onPriceSaved={() => void invalidateStampsAndIssues(collectionId)}
                  onEdit={(stampId) => {
                    const stampNode = members?.find(
                      (m) => m.stampId === stampId
                    );
                    if (stampNode) callbacks.onEditStamp(issue.id, stampNode);
                  }}
                  onAddChild={(parentStampId) => {
                    const parentNode = members?.find(
                      (m) => m.stampId === parentStampId
                    );
                    callbacks.onAddStamp(issue.id, {
                      stampId: parentStampId,
                      catalogNumbers: parentNode?.catalogNumbers ?? [],
                      issuedYear: parentNode?.issuedYear ?? null,
                    });
                  }}
                  onAddVariantRange={(parentStampId) => {
                    const parentNode = members?.find(
                      (m) => m.stampId === parentStampId
                    );
                    callbacks.onAddVariantRange(issue, {
                      stampId: parentStampId,
                      name: parentNode?.name ?? null,
                      catalogNumbers: parentNode?.catalogNumbers ?? [],
                    });
                  }}
                  onDelete={(stampId, stampName) =>
                    callbacks.onDeleteStamp(issue.id, stampId, stampName)
                  }
                  onMove={(stampId) =>
                    callbacks.onMoveStamp(issue.id, stampId)
                  }
                  onReparent={(stampId) =>
                    callbacks.onReparentStamp(issue.id, stampId)
                  }
                  narrowed={!!effectiveMatchedIds}
                  reorder={treeReorder.reorder}
                  drag={drag}
                  selection={selection ?? null}
                  ancestorSelected={false}
                  onToggleTick={toggleTick}
                />
                )}
              />
              {/* Add-stamp button pinned at the bottom of the tree (#180), mirroring the
                  "+ New stamp" button in the browse-stamps picker. Opens the add-stamp dialog
                  with this issue pre-filled. The reorder toggle (#549) sits beside it: both are
                  things done *to* the tree as a whole rather than to any row in it, and the foot
                  of the tree is where the eye already is after reading down it. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.625rem 1rem 0.75rem 0.5rem",
                }}
              >
                <button
                  type="button"
                  onClick={() => callbacks.onAddStamp(issue.id)}
                  style={CREATE_LINK_STYLE}
                >
                  + Add stamp
                </button>
                <ReorderModeButton active={treeReorder.active} onToggle={treeReorder.toggle} />
                {treeReorder.error ? (
                  <span style={{ fontSize: "0.75rem", color: "var(--color-danger)" }}>
                    {treeReorder.error}
                  </span>
                ) : (
                  treeReorder.active && (
                    <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      Drag a stamp by its grip. A stamp only moves among its own siblings.
                    </span>
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
