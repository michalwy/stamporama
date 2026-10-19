import { isTerminalState, type OfferState } from "./offer-rules";

/**
 * A Facebook post's remembered UI state (#2081): whether its screen narrows the lots to the ones still
 * for sale.
 *
 * Once half the lots of a long post have sold, finding what is left to sell — to answer a buyer, or
 * to sell them several lots together — meant reading past every sold row. The chip is remembered
 * **per post**, the way the purchase order remembers its filter chips and a sale its expanded sets:
 * one post being worked through stays narrowed while another is read whole. Stored through the same
 * one-entry-per-record, most-recently-used index (`@/lib/purchase-ui-state` has the reasoning). An
 * entry is one flag, so the count is the cap that bites.
 *
 * Pure, so it tests without a DOM; the storage half is `offers/posts/[postNo]/post-ui-state.ts`.
 */

/** Posts kept before the least-recently-used one is dropped. */
export const MAX_POST_ENTRIES = 50;

/** Byte budget for all post entries together — a tiny slice of the ~5 MB origin quota. */
export const MAX_POST_BYTES = 20_000;

export interface FacebookPostUiState {
  /** Only the lots neither sold nor withdrawn are listed. */
  stillForSale: boolean;
}

export const EMPTY_FACEBOOK_POST_UI_STATE: FacebookPostUiState = Object.freeze({
  stillForSale: false,
}) as FacebookPostUiState;

/** Read a stored entry, tolerating anything: a malformed one reads as *no stored state*, which is
 * every lot listed — the screen's own default. */
export function parseFacebookPostUiState(raw: string | null): FacebookPostUiState {
  if (!raw) return EMPTY_FACEBOOK_POST_UI_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_FACEBOOK_POST_UI_STATE;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY_FACEBOOK_POST_UI_STATE;
  return { stillForSale: (parsed as Record<string, unknown>).stillForSale === true };
}

/** The entry to store, or null at the default (every lot listed) — such an entry is removed rather
 * than stored, so a post merely opened never takes one of the slots. */
export function serializeFacebookPostUiState(state: FacebookPostUiState): string | null {
  return state.stillForSale ? JSON.stringify({ stillForSale: true }) : null;
}

/** A lot still for sale: neither sold nor withdrawn — the reading the list of posts gives *for sale*
 * (`CLOSED_OFFER_STATES`). */
export function isFacebookLotForSale(state: OfferState): boolean {
  return !isTerminalState(state);
}

/** The lots the screen lists: all of them, or with *Still for sale* on only those still for sale, in
 * the order given. Ticks are not this function's business — a ticked lot it leaves out stays ticked. */
export function facebookLotsInView<T extends { state: OfferState }>(lots: readonly T[], stillForSale: boolean): T[] {
  return stillForSale ? lots.filter((l) => isFacebookLotForSale(l.state)) : [...lots];
}
