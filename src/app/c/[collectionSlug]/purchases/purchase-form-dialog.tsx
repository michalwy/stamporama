"use client";

import { type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import type { PurchaseListItem } from "@/lib/purchases";
import { PurchaseContactSelect } from "./purchase-contact-select";

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

const FIELD_GAP: React.CSSProperties = { marginBottom: "1rem" };

const STATUS_OPTIONS = [
  { value: "preparing", label: "Preparing" },
  { value: "in_transit", label: "In transit" },
  { value: "arrived", label: "Arrived" },
] as const;

export interface PurchaseFormDialogProps {
  mode: "add" | "edit";
  collectionId: string;
  /** Default transaction currency for a new purchase (collection base currency). */
  baseCurrency: string;
  /** Today as yyyy-mm-dd, computed by the caller (server/page) to avoid SSR clock use. */
  today: string;
  /** The row being edited (add mode leaves this undefined). Its header fields — supplier,
   * date, currency, status, shipping — are already in the loaded list row, so editing
   * needs no extra fetch. */
  purchase?: PurchaseListItem;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

/** Add/edit a purchase header (ADR-0009, #120): supplier, date, transaction currency,
 * delivery status, and the shared shipping cost. The order's line items — inventory lots
 * and non-inventory expenses — are NOT captured here; they are managed during lot intake
 * (#121). Editing a purchase therefore never touches its lots or expenses. */
export function PurchaseFormDialog({
  mode,
  collectionId,
  baseCurrency,
  today,
  purchase,
  isPending,
  error,
  onClose,
  onSubmit,
}: PurchaseFormDialogProps) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  const title = mode === "add" ? "Add purchase" : "Edit purchase";
  const actionLabel = isPending
    ? mode === "add" ? "Adding…" : "Saving…"
    : mode === "add" ? "Add purchase" : "Save changes";

  return (
    <DialogShell title={title} onClose={onClose} minHeight="20rem" maxWidth="34rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          {/* Supplier + platform */}
          <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="purchase-supplier">Supplier</LabelWithError>
              <PurchaseContactSelect
                collectionId={collectionId}
                fieldName="contactId"
                initialContactId={purchase?.contactId}
                initialContactName={purchase?.contactName}
                inputId="purchase-supplier"
                placeholder="Search or add a supplier…"
                disabled={isPending}
              />
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="purchase-platform">Platform</LabelWithError>
              <PurchaseContactSelect
                collectionId={collectionId}
                fieldName="platformId"
                role="platform"
                initialContactId={purchase?.platformId}
                initialContactName={purchase?.platformName}
                inputId="purchase-platform"
                placeholder="e.g. Allegro, eBay…"
                disabled={isPending}
              />
            </div>
          </div>

          {/* Date + currency + status */}
          <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="purchase-date">Date</LabelWithError>
              <input
                id="purchase-date"
                name="purchasedAt"
                type="date"
                defaultValue={purchase?.purchasedAt ?? today}
                max={today}
                disabled={isPending}
                required
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="purchase-currency">Currency</LabelWithError>
              <select
                id="purchase-currency"
                name="currency"
                defaultValue={purchase?.currency ?? baseCurrency}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="purchase-status">Status</LabelWithError>
              <select
                id="purchase-status"
                name="status"
                defaultValue={purchase?.status ?? "preparing"}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Shipping (a shared cost of the whole order, spread across its lines) */}
          <div>
            <LabelWithError htmlFor="purchase-shipping">Shipping / shared cost</LabelWithError>
            <input
              id="purchase-shipping"
              name="shippingCost"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              defaultValue={purchase?.shippingCost ?? ""}
              disabled={isPending}
              style={{ ...INPUT_STYLE, maxWidth: "10rem" }}
            />
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          onCancel={onClose}
          disabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
