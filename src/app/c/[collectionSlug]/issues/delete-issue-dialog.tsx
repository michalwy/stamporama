"use client";

import { useEffect, useState } from "react";
import type { IssueDeletionPreview } from "@/lib/issues";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
  ConfirmDialog,
} from "@/app/dialog-shell";

interface DeleteIssueDialogProps {
  collectionId: string;
  issueId: string;
  issueName: string;
  isPending: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteIssueDialog({
  collectionId,
  issueId,
  issueName,
  isPending,
  error,
  onConfirm,
  onClose,
}: DeleteIssueDialogProps) {
  const [preview, setPreview] = useState<IssueDeletionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { previewIssueDeletionAction } = await import("@/app/actions/issues");
      const result = await previewIssueDeletionAction(collectionId, issueId);
      if (cancelled) return;
      if ("error" in result) {
        setLoadError(result.error);
      } else {
        setPreview(result);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [collectionId, issueId]);

  if (!preview && !loadError) {
    return (
      <DialogShell title="Delete issue" onClose={onClose}>
        <DialogBody>
          <p
            style={{
              margin: 0,
              fontSize: "0.9375rem",
              color: "var(--color-text-muted)",
              lineHeight: 1.6,
            }}
          >
            Checking stamps…
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
        title="Delete issue"
        message={loadError}
        actionLabel="Close"
        variant="primary"
        onConfirm={onClose}
        onClose={onClose}
      />
    );
  }

  const { totalMembers, exclusiveCount, sharedCount } = preview!;

  let message;
  if (totalMembers === 0) {
    message = (
      <>
        Delete issue <strong>{issueName}</strong>? This cannot be undone.
      </>
    );
  } else if (exclusiveCount > 0 && sharedCount > 0) {
    message = (
      <>
        Delete issue <strong>{issueName}</strong>? This will permanently delete{" "}
        <strong>
          {exclusiveCount} {exclusiveCount === 1 ? "stamp" : "stamps"}
        </strong>{" "}
        that only belong to this issue.{" "}
        {sharedCount} {sharedCount === 1 ? "stamp" : "stamps"} in other issues
        will be kept. This cannot be undone.
      </>
    );
  } else if (exclusiveCount > 0) {
    message = (
      <>
        Delete issue <strong>{issueName}</strong>? This will permanently delete
        all{" "}
        <strong>
          {exclusiveCount} {exclusiveCount === 1 ? "stamp" : "stamps"}
        </strong>{" "}
        within it. This cannot be undone.
      </>
    );
  } else {
    message = (
      <>
        Delete issue <strong>{issueName}</strong>? All{" "}
        <strong>{sharedCount}</strong> stamps belong to other issues and will be
        kept. This cannot be undone.
      </>
    );
  }

  return (
    <ConfirmDialog
      title="Delete issue"
      message={message}
      actionLabel="Delete"
      pendingLabel="Deleting…"
      isPending={isPending}
      error={error}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
