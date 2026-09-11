"use client";

import { DialogShell, DialogBody, DialogActions, DialogSecondaryButton } from "@/app/dialog-shell";

interface UnpackedCopiesDialogProps {
  /** How many of the sale's copies are still unmarked (#973). Named in the question, because the
   *  number is what makes it answerable — three of eleven and ten of eleven are very different. */
  unpackedCount: number;
  /** The label of the status the sale is being moved to. Every option is written against **this**,
   *  not against Packed: a jump straight to Sent asks the same question, and offering to "advance
   *  to Packed" there would name a status the sale is not going to. */
  targetLabel: string;
  isPending: boolean;
  /** A failed write — shown here, since the dialog covers the panel's own error line. */
  error?: string;
  /** Mark every copy packed, then move the sale. */
  onMarkPacked: () => void;
  /** Move the sale and leave the copies as they are. */
  onAdvanceAnyway: () => void;
  /** Do nothing: neither the status nor any copy flag changes. This is the cancel. */
  onClose: () => void;
}

/**
 * Asks what to do when a sale is moved to **Packed or past it** while some of its copies are not
 * marked packed (#973).
 *
 * The schema has had one direction of this since #192 — when every copy is packed, the detail
 * screen hints that the sale can advance — and nothing said anything in the other direction, so a
 * sale could reach `packed`, or `sent`, with copies still unmarked and no sign of it.
 *
 * **Asked at the transition, not afterwards**, which is the shape #443 established for the total on
 * the way to `paid`: the moment the collector says the parcel is packed is the moment they know
 * whether it is, and a flag put right later is a flag nobody goes back for.
 *
 * The footer is grouped by role, as `DialogActions` groups every footer: *move it anyway* is the
 * **alternative outcome** and sits on the left, while *do nothing* is the **cancel** and keeps the
 * cancel's place beside the action. It is also the safe default — neither the status nor a single
 * flag moves — which is why it is the cancel rather than a third button competing with the other
 * two. Nothing is asked when every copy is already packed: that path is #192's hint and must never
 * gain a dialog.
 */
export function UnpackedCopiesDialog({
  unpackedCount,
  targetLabel,
  isPending,
  error,
  onMarkPacked,
  onAdvanceAnyway,
  onClose,
}: UnpackedCopiesDialogProps) {
  const copies = unpackedCount === 1 ? "copy is" : "copies are";
  return (
    <DialogShell title={`Move to ${targetLabel}?`} onClose={onClose} maxWidth="30rem">
      <DialogBody>
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
          <strong>
            {unpackedCount} {copies}
          </strong>{" "}
          not marked as packed on this sale.
        </p>
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
          Mark them all packed if they went in the parcel and the marks were simply never made, or
          move the sale on and leave them as they are.
        </p>
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Saving…" : `Mark all packed and move to ${targetLabel}`}
        onAction={onMarkPacked}
        cancelLabel="Do nothing"
        onCancel={onClose}
        disabled={isPending}
        error={error}
        leading={
          <DialogSecondaryButton onClick={onAdvanceAnyway} disabled={isPending}>
            Move to {targetLabel} anyway
          </DialogSecondaryButton>
        }
      />
    </DialogShell>
  );
}
