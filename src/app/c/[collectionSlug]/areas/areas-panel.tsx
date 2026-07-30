"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import {
  createCollectionAreaAction,
  updateCollectionAreaAction,
  deleteCollectionAreaAction,
  reorderCollectionAreasAction,
  type AreaActionState,
} from "@/app/actions/areas";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import { languageLabel } from "@/lib/languages";
import {
  fillTranslationValues,
  type TranslationField,
  type TranslationValues,
} from "@/app/c/[collectionSlug]/shared/translations-dialog";
import { TranslationsField } from "@/app/c/[collectionSlug]/shared/translations-field";
import type { CatalogNameFlat } from "@/lib/catalog";
import { AreaTreeSelect, buildAreaTree } from "@/app/area-tree-select";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { FormatFactorsDialog } from "@/app/c/[collectionSlug]/shared/use-format-factors-action";
import { useCollapsedSet } from "@/app/c/[collectionSlug]/shared/use-collapsed-set";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";

// Persisted collapse state for the area management tree, consistent with the area
// filter tree (#81). Distinct key so the two trees collapse independently (#237).
const COLLAPSE_STORAGE_KEY = "stamporama:area-mgmt-collapsed";

interface AreasPanelProps {
  collectionId: string;
  collectionSlug: string;
  initialAreas: CollectionAreaData[];
  catalogNames: CatalogNameFlat[];
  /** Languages needing a translation (#293): the platforms' listing languages minus the
   * collection's default language. Empty means no translation UI at all. */
  titleLanguages: string[];
  /** The language the plain `titleName` is written in (#293); labels the field once translations
   * are in play. */
  defaultLanguage: string;
}

type DialogState =
  | { kind: "none" }
  | { kind: "add-area"; defaultParentId?: string; inheritedPrimaryId: string | null; inheritedPrefixes: AreaCatalogEntry[] }
  | { kind: "edit-area"; area: CollectionAreaData; inheritedPrimaryId: string | null; inheritedPrefixes: AreaCatalogEntry[] }
  | { kind: "delete-area"; area: CollectionAreaData }
  | { kind: "format-factors"; area: CollectionAreaData };

interface TreeNode {
  area: CollectionAreaData;
  depth: number;
  effectivePrimaryCatalogNameId: string | null;
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

  // Effective prefix for a catalog in an area: own entry if present, else walk up parent chain
  function effectivePrefixes(area: CollectionAreaData): AreaCatalogEntry[] {
    // Collect all unique catalog IDs up the tree, own entries override parent entries
    const result = new Map<string, AreaCatalogEntry>();
    const ancestors: CollectionAreaData[] = [];
    let current: CollectionAreaData | undefined = area;
    let d = 0;
    while (current && d < 50) {
      ancestors.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
      d++;
    }
    // Apply from root down so own entries override; dedup by vendor so child vendor prefix wins
    for (const a of ancestors.reverse()) {
      for (const e of a.catalogEntries) {
        result.set(e.catalogVendorId, e);
      }
    }
    return Array.from(result.values());
  }

  function collectChildren(parentId: string | null, depth: number): TreeNode[] {
    const nodes: TreeNode[] = [];
    const children = areas.filter((a) => a.parentId === parentId);
    for (const child of children) {
      nodes.push({
        area: child,
        depth,
        effectivePrimaryCatalogNameId: effectivePrimary(child),
        effectivePrefixEntries: effectivePrefixes(child),
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

// ── Shared styles ────────────────────────────────────────────────────────────

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

const addBtnStyle: React.CSSProperties = {
  padding: "0.25rem 0.625rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  border: "1px solid var(--color-border)",
  borderRadius: "0.3rem",
  cursor: "pointer",
  background: "transparent",
  color: "var(--color-text-muted)",
  whiteSpace: "nowrap",
};

const catalogBadgeStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};

/** The area's one translatable field (#293). `defaultValue` is filled in at render time from the
 * live default-language input, so the dialog's placeholders show what a blank entry falls back to. */
const TITLE_NAME_FIELDS: TranslationField[] = [{ key: "titleName", label: "Title name" }];

const groupingBadgeStyle: React.CSSProperties = {
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

// ── CollectionAreaForm ────────────────────────────────────────────────────────

interface EntryState {
  catalogNameId: string;
  prefix: string;
}

interface CollectionAreaFormProps {
  defaultName?: string;
  defaultParentId?: string | null;
  defaultDescription?: string | null;
  defaultTitleName?: string | null;
  defaultTitleNameByLanguage?: Record<string, string>;
  defaultPrimaryCatalogNameId?: string | null;
  defaultCatalogEntries?: AreaCatalogEntry[];
  defaultAssignable?: boolean;
  inheritedPrimaryId: string | null;
  inheritedPrefixes: AreaCatalogEntry[];
  areas: CollectionAreaData[];
  currentAreaId?: string;
  catalogNames: CatalogNameFlat[];
  /** Languages needing a translation (#293); edited in the translations dialog opened from
   * this form. */
  titleLanguages: string[];
  /** The language the plain `titleName` field holds (#293). */
  defaultLanguage: string;
  /** Told when the nested translations dialog opens/closes, so the enclosing dialog can stop
   * dismissing itself on Esc / backdrop click while it is up. */
  onNestedDialogOpenChange?: (open: boolean) => void;
  isPending: boolean;
}

function CollectionAreaForm({
  defaultName,
  defaultParentId,
  defaultDescription,
  defaultTitleName,
  defaultTitleNameByLanguage,
  defaultPrimaryCatalogNameId,
  defaultCatalogEntries,
  defaultAssignable = true,
  inheritedPrimaryId,
  inheritedPrefixes,
  areas,
  currentAreaId,
  catalogNames,
  titleLanguages,
  defaultLanguage,
  onNestedDialogOpenChange,
  isPending,
}: CollectionAreaFormProps) {
  const catalogById = useMemo(() => {
    const m = new Map<string, CatalogNameFlat>();
    for (const c of catalogNames) m.set(c.id, c);
    return m;
  }, [catalogNames]);

  const excludedIds = useMemo(
    () => (currentAreaId ? getDescendantIds(areas, currentAreaId) : new Set<string>()),
    [areas, currentAreaId]
  );

  const selectableAreas = useMemo(
    () => areas.filter((a) => a.id !== currentAreaId && !excludedIds.has(a.id)),
    [areas, currentAreaId, excludedIds]
  );

  const selectableTree = useMemo(() => buildAreaTree(selectableAreas), [selectableAreas]);

  const [parentId, setParentId] = useState(defaultParentId ?? "");

  // Name and title name (#210) are edited together: the title name mirrors the name while the two
  // are equal (the common case — every area's title defaults to its own name), and stops mirroring
  // once the user gives the title name its own value. So renaming an area keeps its title in sync
  // unless it was deliberately customised or cleared (cleared = roll up to a parent).
  const [name, setName] = useState(defaultName ?? "");
  const [titleName, setTitleName] = useState(defaultTitleName ?? "");
  function handleNameChange(next: string) {
    setTitleName((tn) => (tn === name ? next : tn));
    setName(next);
  }

  // Per-language title names (#293) are edited in the shared translations dialog rather than as a
  // field per language on this form, which would grow it without bound as languages are added.
  // They are held here and submitted through hidden `titleName:<lang>` inputs, so the existing
  // form-data save path is unchanged. Unlike the default title name they never mirror `name` — a
  // translation is only ever typed deliberately, and a blank one falls back to the default.
  const [translations, setTranslations] = useState<TranslationValues>(() =>
    fillTranslationValues(titleLanguages, TITLE_NAME_FIELDS, {
      titleName: defaultTitleNameByLanguage,
    })
  );

  const [entries, setEntries] = useState<EntryState[]>(
    (defaultCatalogEntries ?? []).map((e) => ({
      catalogNameId: e.catalogNameId,
      prefix: e.prefix ?? "",
    }))
  );

  const [addCatalogId, setAddCatalogId] = useState("");

  const usedIds = new Set(entries.map((e) => e.catalogNameId));
  const availableCatalogs = catalogNames.filter((cn) => !usedIds.has(cn.id));

  function addEntry() {
    const id = addCatalogId || availableCatalogs[0]?.id;
    if (!id || usedIds.has(id)) return;
    setEntries([...entries, { catalogNameId: id, prefix: "" }]);
    setAddCatalogId("");
  }

  function removeEntry(catalogNameId: string) {
    setEntries(entries.filter((e) => e.catalogNameId !== catalogNameId));
  }

  function updatePrefix(catalogNameId: string, prefix: string) {
    setEntries(entries.map((e) => (e.catalogNameId === catalogNameId ? { ...e, prefix } : e)));
  }

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-area-name">Name</LabelWithError>
        <input
          id="f-area-name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          disabled={isPending}
          placeholder="e.g. Germany"
          style={INPUT_STYLE}
          required
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-area-parent-button">Parent area</LabelWithError>
        <AreaTreeSelect
          areas={selectableAreas}
          areaTree={selectableTree}
          name="parentId"
          selectedId={parentId}
          onSelectedIdChange={setParentId}
          disabled={isPending}
          noneOptionLabel="— None (top-level)"
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-area-description">Description (optional)</LabelWithError>
        <textarea
          id="f-area-description"
          name="description"
          rows={3}
          defaultValue={defaultDescription ?? ""}
          disabled={isPending}
          style={{ ...INPUT_STYLE, resize: "vertical", minHeight: "4.5rem" }}
        />
      </div>

      {/* Title name (#210): the name to use for this area in auto-generated listing titles. Blank
          rolls up to the nearest ancestor that sets one, else the area's own name — so internal
          grouping levels can defer to a public parent. */}
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-area-title-name">
          {titleLanguages.length > 0
            ? `Title name — ${languageLabel(defaultLanguage)} (optional)`
            : "Title name (optional)"}
        </LabelWithError>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            id="f-area-title-name"
            name="titleName"
            type="text"
            value={titleName}
            onChange={(e) => setTitleName(e.target.value)}
            disabled={isPending}
            placeholder="e.g. Poland"
            style={INPUT_STYLE}
          />
          {/* Per-language title names (#293) live behind the shared translations dialog, opened
              from this icon so the form keeps one field however many languages are in use. Only
              rendered once a platform has a listing language. The badge counts languages still
              missing a translation. Values ride along as hidden inputs; a cleared one submits
              blank, which drops that language's translation. */}
          {titleLanguages.length > 0 && (
            <TranslationsField
              dialogTitle="Title name translations"
              description={`The title name each language's platforms use for this area. Leave one blank to fall back to the ${languageLabel(defaultLanguage)} title name above. They are saved together with the area.`}
              languages={titleLanguages}
              fields={[
                { ...TITLE_NAME_FIELDS[0], defaultValue: titleName || name },
              ]}
              values={translations}
              onChange={setTranslations}
              onOpenChange={onNestedDialogOpenChange}
              ariaLabel="Edit title name translations"
              disabled={isPending}
            />
          )}
        </div>
        <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
          Used for the <code>{"{area}"}</code> token in listing titles. Defaults to (and stays in sync
          with) this area&apos;s name. <strong>Clear it</strong> to roll this area up to the nearest
          parent that has a title name — handy for internal grouping levels.
          {titleLanguages.length > 0 && (
            <> Translations (🌐) are saved together with the area.</>
          )}
        </p>
      </div>

      {/* Grouping-only areas (#263): organize children but can't receive issues directly. */}
      <div style={{ marginBottom: "1rem" }}>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            fontSize: "0.875rem",
            color: "var(--color-text-primary)",
            cursor: isPending ? "not-allowed" : "pointer",
          }}
        >
          {/* An unchecked checkbox submits nothing, so the action reads `assignable` as
              false when off and "true" when on — no hidden companion field. */}
          <input
            type="checkbox"
            name="assignable"
            value="true"
            defaultChecked={defaultAssignable}
            disabled={isPending}
            style={{ marginTop: "0.2rem" }}
          />
          <span>
            Can hold issues
            <span
              style={{
                display: "block",
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Leave unchecked for a grouping-only area (e.g. &ldquo;Europe&rdquo;) that just
              organizes the areas inside it. Catalog settings still pass down to children.
            </span>
          </span>
        </label>
      </div>

      {catalogNames.length > 0 && (
        <>
          <div style={{ marginBottom: "1rem" }}>
            <LabelWithError htmlFor="f-area-primary-catalog">
              Primary catalog
            </LabelWithError>
            <select
              id="f-area-primary-catalog"
              name="primaryCatalogNameId"
              defaultValue={defaultPrimaryCatalogNameId ?? ""}
              disabled={isPending}
              style={INPUT_STYLE}
            >
              <option value="">
                {inheritedPrimaryId
                  ? "— None (inherit from parent)"
                  : "— Select a catalog —"}
              </option>
              {catalogNames.map((cn) => (
                <option key={cn.id} value={cn.id}>
                  {cn.vendorName} / {cn.name}
                </option>
              ))}
            </select>
            {inheritedPrimaryId && !defaultPrimaryCatalogNameId && (() => {
              const inh = catalogById.get(inheritedPrimaryId);
              return inh ? (
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>
                  Inherits: {inh.vendorName} / {inh.name}
                </p>
              ) : null;
            })()}
            {!inheritedPrimaryId && !defaultPrimaryCatalogNameId && (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                Required for top-level areas (or set on a parent area).
              </p>
            )}
          </div>

          <div>
            <LabelWithError>Catalog number prefixes</LabelWithError>

            {/* Inherited prefix entries (read-only, not overridden by own) */}
            {inheritedPrefixes.filter((ip) => !usedIds.has(ip.catalogNameId)).map((ip) => (
              <div
                key={ip.catalogNameId}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem", opacity: 0.6 }}
              >
                <span style={{ flex: 1, fontSize: "0.875rem", color: "var(--color-text-secondary)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ip.vendorName} / {ip.catalogName}
                  <span style={{ marginLeft: "0.375rem", fontSize: "0.75rem" }}>(inherited)</span>
                </span>
                <span style={{ width: "6rem", flex: "none", padding: "0.375rem 0.5rem", fontSize: "0.875rem", fontFamily: "monospace", color: "var(--color-text-muted)" }}>
                  {ip.prefix ?? "—"}
                </span>
                <span style={{ width: "1.5rem", flexShrink: 0 }} />
              </div>
            ))}

            {/* Own prefix entries */}
            {entries.length > 0 && (
              <div style={{ marginBottom: "0.5rem" }}>
                {entries.map((entry) => {
                  const cn = catalogById.get(entry.catalogNameId);
                  return (
                    <div
                      key={entry.catalogNameId}
                      style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}
                    >
                      <span
                        style={{ flex: 1, fontSize: "0.875rem", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {cn ? `${cn.vendorName} / ${cn.name}` : entry.catalogNameId}
                      </span>
                      <input
                        type="text"
                        value={entry.prefix}
                        onChange={(e) => updatePrefix(entry.catalogNameId, e.target.value)}
                        disabled={isPending}
                        placeholder="prefix"
                        {...NO_AUTOFILL}
                        style={{ ...INPUT_STYLE, width: "6rem", flex: "none", padding: "0.375rem 0.5rem", minHeight: "2rem", fontFamily: "monospace" }}
                      />
                      <button
                        type="button"
                        onClick={() => removeEntry(entry.catalogNameId)}
                        disabled={isPending}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-error)", fontSize: "0.875rem", padding: "0.25rem", lineHeight: 1 }}
                        aria-label="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {availableCatalogs.length > 0 && (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <select
                  value={addCatalogId}
                  onChange={(e) => setAddCatalogId(e.target.value)}
                  disabled={isPending}
                  style={{ ...INPUT_STYLE, flex: 1, minHeight: "2rem", padding: "0.375rem 0.5rem" }}
                >
                  <option value="">— Select catalog —</option>
                  {availableCatalogs.map((cn) => (
                    <option key={cn.id} value={cn.id}>
                      {cn.vendorName} / {cn.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addEntry}
                  disabled={isPending || !addCatalogId}
                  style={addBtnStyle}
                >
                  + Add
                </button>
              </div>
            )}

            <input
              type="hidden"
              name="catalogEntries"
              value={JSON.stringify(
                entries.map((e) => ({ catalogNameId: e.catalogNameId, prefix: e.prefix || null }))
              )}
            />
          </div>
        </>
      )}
    </>
  );
}

// ── AreasPanel ────────────────────────────────────────────────────────────────

export function AreasPanel({
  collectionId,
  collectionSlug,
  initialAreas,
  catalogNames,
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

  function inheritedValuesFor(parentId: string | undefined | null): { inheritedPrimaryId: string | null; inheritedPrefixes: AreaCatalogEntry[] } {
    if (!parentId) return { inheritedPrimaryId: null, inheritedPrefixes: [] };
    const node = nodeByAreaId.get(parentId);
    return {
      inheritedPrimaryId: node?.effectivePrimaryCatalogNameId ?? null,
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
          onClick={() => openDialog({ kind: "add-area", inheritedPrimaryId: null, inheritedPrefixes: [] })}
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
          {visibleTree.map(({ area, depth, effectivePrimaryCatalogNameId, effectivePrefixEntries }, idx) => {
            const hasChildren = parentIds.has(area.id);
            const isCollapsed = collapsed.has(area.id);
            const primaryCatalog = effectivePrimaryCatalogNameId
              ? catalogById.get(effectivePrimaryCatalogNameId)
              : null;
            const isPrimaryInherited =
              primaryCatalog !== null &&
              area.primaryCatalogNameId !== effectivePrimaryCatalogNameId;

            // Find the effective prefix for the primary catalog
            const primaryPrefix = effectivePrefixEntries.find(
              (e) => e.catalogNameId === effectivePrimaryCatalogNameId
            )?.prefix ?? null;

            // Other prefix entries besides the primary
            const otherPrefixEntries = effectivePrefixEntries.filter(
              (e) => e.catalogNameId !== effectivePrimaryCatalogNameId
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
                  ⠿
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
                    {isCollapsed ? "▶" : "▼"}
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

                {/* Primary catalog badge */}
                {primaryCatalog && (
                  <Tooltip
                    content={isPrimaryInherited ? "Primary catalog (inherited)" : "Primary catalog"}
                  >
                    <span
                      style={{
                        ...catalogBadgeStyle,
                        fontStyle: isPrimaryInherited ? "italic" : undefined,
                        color: "var(--color-accent)",
                        borderColor: "var(--color-accent)",
                      }}
                    >
                      {(() => {
                        const abbr = primaryCatalog.vendorAbbreviation;
                        return primaryPrefix ? `${abbr}·${primaryPrefix}` : abbr;
                      })()}
                    </span>
                  </Tooltip>
                )}

                {/* Other prefix entry badges */}
                {otherPrefixEntries.length > 0 && (
                  <span style={{ display: "flex", gap: "0.25rem" }}>
                    {otherPrefixEntries.map((entry) => {
                      const cn = catalogById.get(entry.catalogNameId);
                      const abbr = cn ? cn.vendorAbbreviation : entry.vendorName;
                      const isInherited = !area.catalogEntries.some(
                        (e) => e.catalogNameId === entry.catalogNameId
                      );
                      return (
                        <Tooltip
                          key={entry.catalogNameId}
                          content={isInherited ? "Inherited from parent" : undefined}
                        >
                          <span
                            style={{
                              ...catalogBadgeStyle,
                              fontStyle: isInherited ? "italic" : undefined,
                            }}
                          >
                            {entry.prefix ? `${abbr}·${entry.prefix}` : abbr}
                          </span>
                        </Tooltip>
                      );
                    })}
                  </span>
                )}

                {area.stampCount > 0 && (
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                    {area.stampCount} stamp{area.stampCount !== 1 ? "s" : ""}
                  </span>
                )}

                <RowActionsMenu
                  ariaLabel="Area actions"
                  actions={[
                    {
                      key: "add-sub",
                      label: "Add sub-area",
                      icon: "＋",
                      onSelect: () =>
                        openDialog({ kind: "add-area", defaultParentId: area.id, ...inheritedValuesFor(area.id) }),
                    },
                    {
                      key: "edit",
                      label: "Edit",
                      icon: "✎",
                      onSelect: () =>
                        openDialog({ kind: "edit-area", area, ...inheritedValuesFor(area.parentId) }),
                    },
                    {
                      key: "format-multipliers",
                      label: "Format multipliers…",
                      icon: "×",
                      onSelect: () => openDialog({ kind: "format-factors", area }),
                    },
                    {
                      key: "delete",
                      label: "Delete",
                      icon: "✕",
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
        <DialogShell title="Add area" onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => createCollectionAreaAction(collectionId, fd), e)
            }
          >
            <DialogBody>
              <CollectionAreaForm
                defaultParentId={dialog.defaultParentId}
                inheritedPrimaryId={dialog.inheritedPrimaryId}
                inheritedPrefixes={dialog.inheritedPrefixes}
                areas={initialAreas}
                catalogNames={catalogNames}
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

      {dialog.kind === "edit-area" && (
        <DialogShell title="Edit area" onClose={closeDialog} dismissable={!nestedDialogOpen}>
          <form
            style={FORM_STYLE}
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
                defaultCatalogEntries={dialog.area.catalogEntries}
                defaultAssignable={dialog.area.assignable}
                inheritedPrimaryId={dialog.inheritedPrimaryId}
                inheritedPrefixes={dialog.inheritedPrefixes}
                areas={initialAreas}
                currentAreaId={dialog.area.id}
                catalogNames={catalogNames}
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
