"use client";

import { useEffect, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
  DialogDestructiveButton,
  ConfirmDialog,
  ErrorBubble,
} from "@/app/dialog-shell";

interface DeleteStampDialogProps {
  stampId: string;
  stampName: string;
  isPending: boolean;
  error?: string;
  onConfirm: (mode: "cascade" | "reparent") => void;
  onClose: () => void;
}

export function DeleteStampDialog({
  stampId,
  stampName,
  isPending,
  error,
  onConfirm,
  onClose,
}: DeleteStampDialogProps) {
  const [childCount, setChildCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { getStampChildCountAction } = await import("@/app/actions/stamps");
      const result = await getStampChildCountAction(stampId);
      if (cancelled) return;
      if ("error" in result) {
        setLoadError(result.error);
      } else {
        setChildCount(result.count);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [stampId]);

  if (childCount === null && !loadError) {
    return (
      <DialogShell title="Delete stamp" onClose={onClose}>
        <DialogBody>
          <p
            style={{
              margin: 0,
              fontSize: "0.9375rem",
              color: "var(--color-text-muted)",
              lineHeight: 1.6,
            }}
          >
            Checking children…
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryButton onClick={onClose}>
            Cancel
          </DialogSecondaryButton>
        </DialogFooter>
      </DialogShell>
    );
  }

  if (loadError) {
    return (
      <ConfirmDialog
        title="Delete stamp"
        message={loadError}
        actionLabel="Close"
        variant="primary"
        onConfirm={onClose}
        onClose={onClose}
      />
    );
  }

  if (childCount === 0) {
    return (
      <ConfirmDialog
        title="Delete stamp"
        message={
          <>
            Delete stamp <strong>{stampName}</strong>? This will remove it from
            all issues. This cannot be undone.
          </>
        }
        actionLabel="Delete"
        pendingLabel="Deleting…"
        isPending={isPending}
        error={error}
        onConfirm={() => onConfirm("cascade")}
        onClose={onClose}
      />
    );
  }

  return (
    <DialogShell title="Delete stamp" onClose={onClose}>
      <DialogBody>
        <p
          style={{
            margin: 0,
            fontSize: "0.9375rem",
            color: "var(--color-text-primary)",
            lineHeight: 1.6,
          }}
        >
          Stamp <strong>{stampName}</strong> has{" "}
          <strong>
            {childCount} {childCount === 1 ? "child" : "children"}
          </strong>
          . How would you like to proceed?
        </p>
      </DialogBody>
      <DialogFooter>
        <DialogSecondaryButton onClick={onClose} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        <div style={{ display: "flex", gap: "0.5rem", position: "relative" }}>
          <ErrorBubble>{error}</ErrorBubble>
          <DialogDestructiveButton
            onClick={() => onConfirm("reparent")}
            disabled={isPending}
          >
            {isPending ? "Deleting…" : "Move children up and delete"}
          </DialogDestructiveButton>
          <DialogDestructiveButton
            onClick={() => onConfirm("cascade")}
            disabled={isPending}
          >
            {isPending ? "Deleting…" : "Delete with all children"}
          </DialogDestructiveButton>
        </div>
      </DialogFooter>
    </DialogShell>
  );
}
