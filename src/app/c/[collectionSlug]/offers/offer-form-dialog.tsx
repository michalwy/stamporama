"use client";

import { useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import type { OfferDetail } from "@/lib/offers";
import { PurchaseContactSelect } from "@/app/c/[collectionSlug]/purchases/purchase-contact-select";

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

export interface OfferFormDialogProps {
  collectionId: string;
  baseCurrency: string;
  /** The offer being edited (edit mode). Omit for create. */
  offer?: Pick<OfferDetail, "platformId" | "platformName" | "url" | "price" | "currency">;
  /** Pre-fills the platform on create — e.g. the platform the list is currently filtered by. Its
   * `platformCurrency` (#196) seeds the locked/derived currency so a pre-filled platform doesn't
   * show a misleading editable picker. */
  initialPlatform?: { id: string; name: string; platformCurrency?: string | null };
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

/** Create or edit an offer's header (ADR-0013): platform, asking price + currency, optional
 * listing URL. The offer's composition (its sets) is built afterwards on the offer detail screen,
 * so there is no lot to pick here. */
export function OfferFormDialog({
  collectionId,
  baseCurrency,
  offer,
  initialPlatform,
  isPending,
  error,
  onClose,
  onSubmit,
}: OfferFormDialogProps) {
  const isEdit = !!offer;
  const [, setPlatformId] = useState(offer?.platformId ?? initialPlatform?.id ?? "");
  // The currency the picked platform is locked to (#196). Editing keeps the offer's own snapshot;
  // creating derives it from the platform — a known currency locks the field, an unset one (or a
  // brand-new platform) shows an inline picker whose value becomes the platform's currency.
  const [platformCurrency, setPlatformCurrency] = useState<string | null | undefined>(
    isEdit ? undefined : (initialPlatform?.platformCurrency ?? undefined)
  );
  const lockedCurrency = isEdit
    ? offer!.currency
    : typeof platformCurrency === "string" && platformCurrency
      ? platformCurrency
      : null;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  const title = isEdit ? "Edit offer" : "New offer";
  const actionLabel = isPending
    ? isEdit ? "Saving…" : "Creating…"
    : isEdit ? "Save changes" : "Create offer";

  return (
    <DialogShell title={title} onClose={onClose} minHeight="20rem" maxWidth="34rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          {/* Platform */}
          <div style={FIELD_GAP}>
            <LabelWithError htmlFor="offer-platform">Platform</LabelWithError>
            <PurchaseContactSelect
              collectionId={collectionId}
              idFieldName="platformId"
              nameFieldName="platformName"
              role="platform"
              initialContactId={offer?.platformId ?? initialPlatform?.id}
              initialContactName={offer?.platformName ?? initialPlatform?.name}
              inputId="offer-platform"
              placeholder="e.g. Delcampe, Allegro, Colnect…"
              disabled={isPending}
              onSelectionChange={(id, _name, pc) => {
                setPlatformId(id);
                // A picked platform carries its currency (null when unset); a typed name is an
                // unknown/new platform, so its currency is prompted below. Ignored in edit mode.
                if (!isEdit) setPlatformCurrency(id ? pc : undefined);
              }}
            />
          </div>

          {/* Price + currency. The asking price is only asked for when editing — at creation you
              rarely know it yet (it follows from the copies you add), so it is set later. */}
          <div style={{ display: "flex", gap: "0.75rem", ...(isEdit ? FIELD_GAP : {}) }}>
            {isEdit && (
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="offer-price">Asking price</LabelWithError>
                <input
                  id="offer-price"
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  defaultValue={offer?.price ?? ""}
                  disabled={isPending}
                  style={INPUT_STYLE}
                />
              </div>
            )}
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="offer-currency">Currency</LabelWithError>
              {lockedCurrency ? (
                // Inherited from the platform and locked (#196). Submitted as a hidden field so the
                // server has it as a first-offer fallback; ignored once the platform has a currency.
                <>
                  <input type="hidden" name="currency" value={lockedCurrency} />
                  <div style={{ ...INPUT_STYLE, display: "flex", alignItems: "center", color: "var(--color-text-muted)", cursor: "not-allowed" }}>
                    {lockedCurrency} · from platform
                  </div>
                </>
              ) : (
                <>
                  <select
                    id="offer-currency"
                    name="currency"
                    defaultValue={baseCurrency}
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

          {/* Listing URL — only when editing; a fresh offer has no live listing yet. */}
          {isEdit && (
            <div>
              <LabelWithError htmlFor="offer-url">Listing URL (optional)</LabelWithError>
              <input
                id="offer-url"
                name="url"
                type="url"
                placeholder="https://…"
                defaultValue={offer?.url ?? ""}
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
          )}

          {!isEdit && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              Add the copies (sets) next, then set the asking price and listing URL once you know
              them.
            </p>
          )}
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
