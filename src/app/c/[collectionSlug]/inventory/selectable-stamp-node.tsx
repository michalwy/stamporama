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
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { PhotoThumb } from "./photo-thumb";
import { Icon } from "@/app/icons";

/** True when this node or any descendant is in the active filter's match set (#186). */
function subtreeHasMatch(treeNode: StampTreeNodeData, matched: Set<string>): boolean {
  if (matched.has(treeNode.node.stampId)) return true;
  return treeNode.children.some((c) => subtreeHasMatch(c, matched));
}

/** A selectable stamp/variant row in a rich picker tree (catalog chips, dates, prices, and
 * the "— unknown variant" marker on a node that still has variant children). Shared by the
 * area→issue→stamp Browse popup (#104) and the issue-scoped stamp picker for adding a copy
 * from the issue list (#111). Clicking the row selects it; the caret toggles children.
 *
 * `onNewVariant` is optional: the Browse popup passes it to expose inline "+ variant" create
 * (#105); the selection-only issue picker omits it. */
export function SelectableStampNode({
  treeNode,
  depth,
  collectionId,
  vendorMap,
  primaryVendorId,
  isLast,
  onPick,
  onNewVariant,
  matchedStampIds,
  contextIds,
}: {
  treeNode: StampTreeNodeData;
  depth: number;
  collectionId: string;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  isLast: boolean;
  onPick: (node: StampNodeData, unknownVariant: boolean) => void;
  onNewVariant?: (parentStampId: string) => void;
  /** When set, the active filter matched only stamps within this issue (#186): nodes whose
   * subtree contains no match are dimmed, and nodes on the path to a match start expanded. */
  matchedStampIds?: Set<string> | null;
  /** Stamps the checklist filter (#531) kept only as context for a matching descendant. Dimmed
   *  the same way and for the same reason as #186's non-matches — one faded state, not two. */
  contextIds?: Set<string>;
}) {
  const { node, children } = treeNode;
  const hasChildren = children.length > 0;
  // Under an active inner-stamp filter, reveal the path to a matching descendant.
  const childHasMatch =
    !!matchedStampIds && children.some((c) => subtreeHasMatch(c, matchedStampIds));
  const [userCollapsed, setUserCollapsed] = useState(true);
  // A filter match forces the node open (so the match is visible) regardless of the user's toggle;
  // when the filter clears, the node falls back to the user's own collapsed state.
  const collapsed = userCollapsed && !childHasMatch;
  const [hovered, setHovered] = useState(false);
  // Dim a node when a filter is active and neither it nor any descendant matches (#186), or when
  // the checklist filter kept it only as the numbering a match hangs under (#531).
  const dimmed =
    (!!matchedStampIds && !subtreeHasMatch(treeNode, matchedStampIds)) ||
    !!contextIds?.has(treeNode.node.stampId);
  // A node is selectable as the "unknown variant" when at least one of its children acts as a
  // variant (ADR-0010 §3) — not when its children are all distinct entries (errors, overprints…).
  // At **any** depth (#239/#401): `3 → 3A → 3Aa` puts the same question on `3A` as on `3`, and the
  // tree is arbitrarily deep by design (#54).
  const isUnknownVariant = children.some((c) => c.node.actsAsVariant);
  const indent = `${depth * 1.25}rem`;

  return (
    <>
      <Tooltip content="Select this stamp" align="start" style={{ display: "block" }}>
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
          style={{
            padding: `0.4rem 1rem 0.55rem calc(0.5rem + ${indent})`,
            fontSize: "0.8125rem",
            background: hovered ? "var(--color-bg-row-hover)" : undefined,
            transition: "background 0.1s ease, opacity 0.1s ease",
            borderBottom: isLast ? undefined : "1px solid var(--color-border)",
            cursor: "pointer",
            // De-emphasize stamps that don't match the active inner-stamp filter (#186).
            opacity: dimmed ? 0.45 : 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
            {/* Expand/collapse toggle sits first, before the photo. */}
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setUserCollapsed(!collapsed);
                }}
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

            {/* Catalog-level photo (#137) as a left column, matching the inventory list. Reserved
                even when empty for alignment. Stop click propagation so opening a thumbnail's
                lightbox doesn't also select the row. */}
            <div onClick={(e) => e.stopPropagation()}>
              <PhotoThumb collectionId={collectionId} photos={node.photos} reserveWhenEmpty />
            </div>

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
                  {isUnknownVariant && (
                    <span style={{ color: "var(--color-text-muted)" }}> — unknown variant</span>
                  )}
                </span>

                {/* A child hangs under a node at **any** depth (#401): the tree is `Issue → X → Xa →
                    Xay → XayI` by design (#54), so `3a` takes `3a1` exactly as `3` takes `3a`. The
                    issue list's own "Add child stamp" has always allowed this — only the picker
                    stopped at the first level. */}
                {onNewVariant && (
                  <Tooltip content="Add a variant under this stamp" style={{ flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNewVariant(node.stampId);
                      }}
                      style={{ ...CREATE_LINK_STYLE, padding: "0.15rem 0.45rem" }}
                    >
                      + variant
                    </button>
                  </Tooltip>
                )}
              </div>

              <StampDetailLine node={node} vendorMap={vendorMap} primaryVendorId={primaryVendorId} />
            </div>
          </div>
        </div>
      </Tooltip>
      {!collapsed &&
        children.map((child, i) => (
          <SelectableStampNode
            key={child.node.stampId}
            treeNode={child}
            depth={depth + 1}
            collectionId={collectionId}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
            isLast={isLast && i === children.length - 1}
            onPick={onPick}
            onNewVariant={onNewVariant}
            matchedStampIds={matchedStampIds}
            contextIds={contextIds}
          />
        ))}
    </>
  );
}
