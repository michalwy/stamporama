"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { DialogShell } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { IssueData, StampNodeData } from "@/lib/issues";
import { AreaFilterSidebar } from "@/app/c/[collectionSlug]/shared/area-filter-sidebar";
import {
  effectiveVendorsForArea,
  effectivePrimaryVendorId,
  getDescendantIds,
} from "@/app/c/[collectionSlug]/shared/area-helpers";
import { formatStampCN } from "@/app/c/[collectionSlug]/shared/chip-styles";
import {
  buildStampTree,
  IssueTitle,
  IssueCatalogChips,
  StampCountBadge,
  StampTitle,
  StampDetailLine,
  type VendorMap,
  type StampTreeNodeData,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import { useIssuesByArea } from "./use-inventory-query";
import { issueLabel, type PickedStamp } from "./stamp-picker-shared";

// ── Styles ──────────────────────────────────────────────────────────────────

const SEARCH_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const HINT_STYLE: React.CSSProperties = {
  padding: "2rem 1.5rem",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};

/** Popup area→issue→stamp browser for the inventory picker (#104). Left: the area
 * tree (reused `AreaFilterSidebar`); "All areas" (no selection) lists every issue,
 * a parent area includes its descendants. Right: the scope's issues, text-filterable,
 * each expandable to its stamp/variant tree — rendered with the same shared
 * presentation as the main issues list, minus action buttons; a click selects. */
export function StampPickerBrowser({
  collectionId,
  areas,
  onPick,
  onClose,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  onPick: (picked: PickedStamp) => void;
  onClose: () => void;
}) {
  const [areaId, setAreaId] = useState<string | null>(null);

  // This popup nests inside the item-form dialog, and both register document-level
  // Escape handlers. Intercept Escape in the capture phase and stop it so only the
  // browser closes — otherwise the parent form (with its in-progress edits) would
  // close too.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  // The parent item-form dialog panel uses `transform` for centering, which makes
  // it the containing block for `position: fixed` descendants — so an un-portaled
  // popup gets clipped to that dialog's box. Portal to <body> to escape it.
  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title="Browse stamps"
      onClose={onClose}
      maxWidth="min(94vw, 88rem)"
      height="min(90vh, 60rem)"
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* The sidebar is authored for the page layout (max-height: 100vh, sticky);
            wrap it so a long area tree scrolls within the dialog instead. */}
        <div style={{ height: "100%", overflowY: "auto", flexShrink: 0 }}>
          <AreaFilterSidebar areas={areas} filterAreaId={areaId} onNavigate={setAreaId} />
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderLeft: "1px solid var(--color-border)",
          }}
        >
          <IssueBrowser
            collectionId={collectionId}
            areas={areas}
            selectedAreaId={areaId}
            onPick={onPick}
          />
        </div>
      </div>
    </DialogShell>,
    document.body
  );
}

function IssueBrowser({
  collectionId,
  areas,
  selectedAreaId,
  onPick,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  selectedAreaId: string | null;
  onPick: (picked: PickedStamp) => void;
}) {
  const [filter, setFilter] = useState("");

  // Selecting a parent area includes its descendants, so its issues surface too.
  const areaIds = useMemo(() => {
    if (!selectedAreaId) return null;
    const ids = getDescendantIds(areas, selectedAreaId);
    ids.add(selectedAreaId);
    return [...ids];
  }, [areas, selectedAreaId]);

  const { data: issues = [], isLoading } = useIssuesByArea(collectionId, areaIds);

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  // Effective vendor entries + primary vendor per area (ancestor-inherited), matching
  // how the main issues list builds them — a parent/"All areas" mixes many areas.
  const vendorMapByArea = useMemo(() => {
    const m = new Map<string, VendorMap>();
    for (const a of areas) {
      const vendors = effectiveVendorsForArea(areas, a.id);
      m.set(a.id, new Map(vendors.map((v) => [v.catalogVendorId, v])));
    }
    return m;
  }, [areas]);

  const primaryVendorByArea = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of areas) m.set(a.id, effectivePrimaryVendorId(areas, a.id));
    return m;
  }, [areas]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter((issue) => {
      if ((issue.name ?? "").toLowerCase().includes(q)) return true;
      if (issue.year && String(issue.year).includes(q)) return true;
      return issue.members.some((m) =>
        m.catalogNumbers.some((cn) => cn.number.toLowerCase().includes(q))
      );
    });
  }, [issues, filter]);

  function handlePick(node: StampNodeData, unknownVariant: boolean, issue: IssueData) {
    const vm = vendorMapByArea.get(issue.collectionAreaId);
    const cat = node.catalogNumbers
      .map((cn) => formatStampCN(cn.number, vm?.get(cn.catalogVendorId)))
      .join(", ");
    const primary = [cat || null, node.name || null].filter(Boolean).join(" · ") || "(unnamed stamp)";
    const areaName = areaById.get(issue.collectionAreaId)?.name ?? null;
    const context = [
      issue.name || issue.year ? issueLabel(issue.name, issue.year) : null,
      areaName,
    ]
      .filter(Boolean)
      .join(" · ");
    onPick({ stampId: node.stampId, primary, secondary: context || null, unknownVariant });
  }

  return (
    <>
      <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--color-border)" }}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={selectedAreaId ? "Filter issues in this area…" : "Filter issues…"}
          style={SEARCH_STYLE}
          aria-label="Filter issues"
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {isLoading ? (
          <p style={HINT_STYLE}>Loading issues…</p>
        ) : filtered.length === 0 ? (
          <p style={HINT_STYLE}>
            {issues.length === 0 ? "No issues here yet." : "No issues match your filter."}
          </p>
        ) : (
          filtered.map((issue, i) => (
            <PickIssueRow
              key={issue.id}
              issue={issue}
              areaName={areaById.get(issue.collectionAreaId)?.name ?? null}
              showArea={selectedAreaId !== issue.collectionAreaId}
              vendorMap={vendorMapByArea.get(issue.collectionAreaId) ?? new Map()}
              primaryVendorId={primaryVendorByArea.get(issue.collectionAreaId) ?? null}
              isLast={i === filtered.length - 1}
              onPick={handlePick}
            />
          ))
        )}
      </div>
    </>
  );
}

function PickIssueRow({
  issue,
  areaName,
  showArea,
  vendorMap,
  primaryVendorId,
  isLast,
  onPick,
}: {
  issue: IssueData;
  areaName: string | null;
  showArea: boolean;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  isLast: boolean;
  onPick: (node: StampNodeData, unknownVariant: boolean, issue: IssueData) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const tree = useMemo<StampTreeNodeData[]>(() => buildStampTree(issue.members), [issue.members]);

  return (
    <div style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setIsExpanded((v) => !v)}
        style={{
          padding: "0.875rem 1.25rem",
          background: hovered ? "var(--color-bg-row-hover)" : "var(--color-bg-elevated)",
          transition: "background 0.1s ease",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((v) => !v);
            }}
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

          {showArea && areaName && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--color-text-muted)",
                background: "var(--color-bg-page)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.25rem",
                padding: "0.1rem 0.4rem",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {areaName}
            </span>
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
        </div>

        {(issue.catalogNumbers.length > 0 || issue.members.length > 0) && (
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
            {issue.members.length > 0 && (
              <StampCountBadge required={issue.completeness.required} total={issue.members.length} />
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
          {tree.length === 0 ? (
            <div
              style={{
                padding: "0.875rem 0 0.875rem 0.5rem",
                fontSize: "0.875rem",
                color: "var(--color-text-muted)",
                fontStyle: "italic",
              }}
            >
              No stamps in this issue yet.
            </div>
          ) : (
            tree.map((treeNode, i) => (
              <PickStampNode
                key={treeNode.node.stampId}
                treeNode={treeNode}
                depth={0}
                vendorMap={vendorMap}
                primaryVendorId={primaryVendorId}
                isLast={i === tree.length - 1}
                onPick={(node, unknownVariant) => onPick(node, unknownVariant, issue)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PickStampNode({
  treeNode,
  depth,
  vendorMap,
  primaryVendorId,
  isLast,
  onPick,
}: {
  treeNode: StampTreeNodeData;
  depth: number;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  isLast: boolean;
  onPick: (node: StampNodeData, unknownVariant: boolean) => void;
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
        </div>

        <StampDetailLine node={node} vendorMap={vendorMap} primaryVendorId={primaryVendorId} />
      </div>
      {!collapsed &&
        children.map((child, i) => (
          <PickStampNode
            key={child.node.stampId}
            treeNode={child}
            depth={depth + 1}
            vendorMap={vendorMap}
            primaryVendorId={primaryVendorId}
            isLast={isLast && i === children.length - 1}
            onPick={onPick}
          />
        ))}
    </>
  );
}
