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
import {
  CREATABLE_OFFER_STATES,
  OFFER_STATE_LABEL,
  OFFER_LISTING_TYPES,
  OFFER_LISTING_TYPE_LABEL,
  type OfferListingType,
  isAuctionListing,
  normalizeListingType,
  priceLabel,
} from "@/lib/offer-rules";
import { PurchaseContactSelect } from "@/app/c/[collectionSlug]/purchases/purchase-contact-select";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import {
  fromLocalInputValue,
  toLocalInputValue,
} from "@/app/c/[collectionSlug]/auctions/auction-format";
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
  offer?: Pick<
    OfferDetail,
    | "platformId"
    | "platformName"
    | "url"
    | "price"
    | "currency"
    | "listingDate"
    | "listingType"
    | "startingPrice"
    | "endsAt"
  >;
  /** Pre-fills the platform on create — e.g. the platform the list is currently filtered by. Its
   * `platformCurrency` (#196) seeds the locked/derived currency so a pre-filled platform doesn't
   * show a misleading editable picker, its `defaultListingType` (#449) pre-selects how the listing
   * is sold, and its `defaultStartingPrice` (#362, narrowed in #449) seeds an auction's opening
   * figure when nothing better suggests one. */
  initialPlatform?: {
    id: string;
    name: string;
    platformCurrency?: string | null;
    defaultStartingPrice?: string | null;
    defaultListingType?: string | null;
  };
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
  /** Put the cursor straight in the money field on open, with its pre-filled figure selected so
   * typing replaces it. For flows that arrive here with everything else already decided — the
   * inventory "list these copies" path (#189/#277), where the platform is carried in and the price
   * is the one thing left to state. Lands on the starting price when the listing is an auction,
   * since that is where a suggested figure goes (#449). */
  autoFocusPrice?: boolean;
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
  autoFocusPrice = false,
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
  // The live price: an offer's own when editing, else whatever the parent suggests (a lot's price, a
  // catalog value) or nothing. It has no platform-level fallback of its own — that default is now an
  // auction's **starting** price (#449), seeded below.
  const [uncontrolledPrice, setUncontrolledPrice] = useState(offer?.price ?? "");
  // How the listing is sold (#449). Held in state because it renames the price field and reveals the
  // starting-price one — the two prices only make sense once you know which format you are in.
  // Seeded from the platform's own default (the price fallback's rule, #362): read at creation, and
  // stopped re-seeding the moment the collector answers the question themselves.
  const [listingType, setListingType] = useState<OfferListingType>(
    normalizeListingType(isEdit ? offer!.listingType : initialPlatform?.defaultListingType)
  );
  const [listingTypeTouched, setListingTypeTouched] = useState(false);
  const isAuction = isAuctionListing(listingType);
  // An auction's opening figure, seeded from the platform's own default on exactly the price
  // fallback's rule (#362): lowest priority, re-seeded on a platform change, and left alone the
  // moment the collector types one.
  const [startingPrice, setStartingPrice] = useState(
    offer?.startingPrice ?? (isEdit ? "" : (initialPlatform?.defaultStartingPrice ?? ""))
  );
  const [startingPriceTyped, setStartingPriceTyped] = useState(false);
  // When the auction closes (#490), held as the field's local-time value and converted to an instant
  // on submit. Never seeded from the last offer: a closing time belongs to one listing.
  const [endsAt, setEndsAt] = useState(toLocalInputValue(offer?.endsAt));
  // Where a parent's suggested figure lands (#449). It is what one would ask for the goods, which on
  // an auction is what one would open at — so it fills the starting price there and leaves the
  // current one blank, rather than recording a bid nobody placed.
  const suggestionFillsPrice = priceControlled && !isAuction;
  const suggestionFillsStartingPrice = priceControlled && isAuction;
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

  // Cursor straight in the money field on open (`autoFocusPrice`), on the one a suggestion fills:
  // the asking price on a quick buy, the starting price on an auction. Selected rather than merely
  // focused, so a pre-filled suggestion is overwritten by simply typing. Mount-only — once the
  // collector is in the form, nothing here may pull the cursor out from under them.
  const priceRef = useRef<HTMLInputElement>(null);
  const startingPriceRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocusPrice || !showPriceField) return;
    const el = isAuction ? startingPriceRef.current : priceRef.current;
    el?.focus();
    el?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              onSelectionChange={(id, _name, platform) => {
                setPlatformId(id);
                // A picked platform carries its currency (null when unset); a typed name is an
                // unknown/new platform, so its currency is prompted below. Ignored in edit mode.
                if (!isEdit) setPlatformCurrency(id ? platform?.platformCurrency : undefined);
                // …how it sells by default (#449), re-seeded while the collector has not answered
                // the question themselves, so switching from an auction platform to a quick-buy one
                // does not leave the wrong format behind…
                if (!isEdit && !listingTypeTouched) {
                  setListingType(normalizeListingType(id ? platform?.defaultListingType : null));
                }
                // …and the opening figure that goes with it (#362/#449), on the same rule: switching
                // platforms mid-form must not leave the previous house's starting price behind.
                if (!isEdit && !startingPriceTyped) {
                  setStartingPrice((id && platform?.defaultStartingPrice) || "");
                }
              }}
            />
          </div>

          {/* How the listing is sold (#449), beside the currency it is priced in: both say how to
              read the figures below rather than being figures themselves. A quick buy states one
              price; an auction's price is where the bidding stands, and the opening figure gets its
              own field. Available when editing too — a listing posted as one format was never
              re-posted as the other, but a mis-set type is worth correcting. */}
          <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
            <div style={{ flex: 1 }}>
              <LabelWithError htmlFor="offer-listing-type">Listing type</LabelWithError>
              <select
                id="offer-listing-type"
                name="listingType"
                value={listingType}
                onChange={(e) => {
                  setListingType(normalizeListingType(e.target.value));
                  setListingTypeTouched(true);
                }}
                disabled={isPending}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
              >
                {OFFER_LISTING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {OFFER_LISTING_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
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

          {/* The money. It is only asked for when the composition is known — editing, or duplicating
              (#200); on a plain create it follows from the copies you add later, so it is deferred.

              Which field the parent's **suggestion** lands in follows the listing type (#449). A
              suggested figure — the copies' catalog value, a lot's price, the source offer's price —
              is what one would *ask* for the goods, so on an auction it is what one would **open**
              at, not a bid somebody has placed. It therefore fills the starting price there, and the
              current price is left blank: an auction nobody has bid on has no current figure at all,
              and inventing one would put a bid in the record that never happened. */}
          {showPriceField && (
            <div style={{ display: "flex", gap: "0.75rem", ...FIELD_GAP }}>
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="offer-price">{priceLabel(listingType)}</LabelWithError>
                <NumericInput
                  ref={priceRef}
                  id="offer-price"
                  name="price"
                  placeholder="0.00"
                  disabled={isPending}
                  style={INPUT_STYLE}
                  {...(suggestionFillsPrice
                    ? { value: priceValue, onChange: (e) => onPriceValueChange?.(e.target.value) }
                    : {
                        value: uncontrolledPrice,
                        onChange: (e) => setUncontrolledPrice(e.target.value),
                      })}
                />
                {isAuction && (
                  <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.25rem 0 0" }}>
                    Leave blank until somebody bids — an auction has no current price before that.
                  </p>
                )}
              </div>
              {isAuction && (
                <div style={{ flex: 1 }}>
                  <LabelWithError htmlFor="offer-starting-price">Starting price</LabelWithError>
                  <NumericInput
                    ref={startingPriceRef}
                    id="offer-starting-price"
                    name="startingPrice"
                    placeholder="0.00"
                    disabled={isPending}
                    required
                    style={INPUT_STYLE}
                    {...(suggestionFillsStartingPrice
                      ? { value: priceValue, onChange: (e) => onPriceValueChange?.(e.target.value) }
                      : {
                          value: startingPrice,
                          onChange: (e) => {
                            setStartingPrice(e.target.value);
                            setStartingPriceTyped(true);
                          },
                        })}
                  />
                </div>
              )}
            </div>
          )}

          {/* Listing URL — always available; a fresh offer may not have a live listing yet, so it's
              optional (#213 keeps it editable later). Never pre-filled from the last offer. Sits
              ahead of status and date (#287): the URL is what you paste in from the listing, the
              other two are usually left at their remembered values. */}
          <div style={FIELD_GAP}>
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

          {/* Status + listing date (#257). Status is create-only — an existing offer's lifecycle is
              driven by its own controls. A live status (Ready / Active) needs the offer to list
              something and to carry an asking price (#336); the server rejects either and the
              message lands on the dialog's error line. Both pre-fill from the last created
              offer so repeated listings are fast. */}
          <div style={{ display: "flex", gap: "0.75rem" }}>
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

          {/* When the auction closes (#490) — asked only of an auction, which is the only listing
              that ends of its own accord. It is what the "ended with a bid on it" flag is read
              against, and on a connected platform the sync keeps it current by itself (#481), so
              this is for the marketplaces the app cannot see. The field converts to an instant in
              the browser, the only place the collector's own zone is known. */}
          {isAuction && (
            <div style={FIELD_GAP}>
              <LabelWithError htmlFor="offer-ends-at">Closes (optional)</LabelWithError>
              <input
                id="offer-ends-at"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              />
              <input type="hidden" name="endsAt" value={fromLocalInputValue(endsAt)} />
            </div>
          )}

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
