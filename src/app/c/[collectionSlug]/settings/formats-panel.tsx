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
  createStampFormatAction,
  updateStampFormatAction,
  deleteStampFormatAction,
  reorderStampFormatsAction,
  type StampFormatActionState,
} from "@/app/actions/stamp-formats";
import type { StampFormatData } from "@/lib/stamp-formats";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";

// The physical-format dictionary. Mirrors `conditions-panel.tsx` rather than reinventing the
// list/drag/dialog scaffolding — a format is the same kind of per-collection taxonomy, set up once
// and then left alone, which is why it lives in Settings and not on its own nav page.
//
// Formats carry no translations yet, unlike conditions (#294): nothing renders a format into a
// listing title so far. When something does, this panel grows the same 🌐 buttons.

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

interface FormatsPanelProps {
  collectionId: string;
  initialFormats: StampFormatData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; format: StampFormatData }
  | { kind: "delete"; format: StampFormatData };

function FormatForm({
  defaultName,
  defaultAbbreviation,
  isPending,
}: {
  defaultName?: string;
  defaultAbbreviation?: string;
  isPending: boolean;
}) {
  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-fmt-abbr">Abbreviation</LabelWithError>
        <input
          id="f-fmt-abbr"
          name="abbreviation"
          type="text"
          defaultValue={defaultAbbreviation}
          disabled={isPending}
          placeholder="e.g. Blk4"
          style={{ ...INPUT_STYLE, maxWidth: "8rem" }}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-fmt-name">Name</LabelWithError>
        <input
          id="f-fmt-name"
          name="name"
          type="text"
          defaultValue={defaultName}
          disabled={isPending}
          placeholder="e.g. Block of 4"
          style={INPUT_STYLE}
        />
      </div>
    </>
  );
}

export function FormatsPanel({ collectionId, initialFormats }: FormatsPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<StampFormatActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  // Local ordering for optimistic drag-and-drop; re-synced on server refresh via the
  // render-phase "reset state when a prop changes" pattern.
  const [items, setItems] = useState<StampFormatData[]>(initialFormats);
  const [syncedFrom, setSyncedFrom] = useState(initialFormats);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (syncedFrom !== initialFormats) {
    setSyncedFrom(initialFormats);
    setItems(initialFormats);
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
    action: (fd: FormData) => Promise<StampFormatActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<StampFormatActionState>) {
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

    const from = items.findIndex((f) => f.id === sourceId);
    const to = items.findIndex((f) => f.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    startTransition(async () => {
      const result = await reorderStampFormatsAction(collectionId, next.map((f) => f.id));
      if (result.status === "success") {
        router.refresh();
      } else {
        setItems(initialFormats);
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
          + Add format
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        A format is how a copy is physically attached — a pair, a block, a strip. A single stamp
        needs no entry here: it is what a copy with no format set already is. Drag rows to change
        the order formats appear in.
      </p>

      {reorderError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {reorderError}
        </p>
      )}

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No formats yet. Add one to record pairs, blocks or strips.
        </p>
      )}

      <div
        style={{
          border: items.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {items.map((format, i) => (
          <div
            key={format.id}
            draggable={!isPending}
            onDragStart={() => setDraggingId(format.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(format.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background:
                draggingId === format.id ? "var(--color-bg-page)" : "var(--color-bg-elevated)",
              borderBottom: i < items.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: draggingId === format.id ? 0.5 : 1,
              cursor: isPending ? "default" : "grab",
            }}
          >
            <span
              aria-hidden
              style={{ color: "var(--color-text-muted)", fontSize: "1rem", lineHeight: 1 }}
            >
              ⠿
            </span>
            <span
              style={{
                flex: 1,
                fontSize: "0.9375rem",
                color: "var(--color-text-primary)",
                fontWeight: 500,
              }}
            >
              {format.name}
            </span>
            <span style={abbrBadgeStyle}>{format.abbreviation}</span>
            <RowActionsMenu
              ariaLabel="Format actions"
              actions={[
                {
                  key: "edit",
                  label: "Edit",
                  icon: "✎",
                  onSelect: () => openDialog({ kind: "edit", format }),
                },
                {
                  key: "delete",
                  label: "Delete",
                  icon: "✕",
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => openDialog({ kind: "delete", format }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add format" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createStampFormatAction(collectionId, fd), e)}
          >
            <DialogBody>
              <FormatForm isPending={isPending} />
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
        <DialogShell title="Edit format" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => updateStampFormatAction(dialog.format.id, fd), e)}
          >
            <DialogBody>
              <FormatForm
                defaultName={dialog.format.name}
                defaultAbbreviation={dialog.format.abbreviation}
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
          title="Delete format"
          message={
            <>
              Delete format <strong>{dialog.format.name}</strong>? Any multiplier rules for it are
              deleted with it. This cannot be undone.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteStampFormatAction(dialog.format.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

// ── Shared row styles (local, mirrors conditions-panel) ──────────────────────

const abbrBadgeStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};
