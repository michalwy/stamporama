"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import {
  createLocationAction,
  updateLocationAction,
  deleteLocationAction,
  type LocationActionState,
} from "@/app/actions/locations";
import type { LocationData } from "@/lib/locations";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { getLocationDescendantIds, flattenLocationTree } from "@/app/c/[collectionSlug]/shared/location-helpers";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { useCollapsedSet } from "@/app/c/[collectionSlug]/shared/use-collapsed-set";

// Persisted collapse state for the location management tree, consistent with the area
// management tree (#237) and area filter tree (#81). Distinct key so it collapses independently.
const COLLAPSE_STORAGE_KEY = "stamporama:location-mgmt-collapsed";

interface LocationsPanelProps {
  collectionId: string;
  initialLocations: LocationData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add"; defaultParentId?: string }
  | { kind: "edit"; location: LocationData }
  | { kind: "delete"; location: LocationData };

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

const badgeStyle: React.CSSProperties = {
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

// ── LocationForm ────────────────────────────────────────────────────────────

interface LocationFormProps {
  defaultName?: string;
  defaultParentId?: string | null;
  defaultDescription?: string | null;
  defaultAssignable?: boolean;
  locations: LocationData[];
  currentLocationId?: string;
  isPending: boolean;
}

function LocationForm({
  defaultName,
  defaultParentId,
  defaultDescription,
  defaultAssignable = true,
  locations,
  currentLocationId,
  isPending,
}: LocationFormProps) {
  const excludedIds = useMemo(
    () =>
      currentLocationId
        ? getLocationDescendantIds(locations, currentLocationId)
        : new Set<string>(),
    [locations, currentLocationId]
  );

  const selectableLocations = useMemo(
    () =>
      locations.filter(
        (l) => l.id !== currentLocationId && !excludedIds.has(l.id)
      ),
    [locations, currentLocationId, excludedIds]
  );

  const selectableTree = useMemo(
    () => buildLocationTree(selectableLocations),
    [selectableLocations]
  );

  const [parentId, setParentId] = useState(defaultParentId ?? "");

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-location-name">Name</LabelWithError>
        <input
          id="f-location-name"
          name="name"
          type="text"
          defaultValue={defaultName}
          disabled={isPending}
          placeholder="e.g. Klaser A"
          style={INPUT_STYLE}
          required
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-location-parent-button">Parent location</LabelWithError>
        <LocationTreeSelect
          locations={selectableLocations}
          locationTree={selectableTree}
          name="parentId"
          selectedId={parentId}
          onSelectedIdChange={setParentId}
          disabled={isPending}
          noneOptionLabel="— None (top-level)"
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-location-description">
          Description (optional)
        </LabelWithError>
        <textarea
          id="f-location-description"
          name="description"
          rows={3}
          defaultValue={defaultDescription ?? ""}
          disabled={isPending}
          style={{ ...INPUT_STYLE, resize: "vertical", minHeight: "4.5rem" }}
        />
      </div>

      <div>
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
          {/* An unchecked checkbox submits nothing, so the action reads `assignable`
              as false when off and "true" when on — no hidden companion field (a
              hidden "false" before it would win `formData.get` and force false). */}
          <input
            type="checkbox"
            name="assignable"
            value="true"
            defaultChecked={defaultAssignable}
            disabled={isPending}
            style={{ marginTop: "0.2rem" }}
          />
          <span>
            Can hold copies
            <span
              style={{
                display: "block",
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Leave unchecked for a grouping-only location (e.g. a cabinet) that just
              organizes the ones inside it.
            </span>
          </span>
        </label>
      </div>
    </>
  );
}

// ── LocationsPanel ──────────────────────────────────────────────────────────

export function LocationsPanel({
  collectionId,
  initialLocations,
}: LocationsPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<LocationActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  const flatTree = useMemo(
    () => flattenLocationTree(initialLocations),
    [initialLocations]
  );

  // Ids of locations that have at least one child (only these get an expand/collapse toggle).
  const parentIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of initialLocations) if (l.parentId) set.add(l.parentId);
    return set;
  }, [initialLocations]);

  // Default (nothing stored yet): collapse nested parents, mirroring the area trees (#81/#237).
  const computeDefaultCollapsed = useCallback(() => {
    const defaults = new Set<string>();
    for (const { location, depth } of flatTree) {
      if (depth > 0 && parentIds.has(location.id)) defaults.add(location.id);
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
    for (const { location } of flatTree) {
      if (collapsed.has(location.id)) {
        for (const id of getLocationDescendantIds(initialLocations, location.id)) hidden.add(id);
      }
    }
    return flatTree.filter(({ location }) => !hidden.has(location.id));
  }, [flatTree, collapsed, initialLocations]);

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    // Refresh the server tree and drop the cached client-side locations list so open
    // inventory dialogs pick up the change (#56).
    queryClient.invalidateQueries({ queryKey: ["locations", collectionId] });
    router.refresh();
  }

  function submitAction(
    action: (fd: FormData) => Promise<LocationActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<LocationActionState>) {
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
          onClick={() => openDialog({ kind: "add" })}
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
          + Add location
        </button>
      </div>

      {flatTree.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No storage locations yet. Add one (e.g. a cabinet, stockbook, or album) to
          start filing your copies.
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
          {visibleTree.map(({ location, depth }, idx) => {
            const hasChildren = parentIds.has(location.id);
            const isCollapsed = collapsed.has(location.id);
            return (
            <div
              key={location.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1.25rem",
                paddingLeft: `${1.25 + depth * 1.5}rem`,
                background:
                  depth === 0 ? "var(--color-bg-elevated)" : "var(--color-bg-page)",
                borderBottom:
                  idx < visibleTree.length - 1 ? "1px solid var(--color-border)" : undefined,
              }}
            >
              {/* Expand/collapse toggle for nodes with children; a reserved spacer otherwise so
                  every row's name lines up (#237). */}
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggle(location.id)}
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
                {location.name}
              </span>

              {!location.assignable && <span style={badgeStyle}>Grouping</span>}

              {location.itemCount > 0 && (
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--color-text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {location.itemCount} cop{location.itemCount !== 1 ? "ies" : "y"}
                </span>
              )}

              <RowActionsMenu
                ariaLabel="Location actions"
                actions={[
                  {
                    key: "add-sub",
                    label: "Add sub-location",
                    icon: "＋",
                    onSelect: () =>
                      openDialog({ kind: "add", defaultParentId: location.id }),
                  },
                  {
                    key: "edit",
                    label: "Edit",
                    icon: "✎",
                    onSelect: () => openDialog({ kind: "edit", location }),
                  },
                  {
                    key: "delete",
                    label: "Delete",
                    icon: "✕",
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => openDialog({ kind: "delete", location }),
                  },
                ]}
              />
            </div>
            );
          })}
        </div>
      )}

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add location" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => createLocationAction(collectionId, fd), e)
            }
          >
            <DialogBody>
              <LocationForm
                defaultParentId={dialog.defaultParentId}
                locations={initialLocations}
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

      {dialog.kind === "edit" && (
        <DialogShell title="Edit location" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => updateLocationAction(dialog.location.id, fd), e)
            }
          >
            <DialogBody>
              <LocationForm
                defaultName={dialog.location.name}
                defaultParentId={dialog.location.parentId}
                defaultDescription={dialog.location.description}
                defaultAssignable={dialog.location.assignable}
                locations={initialLocations}
                currentLocationId={dialog.location.id}
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

      {dialog.kind === "delete" && (() => {
        const { location } = dialog;
        const blocked = location.childCount > 0 || location.itemCount > 0;

        let blockMessage = "";
        if (location.childCount > 0 && location.itemCount > 0) {
          blockMessage = `Cannot delete "${location.name}" because it has ${location.childCount} child location${location.childCount !== 1 ? "s" : ""} and ${location.itemCount} stored cop${location.itemCount !== 1 ? "ies" : "y"}. Move them first.`;
        } else if (location.childCount > 0) {
          blockMessage = `Cannot delete "${location.name}" because it has ${location.childCount} child location${location.childCount !== 1 ? "s" : ""}. Move or delete them first.`;
        } else {
          blockMessage = `Cannot delete "${location.name}" because it has ${location.itemCount} stored cop${location.itemCount !== 1 ? "ies" : "y"}. Move them first.`;
        }

        return (
          <DialogShell title="Delete location" onClose={closeDialog}>
            <DialogBody>
              <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.6 }}>
                {blocked ? blockMessage : `Delete location "${location.name}"? This cannot be undone.`}
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
                onAction={() => submitDelete(() => deleteLocationAction(location.id))}
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
