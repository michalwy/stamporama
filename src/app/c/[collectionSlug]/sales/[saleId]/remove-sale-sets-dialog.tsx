"use client";

import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";

const LIST: React.CSSProperties = {
  margin: "0 0 1rem",
  paddingLeft: "1.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
};

interface RemoveSaleSetsDialogProps {
  /** The ticked sets, by the name the sale screen gives them, with how many copies each holds. */
  sets: readonly { name: string; copyCount: number }[];
  isPending: boolean;
  error?: string;
  /** The ticked sets the removal was refused for, by name — no longer on this sale. `error` says why. */
  goneNames?: readonly string[];
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * **Remove** for the ticked sold sets (#2315): one confirmation naming how many sets and copies go,
 * and which. Each goes as its own ⋮ → *Remove* takes it, and all or nothing — a refusal names the
 * sets it was refused for.
 */
export function RemoveSaleSetsDialog({ sets, isPending, error, goneNames, onConfirm, onClose }: RemoveSaleSetsDialogProps) {
  const count = sets.length;
  const copies = sets.reduce((sum, s) => sum + s.copyCount, 0);
  const what = `${count} sold ${count === 1 ? "set" : "sets"} (${copies} ${copies === 1 ? "copy" : "copies"})`;

  return (
    <DialogShell title="Remove sold units" onClose={onClose} maxWidth="34rem">
      <DialogBody>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
          Remove {what} from this sale?
        </p>
        <ul style={LIST}>
          {sets.map((s, i) => (
            <li key={i}>{s.name}</li>
          ))}
        </ul>
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          Their copies become available again, and an offer whose last unit this was returns to active.
        </p>
        {goneNames && goneNames.length > 0 && (
          <>
            <p style={{ margin: "1rem 0 0.5rem", fontSize: "0.8125rem", color: "var(--color-error)" }}>
              Nothing was removed. Not on this sale any more:
            </p>
            <ul style={{ ...LIST, color: "var(--color-error)", margin: 0 }}>
              {goneNames.map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
          </>
        )}
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Removing…" : "Remove"}
        variant="destructive"
        disabled={isPending || count === 0}
        error={error}
        onCancel={onClose}
        onAction={onConfirm}
      />
    </DialogShell>
  );
}
