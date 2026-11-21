"use client";

import { useEffect, useState, useTransition } from "react";
import {
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { proposalDeleteRefusal, proposalDeletionText, type ProposalDeletion } from "@/lib/proposal-rules";

const TEXT: React.CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-primary)",
  lineHeight: 1.6,
};

/**
 * *Delete proposal…* (#2641), from the proposal's screen and from its row on the list: the proposal and
 * its lots go in one action, the copies staying in the inventory — except a sold lot, kept with its
 * sale, and a post's lots, kept in the post. What it would take is read from the server when the
 * dialog opens; a Sold proposal is refused with the reason and offers nothing but Close.
 */
export function DeleteProposalDialog({
  proposalId,
  onDeleted,
  onClose,
}: {
  proposalId: string;
  /** Called once the proposal is gone, with what went. */
  onDeleted: (deleted: { proposalNo: number; deletedLots: number }) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ deletion: ProposalDeletion | null; loading: boolean; error?: string }>({
    deletion: null,
    loading: true,
  });
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    import("@/app/actions/proposals")
      .then(({ readProposalDeletionAction }) => readProposalDeletionAction(proposalId))
      .then(
        (result) => {
          if (!live) return;
          if (result.status === "error") setState({ deletion: null, loading: false, error: result.message });
          else setState({ deletion: result.deletion, loading: false });
        },
        () => {
          if (live) setState({ deletion: null, loading: false, error: "Could not read the proposal." });
        }
      );
    return () => {
      live = false;
    };
  }, [proposalId]);

  function close() {
    if (!isPending) onClose();
  }

  function confirm() {
    setError(undefined);
    startTransition(async () => {
      const { deleteProposalAction } = await import("@/app/actions/proposals");
      const result = await deleteProposalAction(proposalId);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      onDeleted({ proposalNo: result.proposalNo, deletedLots: result.deletedLots });
    });
  }

  const { deletion } = state;
  const refusal = deletion ? proposalDeleteRefusal(deletion.status) : null;

  return (
    <DialogShell title="Delete proposal?" onClose={close}>
      <DialogBody>
        {state.loading ? (
          <p style={{ ...TEXT, color: "var(--color-text-muted)" }}>Reading the proposal…</p>
        ) : !deletion ? (
          <p role="alert" style={{ ...TEXT, color: "var(--color-error)" }}>
            {state.error ?? "Could not read the proposal."}
          </p>
        ) : refusal ? (
          <p role="alert" style={TEXT}>
            {refusal}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {proposalDeletionText(deletion).map((line) => (
              <p key={line} style={TEXT}>
                {line}
              </p>
            ))}
          </div>
        )}
      </DialogBody>
      {deletion && !refusal ? (
        <DialogActions
          actionLabel={isPending ? "Deleting…" : "Delete proposal"}
          variant="destructive"
          disabled={isPending}
          error={error}
          onCancel={close}
          onAction={confirm}
        />
      ) : (
        <DialogFooter>
          <div style={{ marginLeft: "auto" }}>
            <DialogSecondaryButton onClick={close}>Close</DialogSecondaryButton>
          </div>
        </DialogFooter>
      )}
    </DialogShell>
  );
}
