"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  createStampSizePresetAction,
  updateStampSizePresetAction,
  deleteStampSizePresetAction,
  reorderStampSizePresetsAction,
  type StampSizePresetActionState,
} from "@/app/actions/stamp-size-presets";
import type { StampSizePresetData } from "@/lib/stamp-size-presets";
import { formatSizeMm } from "@/lib/stamp-size";
import { STAMP_SIZE_LABELS } from "@/lib/stamp-attribute-kinds";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Icon } from "@/app/icons";

// The collection's stamp size presets (#804; ADR-0048) — `hawid-stock-panel.tsx`'s scaffolding,
// because the two are the same kind of thing: a dictionary of millimetres in the collector's own
// dragged order, with a label that is not its identity.
//
// It sits on **Attributes** rather than beside the hawid drawer on Albums, which was weighed and
// refused: a size is the seventh and eighth stamp attribute (#763), catalogue identity, and it is a
// fact for a collection that never prints a page. This is the tab the collector is already on when
// he is filling one in.
//
// ## Two things the wording here is doing on purpose
//
// **The delete confirmation says that deleting is safe**, because nothing on screen can show that it
// is. A preset is copied onto a stamp and never referenced (ADR-0048 §1), so no stamp can be
// orphaned by removing one — but a collector who has just applied a preset to forty stamps has every
// reason to assume the opposite, and every other dictionary in this app *does* refuse a delete that
// is in use. Silence would read as the dangerous case.
//
// **The figures are `type="text"` with `inputMode="decimal"`, not `type="number"`**, matching the
// stamp form's own size fields rather than the hawid panel's. `parseSizeMm` (#763) reads a comma as
// a decimal point deliberately — the collector's locale writes `21,5` — and a number input strips or
// rejects the comma before the action ever sees it, which would make that rule unreachable from this
// screen while leaving it true everywhere else.

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

const HINT_STYLE: React.CSSProperties = {
  display: "block",
  marginTop: "0.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

interface StampSizePresetsPanelProps {
  collectionId: string;
  initialPresets: StampSizePresetData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; preset: StampSizePresetData }
  | { kind: "delete"; preset: StampSizePresetData };

/** `25 × 30 mm` — the pair, which is what the preset *is*. The name rides beside it rather than in
 *  it, so a row without one reads as complete instead of as a missing label. */
function presetPair(preset: StampSizePresetData): string {
  return `${formatSizeMm(preset.widthMm)} × ${formatSizeMm(preset.heightMm)} mm`;
}

function PresetForm({ preset, isPending }: { preset?: StampSizePresetData; isPending: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        {(["widthMm", "heightMm"] as const).map((field) => (
          <div key={field}>
            <LabelWithError htmlFor={`f-preset-${field}`}>
              {STAMP_SIZE_LABELS[field].field}
            </LabelWithError>
            <input
              id={`f-preset-${field}`}
              name={field}
              type="text"
              inputMode="decimal"
              defaultValue={preset ? formatSizeMm(preset[field]) : ""}
              disabled={isPending}
              placeholder={STAMP_SIZE_LABELS[field].example}
              style={INPUT_STYLE}
            />
          </div>
        ))}
      </div>
      <span style={HINT_STYLE}>
        Millimetres, to a tenth — what a catalogue prints. Both are required: a preset is a complete
        size, unlike a stamp, which is free to state half of one.
      </span>

      <div>
        <LabelWithError htmlFor="f-preset-name">Name (optional)</LabelWithError>
        <input
          id="f-preset-name"
          name="name"
          type="text"
          defaultValue={preset?.name ?? ""}
          disabled={isPending}
          placeholder="e.g. Germania"
          style={INPUT_STYLE}
        />
        <span style={HINT_STYLE}>
          What you call this size. The pair of numbers is already the identity — the name is there so
          you can recognise it in a list, and two presets can never share a pair.
        </span>
      </div>
    </div>
  );
}

export function StampSizePresetsPanel({
  collectionId,
  initialPresets,
}: StampSizePresetsPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<StampSizePresetActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  // Local ordering for optimistic drag-and-drop, re-synced from the server on refresh — the hawid
  // panel's pattern, which is the formats panel's.
  const [items, setItems] = useState<StampSizePresetData[]>(initialPresets);
  const [syncedFrom, setSyncedFrom] = useState(initialPresets);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (syncedFrom !== initialPresets) {
    setSyncedFrom(initialPresets);
    setItems(initialPresets);
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
    action: (fd: FormData) => Promise<StampSizePresetActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<StampSizePresetActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function handleDrop(targetId: string) {
    const sourceId = draggingId;
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;

    const from = items.findIndex((p) => p.id === sourceId);
    const to = items.findIndex((p) => p.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    startTransition(async () => {
      const result = await reorderStampSizePresetsAction(
        collectionId,
        next.map((p) => p.id)
      );
      if (result.status === "success") {
        router.refresh();
      } else {
        setItems(initialPresets);
        setActionState(result);
      }
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;
  const listError =
    actionState.status === "error" && dialog.kind === "none" ? actionState.message : undefined;

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
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
          + Add preset
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        Sizes you already know, saved so they can be typed once. Both ways of measuring a stamp need
        the stamp in front of you and a scan of it — but a new overprint run is the same impression
        as the base issue you measured years ago, and nothing about it needs measuring again. A
        preset is that pair of millimetres. Nothing is set up here to begin with: an empty list is a
        collection that has not needed one, not a collection missing something. Drag rows to change
        the order they are offered in.
      </p>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No presets yet. Add one for a size you keep typing.
        </p>
      )}

      <div
        style={{
          border: items.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {items.map((preset, i) => (
          <div
            key={preset.id}
            draggable={!isPending}
            onDragStart={() => setDraggingId(preset.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(preset.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background:
                draggingId === preset.id ? "var(--color-bg-page)" : "var(--color-bg-elevated)",
              borderBottom: i < items.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: draggingId === preset.id ? 0.5 : 1,
              cursor: isPending ? "default" : "grab",
            }}
          >
            <span
              aria-hidden
              style={{ color: "var(--color-text-muted)", fontSize: "1rem", lineHeight: 1 }}
            >
              <Icon name="dragGrip" size="sm" />
            </span>
            <span
              style={{
                fontSize: "0.9375rem",
                color: "var(--color-text-primary)",
                fontWeight: 500,
              }}
            >
              {presetPair(preset)}
            </span>
            <span style={{ flex: 1, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              {preset.name ?? ""}
            </span>
            <RowActionsMenu
              ariaLabel="Stamp size preset actions"
              actions={[
                {
                  key: "edit",
                  label: "Edit",
                  icon: "edit",
                  onSelect: () => openDialog({ kind: "edit", preset }),
                },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "delete",
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => openDialog({ kind: "delete", preset }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add size preset" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createStampSizePresetAction(collectionId, fd), e)}
          >
            <DialogBody>
              <PresetForm isPending={isPending} />
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
        <DialogShell title="Edit size preset" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => updateStampSizePresetAction(dialog.preset.id, fd), e)
            }
          >
            <DialogBody>
              <PresetForm preset={dialog.preset} isPending={isPending} />
              <p
                style={{
                  marginTop: "1rem",
                  marginBottom: 0,
                  fontSize: "0.8125rem",
                  color: "var(--color-text-muted)",
                }}
              >
                Correcting the figures here changes what this preset writes from now on. Stamps
                already sized from it keep the numbers they hold — a preset is copied onto a stamp,
                not linked to it — so correct those on the stamps themselves, or by applying the
                corrected preset again.
              </p>
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

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete size preset"
          message={
            <>
              Delete the <strong>{presetPair(dialog.preset)}</strong> preset
              {dialog.preset.name ? ` (${dialog.preset.name})` : ""}? Every stamp you have sized from
              it keeps its size: a preset is copied onto a stamp rather than referenced by it, so
              nothing here is pointed at and nothing can be left dangling. You are removing it from
              this list, and nothing else.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteStampSizePresetAction(dialog.preset.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}
