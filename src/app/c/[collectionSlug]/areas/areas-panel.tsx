"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import {
  updateCollectionAreaAction,
  deleteCollectionAreaAction,
  reorderCollectionAreasAction,
  type AreaActionState,
} from "@/app/actions/areas";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import type { CatalogNameFlat } from "@/lib/catalog";
import { effectivePrimaryVendorId, effectiveVendorsForArea } from "@/lib/area-vendor";
import {
  resolveEffectiveCatalogPrefix,
  type AreaInheritedValues,
} from "@/lib/area-inheritance";
import {
  AddAreaDialog,
  AREA_FORM_STYLE,
  CollectionAreaForm,
  type AreaFormVendor,
} from "@/app/c/[collectionSlug]/shared/area-form-dialog";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { FormatFactorsDialog } from "@/app/c/[collectionSlug]/shared/use-format-factors-action";
import { useCollapsedSet } from "@/app/c/[collectionSlug]/shared/use-collapsed-set";
import { Icon } from "@/app/icons";

// Persisted collapse state for the area management tree, consistent with the area
// filter tree (#81). Distinct key so the two trees collapse independently (#237).
const COLLAPSE_STORAGE_KEY = "stamporama:area-mgmt-collapsed";

interface AreasPanelProps {
  collectionId: string;
  collectionSlug: string;
  initialAreas: CollectionAreaData[];
  catalogNames: CatalogNameFlat[];
  /** Every vendor in the collection, book or no book (#675) — the *Numbering* section lists them
   * independently of the price sources. */
  catalogVendors: AreaFormVendor[];
  /** Languages needing a translation (#293): the platforms' listing languages minus the
   * collection's default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain `titleName` is written in (#293); labels the field once translations
   * are in play. */
  defaultLanguage: string;
}

type DialogState =
  | { kind: "none" }
  | { kind: "add-area"; defaultParentId?: string }
  | ({ kind: "edit-area"; area: CollectionAreaData } & AreaInheritedValues)
  | { kind: "delete-area"; area: CollectionAreaData }
  | { kind: "format-factors"; area: CollectionAreaData };

interface TreeNode {
  area: CollectionAreaData;
  depth: number;
  effectivePrimaryCatalogNameId: string | null;
  /** The vendor that leads numbering here, own or inherited (#675). */
  effectivePrimaryVendorId: string | null;
  /** The area-level prefix in force here, own or inherited (#675); a per-vendor row may still
   * override it for one vendor, which is what {@link effectivePrefixEntries} reports. */
  effectiveCatalogPrefix: string | null;
  effectivePrefixEntries: AreaCatalogEntry[];
}

function buildFlatTree(areas: CollectionAreaData[]): TreeNode[] {
  const byId = new Map<string, CollectionAreaData>();
  for (const a of areas) byId.set(a.id, a);

  function effectivePrimary(area: CollectionAreaData): string | null {
    let current: CollectionAreaData | undefined = area;
    let depth = 0;
    while (current && depth < 50) {
      if (current.primaryCatalogNameId) return current.primaryCatalogNameId;
      current = current.parentId ? byId.get(current.parentId) : undefined;
      depth++;
    }
    return null;
  }

  function collectChildren(parentId: string | null, depth: number): TreeNode[] {
    const nodes: TreeNode[] = [];
    const children = areas.filter((a) => a.parentId === parentId);
    for (const child of children) {
      nodes.push({
        area: child,
        depth,
        effectivePrimaryCatalogNameId: effectivePrimary(child),
        effectivePrimaryVendorId: effectivePrimaryVendorId(areas, child.id),
        effectiveCatalogPrefix: resolveEffectiveCatalogPrefix(areas, child.id),
        // The shared resolution (#675), not a walk of this file's own — the prefix is catalog
        // identity, so the badges on these rows must agree with every chip drawn elsewhere.
        effectivePrefixEntries: effectiveVendorsForArea(areas, child.id),
      });
      nodes.push(...collectChildren(child.id, depth + 1));
    }
    return nodes;
  }

  return collectChildren(null, 0);
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

const catalogBadgeStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
  // A chip is one token and stays on one line (#691): a prefix broken across two lines inside a
  // single-line row reads as two chips. It never gives up width either — the area name beside it is
  // what yields when a deeply nested row runs out of room, since a shortened name is still the row's
  // identity while half a catalog prefix is nothing.
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const groupingBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  whiteSpace: "nowrap",
};

// ── AreasPanel ────────────────────────────────────────────────────────────────

export function AreasPanel({
  collectionId,
  collectionSlug,
  initialAreas,
  catalogNames,
  catalogVendors,
  titleLanguages,
  defaultLanguage,
}: AreasPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  // The area form can open the translations dialog on top of the area dialog (#293); while it is
  // up the area dialog must not close on Esc / backdrop click.
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);
  const [actionState, setActionState] = useState<AreaActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  const catalogById = useMemo(() => {
    const m = new Map<string, CatalogNameFlat>();
    for (const c of catalogNames) m.set(c.id, c);
    return m;
  }, [catalogNames]);

  const flatTree = useMemo(() => buildFlatTree(initialAreas), [initialAreas]);

  const nodeByAreaId = useMemo(() => {
    const m = new Map<string, TreeNode>();
    for (const node of flatTree) m.set(node.area.id, node);
    return m;
  }, [flatTree]);

  // Ids of areas that have at least one child (only these get an expand/collapse toggle).
  const parentIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of initialAreas) if (a.parentId) set.add(a.parentId);
    return set;
  }, [initialAreas]);

  // Default (nothing stored yet): collapse nested parents, mirroring the filter tree (#81).
  const computeDefaultCollapsed = useCallback(() => {
    const defaults = new Set<string>();
    for (const { area, depth } of flatTree) {
      if (depth > 0 && parentIds.has(area.id)) defaults.add(area.id);
    }
    return defaults;
  }, [flatTree, parentIds]);

  const { collapsed, loaded, toggle } = useCollapsedSet(
    COLLAPSE_STORAGE_KEY,
    computeDefaultCollapsed
  );

  // Hide every descendant of a collapsed node.
  const visibleTree = useMemo(() => {
    const hidden = new Set<string>();
    for (const { area } of flatTree) {
      if (collapsed.has(area.id)) {
        for (const id of getDescendantIds(initialAreas, area.id)) hidden.add(id);
      }
    }
    return flatTree.filter(({ area }) => !hidden.has(area.id));
  }, [flatTree, collapsed, initialAreas]);

  // ── Drag-and-drop reordering within a sibling group (#78) ──────────────────
  const areaById = useMemo(() => {
    const m = new Map<string, CollectionAreaData>();
    for (const a of initialAreas) m.set(a.id, a);
    return m;
  }, [initialAreas]);

  // `dragId` is the area being dragged (drag is armed only from its grip handle so the
  // name link and actions menu still work). `dropTarget` marks the row and edge the
  // indicator line renders on.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragArmedId, setDragArmedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);

  function clearDrag() {
    setDragId(null);
    setDragArmedId(null);
    setDropTarget(null);
  }

  // True when `targetId` is a valid drop for the current drag: a different area under the
  // same parent (reordering is sibling-scoped only).
  function isSiblingDropTarget(targetId: string): boolean {
    if (!dragId || dragId === targetId) return false;
    const dragged = areaById.get(dragId);
    const target = areaById.get(targetId);
    return !!dragged && !!target && dragged.parentId === target.parentId;
  }

  function handleReorderDrop(targetId: string) {
    const dragged = dragId ? areaById.get(dragId) : undefined;
    const target = dropTarget ?? null;
    if (!dragged || !target || !isSiblingDropTarget(targetId) || target.id !== targetId) {
      clearDrag();
      return;
    }

    const siblingIds = initialAreas
      .filter((a) => a.parentId === dragged.parentId)
      .map((a) => a.id);
    const without = siblingIds.filter((id) => id !== dragged.id);
    const targetIdx = without.indexOf(targetId);
    const insertIdx = target.position === "after" ? targetIdx + 1 : targetIdx;
    without.splice(insertIdx, 0, dragged.id);

    // No-op if the order is unchanged.
    if (without.length === siblingIds.length && without.every((id, i) => id === siblingIds[i])) {
      clearDrag();
      return;
    }

    const parentId = dragged.parentId;
    clearDrag();
    startTransition(async () => {
      const result = await reorderCollectionAreasAction(collectionId, parentId, without);
      setActionState(result);
      if (result.status === "success") router.refresh();
    });
  }

  function inheritedValuesFor(parentId: string | undefined | null): AreaInheritedValues {
    if (!parentId) {
      return {
        inheritedPrimaryId: null,
        inheritedPrimaryVendorId: null,
        inheritedCatalogPrefix: null,
        inheritedPrefixes: [],
      };
    }
    const node = nodeByAreaId.get(parentId);
    return {
      inheritedPrimaryId: node?.effectivePrimaryCatalogNameId ?? null,
      inheritedPrimaryVendorId: node?.effectivePrimaryVendorId ?? null,
      inheritedCatalogPrefix: node?.effectiveCatalogPrefix ?? null,
      inheritedPrefixes: node?.effectivePrefixEntries ?? [],
    };
  }

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) {
      setDialog({ kind: "none" });
      setNestedDialogOpen(false);
    }
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    setNestedDialogOpen(false);
    router.refresh();
  }

  function submitAction(
    action: (fd: FormData) => Promise<AreaActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<AreaActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;

  return (
    <>
      <div style={{ marginBottom: "1.5rem" }}>
        <button
          type="button"
          onClick={() => openDialog({ kind: "add-area" })}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--color-action-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          + Add area
        </button>
      </div>

      {flatTree.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No collection areas yet. Add one to get started.
        </p>
      )}

      {flatTree.length > 0 && loaded && (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          {visibleTree.map((node, idx) => {
            const {
              area,
              depth,
              effectivePrimaryCatalogNameId,
              effectivePrimaryVendorId: leadingVendorId,
              effectiveCatalogPrefix,
              effectivePrefixEntries,
            } = node;
            const hasChildren = parentIds.has(area.id);
            const isCollapsed = collapsed.has(area.id);

            // A row reads the whole catalog configuration off the tree (#675): the area prefix, the
            // vendor that leads numbering, the volume a copy is valued from, and the remaining
            // numbering vendors — each marked own or inherited, so a leaf that declares nothing
            // still says where its settings come from without opening the dialog.
            const primaryCatalog = effectivePrimaryCatalogNameId
              ? catalogById.get(effectivePrimaryCatalogNameId)
              : null;
            const isPrimaryInherited =
              primaryCatalog != null &&
              area.primaryCatalogNameId !== effectivePrimaryCatalogNameId;
            const isAreaPrefixInherited = area.catalogPrefix === null;
            // A vendor is this area's own when it declares a row for it or attaches one of its
            // books; otherwise the row came down the tree.
            const declaresVendor = (vendorId: string) =>
              area.vendorEntries.some((v) => v.catalogVendorId === vendorId) ||
              area.catalogEntries.some((e) => e.catalogVendorId === vendorId);

            const leadingVendorEntry = leadingVendorId
              ? (effectivePrefixEntries.find((e) => e.catalogVendorId === leadingVendorId) ?? null)
              : null;
            const isLeadingVendorInherited =
              leadingVendorId != null && area.primaryCatalogVendorId !== leadingVendorId;
            const otherPrefixEntries = effectivePrefixEntries.filter(
              (e) => e.catalogVendorId !== leadingVendorId
            );

            const isDragging = dragId === area.id;
            // Subtle depth shading: the top level sits on the clean elevated surface (white),
            // and each deeper level mixes a bit more neutral gray in, so nesting reads as a gentle
            // fade — scales to any depth (capped). Theme-safe — both surfaces are tokens.
            const shadePct = Math.min(depth, 6) * 22;
            const rowBackground = `color-mix(in srgb, var(--color-bg-muted) ${shadePct}%, var(--color-bg-elevated))`;
            const showDropBefore =
              dropTarget?.id === area.id && dropTarget.position === "before";
            const showDropAfter =
              dropTarget?.id === area.id && dropTarget.position === "after";

            return (
              <div
                key={area.id}
                draggable={dragArmedId === area.id}
                onDragStart={(e) => {
                  setDragId(area.id);
                  e.dataTransfer.effectAllowed = "move";
                  // Firefox requires data to be set for a drag to start.
                  e.dataTransfer.setData("text/plain", area.id);
                }}
                onDragOver={(e) => {
                  if (!isSiblingDropTarget(area.id)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                  setDropTarget((prev) =>
                    prev?.id === area.id && prev.position === position
                      ? prev
                      : { id: area.id, position }
                  );
                }}
                onDragLeave={(e) => {
                  // Ignore leave events bubbling from children still within the row.
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setDropTarget((prev) => (prev?.id === area.id ? null : prev));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleReorderDrop(area.id);
                }}
                onDragEnd={clearDrag}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.75rem 1.25rem",
                  paddingLeft: `${1.25 + depth * 1.5}rem`,
                  background: rowBackground,
                  borderBottom:
                    idx < visibleTree.length - 1 ? "1px solid var(--color-border)" : undefined,
                  opacity: isDragging ? 0.4 : undefined,
                  boxShadow: showDropBefore
                    ? "inset 0 2px 0 0 var(--color-accent)"
                    : showDropAfter
                      ? "inset 0 -2px 0 0 var(--color-accent)"
                      : undefined,
                }}
              >
                {/* Drag handle (#78): arms dragging so the name link and actions menu stay
                    clickable. Grouping and leaf areas both reorder among their siblings. */}
                <button
                  type="button"
                  aria-label={`Drag to reorder ${area.name}`}
                  onMouseDown={() => setDragArmedId(area.id)}
                  onMouseUp={() => setDragArmedId((prev) => (dragId ? prev : null))}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "1rem",
                    flexShrink: 0,
                    background: "none",
                    border: "none",
                    cursor: "grab",
                    color: "var(--color-text-muted)",
                    fontSize: "0.875rem",
                    padding: 0,
                    lineHeight: 1,
                    touchAction: "none",
                  }}
                >
                  <Icon name="dragGrip" size="sm" />
                </button>

                {/* Expand/collapse toggle for nodes with children; a reserved spacer
                    otherwise so every row's name lines up (#237). */}
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(area.id)}
                    aria-label={isCollapsed ? "Expand" : "Collapse"}
                    aria-expanded={!isCollapsed}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "1rem",
                      height: "1rem",
                      flexShrink: 0,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--color-text-muted)",
                      fontSize: "0.625rem",
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    <Icon name={isCollapsed ? "expand" : "collapse"} size="sm" />
                  </button>
                ) : (
                  <span style={{ width: "1rem", flexShrink: 0 }} />
                )}

                <a
                  href={`/c/${collectionSlug}/issues?areaId=${area.id}`}
                  draggable={false}
                  style={{
                    flex: 1,
                    fontSize: "0.9375rem",
                    fontWeight: depth === 0 ? 600 : 500,
                    color: "var(--color-text-primary)",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration: "none",
                  }}
                  onMouseOver={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
                  onMouseOut={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
                >
                  {area.name}
                </a>

                {/* Grouping-only marker (#263): this area organizes children but holds no issues. */}
                {!area.assignable && <span style={groupingBadgeStyle}>Grouping</span>}

                {/* The area prefix in force here (#675) — the one value that used to be typed once
                    per vendor, so it earns its own badge rather than only showing inside them. */}
                {effectiveCatalogPrefix && (
                  <Tooltip
                    content={
                      isAreaPrefixInherited
                        ? "Area prefix (inherited from a parent area)"
                        : "Area prefix — used for every vendor that does not override it"
                    }
                  >
                    <span
                      style={{
                        ...catalogBadgeStyle,
                        fontStyle: isAreaPrefixInherited ? "italic" : undefined,
                      }}
                    >
                      {effectiveCatalogPrefix}
                    </span>
                  </Tooltip>
                )}

                {/* The vendor that leads numbering, and then the rest. */}
                {leadingVendorEntry && (
                  <Tooltip
                    content={
                      isLeadingVendorInherited
                        ? "Leading catalog vendor (inherited)"
                        : "Leading catalog vendor"
                    }
                  >
                    <span
                      style={{
                        ...catalogBadgeStyle,
                        fontStyle: isLeadingVendorInherited ? "italic" : undefined,
                        color: "var(--color-accent)",
                        borderColor: "var(--color-accent)",
                      }}
                    >
                      {leadingVendorEntry.prefix
                        ? `${leadingVendorEntry.vendorAbbreviation}·${leadingVendorEntry.prefix}`
                        : leadingVendorEntry.vendorAbbreviation}
                    </span>
                  </Tooltip>
                )}

                {otherPrefixEntries.length > 0 && (
                  <span style={{ display: "flex", gap: "0.25rem", flexShrink: 0 }}>
                    {otherPrefixEntries.map((entry) => {
                      const isInherited = !declaresVendor(entry.catalogVendorId);
                      return (
                        <Tooltip
                          key={entry.catalogVendorId}
                          content={
                            isInherited
                              ? `${entry.vendorName} — inherited from a parent area`
                              : entry.vendorName
                          }
                        >
                          <span
                            style={{
                              ...catalogBadgeStyle,
                              fontStyle: isInherited ? "italic" : undefined,
                            }}
                          >
                            {entry.prefix
                              ? `${entry.vendorAbbreviation}·${entry.prefix}`
                              : entry.vendorAbbreviation}
                          </span>
                        </Tooltip>
                      );
                    })}
                  </span>
                )}

                {/* The volume a copy here is valued from — a different question from who leads the
                    numbering (#675), so it is a different badge. */}
                {primaryCatalog && (
                  <Tooltip
                    content={
                      isPrimaryInherited
                        ? `Valuing volume (inherited): ${primaryCatalog.vendorName} / ${primaryCatalog.name}`
                        : `Valuing volume: ${primaryCatalog.vendorName} / ${primaryCatalog.name}`
                    }
                  >
                    <span
                      style={{
                        ...catalogBadgeStyle,
                        fontFamily: "inherit",
                        fontStyle: isPrimaryInherited ? "italic" : undefined,
                        // The one chip holding a catalog *name* rather than an abbreviation
                        // ("Deutschland Spezial - Band 1"), so it is the one allowed to take the
                        // room it needs and the one that shrinks when there is none (#691). The
                        // fixed 10rem it used to have cut every long volume name short even on a
                        // row with space to spare; the tooltip still carries the full value.
                        flexShrink: 1,
                        minWidth: "4rem",
                        maxWidth: "24rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {primaryCatalog.name}
                    </span>
                  </Tooltip>
                )}

                {area.stampCount > 0 && (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--color-text-muted)",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {area.stampCount} stamp{area.stampCount !== 1 ? "s" : ""}
                  </span>
                )}

                <RowActionsMenu
                  ariaLabel="Area actions"
                  actions={[
                    {
                      key: "add-sub",
                      label: "Add sub-area",
                      icon: "add",
                      onSelect: () =>
                        openDialog({ kind: "add-area", defaultParentId: area.id }),
                    },
                    {
                      key: "edit",
                      label: "Edit",
                      icon: "edit",
                      onSelect: () =>
                        openDialog({ kind: "edit-area", area, ...inheritedValuesFor(area.parentId) }),
                    },
                    {
                      key: "format-multipliers",
                      label: "Format multipliers…",
                      icon: "factors",
                      onSelect: () => openDialog({ kind: "format-factors", area }),
                    },
                    {
                      key: "delete",
                      label: "Delete",
                      icon: "delete",
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => openDialog({ kind: "delete-area", area }),
                    },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* ── Dialogs ── */}

      {/* Multipliers for the pairs and blocks of this area, edited where the area lives rather
          than picked out of a collection-wide list (Settings keeps that overview). */}
      {dialog.kind === "format-factors" && (
        <FormatFactorsDialog
          collectionId={collectionId}
          scope={{ kind: "area", id: dialog.area.id }}
          scopeLabel={dialog.area.name}
          onClose={closeDialog}
        />
      )}

      {dialog.kind === "add-area" && (
        <AddAreaDialog
          collectionId={collectionId}
          areas={initialAreas}
          defaultParentId={dialog.defaultParentId}
          catalogNames={catalogNames}
          catalogVendors={catalogVendors}
          titleLanguages={titleLanguages}
          defaultLanguage={defaultLanguage}
          onClose={closeDialog}
          onCreated={handleSuccess}
        />
      )}

      {dialog.kind === "edit-area" && (
        <DialogShell title="Edit area" onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form
            style={AREA_FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => updateCollectionAreaAction(dialog.area.id, fd), e)
            }
          >
            <DialogBody>
              <CollectionAreaForm
                defaultName={dialog.area.name}
                defaultParentId={dialog.area.parentId}
                defaultDescription={dialog.area.description}
                defaultTitleName={dialog.area.titleName}
                defaultTitleNameByLanguage={dialog.area.titleNameByLanguage}
                defaultPrimaryCatalogNameId={dialog.area.primaryCatalogNameId}
                defaultPrimaryCatalogVendorId={dialog.area.primaryCatalogVendorId}
                defaultCatalogPrefix={dialog.area.catalogPrefix}
                defaultCatalogEntries={dialog.area.catalogEntries}
                defaultVendorEntries={dialog.area.vendorEntries}
                defaultAssignable={dialog.area.assignable}
                inheritedPrimaryId={dialog.inheritedPrimaryId}
                inheritedPrimaryVendorId={dialog.inheritedPrimaryVendorId}
                inheritedCatalogPrefix={dialog.inheritedCatalogPrefix}
                inheritedPrefixes={dialog.inheritedPrefixes}
                areas={initialAreas}
                currentAreaId={dialog.area.id}
                catalogNames={catalogNames}
                catalogVendors={catalogVendors}
                titleLanguages={titleLanguages}
                defaultLanguage={defaultLanguage}
                onNestedDialogOpenChange={setNestedDialogOpen}
                isPending={isPending}
              />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete-area" && (() => {
        const { area } = dialog;
        const blocked = area.childCount > 0 || area.stampCount > 0;

        let blockMessage = "";
        if (area.childCount > 0 && area.stampCount > 0) {
          blockMessage = `Cannot delete "${area.name}" because it has ${area.childCount} child area${area.childCount !== 1 ? "s" : ""} and ${area.stampCount} assigned stamp${area.stampCount !== 1 ? "s" : ""}. Remove them first.`;
        } else if (area.childCount > 0) {
          blockMessage = `Cannot delete "${area.name}" because it has ${area.childCount} child area${area.childCount !== 1 ? "s" : ""}. Move or delete them first.`;
        } else {
          blockMessage = `Cannot delete "${area.name}" because it has ${area.stampCount} assigned stamp${area.stampCount !== 1 ? "s" : ""}. Unassign them first.`;
        }

        return (
          <DialogShell title="Delete area" onClose={closeDialog}>
            <DialogBody>
              <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.6 }}>
                {blocked ? blockMessage : `Delete area "${area.name}"? This cannot be undone.`}
              </p>
            </DialogBody>
            {blocked ? (
              <div style={{ padding: "1rem 1.5rem", display: "flex", justifyContent: "flex-end" }}>
                <DialogSecondaryButton onClick={closeDialog}>Close</DialogSecondaryButton>
              </div>
            ) : (
              <DialogActions
                actionLabel={isPending ? "Deleting…" : "Delete"}
                variant="destructive"
                onCancel={closeDialog}
                onAction={() => submitDelete(() => deleteCollectionAreaAction(area.id))}
                disabled={isPending}
                error={error}
              />
            )}
          </DialogShell>
        );
      })()}
    </>
  );
}
