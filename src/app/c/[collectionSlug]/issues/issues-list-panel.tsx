"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatIssuedDate, formatIssueCatalogNumber } from "@/app/stamp-display";
import type { IssueCatalogNumberData } from "@/lib/issues";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import {
  createIssueAction,
  updateIssueAction,
  deleteIssueAction,
  addStampToIssueAction,
  removeStampFromIssueAction,
  moveStampNodeAction,
  type IssueActionState,
} from "@/app/actions/issues";
import type { IssueData, StampNodeData } from "@/lib/issues";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import { AddStampDialog } from "@/app/c/[collectionSlug]/areas/[areaId]/add-stamp-dialog";

// ── Styles ──────────────────────────────────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

const rowBtnStyle: React.CSSProperties = {
  padding: "0.25rem 0.625rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  border: "1px solid var(--color-border)",
  borderRadius: "0.3rem",
  cursor: "pointer",
  background: "transparent",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

const rowBtnDangerStyle: React.CSSProperties = {
  ...rowBtnStyle,
  color: "var(--color-error)",
  borderColor: "var(--color-error-border)",
};

const addBtnStyle: React.CSSProperties = {
  ...rowBtnStyle,
  color: "var(--color-text-muted)",
};

const ISSUE_PRIMARY_CHIP: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.8125rem",
  fontWeight: 700,
  color: "var(--color-accent)",
  border: "1.5px solid var(--color-accent)",
  borderRadius: "0.3rem",
  padding: "0.1rem 0.45rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const ISSUE_SECONDARY_CHIP: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.3rem",
  padding: "0.1rem 0.4rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const STAMP_PRIMARY_CHIP: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-accent)",
  border: "1px solid var(--color-accent)",
  borderRadius: "0.25rem",
  padding: "0.05rem 0.35rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
  opacity: 0.85,
};

const STAMP_SECONDARY_CHIP: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.6875rem",
  color: "var(--color-text-muted)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.05rem 0.3rem",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const STAMP_MUTED_PRIMARY_CHIP: React.CSSProperties = {
  ...STAMP_PRIMARY_CHIP,
  color: "var(--color-text-muted)",
  borderColor: "var(--color-border)",
  opacity: 0.7,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatStampCN(number: string, v?: AreaCatalogEntry): string {
  if (!v) return number;
  return v.prefix ? `${v.vendorAbbreviation}·${v.prefix} ${number}` : `${v.vendorAbbreviation} ${number}`;
}

function getDescendantIds(areas: CollectionAreaData[], areaId: string): Set<string> {
  const result = new Set<string>();
  const queue = [areaId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const a of areas) {
      if (a.parentId === id) {
        result.add(a.id);
        queue.push(a.id);
      }
    }
  }
  return result;
}

function effectiveVendorsForArea(
  areas: CollectionAreaData[],
  areaId: string
): AreaCatalogEntry[] {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const result = new Map<string, AreaCatalogEntry>();
  const ancestors: CollectionAreaData[] = [];
  let current = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    ancestors.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  for (const a of ancestors.reverse()) {
    for (const e of a.catalogEntries) {
      result.set(e.catalogVendorId, e);
    }
  }
  return Array.from(result.values());
}

function effectivePrimaryVendorId(
  areas: CollectionAreaData[],
  areaId: string
): string | null {
  const byId = new Map(areas.map((a) => [a.id, a]));
  let current = byId.get(areaId);
  let depth = 0;
  while (current && depth < 50) {
    if (current.primaryCatalogNameId) {
      const entry = effectiveVendorsForArea(areas, areaId).find(
        (e) => e.catalogNameId === current!.primaryCatalogNameId
      );
      return entry?.catalogVendorId ?? null;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth++;
  }
  return null;
}

// ── Stamp tree ───────────────────────────────────────────────────────────────

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
  onAddChild: (parentStampId: string) => void;
  onRemove: (stampId: string) => void;
  onMove: (stampId: string) => void;
}

function StampTreeNode({
  treeNode,
  depth,
  primaryVendorId,
  vendorMap,
  onAddChild,
  onRemove,
  onMove,
}: StampTreeNodeProps) {
  const [collapsed, setCollapsed] = useState(true);
  const { node, children } = treeNode;
  const dateStr = formatIssuedDate(node.issuedDay, node.issuedMonth, node.issuedYear);
  const hasChildren = children.length > 0;
  const indent = `${depth * 1.25}rem`;

  const primaryCN = primaryVendorId
    ? node.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null
    : null;
  const secondaryCNs = node.catalogNumbers.filter(
    (cn) => cn.catalogVendorId !== primaryVendorId
  );

  const notRequired = !node.requiredForCompleteness;

  return (
    <>
      <div
        style={{
          padding: `0.4rem 1rem 0.55rem calc(0.5rem + ${indent})`,
          fontSize: "0.8125rem",
        }}
      >
        {/* Row 1: expand + Date, Name + actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand" : "Collapse"}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: "0.625rem", padding: "0.125rem", flexShrink: 0, lineHeight: 1, width: "0.875rem", textAlign: "center" }}
            >
              {collapsed ? "▶" : "▼"}
            </button>
          ) : (
            <span style={{ width: "0.875rem", flexShrink: 0 }} />
          )}

          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {dateStr && (
              <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>{dateStr}, </span>
            )}
            <span style={{ color: node.name ? "var(--color-text-primary)" : "var(--color-text-muted)", fontStyle: node.name ? undefined : "italic" }}>
              {node.name ?? "(unnamed)"}
            </span>
          </span>

          <button type="button" onClick={() => onAddChild(node.stampId)} style={addBtnStyle}>+ Child</button>
          <button type="button" onClick={() => onMove(node.stampId)} style={rowBtnStyle}>Move</button>
          <button type="button" onClick={() => onRemove(node.stampId)} style={rowBtnDangerStyle}>Remove</button>
        </div>

        {/* Row 2: catalog chips */}
        {(primaryCN || secondaryCNs.length > 0) && (
          <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.15rem", paddingLeft: "1.375rem", flexWrap: "wrap" }}>
            {primaryCN && (
              <span style={notRequired ? STAMP_MUTED_PRIMARY_CHIP : STAMP_PRIMARY_CHIP}>
                {formatStampCN(primaryCN.number, vendorMap.get(primaryCN.catalogVendorId))}
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
      {!collapsed && children.map((child) => (
        <StampTreeNode
          key={child.node.stampId}
          treeNode={child}
          depth={depth + 1}
          primaryVendorId={primaryVendorId}
          vendorMap={vendorMap}
          onAddChild={onAddChild}
          onRemove={onRemove}
          onMove={onMove}
        />
      ))}
    </>
  );
}

// ── Area filter sidebar ──────────────────────────────────────────────────────

interface AreaFilterSidebarProps {
  areas: CollectionAreaData[];
  filterAreaId: string | null;
  collectionSlug: string;
  onNavigate: (areaId: string | null) => void;
}

interface AreaTreeItem {
  area: CollectionAreaData;
  depth: number;
}

function flattenAreaTree(areas: CollectionAreaData[]): AreaTreeItem[] {
  function collect(parentId: string | null, depth: number): AreaTreeItem[] {
    const nodes: AreaTreeItem[] = [];
    for (const a of areas.filter((x) => x.parentId === parentId)) {
      nodes.push({ area: a, depth });
      nodes.push(...collect(a.id, depth + 1));
    }
    return nodes;
  }
  return collect(null, 0);
}

function AreaFilterSidebar({ areas, filterAreaId, onNavigate }: AreaFilterSidebarProps) {
  const flatTree = useMemo(() => flattenAreaTree(areas), [areas]);

  const activeIds = useMemo(() => {
    if (!filterAreaId) return null;
    const desc = getDescendantIds(areas, filterAreaId);
    desc.add(filterAreaId);
    return desc;
  }, [areas, filterAreaId]);

  return (
    <aside style={{ width: "14rem", flexShrink: 0, borderRight: "1px solid var(--color-border)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--color-border)" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Filter by area
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <button
          type="button"
          onClick={() => onNavigate(null)}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "0.5rem 1rem",
            background: !filterAreaId ? "var(--color-bg-subtle)" : "transparent",
            border: "none",
            borderBottom: "1px solid var(--color-border)",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontWeight: !filterAreaId ? 600 : 400,
            color: !filterAreaId ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          }}
        >
          All areas
        </button>

        {flatTree.map(({ area, depth }) => {
          const isSelected = filterAreaId === area.id;
          const isInScope = activeIds ? activeIds.has(area.id) : false;

          return (
            <button
              key={area.id}
              type="button"
              onClick={() => onNavigate(isSelected ? null : area.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "0.4rem 1rem",
                paddingLeft: `${1 + depth * 0.875}rem`,
                background: isSelected ? "var(--color-bg-subtle)" : "transparent",
                border: "none",
                borderBottom: "1px solid var(--color-border)",
                cursor: "pointer",
                fontSize: "0.8125rem",
                fontWeight: isSelected ? 600 : 400,
                color: isSelected
                  ? "var(--color-accent)"
                  : isInScope
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
              }}
            >
              {depth > 0 && <span style={{ color: "var(--color-text-muted)", marginRight: "0.25rem" }}>{"·".repeat(depth)}</span>}
              {area.name}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ── IssueForm ────────────────────────────────────────────────────────────────

interface IssueFormProps {
  vendors: AreaCatalogEntry[];
  primaryVendorId?: string | null;
  defaultName?: string;
  defaultYear?: number;
  defaultCatalogNumbers?: IssueCatalogNumberData[];
  isPending: boolean;
  autoFocusName?: boolean;
}

function IssueForm({ vendors, primaryVendorId, defaultName, defaultYear, defaultCatalogNumbers = [], isPending, autoFocusName }: IssueFormProps) {
  const sortedVendors = useMemo(() => {
    if (!primaryVendorId) return vendors;
    return [...vendors].sort((a, b) => {
      if (a.catalogVendorId === primaryVendorId) return -1;
      if (b.catalogVendorId === primaryVendorId) return 1;
      return 0;
    });
  }, [vendors, primaryVendorId]);

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-issue-name">Name (optional)</LabelWithError>
        <input
          id="f-issue-name"
          name="name"
          type="text"
          defaultValue={defaultName}
          disabled={isPending}
          placeholder="e.g. First Issue"
          style={INPUT_STYLE}
          data-autofocus={autoFocusName || undefined}
        />
      </div>
      <div style={{ marginBottom: sortedVendors.length > 0 ? "1rem" : undefined }}>
        <LabelWithError htmlFor="f-issue-year">Year (optional)</LabelWithError>
        <input id="f-issue-year" name="year" type="number" defaultValue={defaultYear} disabled={isPending} placeholder="e.g. 1860" min={1840} max={2100} style={INPUT_STYLE} />
      </div>
      {sortedVendors.length > 0 && (
        <div>
          <LabelWithError>Catalog numbers</LabelWithError>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {sortedVendors.map((v) => {
              const isPrimary = v.catalogVendorId === primaryVendorId;
              const existing = defaultCatalogNumbers.find((cn) => cn.catalogVendorId === v.catalogVendorId);
              return (
                <div key={v.catalogVendorId}>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.25rem" }}>
                    <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", fontFamily: "monospace", fontWeight: 600 }}>
                      {v.vendorAbbreviation}{v.prefix ? `·${v.prefix}` : ""}
                    </span>
                    {isPrimary && (
                      <span style={{ fontSize: "0.6875rem", color: "var(--color-accent)", border: "1px solid var(--color-accent)", borderRadius: "0.2rem", padding: "0.05rem 0.3rem", fontWeight: 600, lineHeight: 1.5 }}>
                        Primary
                      </span>
                    )}
                  </span>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      name={`issueCatalogFirst_${v.catalogVendorId}`}
                      type="text"
                      defaultValue={existing?.firstNumber ?? ""}
                      disabled={isPending}
                      placeholder="First"
                      style={{ ...INPUT_STYLE, flex: 1 }}
                    />
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.875rem", flexShrink: 0 }}>–</span>
                    <input
                      name={`issueCatalogLast_${v.catalogVendorId}`}
                      type="text"
                      defaultValue={existing?.lastNumber ?? ""}
                      disabled={isPending}
                      placeholder="Last (optional)"
                      style={{ ...INPUT_STYLE, flex: 1 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ── CreateIssueDialog ─────────────────────────────────────────────────────────

interface CreateIssueDialogProps {
  areas: CollectionAreaData[];
  defaultAreaId?: string;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (areaId: string, formData: FormData) => void;
}

function CreateIssueDialog({ areas, defaultAreaId, isPending, error, onClose, onSubmit }: CreateIssueDialogProps) {
  const [selectedAreaId, setSelectedAreaId] = useState(defaultAreaId ?? areas[0]?.id ?? "");

  const vendors = useMemo(
    () => selectedAreaId ? effectiveVendorsForArea(areas, selectedAreaId) : [],
    [areas, selectedAreaId]
  );

  const primaryVendorId = useMemo(
    () => selectedAreaId ? effectivePrimaryVendorId(areas, selectedAreaId) : null,
    [areas, selectedAreaId]
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedAreaId) return;
    onSubmit(selectedAreaId, new FormData(e.currentTarget));
  }

  const flatTree = useMemo(() => flattenAreaTree(areas), [areas]);

  return (
    <DialogShell title="Add issue" onClose={onClose}>
      <form style={FORM_STYLE} onSubmit={handleSubmit}>
        <DialogBody>
          <div style={{ marginBottom: "1rem" }}>
            <LabelWithError htmlFor="f-issue-area">Area</LabelWithError>
            <select
              id="f-issue-area"
              value={selectedAreaId}
              onChange={(e) => setSelectedAreaId(e.target.value)}
              disabled={isPending}
              style={INPUT_STYLE}
            >
              {areas.length === 0 && <option value="">— No areas yet —</option>}
              {flatTree.map(({ area, depth }) => (
                <option key={area.id} value={area.id}>
                  {"  ".repeat(depth)}{area.name}
                </option>
              ))}
            </select>
          </div>
          <IssueForm vendors={vendors} primaryVendorId={primaryVendorId} isPending={isPending} autoFocusName />
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Save"}
          onCancel={onClose}
          disabled={isPending || !selectedAreaId}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

type DialogState =
  | { kind: "none" }
  | { kind: "create-issue" }
  | { kind: "edit-issue"; issue: IssueData }
  | { kind: "delete-issue"; issue: IssueData }
  | { kind: "add-stamp"; issueId?: string; parentStampId?: string; parentCatalogNumbers?: { catalogVendorId: string; number: string }[] }
  | { kind: "move-stamp"; issueId: string; stampId: string };

interface IssuesListPanelProps {
  collectionId: string;
  collectionSlug: string;
  areas: CollectionAreaData[];
  initialIssues: IssueData[];
  filterAreaId: string | null;
}

export function IssuesListPanel({
  collectionId,
  collectionSlug,
  areas,
  initialIssues,
  filterAreaId,
}: IssuesListPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<IssueActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const primaryVendorByArea = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of areas) {
      m.set(a.id, effectivePrimaryVendorId(areas, a.id));
    }
    return m;
  }, [areas]);

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    router.refresh();
  }

  function submitAction(action: (fd: FormData) => Promise<IssueActionState>, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function toggleExpanded(issueId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }

  function handleRemoveStamp(issueId: string, stampId: string) {
    if (!confirm("Remove this stamp from the issue?")) return;
    startTransition(async () => {
      await removeStampFromIssueAction(collectionId, issueId, stampId);
      router.refresh();
    });
  }

  function handleAddStampSubmit(issueId: string, fd: FormData) {
    const newIssueName = fd.get("newIssueName") as string | null;
    const newIssueYear = fd.get("newIssueYear") as string | null;

    startTransition(async () => {
      if (!issueId && (newIssueName !== null || newIssueYear !== null)) {
        setDialog({ kind: "none" });
        router.refresh();
        return;
      }
      if (!issueId) {
        setActionState({ status: "error", message: "Please select or create an issue." });
        return;
      }
      const result = await addStampToIssueAction(collectionId, issueId, fd);
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function handleNavigateFilter(areaId: string | null) {
    if (areaId) {
      router.push(`/c/${collectionSlug}/issues?areaId=${areaId}`);
    } else {
      router.push(`/c/${collectionSlug}/issues`);
    }
  }

  function handleCreateIssueSubmit(areaId: string, fd: FormData) {
    startTransition(async () => {
      const result = await createIssueAction(collectionId, areaId, fd);
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;

  return (
    <div style={{ display: "flex", gap: 0, border: "1px solid var(--color-border)", borderRadius: "0.75rem", overflow: "hidden", minHeight: "24rem" }}>
      {/* ── Area filter sidebar ── */}
      <AreaFilterSidebar
        areas={areas}
        filterAreaId={filterAreaId}
        collectionSlug={collectionSlug}
        onNavigate={handleNavigateFilter}
      />

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Toolbar */}
        <div style={{ display: "flex", gap: "0.75rem", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg-elevated)" }}>
          <button
            type="button"
            onClick={() => openDialog({ kind: "create-issue" })}
            style={{
              padding: "0.4rem 0.875rem",
              background: "var(--color-action-primary)",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            + Add issue
          </button>
          {filterAreaId && areaById.has(filterAreaId) && (
            <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              Filtered by:
              <span style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>
                {areaById.get(filterAreaId)!.name}
              </span>
              <button
                type="button"
                onClick={() => handleNavigateFilter(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: "0.8125rem", padding: "0 0.125rem" }}
                title="Clear filter"
              >
                ✕
              </button>
            </span>
          )}
        </div>

        {/* Issues list */}
        {initialIssues.length === 0 && (
          <div style={{ padding: "2rem", color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            {filterAreaId ? "No issues in this area." : "No issues yet. Add one to get started."}
          </div>
        )}

        {initialIssues.length > 0 && (
          <div style={{ flex: 1 }}>
            {initialIssues.map((issue, idx) => {
              const isExpanded = expandedIds.has(issue.id);
              const stampTree = buildStampTree(issue.members);
              const requiredCount = issue.completeness.required;
              const area = areaById.get(issue.collectionAreaId);
              const primaryVendorId = primaryVendorByArea.get(issue.collectionAreaId) ?? null;
              const isLast = idx === initialIssues.length - 1;

              const areaVendors = area ? effectiveVendorsForArea(areas, area.id) : [];
              const uniqueAreaVendors = Array.from(
                new Map(areaVendors.map((v) => [v.catalogVendorId, v])).values()
              );
              const vendorMap = new Map(uniqueAreaVendors.map((v) => [v.catalogVendorId, v]));

              // Sort catalog numbers: primary first
              const primaryCatEntry = primaryVendorId
                ? issue.catalogNumbers.find((cn) => cn.catalogVendorId === primaryVendorId) ?? null
                : null;
              const secondaryCatEntries = issue.catalogNumbers.filter((cn) => cn.catalogVendorId !== primaryVendorId);

              return (
                <div key={issue.id} style={{ borderBottom: isLast ? undefined : "1px solid var(--color-border)" }}>
                  {/* Issue row — two rows */}
                  <div style={{ padding: "0.875rem 1.25rem", background: "var(--color-bg-elevated)" }}>
                    {/* Row 1: expand + area + year, name + actions */}
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(issue.id)}
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: "0.75rem", padding: "0.25rem", flexShrink: 0, lineHeight: 1 }}
                      >
                        {isExpanded ? "▼" : "▶"}
                      </button>

                      {/* Area chip */}
                      {area && (
                        <button
                          type="button"
                          onClick={() => handleNavigateFilter(area.id)}
                          title={`Filter by ${area.name}`}
                          style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", background: "var(--color-bg-page)", border: "1px solid var(--color-border)", borderRadius: "0.25rem", padding: "0.1rem 0.4rem", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                        >
                          {area.name}
                        </button>
                      )}

                      {/* Year, Name */}
                      <span style={{ flex: 1, fontSize: "0.9375rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {issue.year && (
                          <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>{issue.year}, </span>
                        )}
                        <span style={{ fontWeight: 600, fontStyle: issue.name ? undefined : "italic", color: issue.name ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
                          {issue.name ?? "(unnamed)"}
                        </span>
                      </span>

                      <button type="button" onClick={() => openDialog({ kind: "add-stamp", issueId: issue.id })} style={addBtnStyle}>+ Stamp</button>
                      <button type="button" onClick={() => openDialog({ kind: "edit-issue", issue })} style={rowBtnStyle}>Edit</button>
                      <button type="button" onClick={() => openDialog({ kind: "delete-issue", issue })} style={rowBtnDangerStyle}>Delete</button>
                    </div>

                    {/* Row 2: catalog chips + count badge */}
                    {(issue.catalogNumbers.length > 0 || issue.members.length > 0) && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", paddingLeft: "1.75rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
                        {primaryCatEntry && primaryVendorId && (() => {
                          const v = vendorMap.get(primaryVendorId);
                          return (
                            <span style={ISSUE_PRIMARY_CHIP}>
                              {formatIssueCatalogNumber(primaryCatEntry.firstNumber, primaryCatEntry.lastNumber, v?.vendorAbbreviation ?? "", v?.prefix)}
                            </span>
                          );
                        })()}
                        {secondaryCatEntries.map((cn) => {
                          const v = vendorMap.get(cn.catalogVendorId);
                          return (
                            <span key={cn.catalogVendorId} style={ISSUE_SECONDARY_CHIP}>
                              {formatIssueCatalogNumber(cn.firstNumber, cn.lastNumber, v?.vendorAbbreviation ?? "", v?.prefix)}
                            </span>
                          );
                        })}

                        {issue.members.length > 0 && (
                          <span
                            style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "var(--color-text-muted)", background: "var(--color-bg-muted)", border: "1px solid var(--color-border)", borderRadius: "0.25rem", padding: "0.1rem 0.4rem", flexShrink: 0, whiteSpace: "nowrap" }}
                            title="Required / Total stamps"
                          >
                            {requiredCount}/{issue.members.length}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expanded stamp tree */}
                  {isExpanded && (
                    <div style={{ background: "var(--color-bg-elevated)", borderTop: "1px solid var(--color-border)", marginLeft: "1.25rem", borderLeft: "2px solid var(--color-border)" }}>
                      {stampTree.length === 0 ? (
                        <div style={{ padding: "0.875rem 0 0.875rem 0.5rem", fontSize: "0.875rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>
                          No stamps in this issue yet.{" "}
                          <button type="button" onClick={() => openDialog({ kind: "add-stamp", issueId: issue.id })} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-accent)", fontSize: "inherit", padding: 0 }}>Add one</button>
                        </div>
                      ) : (
                        stampTree.map((treeNode) => (
                          <StampTreeNode
                            key={treeNode.node.stampId}
                            treeNode={treeNode}
                            depth={0}
                            primaryVendorId={primaryVendorId}
                            vendorMap={vendorMap}
                            onAddChild={(parentStampId) => {
                              const parentNode = issue.members.find((m) => m.stampId === parentStampId);
                              openDialog({
                                kind: "add-stamp",
                                issueId: issue.id,
                                parentStampId,
                                parentCatalogNumbers: parentNode?.catalogNumbers ?? [],
                              });
                            }}
                            onRemove={(stampId) => handleRemoveStamp(issue.id, stampId)}
                            onMove={(stampId) => openDialog({ kind: "move-stamp", issueId: issue.id, stampId })}
                          />
                        ))
                      )}
                    </div>
                  )}

                  {/* add-stamp dialog contextual to this issue */}
                  {dialog.kind === "add-stamp" && dialog.issueId === issue.id && (
                    <AddStampDialog
                      issues={[issue]}
                      areaVendors={uniqueAreaVendors}
                      prefilledIssueId={issue.id}
                      prefilledParentStampId={dialog.parentStampId}
                      defaultCatalogNumbers={dialog.parentCatalogNumbers}
                      isPending={isPending}
                      error={error}
                      onClose={closeDialog}
                      onSubmit={handleAddStampSubmit}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* add-stamp dialog when no issueId (global) */}
        {dialog.kind === "add-stamp" && !dialog.issueId && (
          <AddStampDialog
            issues={initialIssues}
            areaVendors={[]}
            isPending={isPending}
            error={error}
            onClose={closeDialog}
            onSubmit={handleAddStampSubmit}
          />
        )}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "create-issue" && (
        <CreateIssueDialog
          areas={areas}
          defaultAreaId={filterAreaId ?? undefined}
          isPending={isPending}
          error={error}
          onClose={closeDialog}
          onSubmit={handleCreateIssueSubmit}
        />
      )}

      {dialog.kind === "edit-issue" && (() => {
        const { issue } = dialog;
        const vendors = effectiveVendorsForArea(areas, issue.collectionAreaId);
        const primaryVendorId = effectivePrimaryVendorId(areas, issue.collectionAreaId);
        return (
          <DialogShell title="Edit issue" onClose={closeDialog}>
            <form
              style={FORM_STYLE}
              onSubmit={(e) => submitAction((fd) => updateIssueAction(collectionId, issue.id, fd), e)}
            >
              <DialogBody>
                <IssueForm
                  vendors={vendors}
                  primaryVendorId={primaryVendorId}
                  defaultName={issue.name ?? ""}
                  defaultYear={issue.year ?? undefined}
                  defaultCatalogNumbers={issue.catalogNumbers}
                  isPending={isPending}
                />
              </DialogBody>
              <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
            </form>
          </DialogShell>
        );
      })()}

      {dialog.kind === "delete-issue" && (() => {
        const { issue } = dialog;
        const memberCount = issue.members.length;
        return (
          <DialogShell title="Delete issue" onClose={closeDialog}>
            <DialogBody>
              <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.6 }}>
                Delete issue <strong>{issue.name ?? "(unnamed)"}</strong>?
                {memberCount > 0 && <>{" "}This will also remove all <strong>{memberCount} stamp member{memberCount !== 1 ? "s" : ""}</strong> from this issue.</>}{" "}
                This cannot be undone.
              </p>
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Deleting…" : "Delete"}
              variant="destructive"
              onCancel={closeDialog}
              onAction={() => {
                startTransition(async () => {
                  const result = await deleteIssueAction(collectionId, issue.id);
                  setActionState(result);
                  if (result.status === "success") handleSuccess();
                });
              }}
              disabled={isPending}
              error={error}
            />
          </DialogShell>
        );
      })()}

      {dialog.kind === "move-stamp" && (() => {
        const { issueId, stampId } = dialog;
        const otherIssues = initialIssues.filter((i) => i.id !== issueId && i.collectionAreaId === initialIssues.find((x) => x.id === issueId)?.collectionAreaId);
        return (
          <DialogShell title="Move stamp to issue" onClose={closeDialog}>
            <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => moveStampNodeAction(collectionId, issueId, stampId, fd), e)}>
              <DialogBody>
                {otherIssues.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>No other issues in this area to move to.</p>
                ) : (
                  <div>
                    <LabelWithError htmlFor="f-move-issue">Target issue</LabelWithError>
                    <select id="f-move-issue" name="targetIssueId" style={INPUT_STYLE} disabled={isPending}>
                      {otherIssues.map((i) => (
                        <option key={i.id} value={i.id}>{i.name ?? "(unnamed)"}{i.year ? ` (${i.year})` : ""}</option>
                      ))}
                    </select>
                    <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>Child stamps will move with this node.</p>
                  </div>
                )}
              </DialogBody>
              {otherIssues.length === 0 ? (
                <div style={{ padding: "1rem 1.5rem", display: "flex", justifyContent: "flex-end" }}>
                  <DialogSecondaryButton onClick={closeDialog}>Close</DialogSecondaryButton>
                </div>
              ) : (
                <DialogActions actionLabel={isPending ? "Moving…" : "Move"} onCancel={closeDialog} disabled={isPending} error={error} />
              )}
            </form>
          </DialogShell>
        );
      })()}
    </div>
  );
}
