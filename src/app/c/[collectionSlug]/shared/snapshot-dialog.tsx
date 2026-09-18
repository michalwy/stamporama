"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { DialogActions, DialogBody, DialogShell, LabelWithError } from "@/app/dialog-shell";
import { useToast } from "@/app/toast-provider";
import { saveAnnotatedSnapshotAction } from "@/app/actions/photo-measure";
import {
  DEFAULT_SNAPSHOT_TITLE,
  MAX_SNAPSHOT_TITLE,
  type SnapshotMark,
} from "@/lib/annotations";
import type { Box } from "@/lib/scan-boxes";

/** What the toast says, by who the snapshot went to (#674). A tile's is the one worth a sentence:
 * the photo is not on any copy yet, and saying where it will end up is what stops it reading as lost. */
const SAVED_TO = {
  item: "Snapshot saved to the copy's photos",
  stamp: "Snapshot saved to the stamp's photos",
  tile: "Snapshot saved with the tile — it moves to the copy when the tile is identified",
} as const;

/**
 * Keeping what is on screen as a photo (#674): the part of the picture in view, the marks drawn on it
 * and the measurement standing on the viewer, saved beside the picture it was taken on.
 *
 * A dialog rather than a single click, for one field — a detail is found again by what it is called,
 * and *Detail* is only the name nobody chose. Stacked over whichever dialog the viewer sits in.
 */
export function SnapshotDialog({
  collectionId,
  photoId,
  region,
  marks,
  viewScale,
  onClose,
  onSaved,
}: {
  collectionId: string;
  photoId: string;
  region: Box;
  /** Each in its own style (#1342). */
  marks: SnapshotMark[];
  /** The zoom on screen when the button was pressed (#1300), so the photo draws the marks as they
   * looked. */
  viewScale: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(DEFAULT_SNAPSHOT_TITLE);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const measured = marks.filter((m) => m.kind === "distance" || m.kind === "box").length;
  const drawn = marks.length - measured;

  function save() {
    setError(undefined);
    startTransition(async () => {
      const state = await saveAnnotatedSnapshotAction(collectionId, {
        photoId,
        region,
        marks,
        title,
        viewScale,
      });
      if (state.status === "error") {
        setError(state.message);
        return;
      }
      toast({ message: SAVED_TO[state.owner] });
      onSaved();
    });
  }

  // Through a portal: the viewer this is opened from sits inside a dialog panel, and that panel's
  // `transform` makes it the containing block of every `position: fixed` inside it — so a dialog
  // rendered in place would be laid out, and clipped, inside the panel instead of over the screen.
  if (typeof document === "undefined") return null;
  return createPortal(
    <DialogShell title="Save snapshot" onClose={pending ? () => {} : onClose} zIndexBase={300}>
      <DialogBody>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
          Keeps the part of the picture on screen as a new photo beside this one
          {drawn > 0 || measured > 0 ? (
            <>
              , with {describeMarks(drawn, measured)} drawn into it
            </>
          ) : null}
          . The picture itself is not changed.
        </p>
        <LabelWithError htmlFor="snapshot-title">Title</LabelWithError>
        <input
          id="snapshot-title"
          data-autofocus-select
          value={title}
          maxLength={MAX_SNAPSHOT_TITLE}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !pending) {
              e.preventDefault();
              save();
            }
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "0.5rem 0.625rem",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.375rem",
            font: "inherit",
            fontSize: "0.875rem",
            color: "var(--color-text-primary)",
            background: "var(--color-bg-page)",
          }}
        />
      </DialogBody>
      <DialogActions
        actionLabel={pending ? "Saving…" : "Save as photo"}
        onCancel={onClose}
        onAction={save}
        disabled={pending}
        error={error}
      />
    </DialogShell>,
    document.body
  );
}

function describeMarks(drawn: number, measured: number): string {
  const parts: string[] = [];
  if (drawn > 0) parts.push(drawn === 1 ? "the mark" : `${drawn} marks`);
  if (measured > 0) parts.push("the measurement");
  return parts.join(" and ");
}
