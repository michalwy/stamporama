"use client";

import { useMemo, useState, useTransition } from "react";
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
  type AreaActionState,
} from "@/app/actions/areas";
import type { CollectionAreaData, AreaCatalogEntry } from "@/lib/areas";
import type { CatalogNameFlat } from "@/lib/catalog";
import { AreaTreeSelect, buildAreaTree } from "@/app/area-tree-select";

interface AreasPanelProps {
  collectionId: string;
  initialAreas: CollectionAreaData[];
  catalogNames: CatalogNameFlat[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add-area"; defaultParentId?: string; inheritedPrimaryId: string | null; inheritedPrefixes: AreaCatalogEntry[] }
  | { kind: "edit-area"; area: CollectionAreaData; inheritedPrimaryId: string | null; inheritedPrefixes: AreaCatalogEntry[] }
  | { kind: "delete-area"; area: CollectionAreaData };

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
    // Apply from root down so own entries override
    for (const a of ancestors.reverse()) {
      for (const e of a.catalogEntries) {
        result.set(e.catalogNameId, e);
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

// ── CollectionAreaForm ────────────────────────────────────────────────────────

interface EntryState {
  catalogNameId: string;
  prefix: string;
}

interface CollectionAreaFormProps {
  defaultName?: string;
  defaultParentId?: string | null;
  defaultDescription?: string | null;
  defaultPrimaryCatalogNameId?: string | null;
  defaultCatalogEntries?: AreaCatalogEntry[];
  inheritedPrimaryId: string | null;
  inheritedPrefixes: AreaCatalogEntry[];
  areas: CollectionAreaData[];
  currentAreaId?: string;
  catalogNames: CatalogNameFlat[];
  isPending: boolean;
}

function CollectionAreaForm({
  defaultName,
  defaultParentId,
  defaultDescription,
  defaultPrimaryCatalogNameId,
  defaultCatalogEntries,
  inheritedPrimaryId,
  inheritedPrefixes,
  areas,
  currentAreaId,
  catalogNames,
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
          defaultValue={defaultName}
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

      {catalogNames.length > 0 && (
        <>
          <div style={{ marginBottom: "1rem" }}>
            <LabelWithError htmlFor="f-area-primary-catalog">
              Primary catalog (optional)
            </LabelWithError>
            <select
              id="f-area-primary-catalog"
              name="primaryCatalogNameId"
              defaultValue={defaultPrimaryCatalogNameId ?? ""}
              disabled={isPending}
              style={INPUT_STYLE}
            >
              <option value="">— None (inherit from parent)</option>
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
  initialAreas,
  catalogNames,
}: AreasPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
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
    if (!isPending) setDialog({ kind: "none" });
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
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

      {flatTree.length > 0 && (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          {flatTree.map(({ area, depth, effectivePrimaryCatalogNameId, effectivePrefixEntries }, idx) => {
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

            return (
              <div
                key={area.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.75rem 1.25rem",
                  paddingLeft: `${1.25 + depth * 1.5}rem`,
                  background: depth === 0 ? "var(--color-bg-elevated)" : "var(--color-bg-page)",
                  borderBottom:
                    idx < flatTree.length - 1 ? "1px solid var(--color-border)" : undefined,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontSize: "0.9375rem",
                    fontWeight: depth === 0 ? 600 : 500,
                    color: "var(--color-text-primary)",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {area.name}
                </span>

                {/* Primary catalog badge */}
                {primaryCatalog && (
                  <span
                    style={{
                      ...catalogBadgeStyle,
                      fontStyle: isPrimaryInherited ? "italic" : undefined,
                      color: "var(--color-accent)",
                      borderColor: "var(--color-accent)",
                    }}
                    title={isPrimaryInherited ? "Primary catalog (inherited)" : "Primary catalog"}
                  >
                    {(() => {
                      const abbr = primaryCatalog.abbreviation ?? primaryCatalog.vendorAbbreviation;
                      return primaryPrefix ? `${abbr}·${primaryPrefix}` : abbr;
                    })()}
                  </span>
                )}

                {/* Other prefix entry badges */}
                {otherPrefixEntries.length > 0 && (
                  <span style={{ display: "flex", gap: "0.25rem" }}>
                    {otherPrefixEntries.map((entry) => {
                      const cn = catalogById.get(entry.catalogNameId);
                      const abbr = cn
                        ? (cn.abbreviation ?? cn.vendorAbbreviation)
                        : entry.vendorName;
                      const isInherited = !area.catalogEntries.some(
                        (e) => e.catalogNameId === entry.catalogNameId
                      );
                      return (
                        <span
                          key={entry.catalogNameId}
                          style={{
                            ...catalogBadgeStyle,
                            fontStyle: isInherited ? "italic" : undefined,
                          }}
                          title={isInherited ? "Inherited from parent" : undefined}
                        >
                          {entry.prefix ? `${abbr}·${entry.prefix}` : abbr}
                        </span>
                      );
                    })}
                  </span>
                )}

                {area.stampCount > 0 && (
                  <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                    {area.stampCount} stamp{area.stampCount !== 1 ? "s" : ""}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => openDialog({ kind: "add-area", defaultParentId: area.id, ...inheritedValuesFor(area.id) })}
                  style={addBtnStyle}
                >
                  + Sub-area
                </button>

                <button
                  type="button"
                  onClick={() => openDialog({ kind: "edit-area", area, ...inheritedValuesFor(area.parentId) })}
                  style={rowBtnStyle}
                >
                  Edit
                </button>

                <button
                  type="button"
                  onClick={() => openDialog({ kind: "delete-area", area })}
                  style={rowBtnDangerStyle}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Dialogs ── */}

      {dialog.kind === "add-area" && (
        <DialogShell title="Add area" onClose={closeDialog}>
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
        <DialogShell title="Edit area" onClose={closeDialog}>
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
                defaultPrimaryCatalogNameId={dialog.area.primaryCatalogNameId}
                defaultCatalogEntries={dialog.area.catalogEntries}
                inheritedPrimaryId={dialog.inheritedPrimaryId}
                inheritedPrefixes={dialog.inheritedPrefixes}
                areas={initialAreas}
                currentAreaId={dialog.area.id}
                catalogNames={catalogNames}
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
