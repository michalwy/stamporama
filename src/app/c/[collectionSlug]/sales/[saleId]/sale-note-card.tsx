"use client";

import { useState } from "react";
import { DialogPrimaryButton, DialogSecondaryButton } from "@/app/dialog-shell";
import { TextArea } from "@/app/c/[collectionSlug]/shared/text-input";
import { Icon } from "@/app/icons";

// The sale's note (#2379): the collector's own remark — what was agreed with the buyer, a promised
// extra, why the parcel waits. Plain text, line breaks kept, nothing else formatted; links are not
// made clickable. Private: nothing that reaches the buyer draws it.
//
// **Drawn only while the sale has a note, or while one is being written**, as the Attachments card
// is drawn only while there is a file. Writing the first is the header's `⋮ → Add note`; the card's
// own *Edit* changes it, and saving it blank — or *Remove note* — clears it.

type ActionResult = { status: string; message?: string };

interface SaleNoteCardProps {
  note: string | null;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  isPending: boolean;
  /** The screen's own runner: clears the error, runs the action, refreshes on success and only then
   * calls `onDone`. */
  run: (fn: () => Promise<ActionResult>, onDone?: () => void) => void;
  save: (note: string) => Promise<ActionResult>;
}

export function SaleNoteCard({ note, editing, setEditing, isPending, run, save }: SaleNoteCardProps) {
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
        <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>Only you see it</span>
        <span style={{ flex: 1 }} />
        {!editing && (
          <DialogSecondaryButton onClick={() => setEditing(true)} disabled={isPending}>
            <Icon name="edit" /> Edit
          </DialogSecondaryButton>
        )}
      </div>
      {editing ? (
        <NoteEditor
          note={note}
          isPending={isPending}
          onCancel={() => setEditing(false)}
          onSave={(next) => run(() => save(next), () => setEditing(false))}
        />
      ) : (
        <p
          style={{
            margin: 0,
            padding: "0.75rem 1.25rem",
            fontSize: "0.875rem",
            lineHeight: 1.5,
            color: "var(--color-text-primary)",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {note}
        </p>
      )}
    </section>
  );
}

function NoteEditor({
  note,
  isPending,
  onCancel,
  onSave,
}: {
  note: string | null;
  isPending: boolean;
  onCancel: () => void;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(note ?? "");
  return (
    <div style={{ padding: "0.75rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
      <TextArea
        autoFocus
        aria-label="Sale note"
        value={draft}
        rows={Math.min(12, Math.max(4, draft.split("\n").length + 1))}
        placeholder="What was agreed with the buyer, a promised extra, why the parcel waits…"
        disabled={isPending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // A line break is Enter's, so saving is ⌘/Ctrl+Enter; Escape drops the draft.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        style={{
          width: "100%",
          maxWidth: "48rem",
          boxSizing: "border-box",
          padding: "0.5rem 0.625rem",
          border: "1px solid var(--color-border-strong)",
          borderRadius: "0.375rem",
          fontSize: "0.875rem",
          lineHeight: 1.5,
          fontFamily: "inherit",
          color: "var(--color-text-primary)",
          background: "var(--color-bg-elevated)",
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <DialogPrimaryButton type="button" onClick={() => onSave(draft)} disabled={isPending}>
          Save
        </DialogPrimaryButton>
        <DialogSecondaryButton onClick={onCancel} disabled={isPending}>
          Cancel
        </DialogSecondaryButton>
        {note && (
          <DialogSecondaryButton onClick={() => onSave("")} disabled={isPending} style={{ marginLeft: "auto" }}>
            <Icon name="delete" /> Remove note
          </DialogSecondaryButton>
        )}
      </div>
    </div>
  );
}
