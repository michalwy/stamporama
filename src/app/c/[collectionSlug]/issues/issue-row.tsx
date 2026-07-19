"use client";

import { useState } from "react";
import { moneyPrimaryText, moneySecondaryText } from "@/app/stamp-display";
import { useIssueMembers } from "./use-issues-query";
import type { IssueListItem, StampNodeData } from "@/lib/issues";
import type { AreaCatalogEntry, CollectionAreaData } from "@/lib/areas";
import {
  rowBtnStyle,
  rowBtnDangerStyle,
  addBtnStyle,
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
import { AllPricesButton } from "@/app/c/[collectionSlug]/shared/all-prices-button";
import { IssuePricesButton } from "@/app/c/[collectionSlug]/shared/issue-prices-button";
import { InventoryPopupButton } from "@/app/c/[collectionSlug]/inventory/inventory-popup-button";
import { InventoryAddButton } from "@/app/c/[collectionSlug]/inventory/inventory-add-button";
import { primaryLabel } from "@/app/c/[collectionSlug]/inventory/stamp-picker-shared";

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
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand" : "Collapse"}
              style={{
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

          <button
            type="button"
            onClick={() => onAddChild(node.stampId)}
            style={addBtnStyle}
          >
            + Child
          </button>
          <button
            type="button"
            onClick={() => onMove(node.stampId)}
            style={rowBtnStyle}
          >
            Move
          </button>
          <InventoryAddButton
            collectionId={collectionId}
            areas={areas}
            baseCurrency={baseCurrency}
            target={{
              kind: "stamp",
              stampId: node.stampId,
              initial: {
                stampId: node.stampId,
                primary: primaryLabel(
                  node.catalogNumbers.map((cn) => cn.number),
                  node.name
                ),
                secondary: null,
                unknownVariant: children.length > 0,
              },
            }}
          />
          <InventoryPopupButton
            collectionId={collectionId}
            areas={areas}
            baseCurrency={baseCurrency}
            target={{ kind: "stamp", stampId: node.stampId, label: popupLabel }}
          />
          <button
            type="button"
            onClick={() => onEdit(node.stampId)}
            style={rowBtnStyle}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(node.stampId, node.name ?? "(unnamed)")}
            style={rowBtnDangerStyle}
          >
            Delete
          </button>
        </div>

        <StampDetailLine
          node={node}
          vendorMap={vendorMap}
          primaryVendorId={primaryVendorId}
          priceTrailing={<AllPricesButton stampId={node.stampId} />}
        />
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
}: IssueRowProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? false);
  const [hovered, setHovered] = useState(false);

  const { data: members, isLoading: membersLoading } = useIssueMembers(
    collectionId,
    issue.id,
    isExpanded
  );

  const stampTree = members ? buildStampTree(members) : [];

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
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? "Collapse" : "Expand"}
            style={{
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

          <button
            type="button"
            onClick={() => callbacks.onAddStamp(issue.id)}
            style={addBtnStyle}
          >
            + Stamp
          </button>
          <InventoryAddButton
            collectionId={collectionId}
            areas={areas}
            baseCurrency={baseCurrency}
            target={{
              kind: "issue",
              issue: {
                id: issue.id,
                name: issue.name,
                year: issue.year,
                collectionAreaId: issue.collectionAreaId,
              },
            }}
            label="+ Copy"
          />
          <InventoryPopupButton
            collectionId={collectionId}
            areas={areas}
            baseCurrency={baseCurrency}
            target={{
              kind: "issue",
              issueId: issue.id,
              label: issue.name ?? "(unnamed issue)",
            }}
          />
          <button
            type="button"
            onClick={() => callbacks.onEdit(issue)}
            style={rowBtnStyle}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => callbacks.onDelete(issue)}
            style={rowBtnDangerStyle}
          >
            Delete
          </button>
        </div>

        {(issue.catalogNumbers.length > 0 || issue.memberCount > 0) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              paddingLeft: "1.75rem",
              marginTop: "0.3rem",
              flexWrap: "wrap",
            }}
          >
            <IssueCatalogChips
              catalogNumbers={issue.catalogNumbers}
              vendorMap={vendorMap}
              primaryVendorId={primaryVendorId}
            />

            {issue.memberCount > 0 && (
              <StampCountBadge required={issue.requiredCount} total={issue.memberCount} />
            )}

            {issue.requiredPriceTotal && (() => {
              const t = issue.requiredPriceTotal;
              const incomplete = t.pricedCount < t.requiredCount;
              const unpriced = t.requiredCount - t.pricedCount - t.olderEditionExcludedCount;
              const showWarning = t.usesOlderEdition || incomplete;
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
                  <IssuePricesButton collectionId={collectionId} issueId={issue.id} />
                </span>
              );
            })()}
          </div>
        )}
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
