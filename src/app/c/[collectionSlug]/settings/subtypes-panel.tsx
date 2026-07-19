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
  createStampSubtypeAction,
  updateStampSubtypeAction,
  setSubtypeActsAsVariantAction,
  setDefaultSubtypeAction,
  deleteStampSubtypeAction,
  reorderStampSubtypesAction,
  type SubtypeActionState,
} from "@/app/actions/subtypes";
import type { StampSubtypeData } from "@/lib/subtypes";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";

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

interface SubtypesPanelProps {
  collectionId: string;
  initialSubtypes: StampSubtypeData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; subtype: StampSubtypeData }
  | { kind: "delete"; subtype: StampSubtypeData };

function SubtypeForm({
  defaultName,
  defaultActsAsVariant,
  showActsAsVariant,
  isPending,
}: {
  defaultName?: string;
  defaultActsAsVariant?: boolean;
  showActsAsVariant: boolean;
  isPending: boolean;
}) {
  return (
    <>
      <div style={{ marginBottom: showActsAsVariant ? "1rem" : 0 }}>
        <LabelWithError htmlFor="f-subtype-name">Name</LabelWithError>
        <input
          id="f-subtype-name"
          name="name"
          type="text"
          defaultValue={defaultName}
          disabled={isPending}
          placeholder="e.g. Colour variety"
          style={INPUT_STYLE}
        />
      </div>
      {showActsAsVariant && (
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            cursor: isPending ? "default" : "pointer",
          }}
        >
          <input
            type="checkbox"
            name="actsAsVariant"
            defaultChecked={defaultActsAsVariant ?? true}
            disabled={isPending}
            style={{ marginTop: "0.15rem" }}
          />
          <span style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
            Acts as a variant
            <span
              style={{
                display: "block",
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Children of this subtype make their parent an unknown-variant umbrella
              (lowest-child valuation, any-variant completeness). Turn off for distinct
              entries such as errors or overprints.
            </span>
          </span>
        </label>
      )}
    </>
  );
}

export function SubtypesPanel({ collectionId, initialSubtypes }: SubtypesPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<SubtypeActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  // Local ordering for optimistic drag-and-drop; re-synced on server refresh
  // via the render-phase "reset state when a prop changes" pattern.
  const [items, setItems] = useState<StampSubtypeData[]>(initialSubtypes);
  const [syncedFrom, setSyncedFrom] = useState(initialSubtypes);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (syncedFrom !== initialSubtypes) {
    setSyncedFrom(initialSubtypes);
    setItems(initialSubtypes);
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
    action: (fd: FormData) => Promise<SubtypeActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<SubtypeActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  // Fire a mutating row action (default / toggle) and refresh; surface errors
  // inline at the list level.
  function runRowMutation(action: () => Promise<SubtypeActionState>) {
    setActionState({ status: "idle" });
    startTransition(async () => {
      const result = await action();
      if (result.status === "success") {
        router.refresh();
      } else {
        setActionState(result);
      }
    });
  }

  function handleDrop(targetId: string) {
    const sourceId = draggingId;
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;

    const from = items.findIndex((s) => s.id === sourceId);
    const to = items.findIndex((s) => s.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    const orderedIds = next.map((s) => s.id);
    startTransition(async () => {
      const result = await reorderStampSubtypesAction(collectionId, orderedIds);
      if (result.status === "success") {
        router.refresh();
      } else {
        setItems(initialSubtypes);
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
          + Add subtype
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        Subtypes classify a child stamp relative to its parent. Select the default assigned
        to new children, and drag rows to change their order.
      </p>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No subtypes yet. Add one to get started.
        </p>
      )}

      <div
        style={{
          border: items.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {items.map((subtype, i) => (
          <div
            key={subtype.id}
            draggable={!isPending}
            onDragStart={() => setDraggingId(subtype.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(subtype.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background:
                draggingId === subtype.id
                  ? "var(--color-bg-page)"
                  : "var(--color-bg-elevated)",
              borderBottom:
                i < items.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: draggingId === subtype.id ? 0.5 : 1,
              cursor: isPending ? "default" : "grab",
            }}
          >
            <span
              aria-hidden
              style={{ color: "var(--color-text-muted)", fontSize: "1rem", lineHeight: 1 }}
            >
              ⠿
            </span>

            <label
              title={subtype.isDefault ? "Default subtype" : "Make default"}
              style={{
                display: "flex",
                alignItems: "center",
                cursor: isPending || subtype.isDefault ? "default" : "pointer",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="radio"
                name={`default-subtype-${collectionId}`}
                checked={subtype.isDefault}
                disabled={isPending || subtype.isDefault}
                onChange={() =>
                  runRowMutation(() => setDefaultSubtypeAction(subtype.id))
                }
              />
            </label>

            <span
              style={{
                flex: 1,
                fontSize: "0.9375rem",
                color: "var(--color-text-primary)",
                fontWeight: 500,
              }}
            >
              {subtype.name}
              {subtype.isDefault && <span style={defaultBadgeStyle}>Default</span>}
            </span>

            <label
              title="Acts as a variant"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
                cursor: isPending ? "default" : "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={subtype.actsAsVariant}
                disabled={isPending}
                onChange={(e) =>
                  runRowMutation(() =>
                    setSubtypeActsAsVariantAction(subtype.id, e.target.checked)
                  )
                }
              />
              Acts as variant
            </label>

            <RowActionsMenu
              ariaLabel="Subtype actions"
              actions={[
                {
                  key: "edit",
                  label: "Edit",
                  icon: "✎",
                  onSelect: () => openDialog({ kind: "edit", subtype }),
                },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "✕",
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => openDialog({ kind: "delete", subtype }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add subtype" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createStampSubtypeAction(collectionId, fd), e)}
          >
            <DialogBody>
              <SubtypeForm showActsAsVariant isPending={isPending} />
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
        <DialogShell title="Edit subtype" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => updateStampSubtypeAction(dialog.subtype.id, fd), e)}
          >
            <DialogBody>
              <SubtypeForm
                defaultName={dialog.subtype.name}
                showActsAsVariant={false}
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

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete subtype"
          message={
            <>
              Delete subtype <strong>{dialog.subtype.name}</strong>? This cannot be undone.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteStampSubtypeAction(dialog.subtype.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

const defaultBadgeStyle: React.CSSProperties = {
  marginLeft: "0.5rem",
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "var(--color-accent)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  verticalAlign: "middle",
};
