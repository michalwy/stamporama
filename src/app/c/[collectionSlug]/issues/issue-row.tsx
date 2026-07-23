"use client";

import { useState } from "react";
import { moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
import { useIssueMembers, useInvalidateIssues } from "./use-issues-query";
import { applyIssueRangeSuggestionAction } from "@/app/actions/issues";
import type { IssueListItem, StampNodeData } from "@/lib/issues";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import {
  PRICE_MAIN,
  PRICE_CONVERTED,
  PRICE_STALE_ICON,
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
import {
  useInventoryPopupAction,
  useInventoryAddAction,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-copy-actions";
import { primaryLabel } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";
import { PhotoThumb } from "@/app/c/[collectionSlug]/inventory/photo-thumb";

// ── Stamp tree ──────────────────────────────────────────────────────────────

interface StampTreeNodeProps {
  treeNode: StampTreeNodeData;
  depth: number;
  collectionId: string;
  areas: CollectionAreaData[];
  baseCurrency: string;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  isLast: boolean;
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
  onEdit,
  onAddChild,
  onDelete,
  onMove,
}: StampTreeNodeProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [hovered, setHovered] = useState(false);
  const { node, children } = treeNode;
  const hasChildren = children.length > 0;
  const indent = `${depth * 1.25}rem`;

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
        primary: primaryLabel(
          node.catalogNumbers.map((cn) => cn.number),
          node.name
        ),
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
  const prices = usePriceDetailsAction({ kind: "stamp", stampId: node.stampId });

  const actions: RowAction[] = [
    { key: "add-child", label: "Add child stamp", icon: "＋", onSelect: () => onAddChild(node.stampId) },
    { key: "move", label: "Move to another issue…", icon: "⇄", onSelect: () => onMove(node.stampId) },
    addCopy.action,
    copies.action,
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
              {prices.dialog}
            </div>

            <StampDetailLine
              node={node}
              vendorMap={vendorMap}
              primaryVendorId={primaryVendorId}
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

export interface IssueRowCallbacks {
  onEdit: (issue: IssueListItem) => void;
  onDelete: (issue: IssueListItem) => void;
  onMoveIssueArea: (issue: IssueListItem) => void;
  onAddStampRange: (issue: IssueListItem) => void;
  onMergeIssue: (issue: IssueListItem) => void;
  onAddStamp: (
    issueId: string,
    parentStampId?: string,
    parentCatalogNumbers?: { catalogVendorId: string; number: string }[]
  ) => void;
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
  /** Condition whose price fills each member's headline price, matching the list's
   *  price column so the expanded rows track the condition switcher (#238). */
  displayConditionId?: string | null;
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
  displayConditionId,
}: IssueRowProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? false);
  const [hovered, setHovered] = useState(false);

  const { data: members, isLoading: membersLoading } = useIssueMembers(
    collectionId,
    issue.id,
    isExpanded,
    displayConditionId
  );

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
  const prices = usePriceDetailsAction({ kind: "issue", collectionId, issueId: issue.id });

  const { invalidateList } = useInvalidateIssues();
  const [applyingRange, setApplyingRange] = useState(false);
  const rangeSuggestions = issue.rangeSuggestions;

  // Apply every vendor's declared-range extension in one go, then refresh the list.
  async function handleUpdateRange() {
    if (applyingRange || rangeSuggestions.length === 0) return;
    setApplyingRange(true);
    try {
      for (const s of rangeSuggestions) {
        await applyIssueRangeSuggestionAction(
          collectionId,
          issue.id,
          s.catalogVendorId,
          s.proposedFirst,
          s.proposedLast
        );
      }
      await invalidateList(collectionId);
    } finally {
      setApplyingRange(false);
    }
  }

  const actions: RowAction[] = [
    { key: "add-stamp", label: "Add stamp", icon: "＋", onSelect: () => callbacks.onAddStamp(issue.id) },
    { key: "add-stamp-range", label: "Add stamp range…", icon: "⋯", onSelect: () => callbacks.onAddStampRange(issue) },
    addCopy.action,
    copies.action,
    ...(issue.requiredPriceTotal ? [prices.action] : []),
    ...(rangeSuggestions.length > 0
      ? [
          {
            key: "update-range",
            label: applyingRange ? "Updating range…" : "Update declared range",
            icon: "⤢",
            onSelect: handleUpdateRange,
          } as RowAction,
        ]
      : []),
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
            <button
              type="button"
              onClick={() => onFilterByArea?.(issue.collectionAreaId)}
              title={`Filter by ${areaName}`}
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
                background: "var(--color-bg-page)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.25rem",
                padding: "0.1rem 0.4rem",
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {areaName}
            </button>
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
          {prices.dialog}
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
              const estimated = t.estimatedCount > 0;
              const secondary = moneySecondaryText(t);
              const warningLabel = t.usesOlderEdition ? "Older-edition prices" : "Partial total";
              return (
                <span
                  style={{
                    marginLeft: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                  }}
                  title={showWarning ? undefined : "Total of required stamps (main catalog)"}
                >
                  {estimated && (
                    <Tooltip
                      align="end"
                      content={
                        <>
                          <div style={{ fontWeight: 600, marginBottom: "0.15rem" }}>
                            Includes an estimate
                          </div>
                          <div style={{ color: "var(--color-text-secondary)" }}>
                            {t.estimatedCount} required stamp{t.estimatedCount !== 1 ? "s" : ""} priced
                            from the lowest variant (no own price).
                          </div>
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
            stampTree.map((treeNode, i) => (
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
                  callbacks.onAddStamp(
                    issue.id,
                    parentStampId,
                    parentNode?.catalogNumbers ?? []
                  );
                }}
                onDelete={(stampId, stampName) =>
                  callbacks.onDeleteStamp(issue.id, stampId, stampName)
                }
                onMove={(stampId) =>
                  callbacks.onMoveStamp(issue.id, stampId)
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
