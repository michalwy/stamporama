"use client";

import { useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

interface PaidTotalDialogProps {
  /** Sum of the sale's line prices, in the sale currency — the floor for the total (#205). */
  grossProceeds: string;
  currency: string;
  isPending: boolean;
  /** A failed save — shown here, since the dialog covers the panel's own error line. */
  error?: string;
  /** Record the total and advance to Paid. */
  onSubmit: (totalPaid: string) => void;
  /** Advance to Paid without recording a total — the money can be filled in later. */
  onSkip: () => void;
  onClose: () => void;
}

/**
 * Asks for the total the buyer paid while a sale is being marked **Paid** (#443). The money is
 * what a collector reads off the marketplace at exactly that moment, and it is the anchor #205's
 * buyer handling is derived from — so it is asked for here instead of being a separate trip to
 * the amounts card.
 *
 * Only ever opened when the sale's buyer side has *no* anchor yet: a sale carrying a directly
 * entered handling has already been answered, and answering again would silently clear it.
 */
export function PaidTotalDialog({
  grossProceeds,
  currency,
  isPending,
  error,
  onSubmit,
  onSkip,
  onClose,
}: PaidTotalDialogProps) {
  const [totalPaid, setTotalPaid] = useState("");
  const gross = Number(grossProceeds);
  const grossNum = Number.isNaN(gross) ? 0 : gross;
  const totalNum = totalPaid.trim() === "" ? null : Number(totalPaid);
  const derivedHandling =
    totalNum == null || Number.isNaN(totalNum) ? null : totalNum - grossNum;
  // A total below the offer prices would make handling negative — the same invalid case the sale
  // form blocks (#205), refused here rather than stored and flagged afterwards.
  const totalTooLow = derivedHandling != null && derivedHandling < 0;
  const canSave = derivedHandling != null && !totalTooLow;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave || isPending) return;
    onSubmit(totalPaid.trim());
  }

  return (
    <DialogShell title="Mark as paid" onClose={onClose} maxWidth="26rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          <LabelWithError htmlFor="sale-paid-total">Total paid by buyer</LabelWithError>
          <NumericInput
            id="sale-paid-total"
            data-autofocus-select
            placeholder="0.00"
            value={totalPaid}
            onChange={(e) => setTotalPaid(e.target.value)}
            disabled={isPending}
            aria-invalid={totalTooLow}
            style={{
              ...INPUT_STYLE,
              ...(totalTooLow ? { borderColor: "var(--color-error)" } : {}),
            }}
          />
          <p
            style={{
              fontSize: "0.75rem",
              margin: "0.375rem 0 0",
              color: totalTooLow ? "var(--color-error)" : "var(--color-text-muted)",
            }}
          >
            {totalTooLow
              ? `Total must be at least ${grossNum.toFixed(2)} ${currency} (the offer prices).`
              : `− ${grossNum.toFixed(2)} ${currency} offers = ${
                  derivedHandling != null ? derivedHandling.toFixed(2) : "0.00"
                } ${currency} buyer handling`}
          </p>
          <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "0.75rem 0 0" }}>
            Buyer handling is derived from this and re-settles as sold sets change. Skip it if you
            don&apos;t know the figure yet — you can record it on the amounts card later.
          </p>
          {error && (
            <p style={{ fontSize: "0.75rem", color: "var(--color-error)", margin: "0.75rem 0 0" }}>
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryButton onClick={onSkip} disabled={isPending}>
            Skip
          </DialogSecondaryButton>
          <DialogPrimaryButton disabled={isPending || !canSave}>
            {isPending ? "Saving…" : "Save and mark paid"}
          </DialogPrimaryButton>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}
