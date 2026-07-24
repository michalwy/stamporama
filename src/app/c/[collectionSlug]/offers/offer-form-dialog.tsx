"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import type { OfferDetail } from "@/lib/offers";
import { CREATABLE_OFFER_STATES, OFFER_STATE_LABEL } from "@/lib/offer-rules";
import { PurchaseContactSelect } from "@/app/c/[collectionSlug]/purchases/purchase-contact-select";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { useLastOfferDefaults } from "./use-last-offer-defaults";

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

/** Today as `YYYY-MM-DD` in the local timezone — the listing-date default for a fresh offer. */
function todayIso(): string {
  const now = new Date();
  const tz = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tz).toISOString().slice(0, 10);
}

/** A stored listing date (UTC `@db.Date`) as `YYYY-MM-DD`, or "" when not recorded. */
function formatListingDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export interface OfferFormDialogProps {
  collectionId: string;
  baseCurrency: string;
  /** The offer being edited (edit mode). Omit for create. */
  offer?: Pick<OfferDetail, "platformId" | "platformName" | "url" | "price" | "currency" | "listingDate">;
  /** Pre-fills the platform on create — e.g. the platform the list is currently filtered by. Its
   * `platformCurrency` (#196) seeds the locked/derived currency so a pre-filled platform doesn't
   * show a misleading editable picker. */
  initialPlatform?: { id: string; name: string; platformCurrency?: string | null };
  isPending: boolean;
  error?: string;
  /** Raises the dialog's stacking when opened on top of another dialog (e.g. the inventory
   * add-to-offer picker's "create new offer" path, #189). */
  zIndexBase?: number;
  /** Show the asking-price field on create. Off by default — a fresh offer's price follows from the
   * copies you add later. On for the duplicate flow (#200), where the composition is already known
   * so pricing it for the new platform up front makes sense. */
  showPrice?: boolean;
  /** Controls the asking-price field. When set, the input is controlled and every keystroke calls
   * `onPriceValueChange` — lets the parent recompute it (e.g. converting on a currency change). */
  priceValue?: string;
  onPriceValueChange?: (value: string) => void;
  /** Seeds the currency picker's default on a non-edit form when the platform has no currency yet
   * (else `baseCurrency`). The duplicate flow carries the source offer's currency over. */
  initialCurrency?: string;
  /** Fires with the effective currency (locked from the platform, else the picker's value) whenever
   * it changes — the duplicate flow converts the carried-over price against it. */
  onCurrencyChange?: (currency: string | null) => void;
  /** Overrides the dialog title / submit label — used by the duplicate flow (#200). */
  title?: string;
  submitLabel?: string;
  /** A line describing what a non-edit form is seeded from (e.g. "Copying 3 sets from …"), shown in
   * place of the default "add the copies next" hint. */
  sourceNote?: React.ReactNode;
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
  zIndexBase,
  showPrice = false,
  priceValue,
  onPriceValueChange,
  initialCurrency,
  onCurrencyChange,
  title: titleProp,
  submitLabel,
  sourceNote,
  onClose,
  onSubmit,
}: OfferFormDialogProps) {
  const isEdit = !!offer;
  // Whether the price field shows: always when editing, opt-in (duplicate) otherwise.
  const showPriceField = isEdit || showPrice;
  // Status + listing date pre-fills (#257): remembered per collection for a fresh offer; an edit
  // seeds the date from the offer itself and has no status field (lifecycle controls own it). The URL
  // is never remembered — always specific to the individual offer.
  const [lastDefaults] = useLastOfferDefaults(collectionId);
  const defaultState = lastDefaults?.state ?? "preparing";
  const defaultListingDate = isEdit
    ? formatListingDate(offer!.listingDate)
    : lastDefaults?.listingDate || todayIso();
  const priceControlled = priceValue !== undefined;
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
  // The unlocked picker's chosen value (which becomes the platform's currency). Tracked in state so
  // the effective currency can be reported up for price conversion (#200).
  const [pickedCurrency, setPickedCurrency] = useState(initialCurrency ?? baseCurrency);
  const effectiveCurrency = lockedCurrency ?? pickedCurrency;

  // Report the effective currency (locked or picked) whenever it changes, via a ref so a parent
  // needn't memoize the callback. Fires on mount too, so the parent has the starting currency.
  const onCurrencyChangeRef = useRef(onCurrencyChange);
  useEffect(() => {
    onCurrencyChangeRef.current = onCurrencyChange;
  });
  useEffect(() => {
    onCurrencyChangeRef.current?.(effectiveCurrency);
  }, [effectiveCurrency]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  const title = titleProp ?? (isEdit ? "Edit offer" : "New offer");
  const doneLabel = submitLabel ?? (isEdit ? "Save changes" : "Create offer");
  const actionLabel = isPending
    ? isEdit ? "Saving…" : "Creating…"
    : doneLabel;

  return (
    <DialogShell title={title} onClose={onClose} minHeight="20rem" maxWidth="34rem" zIndexBase={zIndexBase}>
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

          {/* Price + currency. The asking price is only asked for when the composition is known —
              editing, or duplicating (#200). On a plain create it follows from the copies you add
              later, so it is deferred. */}
          <div style={{ display: "flex", gap: "0.75rem", ...(showPriceField ? FIELD_GAP : {}) }}>
            {showPriceField && (
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="offer-price">Asking price</LabelWithError>
                <NumericInput
                  id="offer-price"
                  name="price"
                  placeholder="0.00"
                  disabled={isPending}
                  style={INPUT_STYLE}
                  {...(priceControlled
                    ? { value: priceValue, onChange: (e) => onPriceValueChange?.(e.target.value) }
                    : { defaultValue: offer?.price ?? "" })}
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
                    value={pickedCurrency}
                    onChange={(e) => setPickedCurrency(e.target.value)}
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

          {/* Status + listing date (#257). Status is create-only — an existing offer's lifecycle is
              driven by its own controls. A live status (Ready / Active) needs the offer to list
              something; the server rejects it on a set-less offer. Both pre-fill from the last created
              offer so repeated listings are fast. */}
          <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
            {!isEdit && (
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="offer-state">Status</LabelWithError>
                <select
                  id="offer-state"
                  name="state"
                  defaultValue={defaultState}
                  disabled={isPending}
                  style={{ ...INPUT_STYLE, cursor: "pointer" }}
                >
                  {CREATABLE_OFFER_STATES.map((s) => (
                    <option key={s} value={s}>
                      {OFFER_STATE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="offer-listing-date">Listing date (optional)</LabelWithError>
              <input
                id="offer-listing-date"
                name="listingDate"
                type="date"
                defaultValue={defaultListingDate}
                disabled={isPending}
                style={INPUT_STYLE}
              />
            </div>
          </div>

          {/* Listing URL — always available; a fresh offer may not have a live listing yet, so it's
              optional (#213 keeps it editable later). Never pre-filled from the last offer. */}
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

          {!isEdit && sourceNote && (
            <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              {sourceNote}
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
