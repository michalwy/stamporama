"use client";

import { ConfirmDialog } from "@/app/dialog-shell";

/**
 * Saying that sheets went onto paper (#778) — one dialog for the album screen and the page editor
 * (#1487), so the two ask the same question and send the same run.
 *
 * `label` names what is being marked, `count` is how many sheets that is, and `together` says that
 * one checklist runs across them — the case where one sheet was asked for and several are marked, so
 * it is said before anything is written. `yearApart` names the year's own sheet standing ahead of them
 * (#1498): a sheet of its own, marked on its own, so marking these leaves it live — said first too.
 */
export function MarkPrintedDialog({
  label,
  count,
  together = false,
  yearApart = null,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  label: string;
  count: number;
  together?: boolean;
  yearApart?: string | null;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      title="Mark printed"
      message={`${together ? `One checklist runs across ${label}, so they go onto paper together. ` : ""}${yearApart ? `${yearApart} is a sheet of its own and is not marked with ${count === 1 ? "this one" : "these"}; mark it when it goes onto paper. ` : ""}Say that ${label} went onto paper? The album stores everything that was on ${count === 1 ? "it" : "them"} — the texts as they read now, every box's size in millimetres, the strip each was cut from and the pictures — and draws that from then on, whatever changes in the collection. It can be undone, loudly.`}
      actionLabel="These went onto paper"
      isPending={isPending}
      error={error}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
