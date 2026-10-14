// The message to a buyer after a sale (#1815) — pure, no Prisma and no `server-only`, because the
// template's editors are client components and list the very placeholders the renderer fills.
//
// After a sale the collector writes the buyer how much to pay, the account to pay into and what
// happens next. Everything but the account and the next steps is on the sale, so a template per
// platform writes it: the account and the steps are ordinary text in the template, the figures are
// placeholders. The message goes into a chat, so it is **plain text** — no formatting is read.
//
// What a placeholder comes out as is the template's whole contract: nothing is added, substituted or
// fallen back to (#1692). A placeholder with nothing to say is empty, and a platform with no template
// has no message at all.

import { generatedAmount } from "./decimal-input";

/** One placeholder a buyer message may carry, with the label and example its editor shows. */
export interface BuyerMessagePlaceholder {
  token: string;
  label: string;
  example: string;
}

/**
 * The placeholders a buyer message may carry, settled in writing the issue (#1815). Amounts are
 * `generatedAmount`'s (#1787), each with its currency.
 */
export const BUYER_MESSAGE_PLACEHOLDERS: readonly BuyerMessagePlaceholder[] = [
  { token: "{buyer}", label: "Buyer's name", example: "Jan Kowalski" },
  { token: "{items}", label: "Items sold, one per line", example: "#412 Austria 1850 Mercury" },
  { token: "{itemsTotal}", label: "Items' total", example: "25 PLN" },
  { token: "{shipping}", label: "Chosen shipping and its price", example: "Registered letter — 12 PLN" },
  { token: "{total}", label: "Total to pay", example: "37 PLN" },
  { token: "{shippingOptions}", label: "Shipping options at the buyer's price, one per line", example: "Registered letter — 12 PLN" },
  { token: "{sale}", label: "Sale number", example: "57" },
];

/** One item sold, as `{items}` lists it: the offer's number and title. */
export interface BuyerMessageItem {
  /** The offer it was sold through, or null where that offer is gone. */
  offerNo: number | null;
  title: string;
  /** The line's price in the sale's currency, as a 2-dp string. */
  price: string;
}

/** One of the platform's shipping options, as `{shippingOptions}` lists it. */
export interface BuyerMessageShippingOption {
  name: string;
  /** What the buyer pays for it (#1909), in its own currency, as a 2-dp string. */
  price: string;
  currency: string;
}

/** What a sale gives its buyer message. */
export interface BuyerMessageSale {
  saleNo: number;
  buyerName: string | null;
  currency: string;
  items: readonly BuyerMessageItem[];
  /** The shipping option on the sale, or null before one is chosen. */
  shippingOptionName: string | null;
  /** What the buyer pays for postage — the sale's buyer handling, entered or derived from the total
   *  they paid (#205) — as a 2-dp string, or null where the sale records none. */
  buyerHandling: string | null;
  shippingOptions: readonly BuyerMessageShippingOption[];
}

function money(amount: string, currency: string): string {
  return `${generatedAmount(amount)} ${currency}`;
}

/** The two halves of a listed line, the way a post's template examples join them. */
function priced(name: string, price: string | null): string {
  return price === null ? name : `${name} — ${price}`;
}

/**
 * Each placeholder's value for this sale. **The total includes the postage once a shipping option is
 * on the sale** (decided with the collector, 2026-10-11): the items plus what the buyer pays for it;
 * before that it is the items alone, and `{shippingOptions}` lets the buyer choose. The price of a
 * chosen option is what the sale says the buyer pays — its buyer handling — while the options list
 * each one's buyer price from the platform's options (the collector's choice, the same day; the
 * buyer's price rather than the collector's cost since #1909).
 */
export function buyerMessageValues(sale: BuyerMessageSale): Record<string, string> {
  // Summed in cents: the prices are 2-dp strings, and a float sum of them can land a cent off.
  const cents = (amount: string) => Math.round(Number(amount) * 100);
  const itemsCents = sale.items.reduce((sum, item) => sum + cents(item.price), 0);
  const chosen = sale.shippingOptionName;
  const postageCents = chosen !== null && sale.buyerHandling !== null ? cents(sale.buyerHandling) : 0;
  return {
    "{buyer}": sale.buyerName ?? "",
    "{items}": sale.items
      .map((item) => (item.offerNo === null ? item.title : `#${item.offerNo} ${item.title}`))
      .join("\n"),
    "{itemsTotal}": money((itemsCents / 100).toFixed(2), sale.currency),
    "{shipping}":
      chosen === null
        ? ""
        : priced(chosen, sale.buyerHandling === null ? null : money(sale.buyerHandling, sale.currency)),
    "{total}": money(((itemsCents + postageCents) / 100).toFixed(2), sale.currency),
    "{shippingOptions}": sale.shippingOptions
      .map((option) => priced(option.name, money(option.price, option.currency)))
      .join("\n"),
    "{sale}": String(sale.saleNo),
  };
}

const TOKEN = /\{[A-Za-z]+\}/g;

/**
 * The message for this sale. A token that is not a placeholder stays as typed — the rule of every
 * template here — and nothing else is touched: the template's own lines and spacing are the message's.
 */
export function renderBuyerMessage(template: string, sale: BuyerMessageSale): string {
  const values = buyerMessageValues(sale);
  return template.replace(TOKEN, (token) => values[token] ?? token);
}

/** The tokens a template carries that are not placeholders — named beside the field while it is typed,
 *  so a misspelt `{totl}` is seen there rather than in the buyer's chat. */
export function unknownBuyerMessagePlaceholders(template: string): string[] {
  const known = new Set(BUYER_MESSAGE_PLACEHOLDERS.map((p) => p.token));
  return [...new Set(template.match(TOKEN) ?? [])].filter((token) => !known.has(token));
}
