"use client";

import { useEffect, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import { previewIssueMergeAction } from "@/app/actions/issues";
import type { IssueMergePreview } from "@/lib/issues";

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

export interface MergeTargetOption {
  id: string;
  label: string;
}

interface MergeIssueDialogProps {
  collectionId: string;
  sourceIssueId: string;
  sourceLabel: string;
  targets: MergeTargetOption[];
  isPending: boolean;
  error?: React.ReactNode;
  onSubmit: (formData: FormData) => void;
  onClose: () => void;
}

export function MergeIssueDialog({
  collectionId,
  sourceIssueId,
  sourceLabel,
  targets,
  isPending,
  error,
  onSubmit,
  onClose,
}: MergeIssueDialogProps) {
  const [targetId, setTargetId] = useState<string>(targets[0]?.id ?? "");
  const [preview, setPreview] = useState<IssueMergePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    (async () => {
      setLoadingPreview(true);
      setPreviewError(null);
      const res = await previewIssueMergeAction(collectionId, sourceIssueId, targetId);
      if (cancelled) return;
      setLoadingPreview(false);
      if ("error" in res) {
        setPreview(null);
        setPreviewError(res.error);
      } else {
        setPreview(res);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collectionId, sourceIssueId, targetId]);

  const canSubmit = !isPending && !!targetId && targets.length > 0;

  if (targets.length === 0) {
    return (
      <DialogShell title="Merge issue" onClose={onClose}>
        <DialogBody>
          <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
            No other issues in this area to merge into.
          </p>
        </DialogBody>
        <div style={{ padding: "1rem 1.5rem", display: "flex", justifyContent: "flex-end" }}>
          <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title="Merge issue" onClose={onClose} minHeight="22rem">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          onSubmit(new FormData(e.currentTarget));
        }}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        <DialogBody>
          <p style={{ margin: "0 0 1rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
            Move every stamp from <strong>{sourceLabel}</strong> into another issue, then
            delete <strong>{sourceLabel}</strong>. This cannot be undone.
          </p>

          <div style={{ marginBottom: "1rem" }}>
            <LabelWithError htmlFor="f-merge-target">Merge into</LabelWithError>
            <select
              id="f-merge-target"
              name="targetIssueId"
              value={targetId}
              disabled={isPending}
              onChange={(e) => setTargetId(e.target.value)}
              style={INPUT_STYLE}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {loadingPreview ? (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              Checking…
            </p>
          ) : previewError ? (
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-error)" }}>
              {previewError}
            </p>
          ) : preview ? (
            <div style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
              <p style={{ margin: 0 }}>
                <strong>{preview.stampCount}</strong>{" "}
                {preview.stampCount === 1 ? "stamp" : "stamps"} will move into{" "}
                <strong>{preview.targetName ?? "(unnamed)"}</strong>.
              </p>
              {preview.conflicts.length > 0 && (
                <p style={{ margin: "0.5rem 0 0", color: "var(--color-warning)" }}>
                  Warning — duplicate catalog{" "}
                  {preview.conflicts.length === 1 ? "number" : "numbers"} in both issues:{" "}
                  {preview.conflicts.slice(0, 5).map((c) => c.label).join(", ")}
                  {preview.conflicts.length > 5 ? ` and ${preview.conflicts.length - 5} more` : ""}.
                </p>
              )}
            </div>
          ) : null}
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Merging…" : "Merge"}
          variant="destructive"
          onCancel={onClose}
          disabled={!canSubmit}
          cancelDisabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
