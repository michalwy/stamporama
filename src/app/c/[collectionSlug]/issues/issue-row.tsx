"use client";

import { useState } from "react";
import { formatIssuedDate, formatIssueCatalogNumber } from "@/app/stamp-display";
import { useIssueMembers } from "./use-issues-query";
import type { IssueListItem, StampNodeData } from "@/lib/issues";
import type { AreaCatalogEntry } from "@/lib/areas";
import {
  rowBtnStyle,
  rowBtnDangerStyle,
  addBtnStyle,
  ISSUE_PRIMARY_CHIP,
  ISSUE_SECONDARY_CHIP,
  STAMP_PRIMARY_CHIP,
  STAMP_SECONDARY_CHIP,
  STAMP_MUTED_PRIMARY_CHIP,
  formatStampCN,
} from "@/app/c/[collectionSlug]/shared/chip-styles";

// ── Stamp tree ──────────────────────────────────────────────────────────────

interface TreeNode {
  node: StampNodeData;
  children: TreeNode[];
}

function buildStampTree(members: StampNodeData[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const m of members) byId.set(m.stampId, { node: m, children: [] });
  const roots: TreeNode[] = [];
  for (const [, treeNode] of byId) {
    const parentId = treeNode.node.parentId;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }
  return roots;
}

interface StampTreeNodeProps {
  treeNode: TreeNode;
  depth: number;
  primaryVendorId: string | null;
  vendorMap: Map<string, AreaCatalogEntry>;
  isLast: boolean;
  onAddChild: (parentStampId: string) => void;
  onRemove: (stampId: string) => void;
  onDelete: (stampId: string, stampName: string) => void;
  onMove: (stampId: string) => void;
}

function StampTreeNode({
  treeNode,
  depth,
  primaryVendorId,
  vendorMap,
  isLast,
  onAddChild,
  onRemove,
  onDelete,
  onMove,
}: StampTreeNodeProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [hovered, setHovered] = useState(false);
  const { node, children } = treeNode;
  const dateStr = formatIssuedDate(
    node.issuedDay,
    node.issuedMonth,
    node.issuedYear
  );
  const hasChildren = children.length > 0;
  const indent = `${depth * 1.25}rem`;

  const primaryCN = primaryVendorId
    ? (node.catalogNumbers.find(
        (cn) => cn.catalogVendorId === primaryVendorId
      ) ?? null)
    : null;
  const secondaryCNs = node.catalogNumbers.filter(
    (cn) => cn.catalogVendorId !== primaryVendorId
  );

  const notRequired = !node.requiredForCompleteness;

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
            {dateStr && (
              <span
                style={{ color: "var(--color-text-muted)", fontWeight: 400 }}
              >
                {dateStr},{" "}
              </span>
            )}
            <span
              style={{
                color: node.name
                  ? "var(--color-text-primary)"
                  : "var(--color-text-muted)",
                fontStyle: node.name ? undefined : "italic",
              }}
            >
              {node.name ?? "(unnamed)"}
            </span>
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
          <button
            type="button"
            onClick={() => onRemove(node.stampId)}
            style={rowBtnDangerStyle}
          >
            Remove
          </button>
          <button
            type="button"
            onClick={() => onDelete(node.stampId, node.name ?? "(unnamed)")}
            style={rowBtnDangerStyle}
          >
            Delete
          </button>
        </div>

        {(primaryCN || secondaryCNs.length > 0) && (
          <div
            style={{
              display: "flex",
              gap: "0.3rem",
              marginTop: "0.15rem",
              paddingLeft: "1.375rem",
              flexWrap: "wrap",
            }}
          >
            {primaryCN && (
              <span
                style={
                  notRequired ? STAMP_MUTED_PRIMARY_CHIP : STAMP_PRIMARY_CHIP
                }
              >
                {formatStampCN(
                  primaryCN.number,
                  vendorMap.get(primaryCN.catalogVendorId)
                )}
              </span>
            )}
            {secondaryCNs.map((cn) => (
              <span key={cn.catalogVendorId} style={STAMP_SECONDARY_CHIP}>
                {formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId))}
              </span>
            ))}
          </div>
        )}
      </div>
      {!collapsed &&
        children.map((child, i) => (
          <StampTreeNode
            key={child.node.stampId}
            treeNode={child}
            depth={depth + 1}
            primaryVendorId={primaryVendorId}
            vendorMap={vendorMap}
            isLast={isLast && i === children.length - 1}
            onAddChild={onAddChild}
            onRemove={onRemove}
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
  onRemoveStamp: (issueId: string, stampId: string) => void;
  onDeleteStamp: (issueId: string, stampId: string, stampName: string) => void;
  onMoveStamp: (issueId: string, stampId: string) => void;
}

interface IssueRowProps {
  issue: IssueListItem;
  collectionId: string;
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

  const primaryCatEntry = primaryVendorId
    ? (issue.catalogNumbers.find(
        (cn) => cn.catalogVendorId === primaryVendorId
      ) ?? null)
    : null;
  const secondaryCatEntries = issue.catalogNumbers.filter(
    (cn) => cn.catalogVendorId !== primaryVendorId
  );

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
            {issue.year && (
              <span
                style={{ color: "var(--color-text-muted)", fontWeight: 400 }}
              >
                {issue.year},{" "}
              </span>
            )}
            <span
              style={{
                fontWeight: 600,
                fontStyle: issue.name ? undefined : "italic",
                color: issue.name
                  ? "var(--color-text-primary)"
                  : "var(--color-text-muted)",
              }}
            >
              {issue.name ?? "(unnamed)"}
            </span>
          </span>

          <button
            type="button"
            onClick={() => callbacks.onAddStamp(issue.id)}
            style={addBtnStyle}
          >
            + Stamp
          </button>
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
            {primaryCatEntry &&
              primaryVendorId &&
              (() => {
                const v = vendorMap.get(primaryVendorId);
                return (
                  <span style={ISSUE_PRIMARY_CHIP}>
                    {formatIssueCatalogNumber(
                      primaryCatEntry.firstNumber,
                      primaryCatEntry.lastNumber,
                      v?.vendorAbbreviation ?? "",
                      v?.prefix
                    )}
                  </span>
                );
              })()}
            {secondaryCatEntries.map((cn) => {
              const v = vendorMap.get(cn.catalogVendorId);
              return (
                <span key={cn.catalogVendorId} style={ISSUE_SECONDARY_CHIP}>
                  {formatIssueCatalogNumber(
                    cn.firstNumber,
                    cn.lastNumber,
                    v?.vendorAbbreviation ?? "",
                    v?.prefix
                  )}
                </span>
              );
            })}

            {issue.memberCount > 0 && (
              <span
                style={{
                  fontSize: "0.75rem",
                  fontFamily: "monospace",
                  color: "var(--color-text-muted)",
                  background: "var(--color-bg-muted)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.25rem",
                  padding: "0.1rem 0.4rem",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
                title="Required / Total stamps"
              >
                {issue.requiredCount}/{issue.memberCount}
              </span>
            )}
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
                primaryVendorId={primaryVendorId}
                vendorMap={vendorMap}
                isLast={i === stampTree.length - 1}
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
                onRemove={(stampId) =>
                  callbacks.onRemoveStamp(issue.id, stampId)
                }
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
