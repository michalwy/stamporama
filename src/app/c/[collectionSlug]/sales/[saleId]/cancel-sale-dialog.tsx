"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { formControl } from "@/app/control-style";
import type { SaleDetailLine } from "@/lib/sales";
import { saleLineHeading } from "@/lib/sale-line-name";
import {
  DEFAULT_CANCEL_OFFER_OUTCOME,
  DEFAULT_CANCEL_REASON,
  type CancelOfferOutcome,
} from "@/lib/sale-cancel-rules";

const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  marginBottom: "0.375rem",
};

const NOTE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
};

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "1rem",
  padding: "0.5rem 0",
  borderTop: "1px solid var(--color-border)",
  fontSize: "0.8125rem",
};

const CHOICE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  whiteSpace: "nowrap",
  cursor: "pointer",
  color: "var(--color-text-primary)",
};

interface CancelSaleDialogProps {
  saleNo: number;
  lines: readonly SaleDetailLine[];
  /** The offers the sale closed — the ones asked about, one row each. */
  closedOfferIds: readonly string[];
  isPending: boolean;
  error?: string;
  onConfirm: (reason: string, offerOutcomes: Record<string, CancelOfferOutcome>) => void;
  onClose: () => void;
}

/**
 * **Cancel sale** (#2500): the buyer never paid. Asks, for each offer the sale closed, whether it goes
 * back to active or is withdrawn — *back to active* preselected, since the listing is usually still
 * up — and for an optional reason, prefilled *Not paid*. The sets on no offer, and on an offer the
 * sale did not close, are only released, so they are counted rather than asked about.
 */
export function CancelSaleDialog({
  saleNo,
  lines,
  closedOfferIds,
  isPending,
  error,
  onConfirm,
  onClose,
}: CancelSaleDialogProps) {
  const [reason, setReason] = useState(DEFAULT_CANCEL_REASON);
  const [outcomes, setOutcomes] = useState<Record<string, CancelOfferOutcome>>(() =>
    Object.fromEntries(closedOfferIds.map((id) => [id, DEFAULT_CANCEL_OFFER_OUTCOME]))
  );
  // One row per closed offer, named by its first line on the sale.
  const closed = closedOfferIds.flatMap((offerId) => {
    const line = lines.find((l) => l.offerId === offerId);
    return line ? [{ offerId, heading: saleLineHeading(line.name) }] : [];
  });
  const closedSet = new Set(closedOfferIds);
  const releasedOnly = lines.filter((l) => !l.offerId || !closedSet.has(l.offerId)).length;

  return (
    <DialogShell title={`Cancel sale s${saleNo}`} onClose={onClose} maxWidth="40rem">
      <DialogBody>
        <p style={{ ...NOTE, marginBottom: "1rem" }}>
          The sale is kept as Cancelled and counts nowhere. Its copies become available again and its
          packing supplies go back to stock.
        </p>
        {closed.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <span style={LABEL}>Offers this sale closed</span>
            {closed.map(({ offerId, heading }) => (
              <div key={offerId} role="radiogroup" aria-label={heading} style={ROW}>
                <span style={{ flex: 1, minWidth: 0, color: "var(--color-text-primary)" }}>{heading}</span>
                {(
                  [
                    ["active", "Back to active"],
                    ["withdrawn", "Withdrawn"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} style={CHOICE}>
                    <input
                      type="radio"
                      name={`cancel-outcome-${offerId}`}
                      checked={outcomes[offerId] === value}
                      onChange={() => setOutcomes((prev) => ({ ...prev, [offerId]: value }))}
                      disabled={isPending}
                    />
                    {label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
        {releasedOnly > 0 && (
          <p style={{ ...NOTE, marginBottom: "1rem" }}>
            {releasedOnly === 1 ? "1 other sold set is" : `${releasedOnly} other sold sets are`} only
            released — on no offer, or on an offer that still has sets to sell.
          </p>
        )}
        <label htmlFor="cancel-sale-reason" style={LABEL}>
          Reason (optional)
        </label>
        <TextInput
          id="cancel-sale-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isPending}
          style={{
            ...formControl,
            width: "100%",
            maxWidth: "24rem",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.375rem",
            padding: "0 0.625rem",
            fontSize: "0.875rem",
            color: "var(--color-text-primary)",
            background: "var(--color-bg-elevated)",
          }}
        />
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Cancelling…" : "Cancel sale"}
        cancelLabel="Keep sale"
        variant="destructive"
        disabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={() => onConfirm(reason, outcomes)}
      />
    </DialogShell>
  );
}
