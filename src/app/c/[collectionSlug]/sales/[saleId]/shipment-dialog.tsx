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
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import type { CarrierData } from "@/lib/carriers";

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

interface ShipmentDialogProps {
  /** `sent` is the prompt on the way to Sent — it saves and advances in one step, and offers Skip.
   * `edit` is the same dialog reopened from the header to correct what was recorded. */
  mode: "sent" | "edit";
  /** How the parcel is going, as recorded on the sale — the method's snapshot name, so the prompt
   * says which service this is about. Null when the sale names no method. */
  shippingMethodName: string | null;
  /** The collection's carriers, to pick from. Maintained under Settings → Shipping. */
  carriers: CarrierData[];
  /** The carrier in force: the sale's own answer, else the **default** its shipping method carries.
   * Pre-selected, because the usual case is that the default is right. */
  carrierId: string | null;
  trackingCode: string | null;
  isPending: boolean;
  /** A failed save — shown here, since the dialog covers the panel's own error line. */
  error?: string;
  /** Record who carried it and under what number (and, in `sent` mode, advance to Sent). */
  onSubmit: (carrierId: string, trackingCode: string) => void;
  /** Advance to Sent without a number — an untracked service, or a receipt still in a coat pocket.
   * Only rendered in `sent` mode; there is nothing to skip when correcting a record. */
  onSkip: () => void;
  onClose: () => void;
}

/**
 * Who carried the parcel, and under what number (#491) — asked while a sale is being marked **Sent**,
 * and reopenable from the header to correct either.
 *
 * Both live here because they are one act. The buyer picks a *service* at checkout — "Courier" —
 * and which courier that turns out to be is decided days later at the parcel counter, at exactly the
 * moment the receipt with the number on it is handed over. So the carrier named on the shipping
 * method is a **default** rather than the truth: it arrives pre-selected and is changed when the
 * parcel went another way.
 *
 * Prompting at the transition is the same reasoning that puts the buyer-paid total on **Paid**
 * (#443), and skipping is a first-class answer: plenty of postage carries no tracking at all. The
 * prompt only appears when the sale has no number yet — one already recorded has answered the
 * question, and asking again would invite overwriting it by reflex.
 */
export function ShipmentDialog({
  mode,
  shippingMethodName,
  carriers,
  carrierId: initialCarrierId,
  trackingCode: initialTrackingCode,
  isPending,
  error,
  onSubmit,
  onSkip,
  onClose,
}: ShipmentDialogProps) {
  const [trackingCode, setTrackingCode] = useState(initialTrackingCode ?? "");
  const [carrierId, setCarrierId] = useState(initialCarrierId ?? "");
  // In `edit` mode clearing the number is a legitimate save (a number entered by mistake), so only
  // the transition prompt insists on one — there, an empty field means Skip.
  const canSave = mode === "edit" || trackingCode.trim().length > 0;
  const carrier = carriers.find((c) => c.id === carrierId) ?? null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave || isPending) return;
    onSubmit(carrierId, trackingCode.trim());
  }

  return (
    <DialogShell
      title={mode === "sent" ? "Mark as sent" : "Shipment"}
      onClose={onClose}
      maxWidth="26rem"
    >
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          <LabelWithError htmlFor="sale-carrier">Carrier</LabelWithError>
          <select
            id="sale-carrier"
            value={carrierId}
            onChange={(e) => setCarrierId(e.target.value)}
            disabled={isPending}
            style={{ ...INPUT_STYLE, cursor: "pointer" }}
          >
            <option value="">— none —</option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "0.375rem 0 1rem" }}>
            {shippingMethodName
              ? `Going by ${shippingMethodName}, which suggests the carrier above — change it if the parcel went another way.`
              : "No shipping method is recorded on this sale, so there is no carrier to suggest."}
          </p>

          <LabelWithError htmlFor="sale-tracking-code">Tracking number</LabelWithError>
          <input
            id="sale-tracking-code"
            type="text"
            data-autofocus-select
            placeholder="e.g. PL12345678901"
            value={trackingCode}
            onChange={(e) => setTrackingCode(e.target.value)}
            disabled={isPending}
            {...NO_AUTOFILL}
            style={INPUT_STYLE}
          />
          <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "0.375rem 0 0" }}>
            {carrier
              ? carrier.trackingUrlTemplate
                ? `${carrier.name} tracks its parcels, so the number becomes a link on the sale.`
                : `${carrier.name} has no tracking address recorded, so the number is kept but not linked — add one in Settings → Shipping.`
              : "With no carrier, the number is kept but not linked."}
          </p>
          {mode === "sent" && (
            <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "0.75rem 0 0" }}>
              Skip it if the service carries no tracking, or if the number isn&apos;t to hand — you
              can add it on the sale header afterwards.
            </p>
          )}
          {error && (
            <p style={{ fontSize: "0.75rem", color: "var(--color-error)", margin: "0.75rem 0 0" }}>
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          {mode === "sent" ? (
            <DialogSecondaryButton onClick={onSkip} disabled={isPending}>
              Skip
            </DialogSecondaryButton>
          ) : (
            <DialogSecondaryButton onClick={onClose} disabled={isPending}>
              Cancel
            </DialogSecondaryButton>
          )}
          <DialogPrimaryButton disabled={isPending || !canSave}>
            {isPending ? "Saving…" : mode === "sent" ? "Save and mark sent" : "Save"}
          </DialogPrimaryButton>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}
