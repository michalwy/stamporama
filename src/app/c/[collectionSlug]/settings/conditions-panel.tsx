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
  createStampConditionAction,
  updateStampConditionAction,
  deleteStampConditionAction,
  reorderStampConditionsAction,
  type ConditionActionState,
} from "@/app/actions/conditions";
import type { StampConditionData } from "@/lib/conditions";

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

interface ConditionsPanelProps {
  collectionId: string;
  initialConditions: StampConditionData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; condition: StampConditionData }
  | { kind: "delete"; condition: StampConditionData };

function ConditionForm({ defaultName, defaultAbbreviation, isPending }: {
  defaultName?: string;
  defaultAbbreviation?: string;
  isPending: boolean;
}) {
  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-cond-abbr">Abbreviation</LabelWithError>
        <input
          id="f-cond-abbr"
          name="abbreviation"
          type="text"
          defaultValue={defaultAbbreviation}
          disabled={isPending}
          placeholder="e.g. MNH"
          style={{ ...INPUT_STYLE, maxWidth: "8rem" }}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-cond-name">Name</LabelWithError>
        <input
          id="f-cond-name"
          name="name"
          type="text"
          defaultValue={defaultName}
          disabled={isPending}
          placeholder="e.g. Mint Never Hinged"
          style={INPUT_STYLE}
        />
      </div>
    </>
  );
}

export function ConditionsPanel({ collectionId, initialConditions }: ConditionsPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<ConditionActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  // Local ordering for optimistic drag-and-drop; re-synced on server refresh
  // via the render-phase "reset state when a prop changes" pattern.
  const [items, setItems] = useState<StampConditionData[]>(initialConditions);
  const [syncedFrom, setSyncedFrom] = useState(initialConditions);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (syncedFrom !== initialConditions) {
    setSyncedFrom(initialConditions);
    setItems(initialConditions);
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
    action: (fd: FormData) => Promise<ConditionActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<ConditionActionState>) {
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

    const from = items.findIndex((c) => c.id === sourceId);
    const to = items.findIndex((c) => c.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    const orderedIds = next.map((c) => c.id);
    startTransition(async () => {
      const result = await reorderStampConditionsAction(collectionId, orderedIds);
      if (result.status === "success") {
        router.refresh();
      } else {
        // Revert on failure.
        setItems(initialConditions);
        setActionState(result);
      }
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;
  const reorderError =
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
          + Add condition
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        Drag rows to change the order conditions appear in.
      </p>

      {reorderError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {reorderError}
        </p>
      )}

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No conditions yet. Add one to get started.
        </p>
      )}

      <div
        style={{
          border: items.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {items.map((condition, i) => (
          <div
            key={condition.id}
            draggable={!isPending}
            onDragStart={() => setDraggingId(condition.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(condition.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background:
                draggingId === condition.id
                  ? "var(--color-bg-page)"
                  : "var(--color-bg-elevated)",
              borderBottom:
                i < items.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: draggingId === condition.id ? 0.5 : 1,
              cursor: isPending ? "default" : "grab",
            }}
          >
            <span
              aria-hidden
              style={{ color: "var(--color-text-muted)", fontSize: "1rem", lineHeight: 1 }}
            >
              ⠿
            </span>
            <span style={{ flex: 1, fontSize: "0.9375rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
              {condition.name}
            </span>
            <span style={abbrBadgeStyle}>{condition.abbreviation}</span>
            <button
              type="button"
              onClick={() => openDialog({ kind: "edit", condition })}
              style={rowBtnStyle}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => openDialog({ kind: "delete", condition })}
              style={rowBtnDangerStyle}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add condition" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => createStampConditionAction(collectionId, fd), e)}>
            <DialogBody>
              <ConditionForm isPending={isPending} />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit" && (
        <DialogShell title="Edit condition" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => updateStampConditionAction(dialog.condition.id, fd), e)}>
            <DialogBody>
              <ConditionForm
                defaultName={dialog.condition.name}
                defaultAbbreviation={dialog.condition.abbreviation}
                isPending={isPending}
              />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete condition"
          message={
            <>
              Delete condition <strong>{dialog.condition.name}</strong>? This cannot be undone.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteStampConditionAction(dialog.condition.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

// ── Shared row styles (local, mirrors catalog-panel) ─────────────────────────

const abbrBadgeStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
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
