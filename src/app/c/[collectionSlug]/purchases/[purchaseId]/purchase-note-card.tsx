"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/app/dialog-shell";
import { baseBtn } from "@/app/button-style";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { TextArea } from "@/app/c/[collectionSlug]/shared/text-input";
import { normalizePurchaseNote } from "@/lib/purchase-note";

// The document's note (#2378): one plain, multi-line remark the collector keeps on a purchase, a
// trade's intake or an opening balance — what was agreed with the seller, what is still missing from
// the parcel, where the lot came from. Line breaks are kept and nothing else is formatted; a link
// stays text. Private: nothing that leaves the app reads it.
//
// **Drawn only while the document has a note, or while one is being written**, as the Expenses card is
// (#1907): most documents have none. Writing the first is the header's `⋮ → Add note`, which opens
// this card straight into its editor.

type ActionResult = { status: string; message?: string };

interface PurchaseNoteCardProps {
  purchaseId: string;
  note: string | null;
  /** Whether the editor is open — the header's `⋮ → Add note` opens it, and this card closes it. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  isPending: boolean;
  error: string | undefined;
  /** The screen's own runner: clears the error, runs the action, refreshes on success. */
  run: (fn: () => Promise<ActionResult>, onDone?: (result: ActionResult) => void) => void;
  clearError: () => void;
}

const ICON_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  background: "none",
  border: "none",
  padding: "0.125rem",
  cursor: "pointer",
  color: "var(--color-text-muted)",
  lineHeight: 1,
};

const TEXTAREA: React.CSSProperties = {
  width: "100%",
  minHeight: "6rem",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontFamily: "inherit",
  lineHeight: 1.5,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-page)",
  boxSizing: "border-box",
  resize: "vertical",
};

export function PurchaseNoteCard({
  purchaseId,
  note,
  editing,
  onEditingChange,
  isPending,
  error,
  run,
  clearError,
}: PurchaseNoteCardProps) {
  // Empty whenever the editor is closed, so the header's *Add note* — offered only while there is no
  // note — opens on a blank one; the pencil fills it with the note it edits.
  const [draft, setDraft] = useState("");
  const [clearing, setClearing] = useState(false);

  function save(next: string | null) {
    run(
      async () => {
        const { setPurchaseNoteAction } = await import("@/app/actions/purchases");
        return setPurchaseNoteAction(purchaseId, next ?? "");
      },
      (result) => {
        if (result.status !== "success") return;
        setDraft("");
        onEditingChange(false);
        setClearing(false);
      }
    );
  }

  function commit() {
    // Nothing changed is nothing to write; an emptied draft clears the note, as *Remove* does.
    if (normalizePurchaseNote(draft) === note) cancel();
    else save(draft);
  }

  function cancel() {
    setDraft("");
    onEditingChange(false);
    clearError();
  }

  if (!note && !editing) return null;

  return (
    <section
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.75rem",
        background: "var(--color-bg-elevated)",
      }}
    >
      <div
        style={{
          padding: "0.75rem 1.25rem",
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <Icon name="notes" />
        <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>Note</span>
        <span style={{ flex: 1 }} />
        {!editing && (
          <>
            <Tooltip content="Edit note">
              <button
                type="button"
                aria-label="Edit note"
                disabled={isPending}
                onClick={() => {
                  clearError();
                  setDraft(note ?? "");
                  onEditingChange(true);
                }}
                style={ICON_BTN}
              >
                <Icon name="edit" size="sm" />
              </button>
            </Tooltip>
            <Tooltip content="Remove note" align="end">
              <button
                type="button"
                aria-label="Remove note"
                disabled={isPending}
                onClick={() => {
                  clearError();
                  setClearing(true);
                }}
                style={ICON_BTN}
              >
                <Icon name="delete" size="sm" />
              </button>
            </Tooltip>
          </>
        )}
      </div>

      <div style={{ padding: "0.75rem 1.25rem" }}>
        {editing ? (
          <>
            <TextArea
              autoFocus
              aria-label="Note"
              value={draft}
              placeholder="What was agreed, what is still missing, where the lot came from…"
              disabled={isPending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter is a new line here; Ctrl/⌘+Enter saves and Escape cancels.
                if (e.key === "Escape") {
                  e.stopPropagation();
                  cancel();
                } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
              }}
              style={TEXTAREA}
            />
            {error && (
              <p style={{ margin: "0.375rem 0 0", fontSize: "0.8125rem", color: "var(--color-danger)" }}>
                {error}
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button
                type="button"
                onClick={commit}
                disabled={isPending}
                style={{ ...baseBtn, color: "#fff", background: "var(--color-action-primary)" }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={isPending}
                style={{
                  ...baseBtn,
                  color: "var(--color-text-secondary)",
                  background: "var(--color-bg-elevated)",
                  border: "1px solid var(--color-border-strong)",
                }}
              >
                Cancel
              </button>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                ⌘/Ctrl + Enter saves · Esc cancels
              </span>
            </div>
          </>
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: "0.875rem",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "var(--color-text-primary)",
            }}
          >
            {note}
          </p>
        )}
      </div>

      {clearing && (
        <ConfirmDialog
          title="Remove note"
          message="This removes the note from the document. Its text is not kept anywhere else."
          actionLabel="Remove note"
          pendingLabel="Removing…"
          variant="destructive"
          isPending={isPending}
          error={error}
          onClose={() => {
            if (isPending) return;
            setClearing(false);
            clearError();
          }}
          onConfirm={() => save(null)}
        />
      )}
    </section>
  );
}
