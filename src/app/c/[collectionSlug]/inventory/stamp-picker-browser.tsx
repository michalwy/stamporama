"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { DialogShell } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { IssueData, IssueListItem, StampNodeData } from "@/lib/issues";
import { createIssueAction, addStampToIssueAction } from "@/app/actions/issues";
import { AreaFilterSidebar } from "@/app/c/[collectionSlug]/shared/area-filter-sidebar";
import { IssueDialog } from "@/app/c/[collectionSlug]/shared/issue-form-dialog";
import { StampFormDialog } from "@/app/c/[collectionSlug]/shared/stamp-form-dialog";
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
import { useIssuesByArea, useInvalidateInventory } from "./use-inventory-query";
import { issueLabel, primaryLabel, type PickedStamp } from "./stamp-picker-shared";

/** An in-progress inline create from the picker popup (#105): a new issue in an
 * area, or a new stamp / variant (parent set) in an issue. */
type CreateState =
  | { kind: "issue"; areaId: string | null }
  | { kind: "stamp"; issue: IssueData; parentStampId?: string };

/** Adapt a browser `IssueData` to the `IssueListItem` shape `StampFormDialog`
 * expects. Only id/name/year are actually read (the issue step is prefilled), so
 * list-only fields are filled with safe placeholders. */
function toIssueListItem(issue: IssueData): IssueListItem {
  return {
    id: issue.id,
    collectionId: issue.collectionId,
    collectionAreaId: issue.collectionAreaId,
    name: issue.name,
    year: issue.year,
    isAutoCreated: issue.isAutoCreated,
    createdAt: String(issue.createdAt),
    catalogNumbers: issue.catalogNumbers,
    memberCount: issue.members.length,
    requiredCount: issue.completeness.required,
    requiredPriceTotal: null,
    requiredPriceStale: false,
  };
}

/** Build the picked-stamp summary for a just-created stamp from its submitted
 * form data (the new row isn't in the refreshed tree synchronously), mirroring
 * how {@link IssueBrowser}'s handlePick composes labels. */
function buildPickedFromForm(
  areas: CollectionAreaData[],
  areaById: Map<string, CollectionAreaData>,
  issue: IssueData,
  stampId: string,
  fd: FormData
): PickedStamp {
  const vendors = effectiveVendorsForArea(areas, issue.collectionAreaId);
  const vm: VendorMap = new Map(vendors.map((v) => [v.catalogVendorId, v]));
  const cats: string[] = [];
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith("catalogNumber_")) continue;
    const num = String(value).trim();
    if (num) cats.push(formatStampCN(num, vm.get(key.slice("catalogNumber_".length))));
  }
  const name = (fd.get("name") as string | null)?.trim() || null;
  const areaName = areaById.get(issue.collectionAreaId)?.name ?? null;
  const secondary =
    [issue.name || issue.year ? issueLabel(issue.name, issue.year) : null, areaName]
      .filter(Boolean)
      .join(" · ") || null;
  return {
    stampId,
    primary: primaryLabel(cats, name),
    secondary,
    // A just-created stamp has no children yet, so it is never an unknown-variant base.
    unknownVariant: false,
  };
}

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

const NEW_ISSUE_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  padding: "0.5rem 0.875rem",
  background: "var(--color-action-primary)",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const CREATE_LINK_STYLE: React.CSSProperties = {
  background: "none",
  border: "1px dashed var(--color-border-strong)",
  borderRadius: "0.375rem",
  cursor: "pointer",
  color: "var(--color-accent)",
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.3rem 0.6rem",
  whiteSpace: "nowrap",
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
  const [create, setCreate] = useState<CreateState | null>(null);
  const [createError, setCreateError] = useState<string>();
  const [justCreatedIssueId, setJustCreatedIssueId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { invalidatePickerData } = useInvalidateInventory();

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  // Keep the capture-phase Escape handler stable while still reacting to whether a
  // nested create dialog is currently open (synced via effect, not during render).
  const createOpenRef = useRef(false);
  useEffect(() => {
    createOpenRef.current = create !== null;
  }, [create]);

  function closeCreate() {
    if (!isPending) {
      setCreate(null);
      setCreateError(undefined);
    }
  }

  function openCreate(next: CreateState) {
    setCreateError(undefined);
    setCreate(next);
  }

  // This popup nests inside the item-form dialog, and a nested create dialog nests
  // inside this popup — all register document-level Escape handlers. Intercept
  // Escape in the capture phase and stop it so only the topmost surface closes: the
  // create dialog if one is open, otherwise the browser — never the parent form
  // (with its in-progress edits).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        if (createOpenRef.current) {
          setCreate(null);
          setCreateError(undefined);
        } else {
          onClose();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  function handleCreateIssue(newAreaId: string, fd: FormData) {
    startTransition(async () => {
      const result = await createIssueAction(collectionId, newAreaId, fd);
      if (result.status === "success") {
        if (result.issueId) setJustCreatedIssueId(result.issueId);
        setCreate(null);
        setCreateError(undefined);
        invalidatePickerData(collectionId);
      } else if (result.status === "error") {
        setCreateError(result.message);
      }
    });
  }

  function handleCreateStamp(issue: IssueData, issueId: string, fd: FormData) {
    startTransition(async () => {
      const result = await addStampToIssueAction(collectionId, issueId, fd);
      if (result.status === "success" && result.stampId) {
        invalidatePickerData(collectionId);
        // Auto-select the freshly created stamp as the copy's target; `onPick` also
        // closes the browser (matching a normal pick).
        onPick(buildPickedFromForm(areas, areaById, issue, result.stampId, fd));
      } else if (result.status === "error") {
        setCreateError(result.message);
      }
    });
  }

  // The parent item-form dialog panel uses `transform` for centering, which makes
  // it the containing block for `position: fixed` descendants — so an un-portaled
  // popup gets clipped to that dialog's box. Portal to <body> to escape it. The
  // create dialogs are portaled as body-level siblings for the same reason (this
  // popup's own panel is also transform-centered).
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
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
              justCreatedIssueId={justCreatedIssueId}
              onPick={onPick}
              onNewIssue={(a) => openCreate({ kind: "issue", areaId: a })}
              onNewStamp={(issue) => openCreate({ kind: "stamp", issue })}
              onNewVariant={(issue, parentStampId) =>
                openCreate({ kind: "stamp", issue, parentStampId })
              }
            />
          </div>
        </div>
      </DialogShell>

      {/* These dialogs are portaled to <body>, but in the React tree they remain
          descendants of the inventory item <form> (this picker lives inside it). React
          events follow the React tree, not the DOM, so a create dialog's submit would
          bubble to that form and fire its "A stamp must be selected" validation. Contain
          submit here so creating an issue/stamp never triggers the outer copy form. */}
      {create && (
        <div style={{ display: "contents" }} onSubmit={(e) => e.stopPropagation()}>
          {create.kind === "issue" && (
            <IssueDialog
              mode="create"
              areas={areas}
              defaultAreaId={create.areaId ?? undefined}
              isPending={isPending}
              error={createError}
              onClose={closeCreate}
              onSubmit={handleCreateIssue}
            />
          )}

          {create.kind === "stamp" &&
            (() => {
              const { issue, parentStampId } = create;
              const vendors = effectiveVendorsForArea(areas, issue.collectionAreaId);
              const uniqueVendors = Array.from(
                new Map(vendors.map((v) => [v.catalogVendorId, v])).values()
              );
              return (
                <StampFormDialog
                  mode="add"
                  collectionId={collectionId}
                  issues={[toIssueListItem(issue)]}
                  areaVendors={uniqueVendors}
                  prefilledIssueId={issue.id}
                  prefilledParentStampId={parentStampId ?? null}
                  isPending={isPending}
                  error={createError}
                  onClose={closeCreate}
                  onSubmit={(issueId, fd) => handleCreateStamp(issue, issueId, fd)}
                />
              );
            })()}
        </div>
      )}
    </>,
    document.body
  );
}

function IssueBrowser({
  collectionId,
  areas,
  selectedAreaId,
  justCreatedIssueId,
  onPick,
  onNewIssue,
  onNewStamp,
  onNewVariant,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  selectedAreaId: string | null;
  justCreatedIssueId: string | null;
  onPick: (picked: PickedStamp) => void;
  onNewIssue: (areaId: string | null) => void;
  onNewStamp: (issue: IssueData) => void;
  onNewVariant: (issue: IssueData, parentStampId: string) => void;
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
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          gap: "0.5rem",
        }}
      >
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={selectedAreaId ? "Filter issues in this area…" : "Filter issues…"}
          style={{ ...SEARCH_STYLE, flex: 1 }}
          aria-label="Filter issues"
        />
        <button
          type="button"
          onClick={() => onNewIssue(selectedAreaId)}
          style={NEW_ISSUE_BUTTON_STYLE}
        >
          + New issue
        </button>
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
              defaultExpanded={issue.id === justCreatedIssueId}
              onPick={handlePick}
              onNewStamp={() => onNewStamp(issue)}
              onNewVariant={(parentStampId) => onNewVariant(issue, parentStampId)}
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
  defaultExpanded,
  onPick,
  onNewStamp,
  onNewVariant,
}: {
  issue: IssueData;
  areaName: string | null;
  showArea: boolean;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  isLast: boolean;
  defaultExpanded: boolean;
  onPick: (node: StampNodeData, unknownVariant: boolean, issue: IssueData) => void;
  onNewStamp: () => void;
  onNewVariant: (parentStampId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
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
                onNewVariant={onNewVariant}
              />
            ))
          )}
          <div style={{ padding: "0.625rem 1rem 0.75rem 0.5rem" }}>
            <button type="button" onClick={onNewStamp} style={CREATE_LINK_STYLE}>
              + New stamp
            </button>
          </div>
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
  onNewVariant,
}: {
  treeNode: StampTreeNodeData;
  depth: number;
  vendorMap: VendorMap;
  primaryVendorId: string | null;
  isLast: boolean;
  onPick: (node: StampNodeData, unknownVariant: boolean) => void;
  onNewVariant: (parentStampId: string) => void;
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
          {depth === 0 && (
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
          <PickStampNode
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
