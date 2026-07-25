"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createOffer,
  duplicateOffer,
  updateOffer,
  setOfferState,
  setOfferInActiveBidding,
  deleteOffer,
  patchOffer,
  regenerateOfferText,
  type OfferTextField,
  addOfferSet,
  addOfferSetsPerCopy,
  addItemToOfferSet,
  updateOfferSet,
  removeOfferSet,
  previewOfferTitle,
  offerTranslationGaps,
  type OfferTitlePreview,
  OfferActionBlockedError,
  type OfferInput,
} from "@/lib/offers";
import type { TitleFallback } from "@/lib/offer-title-template";
import { resolvePurchaseContact } from "@/lib/contacts";
import {
  isOfferState,
  isCreatableOfferState,
  parsePrice,
  parseOfferDate,
  normalizeUrl,
  type OfferState,
} from "@/lib/offer-rules";

// Server actions for offer-owned composition (ADR-0013). Thin wrappers over the `offers` domain
// module; each returns a discriminated `{ status }` union the client dialogs render. Domain guards
// surface as friendly `error` messages. The collision check is a separate read (the
// `offers/collision` endpoint) surfaced as a non-blocking warning, so it lives outside these
// mutations by design.

export type OfferActionState =
  | { status: "success" }
  | { status: "error"; message: string };

export type CreateOfferActionState =
  | { status: "success"; id: string }
  | { status: "error"; message: string };

export type DuplicateOfferActionState =
  | { status: "success"; id: string; skippedCopies: number }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string | null) ?? "").trim();
}

function fail(e: unknown, fallback: string): { status: "error"; message: string } {
  if (e instanceof OfferActionBlockedError) return { status: "error", message: e.message };
  return { status: "error", message: e instanceof Error ? e.message : fallback };
}

/** Resolve the shared offer form fields (platform picker + url + price + currency), returning
 * a domain `OfferInput` or a validation error. `collectionId` is needed to find-or-create the
 * platform contact from the typed name (mirrors the purchase platform picker, #120). */
async function readOfferInput(
  collectionId: string,
  formData: FormData
): Promise<{ ok: true; input: OfferInput } | { ok: false; message: string }> {
  // Price is optional — at creation you rarely know the asking price yet (it follows from the
  // copies you add). A blank price defaults to 0; it is set later on the offer detail screen.
  const rawPrice = str(formData, "price");
  let price = "0.00";
  if (rawPrice) {
    const priced = parsePrice(rawPrice);
    if (!priced.ok) return { ok: false, message: priced.message };
    price = priced.value;
  }

  // Currency is inherited from the platform (#196). The form only sends one as a first-offer
  // fallback (to set the platform's currency when it has none yet); a blank value is fine when the
  // platform already has a currency. The domain resolves and locks it.
  const currency = str(formData, "currency");

  // Listing date (#257): optional; blank means not recorded.
  const listing = parseOfferDate(str(formData, "listingDate"));
  if (!listing.ok) return { ok: false, message: listing.message };

  // Initial status (#257): defaults to `preparing`; a live `ready` / `active` is honoured by the
  // domain only when the offer lists something. `updateOffer` ignores it.
  const rawState = str(formData, "state");
  const state: OfferState = isCreatableOfferState(rawState) ? rawState : "preparing";

  const platformId = await resolvePurchaseContact(collectionId, {
    id: str(formData, "platformId") || null,
    name: str(formData, "platformName") || null,
    role: "platform",
  });
  if (!platformId) return { ok: false, message: "Choose a platform to list on." };

  return {
    ok: true,
    input: {
      platformId,
      url: normalizeUrl(str(formData, "url")),
      price,
      currency,
      listingDate: listing.value,
      state,
    },
  };
}

export async function createOfferAction(
  collectionId: string,
  formData: FormData,
  seedItemIds?: string[]
): Promise<CreateOfferActionState> {
  const session = await getSession();
  const parsed = await readOfferInput(collectionId, formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const id = await createOffer(session.user.id, collectionId, parsed.input, { seedItemIds });
    return { status: "success", id };
  } catch (e) {
    return fail(e, "Failed to create the offer. Please try again.");
  }
}

/** List the same composition on another platform (#200): clone the source offer's sets into a new
 * draft, prompting only for platform / price / currency. `skippedCopies` counts copies dropped from
 * the clone because they had already sold elsewhere. */
export async function duplicateOfferAction(
  collectionId: string,
  sourceOfferId: string,
  formData: FormData
): Promise<DuplicateOfferActionState> {
  const session = await getSession();
  const parsed = await readOfferInput(collectionId, formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const result = await duplicateOffer(session.user.id, sourceOfferId, parsed.input);
    return { status: "success", id: result.id, skippedCopies: result.skippedCopies };
  } catch (e) {
    return fail(e, "Failed to duplicate the offer. Please try again.");
  }
}

/** Add one set (one or more copies that sell together) to an offer. `perCopy` splits the copies
 * into one single-copy set each — the fast path for a stock of duplicates. `language` (#297)
 * generates the set titles in a language other than the platform's; omitted, the platform's own
 * listing language applies. */
export async function addOfferSetAction(
  offerId: string,
  itemIds: string[],
  opts: { perCopy?: boolean; title?: string | null; language?: string | null } = {}
): Promise<OfferActionState> {
  const session = await getSession();
  if (itemIds.length === 0) return { status: "error", message: "Pick at least one copy." };
  try {
    if (opts.perCopy) {
      await addOfferSetsPerCopy(session.user.id, offerId, itemIds, opts.language);
    } else {
      await addOfferSet(session.user.id, offerId, itemIds, opts.title ?? null, opts.language);
    }
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to add the set.");
  }
}

/** The title `itemIds` would be given on this offer's platform, for the compose dialog's live
 * preview (#297) — read-only, writes nothing. `language` previews another language than the
 * platform's; the segments flagged `fellBack` render untranslated text (#298) and `gaps` names the
 * entity fields behind them, for filling in place (#299). Null when the platform has no title
 * template, i.e. there is no generated title to preview. */
export async function previewOfferTitleAction(
  offerId: string,
  itemIds: string[],
  language?: string | null
): Promise<OfferTitlePreview | null> {
  const session = await getSession();
  try {
    return await previewOfferTitle(session.user.id, offerId, itemIds, language);
  } catch {
    // A preview is never worth an error banner — the compose dialog simply shows nothing.
    return null;
  }
}

/** The translations missing behind an offer's generated texts, in the platform's listing language
 * (#299) — what the offer detail screen offers to fill in place. Empty rather than an error when
 * anything goes wrong: this is an assist, never a blocker. */
export async function offerTranslationGapsAction(
  offerId: string
): Promise<{ language: string | null; gaps: TitleFallback[] }> {
  const session = await getSession();
  try {
    return await offerTranslationGaps(session.user.id, offerId);
  } catch {
    return { language: null, gaps: [] };
  }
}

/** Add a single copy to an existing set (turns a single into a series). Used by the inventory
 * "Add to offer" picker when the collector drops a copy into an already-composed set (#188). */
export async function addItemToOfferSetAction(
  setId: string,
  itemId: string
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await addItemToOfferSet(session.user.id, setId, itemId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to add the copy to the set.");
  }
}

export async function updateOfferSetAction(
  setId: string,
  title: string | null
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await updateOfferSet(session.user.id, setId, title);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to rename the set.");
  }
}

export async function removeOfferSetAction(setId: string): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await removeOfferSet(session.user.id, setId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to remove the set.");
  }
}

/** In-place edit of a single offer header field from the detail screen. `price` accepts blank
 * (clears to 0); `url` blank clears the listing link; `name` blank clears the title back to the
 * derived label (#209), and `description` / `privateNote` blank clear those texts (#266/#267).
 * Currency is not editable here (#196) — it is inherited and locked from the platform. */
export async function patchOfferAction(
  offerId: string,
  field: "price" | "url" | OfferTextField,
  rawValue: string
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    if (field === "price") {
      const raw = rawValue.trim();
      let price = "0.00";
      if (raw) {
        const priced = parsePrice(raw);
        if (!priced.ok) return { status: "error", message: priced.message };
        price = priced.value;
      }
      await patchOffer(session.user.id, offerId, { price });
    } else if (field === "url") {
      await patchOffer(session.user.id, offerId, { url: normalizeUrl(rawValue) });
    } else {
      // The three generated texts share one contract: trimmed, blank clears back to null.
      await patchOffer(session.user.id, offerId, { [field]: rawValue.trim() || null });
    }
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to save the change.");
  }
}

/** Regenerate one of the offer's generated listing texts — title (#209/#210), description (#266) or
 * private note (#267) — from the platform's template over its current composition, overwriting any
 * manual edit. `language` (#297) regenerates in another language — a one-off, nothing about the
 * choice is stored. */
export async function regenerateOfferTextAction(
  offerId: string,
  field: OfferTextField,
  language?: string | null
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await regenerateOfferText(session.user.id, offerId, field, language);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to regenerate the listing text.");
  }
}

export async function updateOfferAction(
  collectionId: string,
  offerId: string,
  formData: FormData
): Promise<OfferActionState> {
  const session = await getSession();
  const parsed = await readOfferInput(collectionId, formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateOffer(session.user.id, offerId, parsed.input);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the offer.");
  }
}

export async function setOfferStateAction(
  offerId: string,
  state: OfferState
): Promise<OfferActionState> {
  const session = await getSession();
  if (!isOfferState(state)) return { status: "error", message: "Unknown offer state." };
  try {
    await setOfferState(session.user.id, offerId, state);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the offer state.");
  }
}

/** Set (or clear) "in active bidding" (#215) from the offer list or detail screen. */
export async function setOfferInActiveBiddingAction(
  offerId: string,
  value: boolean
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await setOfferInActiveBidding(session.user.id, offerId, value);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to update the offer's bidding state.");
  }
}

export async function deleteOfferAction(offerId: string): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await deleteOffer(session.user.id, offerId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to delete the offer.");
  }
}
