"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  droppedNote,
  isUnnarrowedListView,
  PRESET_NAME_MAX,
  readListView,
  sameListView,
  storageKey,
  writeListView,
  type ListKey,
  type ListView,
  type ListViewSpec,
} from "@/lib/list-views";
import type { ListPresetData } from "@/lib/list-presets";
import { Icon } from "@/app/icons";
import { ConfirmDialog, DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import {
  FILTER_MENU_HEADING_STYLE,
  FILTER_MENU_ITEM_STYLE,
  FILTER_MENU_Z_INDEX,
  filterMenuStyle,
  filterTriggerStyle,
  useFilterPopover,
} from "./filter-popover";
import { FILTER_CONTROL_STYLE } from "./filter-chip";
import { lsGet, lsRemove, lsSet, notifyLotPref, subscribeLotPref } from "./lot-view-prefs";
import { TextInput } from "./text-input";
import { Tooltip } from "./tooltip";
import { usePersistedCollectionValue } from "./use-persisted-collection-value";

// Filter presets on every list (#2487) — the control beside a list's filters.
//
// **What a preset holds** is the list's whole view, and the rules for capturing and laying it down
// are `list-views.ts`: the address wholesale, the values each list remembers, its stored preferences
// (grouping, search fields, sub-area switch). This file is the control and nothing else: it reads the
// view the list is showing, compares it with the preset last applied, and writes a preset's view back
// — storage first, then the address, so the list's own hooks read the new view as one change.
//
// **The applied preset is remembered per list and collection**, not carried in the address: the
// view is the navigation state and the preset only the name it arrived under (#773's reasoning for
// the bulk-lot builder). Its name stays on the control, marked *modified* once anything differs, and
// *Update* saves the difference into it.
//
// **A preset can be let go of** (#2499): the × on the chip, or *Stop using preset* in the menu,
// forgets the name and leaves the view exactly as it is. Clearing every filter does the same by
// itself — a list that nothing narrows is the plain list, whatever the sort and the grouping
// (`isUnnarrowedListView`) — but only on the way *back* to it: a preset whose own view narrows
// nothing stays attached when applied, and so does one whose exact view the list returns to. The
// detached state is remembered like the applied one, so a reload does not bring the name back.
//
// **Nothing is applied by itself.** A list opens as it always did; a preset is applied only by a
// click.
//
// **Kept on the server** so a preset saved on one device is there on every other. A preset naming a
// record deleted since is applied without it, and a toast names what was dropped.

export const listPresetKeys = {
  list: (collectionId: string, list: ListKey) => ["list-presets", collectionId, list] as const,
};

export function useListPresets(collectionId: string, list: ListKey) {
  return useQuery<ListPresetData[]>({
    queryKey: listPresetKeys.list(collectionId, list),
    queryFn: async () => {
      const { listListPresetsAction } = await import("@/app/actions/list-presets");
      return listListPresetsAction(collectionId, list);
    },
    staleTime: 30_000,
  });
}

/** The screen state of a list that keeps its filters in component state (the Wants list): the
 *  values as strings, and how to set them all at once. */
export interface LocalListView {
  values: Record<string, string>;
  apply: (values: Record<string, string>) => void;
}

/** Every storage key a spec reads — what the view's snapshot watches. */
function storageKeysOf(spec: ListViewSpec, collectionId: string): string[] {
  return [
    ...(spec.remembered ?? []).map((p) => storageKey(p.store.key, collectionId)),
    ...(spec.stored ?? []).map((s) => storageKey(s.key, collectionId)),
  ];
}

/** The list's view as it stands, kept current with the address and with storage. */
function useCurrentListView(
  spec: ListViewSpec,
  collectionId: string,
  local: LocalListView | undefined
): ListView {
  const searchParams = useSearchParams();
  const keys = useMemo(() => storageKeysOf(spec, collectionId), [spec, collectionId]);
  const getSnapshot = useCallback(() => JSON.stringify(keys.map((k) => lsGet(k))), [keys]);
  const storageSnapshot = useSyncExternalStore(subscribeLotPref, getSnapshot, () => "");
  const localValues = local?.values;
  return useMemo(() => {
    // The snapshot is what changes when storage does; the reads below go to storage itself.
    void storageSnapshot;
    const view = readListView(spec, searchParams, lsGet, collectionId);
    const localView: Record<string, string> = {};
    for (const [k, v] of Object.entries(localValues ?? {})) if (v) localView[k] = v;
    return { ...view, local: localView };
  }, [spec, searchParams, collectionId, storageSnapshot, localValues]);
}

type Dialog =
  | { kind: "none" }
  | { kind: "save" }
  | { kind: "rename"; preset: ListPresetData }
  | { kind: "delete"; preset: ListPresetData };

export function ListPresetsControl({
  collectionId,
  spec,
  local,
}: {
  collectionId: string;
  spec: ListViewSpec;
  local?: LocalListView;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: presets = [] } = useListPresets(collectionId, spec.list);
  const current = useCurrentListView(spec, collectionId, local);
  const [appliedId, setAppliedId] = usePersistedCollectionValue(
    `list-preset-applied:${spec.list}`,
    collectionId
  );
  const applied = presets.find((p) => p.id === appliedId);
  const modified = !!applied && !sameListView(applied.view, current);
  const narrowed = !isUnnarrowedListView(spec, current);
  const address = searchParams.toString();

  // Back to the plain list detaches the preset (#2499). Whether the list *was* narrowed is the last
  // view seen; while an apply is still reaching the address (`settlingFrom` — the address it left),
  // the view is part old and part new, and nothing is concluded from it.
  const wasNarrowed = useRef<boolean | null>(null);
  const settlingFrom = useRef<string | null>(null);
  useEffect(() => {
    if (settlingFrom.current !== null) {
      if (address === settlingFrom.current) return;
      settlingFrom.current = null;
      wasNarrowed.current = narrowed;
      return;
    }
    const was = wasNarrowed.current;
    wasNarrowed.current = narrowed;
    if (applied && was === true && !narrowed && modified) setAppliedId("");
  }, [address, narrowed, applied, modified, setAppliedId]);

  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const { open, setOpen, pos, triggerRef, menuRef } = useFilterPopover<HTMLButtonElement>();

  const refs = spec.refs ?? {};
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: listPresetKeys.list(collectionId, spec.list) });

  function apply(preset: ListPresetData) {
    setOpen(false);
    const write = writeListView(spec, preset.view, searchParams, lsGet, collectionId);
    for (const [key, value] of write.storage) {
      if (value === null) lsRemove(key);
      else lsSet(key, value);
    }
    notifyLotPref();
    local?.apply(preset.view.local);
    setAppliedId(preset.id);
    const qs = write.url.toString();
    settlingFrom.current = qs === address ? null : address;
    router.push(qs ? `${pathname}?${qs}` : pathname);
    const note = droppedNote(preset.dropped);
    if (note) toast({ message: `“${preset.name}”: ${note}`, tone: "info" });
  }

  /** Stops using the applied preset (#2499) — the view stays exactly as it is. */
  function detach() {
    setOpen(false);
    setAppliedId("");
  }

  function openNameDialog(next: Dialog, initial: string) {
    setOpen(false);
    setError(undefined);
    setName(initial);
    setDialog(next);
  }

  function close() {
    if (isPending) return;
    setDialog({ kind: "none" });
    setError(undefined);
  }

  function save() {
    setError(undefined);
    startTransition(async () => {
      const { createListPresetAction } = await import("@/app/actions/list-presets");
      const result = await createListPresetAction(collectionId, spec.list, name, current, refs);
      if (result.status === "error") return setError(result.message);
      if (result.presetId) setAppliedId(result.presetId);
      setDialog({ kind: "none" });
      await invalidate();
    });
  }

  function rename(preset: ListPresetData) {
    setError(undefined);
    startTransition(async () => {
      const { renameListPresetAction } = await import("@/app/actions/list-presets");
      const result = await renameListPresetAction(preset.id, name);
      if (result.status === "error") return setError(result.message);
      setDialog({ kind: "none" });
      await invalidate();
    });
  }

  function update(preset: ListPresetData) {
    setOpen(false);
    startTransition(async () => {
      const { updateListPresetViewAction } = await import("@/app/actions/list-presets");
      const result = await updateListPresetViewAction(preset.id, current, refs);
      if (result.status === "error") toast({ message: result.message, tone: "error" });
      else toast({ message: `“${preset.name}” now holds this view` });
      await invalidate();
    });
  }

  function remove(preset: ListPresetData) {
    setError(undefined);
    startTransition(async () => {
      const { deleteListPresetAction } = await import("@/app/actions/list-presets");
      const result = await deleteListPresetAction(preset.id);
      if (result.status === "error") return setError(result.message);
      if (appliedId === preset.id) setAppliedId("");
      setDialog({ kind: "none" });
      await invalidate();
    });
  }

  const label = applied ? applied.name : "Presets";

  return (
    <>
      {/* The chip and, while a preset is attached, its × — one control to the eye, two buttons. */}
      <span style={{ display: "inline-flex", alignItems: "stretch", flexShrink: 0 }}>
        <Tooltip
          content={
            applied
              ? modified
                ? `The view has changed since “${applied.name}” was applied — Update saves it into the preset`
                : `Showing the view saved as “${applied.name}”`
              : "Save this view — filters, area, years, search, sort and grouping — under a name, and bring it back in one click"
          }
        >
          <button
            ref={triggerRef}
            type="button"
            aria-label="Filter presets"
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={isPending}
            onClick={() => setOpen((v) => !v)}
            style={{
              ...filterTriggerStyle({ active: !!applied }),
              maxWidth: "16rem",
              // Attached, the × below is the chip's right end.
              ...(applied
                ? { borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: "none" }
                : null),
            }}
          >
            <span style={{ display: "inline-flex", flexShrink: 0 }}>
              <Icon name="presets" size="xs" />
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
            {modified && (
              <span style={{ fontWeight: 400, fontStyle: "italic", flexShrink: 0 }}>· modified</span>
            )}
            <span style={{ display: "inline-flex", opacity: 0.7, flexShrink: 0 }}>
              <Icon name="caret" size="xs" />
            </span>
          </button>
        </Tooltip>
        {applied && (
          <Tooltip content={`Stop using “${applied.name}” — the filters stay as they are`}>
            <button
              type="button"
              aria-label="Stop using preset"
              disabled={isPending}
              onClick={detach}
              style={{
                ...filterTriggerStyle({ active: true }),
                padding: "0 0.4rem",
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                borderLeft: "1px solid var(--color-accent)",
              }}
            >
              <Icon name="close" size="xs" />
            </button>
          </Tooltip>
        )}
      </span>

      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Filter presets"
            style={{ ...filterMenuStyle(pos, FILTER_MENU_Z_INDEX), minWidth: Math.max(pos.minWidth, 240) }}
          >
            <div style={FILTER_MENU_HEADING_STYLE}>Presets</div>
            {presets.length === 0 && (
              <div style={{ ...FILTER_MENU_ITEM_STYLE, color: "var(--color-text-muted)", fontWeight: 400 }}>
                None saved on this list yet
              </div>
            )}
            {presets.map((preset) => (
              <div key={preset.id} style={{ display: "flex", alignItems: "center", gap: "0.15rem" }}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => apply(preset)}
                  style={{ ...FILTER_MENU_ITEM_STYLE, cursor: "pointer", flex: 1, minWidth: 0 }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      width: "0.9rem",
                      flexShrink: 0,
                      color: "var(--color-accent)",
                    }}
                  >
                    {preset.id === appliedId && <Icon name="check" size="xs" />}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{preset.name}</span>
                </button>
                <MenuIconButton
                  icon="edit"
                  label={`Rename “${preset.name}”`}
                  onClick={() => openNameDialog({ kind: "rename", preset }, preset.name)}
                />
                <MenuIconButton
                  icon="delete"
                  label={`Delete “${preset.name}”`}
                  onClick={() => {
                    setOpen(false);
                    setError(undefined);
                    setDialog({ kind: "delete", preset });
                  }}
                />
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--color-border)", margin: "0.25rem 0" }} />
            {applied && (
              <button
                type="button"
                role="menuitem"
                onClick={detach}
                style={{ ...FILTER_MENU_ITEM_STYLE, cursor: "pointer" }}
              >
                <Icon name="close" size="xs" />
                Stop using preset
              </button>
            )}
            {applied && modified && (
              <button
                type="button"
                role="menuitem"
                onClick={() => update(applied)}
                style={{ ...FILTER_MENU_ITEM_STYLE, cursor: "pointer" }}
              >
                <Icon name="check" size="xs" />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  Update “{applied.name}” with this view
                </span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => openNameDialog({ kind: "save" }, "")}
              style={{ ...FILTER_MENU_ITEM_STYLE, cursor: "pointer" }}
            >
              <Icon name="add" size="xs" />
              Save this view as…
            </button>
          </div>,
          document.body
        )}

      {(dialog.kind === "save" || dialog.kind === "rename") && (
        <DialogShell
          title={dialog.kind === "save" ? "Save this view as a preset" : "Rename preset"}
          onClose={close}
        >
          <DialogBody>
            <label
              htmlFor="list-preset-name"
              style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, marginBottom: "0.375rem" }}
            >
              Name
            </label>
            <TextInput
              id="list-preset-name"
              autoFocus
              maxLength={PRESET_NAME_MAX}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  e.preventDefault();
                  if (dialog.kind === "save") save();
                  else rename(dialog.preset);
                }
              }}
              placeholder="e.g. PRL for sale on Colnect, ** only"
              style={{ ...FILTER_CONTROL_STYLE, width: "100%", boxSizing: "border-box" }}
            />
            {dialog.kind === "save" && (
              <p
                style={{
                  margin: "0.75rem 0 0",
                  fontSize: "0.8125rem",
                  lineHeight: 1.5,
                  color: "var(--color-text-secondary)",
                }}
              >
                Keeps every filter on this list — the area, the years and the search with its fields
                included — with the sort and the grouping.
              </p>
            )}
          </DialogBody>
          <DialogActions
            actionLabel={dialog.kind === "save" ? "Save" : "Rename"}
            variant="primary"
            onCancel={close}
            onAction={() => (dialog.kind === "save" ? save() : rename(dialog.preset))}
            disabled={isPending || !name.trim()}
            cancelDisabled={isPending}
            error={error}
          />
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete this preset?"
          message={
            <>
              <strong>{dialog.preset.name}</strong> will be gone from this list on every device. The
              view on screen stays as it is.
            </>
          }
          actionLabel="Delete"
          isPending={isPending}
          error={error}
          onConfirm={() => remove(dialog.preset)}
          onClose={close}
        />
      )}
    </>
  );
}

function MenuIconButton({
  icon,
  label,
  onClick,
}: {
  icon: "edit" | "delete";
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0.3rem",
          border: "none",
          borderRadius: "0.3rem",
          background: "transparent",
          color: icon === "delete" ? "var(--color-error)" : "var(--color-text-secondary)",
          cursor: "pointer",
        }}
      >
        <Icon name={icon} size="xs" />
      </button>
    </Tooltip>
  );
}
