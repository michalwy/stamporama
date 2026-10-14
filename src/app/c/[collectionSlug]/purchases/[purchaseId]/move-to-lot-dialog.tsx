"use client";

import { useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
} from "@/app/dialog-shell";

/** One lot of the purchase as the move offers it: its name and state, as the lot cards show them. */
export interface MoveLotOption {
  id: string;
  label: string;
  status: string;
  itemCount: number;
}

/** A copy the move did not take, named, with the reason. */
export interface MoveLotRefusal {
  copy: string;
  reason: string;
}

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

/**
 * *Move to lot…* (#1918) — moves copies to another lot of the **same** purchase, from the copies
 * themselves: a copy's `⋮`, or the selection bar for the ticked ones.
 *
 * The purchase's other lots are listed by name and state. A closed lot is listed but cannot be
 * chosen, because its cost is already split (ADR-0009 §3) — showing it says where it went rather
 * than leaving the collector to wonder. The lot a single copy is already on is left out.
 *
 * A partial outcome stays on screen: the copies that moved are gone from the list behind, and the
 * dialog names the ones that did not and why, with nothing left to do but close it.
 */
export function MoveToLotDialog({
  count,
  lots,
  currentLotId,
  isPending,
  error,
  refusals,
  onClose,
  onConfirm,
}: {
  count: number;
  /** Every lot of the purchase, in the screen's order. */
  lots: MoveLotOption[];
  /** The lot a single copy is on, left out of the choice; null for a selection, which may span lots. */
  currentLotId: string | null;
  isPending: boolean;
  error?: string;
  /** Set once a move has landed with refusals; the dialog then reports and only closes. */
  refusals: MoveLotRefusal[] | null;
  onClose: () => void;
  onConfirm: (lotId: string) => void;
}) {
  const options = lots.filter((l) => l.id !== currentLotId);
  const [lotId, setLotId] = useState(
    () => options.find((l) => l.status === "open")?.id ?? ""
  );
  const noun = count === 1 ? "copy" : "copies";

  return (
    <DialogShell title="Move to lot" onClose={onClose} maxWidth="32rem">
      <DialogBody>
        {refusals ? (
          <>
            <p style={{ marginTop: 0, fontSize: "0.875rem" }}>
              {refusals.length} {refusals.length === 1 ? "copy was" : "copies were"} not moved:
            </p>
            <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8125rem" }}>
              {refusals.map((r, i) => (
                <li key={i} style={{ marginBottom: "0.25rem" }}>
                  <strong>{r.copy}</strong> — {r.reason}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
              Move {count} {noun} to another lot of this purchase, changing nothing else about{" "}
              {count === 1 ? "it" : "them"}.
            </p>
            {options.length === 0 ? (
              <p style={MUTED}>This purchase has no other lot to move to.</p>
            ) : (
              <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {options.map((l) => {
                  const closed = l.status !== "open";
                  return (
                    <label
                      key={l.id}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: "0.5rem",
                        fontSize: "0.875rem",
                        cursor: closed ? "not-allowed" : "pointer",
                        color: closed ? "var(--color-text-muted)" : undefined,
                      }}
                    >
                      <input
                        type="radio"
                        name="move-to-lot"
                        checked={lotId === l.id}
                        onChange={() => setLotId(l.id)}
                        disabled={closed || isPending}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>{l.label}</span>
                      <span style={MUTED}>
                        {closed ? "Closed — reopen it first" : "Open"} · {l.itemCount}{" "}
                        {l.itemCount === 1 ? "copy" : "copies"}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </>
        )}
      </DialogBody>
      <DialogFooter error={error}>
        {refusals ? (
          <DialogPrimaryButton type="button" onClick={onClose}>
            Close
          </DialogPrimaryButton>
        ) : (
          <>
            <DialogSecondaryButton onClick={onClose} disabled={isPending}>
              Cancel
            </DialogSecondaryButton>
            <DialogPrimaryButton
              type="button"
              onClick={() => onConfirm(lotId)}
              disabled={isPending || !lotId || count === 0}
            >
              {isPending ? "Moving…" : `Move ${count} ${noun}`}
            </DialogPrimaryButton>
          </>
        )}
      </DialogFooter>
    </DialogShell>
  );
}
