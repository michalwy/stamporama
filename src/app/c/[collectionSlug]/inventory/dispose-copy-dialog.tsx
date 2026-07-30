"use client";

import { useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import type { ItemListItem } from "@/lib/items";
import {
  DISPOSAL_REASONS,
  DISPOSAL_REASON_META,
  disposalNoteRequired,
} from "@/lib/disposal";
import { formatItemNo } from "@/lib/item-number";
import { useCollectionItemNoPad } from "./use-inventory-query";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const HINT_STYLE: React.CSSProperties = {
  margin: "0.375rem 0 0",
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/**
 * Record that a copy is no longer held (#394/#395): why, plus a note that is **required** for
 * *Other* — `lost` and `damaged` say what happened on their own, while *Other* says only that
 * something did.
 *
 * The dialog states plainly what is *not* happening, because the neighbouring axis does the
 * opposite: a not-delivered copy leaves its lot and its share redistributes (#122), whereas this
 * copy did arrive and was paid for, so its cost basis stays and becomes a write-off (#396).
 */
export function DisposeCopyDialog({
  collectionId,
  item,
  isPending,
  error,
  onClose,
  onSubmit,
}: {
  collectionId: string;
  item: ItemListItem;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  const [reason, setReason] = useState<string>(DISPOSAL_REASONS[0]);
  const [note, setNote] = useState("");
  const itemNoPad = useCollectionItemNoPad(collectionId);

  const noteMissing = disposalNoteRequired(reason) && !note.trim();

  return (
    <DialogShell
      title={`No longer held — ${formatItemNo(item.itemNo, itemNoPad)}`}
      onClose={onClose}
      maxWidth="30rem"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (noteMissing) return;
          const fd = new FormData();
          fd.set("disposalReason", reason);
          fd.set("disposalNote", note.trim());
          onSubmit(fd);
        }}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        <DialogBody>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <LabelWithError htmlFor="disposal-reason">Reason</LabelWithError>
              <select
                id="disposal-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                {DISPOSAL_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {DISPOSAL_REASON_META[r].label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <LabelWithError htmlFor="disposal-note">
                {disposalNoteRequired(reason) ? "What happened" : "Note (optional)"}
              </LabelWithError>
              <textarea
                id="disposal-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isPending}
                rows={3}
                style={{ ...INPUT_STYLE, resize: "vertical" }}
              />
              {disposalNoteRequired(reason) && (
                <p style={HINT_STYLE}>
                  Required for Other — the reason on its own says only that the copy is gone.
                </p>
              )}
            </div>

            <p style={HINT_STYLE}>
              The purchase record is left alone: this copy&apos;s cost basis, lot and internal
              number all stay, and the cost is reported as a write-off rather than disappearing
              from the books. You can reverse this if the copy turns up again.
            </p>
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Mark as no longer held"}
          variant="destructive"
          disabled={isPending || noteMissing}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}
