"use client";

import { useState } from "react";
import type { StampNodeData } from "@/lib/issues";
import {
  StampTitle,
  StampDetailLine,
  type VendorMap,
  type StampTreeNodeData,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import { CREATE_LINK_STYLE } from "@/app/c/[collectionSlug]/shared/chip-styles";

/** A selectable stamp/variant row in a rich picker tree (catalog chips, dates, prices, and
 * the "— unknown variant" marker on a base stamp that still has variants). Shared by the
 * area→issue→stamp Browse popup (#104) and the issue-scoped stamp picker for adding a copy
 * from the issue list (#111). Clicking the row selects it; the caret toggles children.
 *
 * `onNewVariant` is optional: the Browse popup passes it to expose inline "+ variant" create
 * (#105); the selection-only issue picker omits it. */
export function SelectableStampNode({
  treeNode,
  depth,
  vendorMap,
  primaryVendorId,
  isLast,
  onPick,
  onNewVariant,
}: {
  treeNode: StampTreeNodeData;
  depth: number;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  isLast: boolean;
  onPick: (node: StampNodeData, unknownVariant: boolean) => void;
  onNewVariant?: (parentStampId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [hovered, setHovered] = useState(false);
  const { node, children } = treeNode;
  const hasChildren = children.length > 0;
  // A base stamp (top level) with variants is selectable as the "unknown variant".
  const isUnknownVariant = depth === 0 && hasChildren;
  const indent = `${depth * 1.25}rem`;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onPick(node, isUnknownVariant)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPick(node, isUnknownVariant);
          }
        }}
        title="Select this stamp"
        style={{
          padding: `0.4rem 1rem 0.55rem calc(0.5rem + ${indent})`,
          fontSize: "0.8125rem",
          background: hovered ? "var(--color-bg-row-hover)" : undefined,
          transition: "background 0.1s ease",
          borderBottom: isLast ? undefined : "1px solid var(--color-border)",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed(!collapsed);
              }}
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
            {isUnknownVariant && (
              <span style={{ color: "var(--color-text-muted)" }}> — unknown variant</span>
            )}
          </span>

          {/* Only base stamps take variants (ADR-0007 §2). */}
          {depth === 0 && onNewVariant && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNewVariant(node.stampId);
              }}
              title="Add a variant under this stamp"
              style={{ ...CREATE_LINK_STYLE, flexShrink: 0, padding: "0.15rem 0.45rem" }}
            >
              + variant
            </button>
          )}
        </div>

        <StampDetailLine node={node} vendorMap={vendorMap} primaryVendorId={primaryVendorId} />
      </div>
      {!collapsed &&
        children.map((child, i) => (
          <SelectableStampNode
            key={child.node.stampId}
            treeNode={child}
            depth={depth + 1}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
            isLast={isLast && i === children.length - 1}
            onPick={onPick}
            onNewVariant={onNewVariant}
          />
        ))}
    </>
  );
}
