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
  createCertificateStatusAction,
  updateCertificateStatusAction,
  deleteCertificateStatusAction,
  reorderCertificateStatusesAction,
  type CertificateStatusActionState,
} from "@/app/actions/certificate-statuses";
import type { CertificateStatusData } from "@/lib/certificate-statuses";

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

interface CertificateStatusesPanelProps {
  collectionId: string;
  initialStatuses: CertificateStatusData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; status: CertificateStatusData }
  | { kind: "delete"; status: CertificateStatusData };

function CertificateStatusForm({ defaultName, defaultAbbreviation, isPending }: {
  defaultName?: string;
  defaultAbbreviation?: string;
  isPending: boolean;
}) {
  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-cert-abbr">Abbreviation</LabelWithError>
        <input
          id="f-cert-abbr"
          name="abbreviation"
          type="text"
          defaultValue={defaultAbbreviation}
          disabled={isPending}
          placeholder="e.g. Cert"
          style={{ ...INPUT_STYLE, maxWidth: "8rem" }}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-cert-name">Name</LabelWithError>
        <input
          id="f-cert-name"
          name="name"
          type="text"
          defaultValue={defaultName}
          disabled={isPending}
          placeholder="e.g. Certificate"
          style={INPUT_STYLE}
        />
      </div>
    </>
  );
}

export function CertificateStatusesPanel({ collectionId, initialStatuses }: CertificateStatusesPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<CertificateStatusActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  // Local ordering for optimistic drag-and-drop; re-synced on server refresh
  // via the render-phase "reset state when a prop changes" pattern.
  const [items, setItems] = useState<CertificateStatusData[]>(initialStatuses);
  const [syncedFrom, setSyncedFrom] = useState(initialStatuses);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (syncedFrom !== initialStatuses) {
    setSyncedFrom(initialStatuses);
    setItems(initialStatuses);
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
    action: (fd: FormData) => Promise<CertificateStatusActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<CertificateStatusActionState>) {
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

    const from = items.findIndex((s) => s.id === sourceId);
    const to = items.findIndex((s) => s.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);

    const orderedIds = next.map((s) => s.id);
    startTransition(async () => {
      const result = await reorderCertificateStatusesAction(collectionId, orderedIds);
      if (result.status === "success") {
        router.refresh();
      } else {
        // Revert on failure.
        setItems(initialStatuses);
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
          + Add certificate status
        </button>
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        Drag rows to change the order certificate statuses appear in.
      </p>

      {reorderError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {reorderError}
        </p>
      )}

      {items.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No certificate statuses yet. Add one to get started.
        </p>
      )}

      <div
        style={{
          border: items.length > 0 ? "1px solid var(--color-border)" : "none",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {items.map((status, i) => (
          <div
            key={status.id}
            draggable={!isPending}
            onDragStart={() => setDraggingId(status.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(status.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background:
                draggingId === status.id
                  ? "var(--color-bg-page)"
                  : "var(--color-bg-elevated)",
              borderBottom:
                i < items.length - 1 ? "1px solid var(--color-border)" : "none",
              opacity: draggingId === status.id ? 0.5 : 1,
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
              {status.name}
            </span>
            <span style={abbrBadgeStyle}>{status.abbreviation}</span>
            <button
              type="button"
              onClick={() => openDialog({ kind: "edit", status })}
              style={rowBtnStyle}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => openDialog({ kind: "delete", status })}
              style={rowBtnDangerStyle}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add certificate status" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => createCertificateStatusAction(collectionId, fd), e)}>
            <DialogBody>
              <CertificateStatusForm isPending={isPending} />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit" && (
        <DialogShell title="Edit certificate status" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => updateCertificateStatusAction(dialog.status.id, fd), e)}>
            <DialogBody>
              <CertificateStatusForm
                defaultName={dialog.status.name}
                defaultAbbreviation={dialog.status.abbreviation}
                isPending={isPending}
              />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete certificate status"
          message={
            <>
              Delete certificate status <strong>{dialog.status.name}</strong>? This cannot be undone.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteCertificateStatusAction(dialog.status.id))}
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
