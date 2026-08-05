import "server-only";
import { prisma } from "./db";
import {
  AllegroApiError,
  createAllegroProductOffer,
  getAllegroOfferOperation,
  setAllegroOfferPublication,
} from "./allegro-api";
import {
  getAllegroAccessToken,
  markAllegroConnectionRejected,
  markAllegroPublishRefused,
  getAllegroConnectionStatus,
  type AllegroCallCredentials,
} from "./allegro-connection";
import { uploadOfferPhotosToAllegro } from "./allegro-images";
import { readAllegroListingInputs } from "./allegro-offer-listing";
import {
  ALLEGRO_OPERATION_POLL_MS,
  ALLEGRO_OPERATION_TIMEOUT_MS,
  allegroOfferUrl,
  buildAllegroOfferRequest,
  evaluateAllegroApiBlockers,
  namesIneligibleAccount,
  readCreatedOffer,
  readOperationStatus,
  type AllegroProfileForPublish,
  type AllegroPublicationStatus,
  type AllegroPublishBlocker,
  type AllegroPublishState,
} from "./allegro-publish-rules";
import { getOfferListingKit } from "./listing-kit";
import { STAMP_LABEL_SELECT } from "./offer-labels";
import { normalizeListingType, type OfferListingType } from "./offer-rules";
import { publishOffer } from "./offers";
import { ALLEGRO_PLATFORM_MODULE } from "./platform-modules";

// Publishing an offer to Allegro through the API (#477; ADR-0027) — the I/O half. Every judgement it
// makes is in `allegro-publish-rules.ts`; this module fetches, sends, polls and writes.
//
// It is the counterpart of the Assistant listing path (#407/#408) rather than a replacement for it:
// a marketplace with no API is driven through its own sale form, and a marketplace with one is not.
// What both paths share is the **listing kit** (#405) — the neutral statement of what an offer holds
// — which is read here directly rather than through its endpoint. Since #493 it also carries the
// **Allegro section** and that section's own refusals, evaluated by rules both paths call
// (`allegro-listing-rules.ts`), so what is left for this file to decide is the connection: whether
// *this account, through the API* may publish at all. Two evaluations of one listing is how the two
// paths would come to disagree about it.
//
// The order of operations is deliberate and is the reason a failure leaves nothing half-done:
// refusals first, then the pictures (which expire on Allegro's side by themselves if nothing uses
// them, #487), then the create, then the write-back and the lesson (#488) — the last two only on a
// listing Allegro concluded.

/** What the publish dialog opens on: whether it can go out, and what would be sent. */
export interface AllegroPublishPlan {
  offerId: string;
  offerNo: number;
  title: string;
  /** Which figure the listing states, already resolved for the format (#449) — the asking price of a
   *  quick buy, the opening price of an auction. */
  listingType: OfferListingType;
  amount: string | null;
  currency: string;
  /** `stock.available` — the number of interchangeable sets. */
  quantity: number;
  photoCount: number;
  profile: { id: string; name: string } | null;
  /** What the offer is configured to be listed as (#494) — read from the offer, never worked out
   *  here, so the dialog states the same category the Assistant path would post. */
  category: { id: string; name: string | null; path: string | null } | null;
  /** The listing this offer already has on Allegro, where there is one. A draft is the only one that
   *  is not a refusal — it is what **Activate** acts on. */
  publishedAs: { offerId: string; status: AllegroPublishState; url: string } | null;
  blockers: AllegroPublishBlocker[];
}

/** What one publish did. Four outcomes, and none of them is "probably fine": a listing, a draft, a
 *  validation still running, and a refusal Allegro stated after accepting the request. */
export type AllegroPublishOutcome = "published" | "draft" | "pending" | "refused";

export interface AllegroPublishResult {
  outcome: AllegroPublishOutcome;
  /** Allegro's offer id, present on everything but a create that named nothing. */
  allegroOfferId: string | null;
  /** The listing's public address — only on one that is actually up. */
  url: string | null;
  /** Allegro's own account of a refusal, or the sentence explaining an unfinished validation. */
  message: string | null;
}

/** Raised for a refusal named before anything was sent. Carries the blockers so the caller renders
 *  them as the dialog already renders them, rather than as one flattened sentence. */
export class AllegroPublishBlockedError extends Error {
  readonly blockers: AllegroPublishBlocker[];

  constructor(blockers: AllegroPublishBlocker[]) {
    super(blockers[0]?.message ?? "This offer cannot be published to Allegro.");
    this.name = "AllegroPublishBlockedError";
    this.blockers = blockers;
  }
}

/** The offer's own half — the columns the kit does not carry, plus the sets as the homogeneity rule
 *  compares them. */
async function readOffer(collectionId: string, offerId: string) {
  return prisma.offer.findFirst({
    where: { id: offerId, collectionId },
    select: {
      id: true,
      offerNo: true,
      collectionId: true,
      state: true,
      listingType: true,
      startingPrice: true,
      allegroOfferId: true,
      allegroPublishStatus: true,
      platform: { select: { id: true, platformModule: true } },
      sets: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          title: true,
          items: {
            select: {
              itemId: true,
              sortOrder: true,
              item: { select: { conditionId: true, stampId: true, ...STAMP_LABEL_SELECT } },
            },
          },
        },
      },
    },
  });
}

/** Everything the offer is configured to be listed as (#494): the category, its answers, and the
 *  profile resolved through #486's single fallback rule. Read, never worked out here — the Assistant
 *  path (#493) reads the same row, and a value each of them resolved for itself is a value the two
 *  would eventually disagree about. */
async function readListingConfig(offerId: string) {
  const config = await readAllegroListingInputs(offerId);
  return {
    categoryId: config?.categoryId ?? null,
    categoryName: config?.categoryName ?? null,
    categoryPath: config?.categoryPath ?? null,
    parameters: config?.parameters ?? [],
    profile: toRequestProfile(config?.profile ?? null),
  };
}

/** The profile in the shape the request wants it. */
function toRequestProfile(
  profile: Awaited<ReturnType<typeof readAllegroListingInputs>> extends infer T
    ? T extends { profile: infer P }
      ? P
      : never
    : never
): AllegroProfileForPublish | null {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name,
    shippingRatesId: profile.shippingRatesId,
    handlingTime: profile.handlingTime,
    returnPolicyId: profile.returnPolicyId,
    impliedWarrantyId: profile.impliedWarrantyId,
    locationCountryCode: profile.locationCountryCode,
    locationCity: profile.locationCity,
    locationPostCode: profile.locationPostCode,
    invoiceType: profile.invoiceType,
  };
}

/**
 * Whether this offer can be published, and what it would go out as.
 *
 * Reads the four sources once each. It never touches Allegro's *write* endpoints and is safe to call
 * whenever the screen wants to know — which is what lets every refusal be stated before the dialog
 * rather than after the request.
 */
export async function getAllegroPublishPlan(
  ownerId: string,
  collectionId: string,
  offerId: string
): Promise<AllegroPublishPlan | null> {
  const kit = await getOfferListingKit(ownerId, collectionId, offerId);
  if (!kit) return null;
  const offer = await readOffer(collectionId, offerId);
  if (!offer) return null;

  const [connection, config] = await Promise.all([
    getAllegroConnectionStatus(ownerId, collectionId),
    readListingConfig(offerId),
  ]);
  const profile = config.profile;

  const listingType = normalizeListingType(offer.listingType);
  const startingPrice = offer.startingPrice?.toFixed(2) ?? null;
  const publishState = readPublishState(offer.allegroPublishStatus);

  // The connection's own refusals, then the **listing's** — which the kit has already evaluated for
  // this very offer (#493), through the same rules and from the same values. Asked of it rather than
  // computed again: a second evaluation is a second answer waiting to disagree, and the category's
  // parameters would be read from Allegro twice to produce it.
  const api = evaluateAllegroApiBlockers({
    isAllegroPlatform: offer.platform.platformModule === ALLEGRO_PLATFORM_MODULE,
    connected: connection.connected,
    needsReconnect: connection.needsReconnect,
    canPublish: connection.canPublishOffers,
    publishRefusedReason: connection.publishRefusedReason,
    publishedAs:
      offer.allegroOfferId && publishState
        ? { offerId: offer.allegroOfferId, status: publishState }
        : null,
  });
  const blockers = api.length > 0 ? api : (kit.allegro?.blockers ?? []);

  return {
    offerId: kit.offerId,
    offerNo: offer.offerNo,
    title: kit.title,
    listingType,
    amount: listingType === "auction" ? startingPrice : kit.price,
    currency: kit.currency,
    quantity: kit.quantity,
    photoCount: kit.photos.images.length,
    profile: profile ? { id: profile.id, name: profile.name } : null,
    category: config.categoryId
      ? { id: config.categoryId, name: config.categoryName, path: config.categoryPath }
      : null,
    publishedAs:
      offer.allegroOfferId && publishState
        ? {
            offerId: offer.allegroOfferId,
            status: publishState,
            url: allegroOfferUrl(offer.allegroOfferId, connection.sandbox),
          }
        : null,
    blockers,
  };
}

/** What the column holds, narrowed. Anything unrecognised is read as no publication at all rather
 *  than trusted — the column is written by one function and a value from anywhere else is not a
 *  state this app knows how to act on. */
function readPublishState(raw: string | null): AllegroPublishState | null {
  return raw === "ACTIVE" || raw === "INACTIVE" || raw === "PENDING" ? raw : null;
}

/**
 * Publish one offer to Allegro.
 *
 * Refuses in words first, uploads the pictures second, sends the create third. A **201** is a
 * listing; a **202** is Allegro having accepted the work, and it is polled to a conclusion here
 * rather than reported as a success — an offer can still be refused asynchronously for a duplicate
 * or a policy breach, and recording one as live on the strength of the request having been accepted
 * is the one mistake this whole path exists to avoid.
 *
 * Only a conclusive success writes anything: the offer's transition (#246, through `publishOffer` so
 * the listing date and the URL follow the same rules a hand-published offer's do) and the Allegro id.
 * The category lesson is **not** recorded here — it hangs off `ready → active` (#494), the one
 * transition every listing path shares, so the Assistant's write-back and a URL pasted in by hand
 * teach the register identically to this.
 *
 * The category, its answers and the profile are **read from the offer** (#494) and never chosen here:
 * the publish dialog is a review of what the offer's own Allegro card says, not a second place the
 * question is asked.
 */
export async function publishOfferToAllegro(
  ownerId: string,
  collectionId: string,
  offerId: string,
  input: { publication: AllegroPublicationStatus },
  signal?: AbortSignal
): Promise<AllegroPublishResult> {
  const plan = await getAllegroPublishPlan(ownerId, collectionId, offerId);
  if (!plan) throw new Error("Offer not found");
  if (plan.blockers.length > 0) throw new AllegroPublishBlockedError(plan.blockers);

  const kit = await getOfferListingKit(ownerId, collectionId, offerId);
  const offer = await readOffer(collectionId, offerId);
  if (!kit || !offer) throw new Error("Offer not found");
  const config = await readListingConfig(offerId);
  const profile = config.profile;
  // Both were checked by the plan a moment ago; re-reading them here is what makes the assembly below
  // total rather than optimistic, and a gap at this point is the same refusal the plan would state.
  if (!profile || !config.categoryId) throw new AllegroPublishBlockedError(plan.blockers);

  const credentials = await getAllegroAccessToken(ownerId, collectionId);

  // The pictures go up first because the create references them by URL. They cost nothing if the
  // create then fails: Allegro removes an uploaded image no listing has used (#487), which is exactly
  // why nothing about them is cached here and why there is nothing to clean up.
  const images = await uploadOfferPhotosToAllegro({
    ownerId,
    collectionId,
    offerId,
    credentials,
    signal,
  });

  const body = buildAllegroOfferRequest({
    offerNo: offer.offerNo,
    title: kit.title,
    description: kit.description,
    descriptionFormat: kit.descriptionFormat,
    listingType: normalizeListingType(offer.listingType),
    price: kit.price,
    startingPrice: offer.startingPrice?.toFixed(2) ?? null,
    currency: kit.currency,
    quantity: kit.quantity,
    categoryId: config.categoryId,
    // **Offer-section parameters only** (ADR-0027 §2). Allegro splits a category's parameters in two
    // and refuses a product one sent among the offer's own by name — it belongs inside
    // `productSet[].product.parameters`, which is the catalog path this app does not take. The other
    // half is not dropped from the offer: the collector answers it because Allegro's own sale form
    // (#493) asks for it, and it is filtered *here*, in the request that has the restriction.
    parameters: config.parameters
      .filter((answered) => !answered.describesProduct)
      .map((answered) => ({ id: answered.parameterId, ...answered.value })),
    imageUrls: images.map((image) => image.url),
    profile,
    publication: input.publication,
  });

  const created = await withConnectionLatching(collectionId, () =>
    createAllegroProductOffer({ ...credentials, offer: body, signal })
  );
  const { offerId: allegroOfferId, operationId } = readCreatedOffer(created.body, created.location);

  if (!allegroOfferId) {
    // Allegro answered a success naming nothing. There is a listing somewhere and this app cannot
    // address it, which is a sentence rather than a recorded publication.
    return {
      outcome: "pending",
      allegroOfferId: null,
      url: null,
      message:
        "Allegro accepted the listing but did not say which offer it created. Check the account before publishing again — a second attempt would create a second listing.",
    };
  }

  if (created.accepted) {
    const status = await pollOperation(credentials, allegroOfferId, operationId, signal);
    if (status.outcome === "failed") {
      await recordPublication(offerId, allegroOfferId, "PENDING");
      return {
        outcome: "refused",
        allegroOfferId,
        url: null,
        message: status.message ?? "Allegro refused the listing.",
      };
    }
    if (status.outcome === "pending") {
      // Recorded so a second press cannot create a duplicate, and reported as what it is.
      await recordPublication(offerId, allegroOfferId, "PENDING");
      return {
        outcome: "pending",
        allegroOfferId,
        url: null,
        message:
          "Allegro accepted the listing and is still validating it. Check the offer on Allegro — it will appear there once validation finishes.",
      };
    }
  }

  return finishPublication({
    ownerId,
    offerId,
    allegroOfferId,
    publication: input.publication,
    sandbox: credentials.sandbox,
  });
}

/** Poll a 202's operation to a conclusion, or to the bound. An operation Allegro named nowhere is
 *  simply unfinished as far as this app can tell — there is nothing to ask. */
async function pollOperation(
  credentials: AllegroCallCredentials,
  offerId: string,
  operationId: string | null,
  signal?: AbortSignal
) {
  if (!operationId) return { outcome: "pending" as const, message: null };

  const deadline = Date.now() + ALLEGRO_OPERATION_TIMEOUT_MS;
  for (;;) {
    const body = await getAllegroOfferOperation({
      ...credentials,
      offerId,
      operationId,
      signal,
    });
    const status = readOperationStatus(body);
    if (status.outcome !== "pending") return status;
    if (Date.now() + ALLEGRO_OPERATION_POLL_MS >= deadline) {
      return { outcome: "pending" as const, message: null };
    }
    await new Promise((resolve) => setTimeout(resolve, ALLEGRO_OPERATION_POLL_MS));
  }
}

/** The writes a concluded publication makes, in the order that leaves nothing false behind. */
async function finishPublication(opts: {
  ownerId: string;
  offerId: string;
  allegroOfferId: string;
  publication: AllegroPublicationStatus;
  sandbox: boolean;
}): Promise<AllegroPublishResult> {
  const url = allegroOfferUrl(opts.allegroOfferId, opts.sandbox);

  if (opts.publication === "ACTIVE") {
    // Through the existing transition (#246), never around it: the listing date (#320), the URL and
    // — since #494 — the category lesson are all written by the same function a hand-published offer
    // goes through. A draft teaches nothing until it is activated, which is the same rule stated
    // once instead of twice.
    await publishOffer(opts.ownerId, opts.offerId, url);
  }
  await recordPublication(opts.offerId, opts.allegroOfferId, opts.publication);

  return {
    outcome: opts.publication === "ACTIVE" ? "published" : "draft",
    allegroOfferId: opts.allegroOfferId,
    url: opts.publication === "ACTIVE" ? url : null,
    message: null,
  };
}

/** The one place the two publication columns are written. */
async function recordPublication(
  offerId: string,
  allegroOfferId: string,
  status: AllegroPublishState
): Promise<void> {
  await prisma.offer.update({
    where: { id: offerId },
    data: { allegroOfferId, allegroPublishStatus: status },
  });
}

/**
 * Activate a draft — the second half of the draft path, and the only reason a published-but-inactive
 * offer is not a dead end.
 *
 * It is the same conclusion the live path reaches, taken later: Allegro is told to publish, and then
 * the offer goes `ready → active` through `publishOffer` exactly as it would have. The category was
 * already learned when the draft was created, so nothing is recorded twice.
 */
export async function activateAllegroDraft(
  ownerId: string,
  collectionId: string,
  offerId: string,
  signal?: AbortSignal
): Promise<AllegroPublishResult> {
  const offer = await readOffer(collectionId, offerId);
  if (!offer) throw new Error("Offer not found");

  const allegroOfferId = offer.allegroOfferId;
  const status = readPublishState(offer.allegroPublishStatus);
  if (!allegroOfferId || status !== "INACTIVE") {
    throw new AllegroPublishBlockedError([
      {
        code: "already-published",
        message:
          status === "ACTIVE"
            ? "This offer's Allegro listing is already live."
            : "This offer has no Allegro draft to activate.",
      },
    ]);
  }

  const credentials = await getAllegroAccessToken(ownerId, collectionId);
  await withConnectionLatching(collectionId, () =>
    setAllegroOfferPublication({ ...credentials, offerId: allegroOfferId, status: "ACTIVE", signal })
  );

  const url = allegroOfferUrl(allegroOfferId, credentials.sandbox);
  await publishOffer(ownerId, offerId, url);
  await recordPublication(offerId, allegroOfferId, "ACTIVE");

  return { outcome: "published", allegroOfferId, url, message: null };
}

/**
 * Run one Allegro write, latching the connection on a rejected token.
 *
 * ADR-0023's single convergence point: a 401 is the connection needing a reconnection and is
 * recorded as that rather than as this offer having failed to publish. A **scope** refusal is
 * deliberately not latched (#485) — reconnecting the same application changes nothing, and the
 * message already names the fix.
 */
async function withConnectionLatching<T>(collectionId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AllegroApiError) {
      if (err.unauthorized) {
        await markAllegroConnectionRejected(collectionId, err.message);
      } else if (namesIneligibleAccount(err.details.map((d) => d.text))) {
        // Allegro's selling endpoints are open to business accounts only, and nothing says so until
        // a listing is published. Recorded in Allegro's own words so the next offer is refused here,
        // before a request, rather than sending the collector round the same discovery per listing.
        await markAllegroPublishRefused(collectionId, err.details[0]?.text ?? err.message);
      }
    }
    throw err;
  }
}
