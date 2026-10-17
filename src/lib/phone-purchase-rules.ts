// A purchase started on the phone (#2006, ADR-0072), its pure half: what the phone's form must say
// before anything is written, the words of the desk's mark, and how a noted stamp is named. Pure, so
// the unit suite holds it; `startPurchaseOnPhone` (`purchases.ts`) does the write.
//
// What the phone writes was decided with the collector on 2026-10-17: a real purchase, stored
// `arrived` (bought at a fair is in hand), with **one open lot** priced at the amount paid and titled
// by the description — no copies, no cost split, both of which stay at the desk — and the stamps it
// was told about noted on the purchase, **only the stamp**, as a reminder of what is in the parcel.

import { COMMON_CURRENCIES } from "./currencies";
import { normalizeDecimalInput, roundAmount } from "./decimal-input";
import { formatEntityNo } from "./quick-jump";

/** The desk's mark on such a purchase, on the purchase list and its own screen. */
export const PHONE_PURCHASE_MARK = "Started on the phone — to complete";

/** The desk's action that takes the mark off — named apart from the status's *Mark completed*. */
export const DONE_AT_DESK_LABEL = "Done at the desk";

/** How many stamps one purchase can note — a fair's purchase, not a stockbook's contents. */
export const PHONE_PURCHASE_STAMP_LIMIT = 50;

/** What the phone's form sends, as strings off the form. */
export interface PhonePurchaseFields {
  sellerName: string;
  amount: string;
  currency: string;
  purchasedAt: string;
  description: string;
  stampIds: readonly string[];
}

/** The form read and checked: what `startPurchaseOnPhone` writes. */
export interface PhonePurchaseInput {
  /** An existing contact by its name, or the name of a new one (`resolvePurchaseContact`). */
  sellerName: string;
  /** The amount paid, two decimals — the one lot's price. */
  amount: number;
  currency: string;
  /** `yyyy-mm-dd`. */
  purchasedAt: string;
  /** The lot's title; null when nothing was written. */
  description: string | null;
  /** In the order picked, each once. */
  stampIds: string[];
}

/**
 * The form checked, or the sentence that says what is missing. Seller, amount, currency and date are
 * required (#2006); the stamps and the description are not. `today` is the server's date, so a date
 * after it is refused as the desk's own date field refuses one.
 */
export function readPhonePurchaseFields(
  fields: PhonePurchaseFields,
  today: string
): { input: PhonePurchaseInput } | { error: string } {
  const sellerName = fields.sellerName.trim();
  if (!sellerName) return { error: "Who was it bought from?" };

  const amountText = fields.amount.trim();
  if (!amountText) return { error: "How much was paid?" };
  const amount = Number(normalizeDecimalInput(amountText));
  if (!Number.isFinite(amount) || amount < 0) return { error: "The amount paid is not an amount." };

  const currency = fields.currency.trim();
  if (!(COMMON_CURRENCIES as readonly string[]).includes(currency)) {
    return { error: "Choose the currency it was paid in." };
  }

  const purchasedAt = fields.purchasedAt.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt) || Number.isNaN(Date.parse(purchasedAt))) {
    return { error: "When was it bought?" };
  }
  if (purchasedAt > today) return { error: "The date cannot be after today." };

  const stampIds = [...new Set(fields.stampIds.map((id) => id.trim()).filter(Boolean))];
  if (stampIds.length > PHONE_PURCHASE_STAMP_LIMIT) {
    return { error: `At most ${PHONE_PURCHASE_STAMP_LIMIT} stamps can be noted on one purchase.` };
  }

  return {
    input: {
      sellerName,
      amount: Number(roundAmount(amount)),
      currency,
      purchasedAt,
      description: fields.description.trim() || null,
      stampIds,
    },
  };
}

/** A noted stamp as the desk's card and the phone's screen list it. */
export interface NotedStamp {
  stampId: string;
  stampNo: number;
  name: string | null;
  /** Catalogue numbers as the collector reads them (`Mi·PL 200`), primary first. */
  catalogNumbers: string[];
}

/**
 * A noted stamp's name: its own name, else its leading catalogue number, else its short number — the
 * phone stamp screen's title, so the row and the screen it opens are named alike.
 */
export function notedStampTitle(stamp: Pick<NotedStamp, "name" | "catalogNumbers" | "stampNo">): string {
  return stamp.name ?? stamp.catalogNumbers[0] ?? `Stamp ${formatEntityNo(stamp.stampNo)}`;
}

/** The line under the title: every catalogue number, then the short number (`#901`). */
export function notedStampNumbers(stamp: Pick<NotedStamp, "catalogNumbers" | "stampNo">): string {
  return [...stamp.catalogNumbers, formatEntityNo(stamp.stampNo)].join(" · ");
}
