// What one field saved on an offer's own screen makes the screen read again (#2426) — pure, so the
// rule is unit-tested rather than inferred from which requests a save happens to send.
//
// The offer's screen reads the offer as a handful of separate questions — its detail (a valuation and
// a ready gate), its copies, its photo plan, the cover walk, its listing duplicates, its untranslated
// names — and a save used to ask every one of them again, along with every other offer read on the
// collection. A field edits the offer's own columns: it cannot move a copy, change a photo, a cover or
// what another live offer lists, so those reads stay as they are. Everything else under the offers
// key — the offer's detail and every other offer read, most of them inactive on this screen and only
// marked stale — is re-read as before.

import { isListedState } from "./offer-listing-drift";
import type { OfferState } from "./offer-rules";

/** The inline fields of the offer's header and texts, as `patchOfferAction` saves them. */
export type OfferInlineField =
  | "price"
  | "startingPrice"
  | "url"
  | "descriptionFormat"
  | "name"
  | "description"
  | "privateNote";

/** The offer's own reads that no inline field can change: what it holds, what it looks like, and
 *  what other offers list. */
const COMPOSITION_READS = new Set<unknown>(["copies", "photo-plan", "cover-walk"]);

/** The texts whose untranslated names the screen reports (#1889, #1733). */
const TEXT_FIELDS = new Set<OfferInlineField>(["name", "description", "privateNote"]);

/**
 * Whether saving `field` on offer `offerId` can change the read under `queryKey` — a key under the
 * offers key, `["offers", collectionId, kind, …]`.
 *
 * Another offer's reads, and every collection-wide one, are always re-read: a list, its counts and
 * summary, Prepare, the posts, the lists of offers by copy all show this offer's figures or texts.
 * Of this offer's own: never its copies, photo plan or cover walk; never its listing duplicates
 * (#1347), which are the *other* live offers listing what this one lists; its untranslated names
 * only after a text. Its detail always.
 */
export function fieldSaveRereads(
  field: OfferInlineField,
  offerId: string,
  queryKey: readonly unknown[]
): boolean {
  const [, , kind, id, part] = queryKey;
  if (id !== offerId) return true;
  if (kind === "detail") return part === undefined;
  if (kind === "translation-gaps") return TEXT_FIELDS.has(field);
  return !COMPOSITION_READS.has(kind);
}

/**
 * Whether saving an inline field can change what the notification centre counts. Only through
 * *Changed since listed* (#542): an edit to an offer that is up on its platform leaves the listing
 * behind, and to one that was never posted — Preparing, Ready — or is closed leaves nothing behind.
 * No other group reads an offer's price, texts or link.
 */
export function fieldSaveTouchesActionItems(state: OfferState): boolean {
  return isListedState(state);
}
