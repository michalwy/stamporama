"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { PurchaseContactSelect } from "@/app/c/[collectionSlug]/purchases/purchase-contact-select";
import type { SaleHeaderRaw } from "@/app/actions/sales";

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

export interface SaleFormDialogInitial {
  platformId: string;
  platformName: string;
  buyerId: string | null;
  buyerName: string | null;
  externalRef: string;
  soldAt: string;
  currency: string;
  buyerHandling: string;
  commission: string;
}

export interface SaleFormDialogProps {
  mode: "add" | "edit";
  collectionId: string;
  baseCurrency: string;
  today: string;
  /** Existing header values in edit mode. */
  initial?: SaleFormDialogInitial;
  /** Blocks platform change (edit mode with sold units already recorded). */
  platformLocked?: boolean;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (raw: SaleHeaderRaw) => void;
}

/** Create or edit a sale header (ADR-0012, #166): platform, buyer, date, currency, and the two
 * sale-time shared amounts (buyer handling + commission). The sold units and my shipping cost
 * are managed on the sale's detail screen. Mirrors the purchase header form (#120). */
export function SaleFormDialog({
  mode,
  collectionId,
  baseCurrency,
  today,
  initial,
  platformLocked,
  isPending,
  error,
  onClose,
  onSubmit,
}: SaleFormDialogProps) {
  const [platformId, setPlatformId] = useState(initial?.platformId ?? "");
  const [platformName, setPlatformName] = useState(initial?.platformName ?? "");
  const [buyerId, setBuyerId] = useState(initial?.buyerId ?? "");
  const [buyerName, setBuyerName] = useState(initial?.buyerName ?? "");
  const [externalRef, setExternalRef] = useState(initial?.externalRef ?? "");
  const [soldAt, setSoldAt] = useState(initial?.soldAt ?? today);
  // Currency is inherited from the platform and locked (#196). Editing keeps the sale's snapshot;
  // recording a new sale derives it from the platform — a known currency locks the field, an unset
  // one (or a brand-new platform) shows an inline picker whose value becomes the platform's currency.
  const [platformCurrency, setPlatformCurrency] = useState<string | null | undefined>(undefined);
  const [currency, setCurrency] = useState(baseCurrency);
  const lockedCurrency =
    mode === "edit"
      ? (initial?.currency ?? null)
      : typeof platformCurrency === "string" && platformCurrency
        ? platformCurrency
        : null;
  const [buyerHandling, setBuyerHandling] = useState(initial?.buyerHandling ?? "");
  const [commission, setCommission] = useState(initial?.commission ?? "");

  const title = mode === "add" ? "Record a sale" : "Edit sale header";
  const actionLabel = isPending
    ? mode === "add"
      ? "Starting…"
      : "Saving…"
    : mode === "add"
      ? "Continue"
      : "Save changes";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit({
      platformId: platformId || null,
      platformName: platformName || null,
      buyerId: buyerId || null,
      buyerName: buyerName || null,
      externalRef,
      soldAt,
      // Locked to the platform's currency; the setter's value only applies as the first-sale
      // fallback that sets an unset platform's currency (#196).
      currency: lockedCurrency ?? currency,
      buyerHandling,
      commission,
    });
  }

  return (
    <DialogShell title={title} onClose={onClose} minHeight="22rem" maxWidth="34rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          {/* Platform + buyer */}
          <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="sale-platform">Platform</LabelWithError>
              <PurchaseContactSelect
                collectionId={collectionId}
                idFieldName="platformId"
                nameFieldName="platformName"
                role="platform"
                initialContactId={initial?.platformId}
                initialContactName={initial?.platformName}
                inputId="sale-platform"
                placeholder="e.g. Delcampe, Allegro…"
                disabled={isPending || platformLocked}
                onSelectionChange={(id, name, pc) => {
                  setPlatformId(id);
                  setPlatformName(name);
                  // A picked platform carries its fixed currency (null when unset); a typed name is
                  // an unknown/new platform, so its currency is prompted below (#196). Editing keeps
                  // the sale's snapshot, so the platform's currency is not tracked then.
                  if (mode !== "edit") setPlatformCurrency(id ? pc : undefined);
                }}
              />
              {platformLocked && (
                <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.25rem 0 0" }}>
                  Remove the sold units first to change the platform.
                </p>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="sale-buyer">Buyer</LabelWithError>
              <PurchaseContactSelect
                collectionId={collectionId}
                idFieldName="buyerId"
                nameFieldName="buyerName"
                role="buyer"
                initialContactId={initial?.buyerId ?? undefined}
                initialContactName={initial?.buyerName ?? undefined}
                inputId="sale-buyer"
                placeholder="Search or add a buyer…"
                disabled={isPending}
                onSelectionChange={(id, name) => {
                  setBuyerId(id);
                  setBuyerName(name);
                }}
              />
            </div>
          </div>

          {/* Date + currency */}
          <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="sale-date">Sale date</LabelWithError>
              <input
                id="sale-date"
                type="date"
                value={soldAt}
                max={today}
                onChange={(e) => setSoldAt(e.target.value)}
                disabled={isPending}
                required
                style={INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="sale-currency">Currency</LabelWithError>
              {lockedCurrency ? (
                // Inherited from the platform and locked (#196).
                <div style={{ ...INPUT_STYLE, display: "flex", alignItems: "center", color: "var(--color-text-muted)", cursor: "not-allowed" }}>
                  {lockedCurrency} · from platform
                </div>
              ) : (
                <>
                  <select
                    id="sale-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    disabled={isPending}
                    style={{ ...INPUT_STYLE, cursor: "pointer" }}
                  >
                    {COMMON_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.25rem 0 0" }}>
                    Sets this platform&apos;s currency — all its offers and sales will use it.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* External transaction / order number */}
          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="sale-external-ref">Order number (optional)</LabelWithError>
            <input
              id="sale-external-ref"
              type="text"
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              placeholder="Transaction / order no. in the marketplace"
              disabled={isPending}
              style={INPUT_STYLE}
            />
          </div>

          {/* Sale-time shared amounts */}
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="sale-handling">Buyer handling</LabelWithError>
              <input
                id="sale-handling"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={buyerHandling}
                onChange={(e) => setBuyerHandling(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              />
              <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.25rem 0 0" }}>
                + paid by buyer
              </p>
            </div>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="sale-commission">Commission</LabelWithError>
              <input
                id="sale-commission"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              />
              <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.25rem 0 0" }}>
                − platform fee
              </p>
            </div>
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
