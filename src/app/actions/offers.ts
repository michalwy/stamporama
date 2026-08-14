"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createOffer,
  duplicateOffer,
  updateOffer,
  setOfferState,
  acknowledgeOfferBiddingNotice,
  markOfferListingSynced,
  setOfferInActiveBidding,
  publishOffer,
  deleteOffer,
  patchOffer,
  regenerateOfferText,
  updateOfferPhotoConfig,
  type OfferTextField,
  addOfferSet,
  addOfferSetsPerCopy,
  addItemsToOfferSet,
  updateOfferSet,
  removeOfferSet,
  reorderOfferSets,
  reorderOfferSetItems,
  resetOfferSetItemOrder,
  previewOfferTitle,
  offerTranslationGaps,
  type OfferTitlePreview,
  OfferActionBlockedError,
  type OfferInput,
} from "@/lib/offers";
import type { TitleFallback } from "@/lib/offer-title-template";
import { parseOfferPhotoConfigInput } from "@/lib/offer-photo-config";
import { enqueueOfferPhotoGeneration } from "@/lib/offer-photo-generation";
import {
  attachOfferCopyPhotos,
  attachOfferItemFrontPhotos,
  attachOfferPhotoCollage,
  attachOfferUploads,
  removeOfferPhotoAttachment,
  renameOfferPhotoAttachment,
  setOfferPhotoPlanOrder,
  setOfferPhotoPublish,
  type BulkCopyPhotoAttachResult,
  type CollageAttachmentInput,
  type CopyPhotoAttachmentInput,
  type UploadAttachmentInput,
} from "@/lib/offer-photo-attachments";
import { kickOfferPhotoWorker } from "@/lib/offer-photo-worker";
import { resolvePurchaseContact } from "@/lib/contacts";
import {
  isOfferState,
  isCreatableOfferState,
  parsePrice,
  parseStartingPrice,
  parseOfferDate,
  parseOfferEndsAt,
  normalizeUrl,
  normalizeListingType,
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

  // How the listing is sold (#449): a quick buy at a stated price, or an auction whose figure moves
  // with the bidding. An **absent** field is *not stated* and is passed on as `undefined`, so the
  // domain can fall back to the platform's own default (#449/#362) — a form that never asked the
  // question (quick offer mode, #537/#589) must not answer it with a `fixed` of its own, which is
  // also what silently denied those offers the platform's default starting price. A value that *is*
  // sent and unrecognised still reads as `fixed`, the reading that claims the least. The starting
  // price is the auction's opening figure and is optional even there (an auction picked up
  // mid-flight may have no recorded opening); the domain drops it on a quick buy rather than
  // storing a figure about a format the listing is not in.
  const rawListingType = str(formData, "listingType");
  const listingType = rawListingType ? normalizeListingType(rawListingType) : undefined;
  const starting = parseStartingPrice(str(formData, "startingPrice"));
  if (!starting.ok) return { ok: false, message: starting.message };

  // Currency is inherited from the platform (#196). The form only sends one as a first-offer
  // fallback (to set the platform's currency when it has none yet); a blank value is fine when the
  // platform already has a currency. The domain resolves and locks it.
  const currency = str(formData, "currency");

  // Listing date (#257): optional; blank means not recorded.
  const listing = parseOfferDate(str(formData, "listingDate"));
  if (!listing.ok) return { ok: false, message: listing.message };

  // When an auction closes (#490): optional, and sent as an ISO instant — the form's
  // `datetime-local` field converts in the browser, the only place the collector's zone is known.
  // The domain drops it on a quick buy, so it is passed on as given.
  const ends = parseOfferEndsAt(str(formData, "endsAt"));
  if (!ends.ok) return { ok: false, message: ends.message };

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
      listingType,
      price,
      startingPrice: starting.value,
      endsAt: ends.value,
      currency,
      listingDate: listing.value,
      state,
    },
  };
}

/** Create an offer, optionally seeding it with copies. `seedPerCopy` packages that seed as one
 * single-copy set each (#372) rather than one set holding everything. */
export async function createOfferAction(
  collectionId: string,
  formData: FormData,
  seedItemIds?: string[],
  seedPerCopy?: boolean
): Promise<CreateOfferActionState> {
  const session = await getSession();
  const parsed = await readOfferInput(collectionId, formData);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const id = await createOffer(session.user.id, collectionId, parsed.input, {
      seedItemIds,
      seedPerCopy,
    });
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

/** Add copies to an existing set (turns a single into a series). Used by the inventory "Add to
 * offer" picker when the collector drops a copy — or a whole selection (#373) — into an
 * already-composed set (#188). Copies that have since sold or are already in the offer are dropped
 * rather than failing the add. */
export async function addItemsToOfferSetAction(
  setId: string,
  itemIds: string[]
): Promise<OfferActionState> {
  const session = await getSession();
  if (itemIds.length === 0) return { status: "error", message: "Pick at least one copy." };
  try {
    await addItemsToOfferSet(session.user.id, setId, itemIds);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to add the copies to the set.");
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

/** Persist a hand-dragged set order for an offer (#306). `setIds` is the full new order. */
export async function reorderOfferSetsAction(
  offerId: string,
  setIds: string[]
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await reorderOfferSets(session.user.id, offerId, setIds);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to reorder the sets.");
  }
}

/** Hand-correct the copy order inside one set (#306). `itemIds` is the full new order. */
export async function reorderOfferSetItemsAction(
  setId: string,
  itemIds: string[]
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await reorderOfferSetItems(session.user.id, setId, itemIds);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to reorder the copies.");
  }
}

/** Drop a set's hand-corrected copy order back to derived catalog order (#306). */
export async function resetOfferSetItemOrderAction(setId: string): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await resetOfferSetItemOrder(session.user.id, setId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to reset the copy order.");
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
 * `descriptionFormat` (#319) says how the description is read; an unknown value normalises to plain
 * text. Currency is not editable here (#196) — it is inherited and locked from the platform. */
export async function patchOfferAction(
  offerId: string,
  field: "price" | "startingPrice" | "url" | "descriptionFormat" | OfferTextField,
  rawValue: string
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    if (field === "descriptionFormat") {
      await patchOffer(session.user.id, offerId, { descriptionFormat: rawValue });
    } else if (field === "startingPrice") {
      // An auction's opening figure (#449): blank clears it, unlike the price, because an auction
      // whose opening was never noted is an ordinary case rather than a gap to insist on.
      const starting = parseStartingPrice(rawValue);
      if (!starting.ok) return { status: "error", message: starting.message };
      await patchOffer(session.user.id, offerId, { startingPrice: starting.value });
    } else if (field === "price") {
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

/** Save the offer's photo configuration (#308) from its photo-settings dialog: sides, tile label
 * template and the collage numbers copied from a template. One dialog, one save — the whole
 * configuration is replaced, and an all-blank collage group clears the numbers. */
export async function updateOfferPhotoConfigAction(
  offerId: string,
  formData: FormData
): Promise<OfferActionState> {
  const session = await getSession();
  const parsed = parseOfferPhotoConfigInput({
    photoSides: str(formData, "photoSides"),
    preferSingles: str(formData, "preferSingles"),
    photoLabelLeftTemplate: str(formData, "photoLabelLeftTemplate"),
    photoLabelRightTemplate: str(formData, "photoLabelRightTemplate"),
    collageGridMode: str(formData, "collageGridMode"),
    collageRows: str(formData, "collageRows"),
    collageColumns: str(formData, "collageColumns"),
    collageGapPercent: str(formData, "collageGapPercent"),
    collageBackground: str(formData, "collageBackground"),
    collageLabelPercent: str(formData, "collageLabelPercent"),
  });
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await updateOfferPhotoConfig(session.user.id, offerId, parsed.value);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to save the photo settings.");
  }
}

/**
 * Queue this offer's photo generation (#311). Generation is explicit and never implicit, and it does
 * **not** happen in this request: the action validates and enqueues, an in-process worker renders, and
 * the panel polls the resulting state. Pressing it again while a run is queued or in flight is a no-op,
 * so a double click renders once.
 */
export async function generateOfferPhotosAction(offerId: string): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await enqueueOfferPhotoGeneration(session.user.id, offerId);
    // Best-effort nudge so rendering starts now rather than on the worker's next poll.
    kickOfferPhotoWorker();
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to start photo generation.");
  }
}

/** What a bulk regeneration did: how many runs were queued, and every offer that refused one. */
export interface BulkPhotoGenerationState {
  queued: number;
  skipped: { offerId: string; message: string }[];
}

export type BulkPhotoGenerationActionState =
  | { status: "success"; result: BulkPhotoGenerationState }
  | { status: "error"; message: string; result?: BulkPhotoGenerationState };

/**
 * Queue photo generation for a whole batch (#323) — the listing workspace regenerating everything it
 * is currently showing, so a session's images are brought up to date in one motion instead of thirty
 * trips to thirty offer screens.
 *
 * Per-offer refusals are **collected, not thrown**: an offer with no collage numbers, or one whose
 * sets have all sold (#315), is a fact about that offer and no reason to abandon the other
 * twenty-nine. The same queue rules apply as for a single offer, so an offer already rendering is
 * left alone rather than stacked, and the worker is nudged once for the whole batch.
 */
export async function generateOffersPhotosAction(
  offerIds: string[]
): Promise<BulkPhotoGenerationActionState> {
  const session = await getSession();
  const skipped: { offerId: string; message: string }[] = [];
  let queued = 0;

  // Sequentially: a run is a database round trip per offer and this is a background nudge, not a
  // latency-critical path — a fan-out over a forty-offer batch would only crowd the pool.
  for (const offerId of offerIds) {
    try {
      await enqueueOfferPhotoGeneration(session.user.id, offerId);
      queued += 1;
    } catch (e) {
      const outcome = fail(e, "Failed to start photo generation.");
      skipped.push({ offerId, message: outcome.message });
    }
  }

  if (queued > 0) kickOfferPhotoWorker();
  if (queued === 0 && skipped.length > 0) {
    return {
      status: "error",
      message:
        skipped.length === 1
          ? skipped[0].message
          : `None of these ${skipped.length} offers could be regenerated.`,
      result: { queued, skipped },
    };
  }
  return { status: "success", result: { queued, skipped } };
}

// ── Manual photo attachments (#313) ─────────────────────────────────────────
// Adding, moving or removing an attachment changes the **plan**, never the stored images: the files
// already generated stay exactly as they are (a buyer may be looking at them) and the plan simply
// reads as out of date until the collector regenerates.

/** Attach one or more specific photos of copies in this offer (#313 mode a) — fronts, backs or
 * extras, so single details can be shown on their own. They land at the end of the plan, in the
 * order picked, and are dragged from there. */
export async function attachOfferCopyPhotosAction(
  offerId: string,
  inputs: CopyPhotoAttachmentInput[]
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await attachOfferCopyPhotos(session.user.id, offerId, inputs);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to attach the photos.");
  }
}

export type AttachItemPhotosActionState =
  | { status: "success"; result: BulkCopyPhotoAttachResult }
  | { status: "error"; message: string };

/**
 * Attach every copy's front scan as an image of its own (#434) — one click instead of picking them
 * one by one in the dialog. Copies with no front scan are skipped and named in the result, and one
 * already attached on its own is passed over, so the button tops the plan up rather than doubling it.
 */
export async function attachOfferItemFrontPhotosAction(
  offerId: string
): Promise<AttachItemPhotosActionState> {
  const session = await getSession();
  try {
    const result = await attachOfferItemFrontPhotos(session.user.id, offerId);
    return { status: "success", result };
  } catch (e) {
    return fail(e, "Failed to attach the copies' photos.");
  }
}

/** Attach one or more images uploaded straight to the offer (#313 mode b): each staged upload (#112)
 * becomes an offer-owned original, from which the annotated image is rendered. */
export async function attachOfferUploadsAction(
  offerId: string,
  uploads: UploadAttachmentInput[]
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await attachOfferUploads(session.user.id, offerId, uploads);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to attach the images.");
  }
}

/**
 * Attach one collage the collector composed by hand (#331): the photos they picked — copy scans and
 * images being uploaded with it, mixed freely — combined into a single image at the width they chose.
 * It lands at the end of the plan and is dragged from there like any other attachment.
 */
export async function attachOfferPhotoCollageAction(
  offerId: string,
  input: CollageAttachmentInput
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await attachOfferPhotoCollage(session.user.id, offerId, input);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to build the collage.");
  }
}

/** Rename an attachment — the caption shown in the plan, never text drawn on the image. */
export async function renameOfferPhotoAttachmentAction(
  attachmentId: string,
  title: string | null
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await renameOfferPhotoAttachment(session.user.id, attachmentId, title);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to rename the attachment.");
  }
}

/** Remove an attachment from the plan. An uploaded image goes with it; a copy's own scan does not. */
export async function removeOfferPhotoAttachmentAction(
  attachmentId: string
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await removeOfferPhotoAttachment(session.user.id, attachmentId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to remove the attachment.");
  }
}

/** Mark one plan image do-not-publish, or publish it again (#313). It stays generated and stored —
 * it only leaves the upload set, which frees its slot under the platform's photo limit. */
export async function setOfferPhotoPublishAction(
  offerId: string,
  token: string,
  publish: boolean
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await setOfferPhotoPublish(session.user.id, offerId, token, publish);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to change whether this image is published.");
  }
}

/** Record the plan order the collector dragged the card into (#313) — collage sides and attachments
 * alike, as the image tokens in their new sequence. An empty list clears the override. Dragging
 * either list (the plan or the stored files) lands here: the stored entries are renumbered to
 * match, so both always show one order. */
export async function setOfferPhotoPlanOrderAction(
  offerId: string,
  tokens: string[]
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await setOfferPhotoPlanOrder(session.user.id, offerId, tokens);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to reorder the plan.");
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

/** Publish a prepared offer from the bulk listing workspace (#322): `ready → active`, stamping the
 * listing date (#320), plus the listing URL the platform gave back. A blank URL is accepted — the
 * listing may not have one to copy yet — and clears whatever was there. */
export async function publishOfferAction(
  offerId: string,
  rawUrl: string
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await publishOffer(session.user.id, offerId, normalizeUrl(rawUrl));
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to publish the offer.");
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

/**
 * Mark the "we marked this in active bidding for you" notice as read (#481).
 *
 * Fired by the offer screen when it opens on an offer carrying one: the notification pointed here,
 * and arriving *is* the acknowledgement. It is idempotent and touches nothing else, so a second tab
 * doing the same is a no-op rather than a conflict.
 */
export async function acknowledgeOfferBiddingNoticeAction(
  offerId: string
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await acknowledgeOfferBiddingNotice(session.user.id, offerId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to acknowledge the bidding notice.");
  }
}

/**
 * The live listing has been brought back into step with this record (#542).
 *
 * Two callers, and they are the same act reached two ways: the Assistant reporting a saved update
 * (#462), which is the flow this signal was added to feed, and the collector pressing **Mark as up
 * to date** — which every platform without an update flow needs, and which is also the answer when
 * the change turns out not to have been worth re-posting.
 *
 * Idempotent: an offer carrying no flag is left alone rather than refused, so the Assistant's report
 * arriving twice, or after the collector has already cleared it by hand, is a no-op.
 */
export async function markOfferListingSyncedAction(
  offerId: string
): Promise<OfferActionState> {
  const session = await getSession();
  try {
    await markOfferListingSynced(session.user.id, offerId);
    return { status: "success" };
  } catch (e) {
    return fail(e, "Failed to mark the listing as up to date.");
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
