"use client";

import { useMemo, useState } from "react";
import { moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
import { useIssueMembers, useInvalidateIssues } from "./use-issues-query";
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
  StampCountBadge,
  StampTitle,
  StampDetailLine,
  type StampTreeNodeData,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { RowActionsMenu, type RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { usePriceDetailsAction } from "@/app/c/[collectionSlug]/shared/use-price-details-action";
import { useOffersPopupAction } from "@/app/c/[collectionSlug]/offers/use-offers-popup-action";
import { useFormatFactorsAction } from "@/app/c/[collectionSlug]/shared/use-format-factors-action";
import { useQuickPriceDialog } from "@/app/c/[collectionSlug]/shared/use-quick-price-dialog";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import type { StampFormatData } from "@/lib/stamp-formats";
import {
  useInventoryPopupAction,
  useInventoryAddAction,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-copy-actions";
import { orderedCatalogLabels } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";

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
  onDelete: (stampId: string, stampName: string) => void;
  onMove: (stampId: string) => void;
}

function StampTreeNode({
  treeNode,
  depth,
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
  onDelete,
  onMove,
}: StampTreeNodeProps) {
  const [hovered, setHovered] = useState(false);
  const { node, children } = treeNode;
  const hasChildren = children.length > 0;
  const indent = `${depth * 1.25}rem`;

  // Expansion is *derived*, never a setState-in-effect: a node is open when it just gained a
  // sub-stamp (#359) or when the collector opened it themselves. The user's own toggle is
  // remembered against the signal it was made under, so a manual collapse sticks — until the
  // next add under this same node, whose fresh nonce supersedes it.
  const autoExpandNonce = expandStamp?.stampId === node.stampId ? expandStamp.nonce : null;
  const [userToggle, setUserToggle] = useState<{
    forNonce: number | null;
    collapsed: boolean;
  } | null>(null);
  const collapsed =
    userToggle && userToggle.forNonce === autoExpandNonce
      ? userToggle.collapsed
      : autoExpandNonce === null;
  const setCollapsed = (next: boolean) =>
    setUserToggle({ forNonce: autoExpandNonce, collapsed: next });

  const popupLabel =
    node.name ??
    node.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId)?.number ??
    node.catalogNumbers[0]?.number ??
    "(stamp)";

  const addCopy = useInventoryAddAction({
    collectionId,
    areas,
    target: {
      kind: "stamp",
      stampId: node.stampId,
      initial: {
        stampId: node.stampId,
        catalogLabels: orderedCatalogLabels(node.catalogNumbers, vendorMap, primaryVendorId),
        name: node.name,
        secondary: null,
        // Umbrella only when a child acts as a variant (ADR-0010 §3), not for a base
        // stamp whose children are all distinct entries.
        unknownVariant: children.some((c) => c.node.actsAsVariant),
      },
    },
  });
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

  const actions: RowAction[] = [
    { key: "add-child", label: "Add child stamp", icon: "＋", onSelect: () => onAddChild(node.stampId) },
    { key: "move", label: "Move to another issue…", icon: "⇄", onSelect: () => onMove(node.stampId) },
    addCopy.action,
    copies.action,
    offers.action,
    ...(node.mainCatalogPrice ? [prices.action] : []),
    { key: "edit", label: "Edit", icon: "✎", onSelect: () => onEdit(node.stampId) },
    {
      key: "delete",
      label: "Delete",
      icon: "✕",
      danger: true,
      separatorBefore: true,
      onSelect: () => onDelete(node.stampId, node.name ?? "(unnamed)"),
    },
  ];

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: `0.4rem 1rem 0.55rem calc(0.5rem + ${indent})`,
          fontSize: "0.8125rem",
          background: hovered ? "var(--color-bg-row-hover)" : undefined,
          transition: "background 0.1s ease",
          borderBottom: isLast ? undefined : "1px solid var(--color-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
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
              {collapsed ? "▶" : "▼"}
            </button>
          ) : (
            <span style={{ width: "0.875rem", flexShrink: 0 }} />
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

              <RowActionsMenu actions={actions} ariaLabel="Stamp actions" />
              {addCopy.dialog}
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
            />
          </div>
        </div>
      </div>
      {!collapsed &&
        children.map((child, i) => (
          <StampTreeNode
            key={child.node.stampId}
            treeNode={child}
            depth={depth + 1}
            collectionId={collectionId}
            areas={areas}
            baseCurrency={baseCurrency}
            primaryVendorId={primaryVendorId}
            vendorMap={vendorMap}
            isLast={isLast && i === children.length - 1}
            issueName={issueName}
            issueYear={issueYear}
            areaName={areaName}
            displayCondition={displayCondition}
            displayFormat={displayFormat}
            expandStamp={expandStamp}
            onPriceSaved={onPriceSaved}
            onEdit={onEdit}
            onAddChild={onAddChild}
            onDelete={onDelete}
            onMove={onMove}
          />
        ))}
    </>
  );
}

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
  onEditStamp: (issueId: string, stamp: StampNodeData) => void;
  onDeleteStamp: (issueId: string, stampId: string, stampName: string) => void;
  onMoveStamp: (issueId: string, stampId: string) => void;
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

  const stampTree = members ? buildStampTree(members) : [];

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
  const prices = usePriceDetailsAction({ kind: "issue", collectionId, issueId: issue.id });
  // An issue's format multipliers are edited here rather than in Settings: the issue is the
  // narrowest anchor a factor can take, and it is the one a catalog actually prints them against.
  const formatFactors = useFormatFactorsAction({
    collectionId,
    scope: { kind: "issue", id: issue.id },
    scopeLabel: issue.name ?? (issue.year ? String(issue.year) : "(unnamed issue)"),
  });

  const { invalidateList } = useInvalidateIssues();
  const rangeSuggestions = issue.rangeSuggestions;
  // Recomputing the declared range (#333) is an explicit, always-available action that confirms
  // before writing — the list row's warning chip is a hint, not the only way in.
  const [recomputeOpen, setRecomputeOpen] = useState(false);

  const actions: RowAction[] = [
    { key: "add-stamp", label: "Add stamp", icon: "＋", onSelect: () => callbacks.onAddStamp(issue.id) },
    { key: "add-stamp-range", label: "Add stamp range…", icon: "⋯", onSelect: () => callbacks.onAddStampRange(issue) },
    addCopy.action,
    copies.action,
    offers.action,
    ...(issue.requiredPriceTotal ? [prices.action] : []),
    formatFactors.action,
    {
      key: "recompute-range",
      label: "Recompute declared range…",
      icon: "⤢",
      onSelect: () => setRecomputeOpen(true),
    },
    { key: "move-area", label: "Move to another area…", icon: "⇄", onSelect: () => callbacks.onMoveIssueArea(issue) },
    { key: "merge", label: "Merge into another issue…", icon: "⤵", onSelect: () => callbacks.onMergeIssue(issue) },
    { key: "edit", label: "Edit", icon: "✎", onSelect: () => callbacks.onEdit(issue) },
    {
      key: "delete",
      label: "Delete",
      icon: "✕",
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
          {isExpanded ? "▼" : "▶"}
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

          <RowActionsMenu actions={actions} ariaLabel="Issue actions" />
          {addCopy.dialog}
          {copies.dialog}
          {offers.dialog}
          {prices.dialog}
          {formatFactors.dialog}
          {recomputeOpen && (
            <RecomputeRangeDialog
              collectionId={collectionId}
              issueId={issue.id}
              issueLabel={issue.name ?? "(unnamed issue)"}
              onApplied={async () => {
                setRecomputeOpen(false);
                await invalidateList(collectionId);
              }}
              onClose={() => setRecomputeOpen(false)}
            />
          )}
        </div>

        {(issue.catalogNumbers.length > 0 || issue.memberCount > 0) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              marginTop: "0.3rem",
              flexWrap: "wrap",
            }}
          >
            <IssueCatalogChips
              catalogNumbers={issue.catalogNumbers}
              vendorMap={vendorMap}
              primaryVendorId={primaryVendorId}
              rangeSuggestions={rangeSuggestions}
            />

            {issue.memberCount > 0 && (
              <StampCountBadge required={issue.requiredCount} total={issue.memberCount} />
            )}

            {issue.requiredPriceTotal && (() => {
              const t = issue.requiredPriceTotal;
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
                  content={showWarning ? undefined : "Total of required stamps (main catalog)"}
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
                          ⚠
                        </span>
                      </Tooltip>
                    )}
                    {secondary && <span style={PRICE_CONVERTED}>{secondary}</span>}
                    <span style={PRICE_MAIN}>{moneyPrimaryText(t)}</span>
                  </span>
                </Tooltip>
              );
            })()}
          </div>
        )}
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
              {stampTree.map((treeNode, i) => (
                <StampTreeNode
                  key={treeNode.node.stampId}
                  treeNode={treeNode}
                  depth={0}
                  collectionId={collectionId}
                  areas={areas}
                  baseCurrency={baseCurrency}
                  primaryVendorId={primaryVendorId}
                  vendorMap={vendorMap}
                  isLast={i === stampTree.length - 1}
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
                  onPriceSaved={() => invalidateList(collectionId)}
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
                  onDelete={(stampId, stampName) =>
                    callbacks.onDeleteStamp(issue.id, stampId, stampName)
                  }
                  onMove={(stampId) =>
                    callbacks.onMoveStamp(issue.id, stampId)
                  }
                />
              ))}
              {/* Add-stamp button pinned at the bottom of the tree (#180), mirroring the
                  "+ New stamp" button in the browse-stamps picker. Opens the add-stamp dialog
                  with this issue pre-filled. */}
              <div style={{ padding: "0.625rem 1rem 0.75rem 0.5rem" }}>
                <button
                  type="button"
                  onClick={() => callbacks.onAddStamp(issue.id)}
                  style={CREATE_LINK_STYLE}
                >
                  + Add stamp
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
