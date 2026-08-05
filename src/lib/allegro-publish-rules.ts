/**
 * What publishing an offer to Allegro decides, kept pure (#477; ADR-0027).
 *
 * Nothing here reaches a database or the network. Two jobs:
 *
 *  • **the refusals** — every reason a listing cannot go out *through the API*, named before a
 *    request is spent on it. A publish is the one act in this app that writes to somebody else's live
 *    selling account, so "why not" has to be answerable without asking Allegro. The reasons that are
 *    about the **listing** rather than about the API live in `allegro-listing-rules.ts` (#493), since
 *    the Assistant path refuses on the very same ones; this file adds the API's own group in front of
 *    them.
 *  • **the request** — one `POST /sale/product-offers` body assembled from the three sources that
 *    each own their half: the listing kit (#405, what the offer holds), the listing profile (#486,
 *    what the account sells under) and the category with its parameters (#488, what the stamp is).
 *
 * Assembly is pure because it is the part that is worth testing and the part that is impossible to
 * test through a live marketplace: `allegro-publish.ts` is the I/O half and decides nothing.
 */

import { toAllegroDescriptionHtml } from "./allegro-description";
import {
  evaluateAllegroListingBlockers,
  type AllegroListingBlocker,
  type AllegroListingBlockerCode,
  type AllegroListingReadiness,
  type AllegroProfileForPublish,
} from "./allegro-listing-rules";
import { descriptionToUnsafeHtml, type DescriptionFormat } from "./description-format";
import { isAuctionListing, type OfferListingType } from "./offer-rules";

export { ALLEGRO_TITLE_MAX_LENGTH } from "./allegro-listing-rules";
export type { AllegroProfileForPublish } from "./allegro-listing-rules";

/** How long the publish waits on a 202's operation before it stops and says so. Allegro's async
 *  validation is normally a second or two; past this the honest answer is "still being validated",
 *  which is a state of its own and neither a listing nor a failure. */
export const ALLEGRO_OPERATION_TIMEOUT_MS = 20_000;

/** How long between polls of that operation. */
export const ALLEGRO_OPERATION_POLL_MS = 1_500;

/** What a create asks Allegro to do with the listing, in Allegro's own vocabulary. Taken in the
 *  create call itself, which is why it is a choice made in the dialog rather than a second step. */
export type AllegroPublicationStatus = "INACTIVE" | "ACTIVE";

/** What this app last knew the published listing to be. The third value is not Allegro's: it is a
 *  create Allegro accepted (202) whose validation had not concluded while we waited. */
export type AllegroPublishState = AllegroPublicationStatus | "PENDING";

/** The API's own refusals, plus every listing-side one (#493) — the dialog renders them as one list
 *  and nothing downstream cares which group a code came from. */
export type AllegroPublishBlockerCode =
  | AllegroApiBlockerCode
  | AllegroListingBlockerCode;

/** The reasons that are about **this connection**, and about nothing a listing could be corrected
 *  into passing: they exist only because the API is the path. */
export type AllegroApiBlockerCode =
  | "not-connected"
  | "needs-reconnect"
  | "missing-write-scope"
  | "account-not-eligible"
  | "not-allegro-platform"
  | "already-published";

/** One reason this offer cannot be published, ready to show verbatim. Shaped like #406's blocker so
 *  the two read alike wherever they are rendered side by side. */
export type AllegroPublishBlocker = AllegroListingBlocker<AllegroPublishBlockerCode>;

/** The connection's own half — everything {@link evaluateAllegroApiBlockers} decides from, and
 *  nothing a listing could be corrected into passing. */
export interface AllegroApiReadiness {
  /** Whether the offer's platform is the one this collection calls Allegro (#355's marker). A listing
   *  cannot be published to an account that is not the marketplace the offer is on. */
  isAllegroPlatform: boolean;
  connected: boolean;
  needsReconnect: boolean;
  /** Whether the grant carries `allegro:api:sale:offers:write` (#485). `null` is *could not be read*,
   *  which is deliberately not a refusal: nothing here is authorized on the strength of a decoded
   *  token, and refusing on an unreadable one would block a connection that publishes perfectly well.
   */
  canPublish: boolean | null;
  /** Why Allegro said this account cannot publish through the API at all, in its own words, or null
   *  where it has never said so. See {@link namesIneligibleAccount}. */
  publishRefusedReason: string | null;
  /** The listing already published from here, where there is one. */
  publishedAs: { offerId: string; status: AllegroPublishState } | null;
}

/**
 * Everything a publish's refusals are decided from: the connection's half and the listing's
 * ({@link AllegroListingReadiness}) — the latter being the same half the Assistant path evaluates,
 * and why it is extended rather than restated.
 */
export interface AllegroPublishReadiness extends AllegroApiReadiness, AllegroListingReadiness {}

function blocker(code: AllegroApiBlockerCode, message: string): AllegroPublishBlocker {
  return { code, message };
}

/**
 * Every reason this offer cannot be published **through the API**, in the order they are worth
 * fixing: the connection's own group, then the listing's (#493), which is the group the Assistant
 * path evaluates on its own.
 *
 * The connection comes first and stands **alone**: with no usable grant nothing else can be acted on
 * anyway, and listing five faults under "not connected" buries the one thing to do.
 */
export function evaluateAllegroPublishBlockers(
  input: AllegroPublishReadiness
): AllegroPublishBlocker[] {
  const api = evaluateAllegroApiBlockers(input);
  return api.length > 0 ? api : evaluateAllegroListingBlockers(input);
}

/**
 * The refusals that are the **API's alone** — each standing alone, since none of them is a fault in
 * this offer and no offer can be corrected into passing one.
 *
 * Empty means nothing about the connection stops a publish; what the *listing* still lacks is
 * {@link evaluateAllegroListingBlockers}, and the Assistant path asks only that one.
 */
export function evaluateAllegroApiBlockers(input: AllegroApiReadiness): AllegroPublishBlocker[] {
  if (!input.isAllegroPlatform) {
    return [
      blocker(
        "not-allegro-platform",
        "This offer's platform is not the one marked as Allegro, so there is no account to publish it to. Mark it under Settings → Allegro, or post this listing by hand."
      ),
    ];
  }
  if (!input.connected) {
    return [
      blocker(
        "not-connected",
        "This collection is not connected to Allegro. Connect it under Settings → Allegro."
      ),
    ];
  }
  if (input.needsReconnect) {
    return [
      blocker(
        "needs-reconnect",
        "The Allegro connection needs reconnecting before anything can be published. Reconnect it under Settings → Allegro."
      ),
    ];
  }
  // `null` is *unreadable*, not *absent* (#485): the scope list is decoded from the token for display
  // and never verified, so only a token that positively lacks the permission is a refusal.
  if (input.canPublish === false) {
    return [
      blocker(
        "missing-write-scope",
        "The connected Allegro application cannot publish offers — it does not carry the offer-write permission. Add it to the application at apps.developer.allegro.pl, then reconnect: a grant keeps the permissions it was issued with."
      ),
    ];
  }

  // The account itself, once Allegro has said so. It sits with the connection checks rather than with
  // the offer's own faults because it is not about this offer and no offer can be fixed into passing
  // it — and it stands alone for that reason. Allegro's sentence is repeated verbatim: this is a rule
  // about somebody's account status, and paraphrasing it would be this app inventing an account
  // policy it does not administer. It is also exactly the refusal the Assistant path exists for
  // (#493), which is why it names that path rather than only stating the rule.
  if (input.publishRefusedReason) {
    return [
      blocker(
        "account-not-eligible",
        `Allegro will not publish listings through the API from this account: “${input.publishRefusedReason}” Post this offer on Allegro yourself — everything else the connection does, including the sold worklist and bid tracking, is unaffected.`
      ),
    ];
  }

  // A listing that already exists is a refusal whatever state it is in, draft included: a second
  // create would put two listings for the same stamps on the account and orphan the first. A draft is
  // not a dead end because **Activate** is a different act on the listing that is already there, and
  // it deliberately does not come through here.
  if (input.publishedAs) {
    const { offerId, status } = input.publishedAs;
    return [
      blocker(
        "already-published",
        status === "PENDING"
          ? `This offer was already sent to Allegro as offer ${offerId} and is still being validated. Wait for Allegro to finish rather than publishing it a second time.`
          : status === "INACTIVE"
            ? `This offer already has an Allegro draft, offer ${offerId}. Activate that draft rather than publishing a second listing for the same stamps.`
            : `This offer is already published on Allegro as offer ${offerId}. Publishing again would create a second listing for the same stamps.`
      ),
    ];
  }

  return [];
}

/**
 * Whether a refusal is Allegro saying **this account may not sell through the API at all**.
 *
 * Allegro's selling endpoints are open to business accounts only, and there is no way to ask in
 * advance: a private seller's grant is issued, refreshed and used for reading orders and bids without
 * complaint, and the refusal arrives the first time something is published — *"You cannot use the
 * Public API method when selling with a Regular Account (not registered as a Business Account)."*
 *
 * Matched on the **wording** rather than on an error code, deliberately. The code Allegro sends with
 * it is undocumented and observed once; the two account types are what the sentence is about in every
 * language it arrives in, and a phrase this specific does not occur in a refusal about a field. A
 * false positive costs one latched sentence a reconnection clears, and a false negative costs the
 * collector re-discovering the rule per offer — so the test leans towards catching it.
 */
export function namesIneligibleAccount(messages: readonly string[]): boolean {
  return messages.some((message) => {
    const text = message.toLowerCase();
    return text.includes("business account") || text.includes("konta firmowego");
  });
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/** One answered category parameter, as Allegro takes it and as #488 remembers it. */
export interface AllegroRequestParameter {
  id: string;
  valuesIds?: string[];
  values?: string[];
  rangeValue?: { from: string | null; to: string | null };
}

/** Everything the request is assembled from. Deliberately flat and platform-shaped: the caller has
 *  already resolved the kit, the profile, the category and the uploads, and this turns the four into
 *  one body. */
export interface AllegroOfferRequestInput {
  /** The Stamporama offer number (#416) — the listing's `external.id`, and the whole reason the read
   *  side (#467) gets to be exact rather than deriving identity from an address. */
  offerNo: number;
  title: string;
  description: string | null;
  descriptionFormat: DescriptionFormat;
  listingType: OfferListingType;
  price: string;
  startingPrice: string | null;
  currency: string;
  /** The number of interchangeable sets. */
  quantity: number;
  categoryId: string;
  parameters: readonly AllegroRequestParameter[];
  /** Allegro's own URLs for the uploaded pictures (#487), in upload order — the first is the
   *  listing's thumbnail. */
  imageUrls: readonly string[];
  profile: AllegroProfileForPublish;
  publication: AllegroPublicationStatus;
}

/**
 * The `POST /sale/product-offers` body for one offer.
 *
 * Two shapes are worth calling out:
 *
 *  • **`sellingMode`** carries the format (#449) and only the figure that format states: `BUY_NOW`
 *    at the asking price, `AUCTION` at the *starting* price. An auction's `price` here is an
 *    observation of the bidding and would be a bid nobody made if it were sent as the opening one.
 *  • **`description`** is Allegro's own section/item structure, and the text goes in as HTML however
 *    it was written (#319) — `descriptionToUnsafeHtml` is the same renderer the offer screen uses, so
 *    what the collector reads here and what the buyer reads on Allegro come from one conversion.
 */
export function buildAllegroOfferRequest(input: AllegroOfferRequestInput): Record<string, unknown> {
  const profile = input.profile;
  const auction = isAuctionListing(input.listingType);

  const body: Record<string, unknown> = {
    name: input.title.trim(),
    // Identity, not a label: #467 matches a synced listing back to this offer on exactly this value.
    external: { id: String(input.offerNo) },
    category: { id: input.categoryId },
    parameters: input.parameters.map((parameter) => {
      const entry: Record<string, unknown> = { id: parameter.id };
      if (parameter.valuesIds?.length) entry.valuesIds = parameter.valuesIds;
      if (parameter.values?.length) entry.values = parameter.values;
      if (parameter.rangeValue) entry.rangeValue = parameter.rangeValue;
      return entry;
    }),
    // Bare URLs, **not** `{ url }` objects: `POST /sale/product-offers` takes an array of strings,
    // and the object shape is the legacy `/sale/offers` endpoint's. Allegro answers the wrong one
    // with a `JsonMappingException` on `images[0]` — a parse failure rather than a validation
    // message, so it says only "message is not readable" and names no expected shape.
    images: [...input.imageUrls],
    sellingMode: auction
      ? {
          format: "AUCTION",
          startingPrice: { amount: input.startingPrice ?? input.price, currency: input.currency },
        }
      : { format: "BUY_NOW", price: { amount: input.price, currency: input.currency } },
    stock: { available: input.quantity, unit: "UNIT" },
    delivery: {
      shippingRates: { id: profile.shippingRatesId },
      handlingTime: profile.handlingTime,
    },
    location: {
      countryCode: profile.locationCountryCode,
      city: profile.locationCity,
      postCode: profile.locationPostCode,
    },
    payments: { invoice: profile.invoiceType },
    publication: { status: input.publication },
  };

  const description = descriptionSections(input.description, input.descriptionFormat);
  if (description) body.description = description;

  // The two after-sales ids are optional on the account and so optional here: an account that has
  // none defined publishes without them rather than not at all (#486).
  const afterSales: Record<string, unknown> = {};
  if (profile.returnPolicyId) afterSales.returnPolicy = { id: profile.returnPolicyId };
  if (profile.impliedWarrantyId) afterSales.impliedWarranty = { id: profile.impliedWarrantyId };
  if (Object.keys(afterSales).length > 0) body.afterSalesServices = afterSales;

  return body;
}

/**
 * The description as Allegro's structure — one section holding one text item.
 *
 * The text goes through the shared renderer for its format (#319) and then through
 * {@link toAllegroDescriptionHtml}, which is not optional decoration: Allegro's description field
 * takes seven tags and **no attributes**, while `plain` renders as `<p style="white-space:pre-wrap">`
 * and `markdown` renders `<strong>`, `<em>` and `<a href>`. Sending what the screen shows is a `422`
 * naming the field and nothing else.
 *
 * Null where the offer has no description, or where it held no words once the markup was taken out:
 * an offer without one is a listing with a title and pictures, not a refusal.
 */
function descriptionSections(
  description: string | null,
  format: DescriptionFormat
): Record<string, unknown> | null {
  const text = description?.trim();
  if (!text) return null;
  const content = toAllegroDescriptionHtml(descriptionToUnsafeHtml(text, format));
  if (!content) return null;
  return { sections: [{ items: [{ type: "TEXT", content }] }] };
}

// ---------------------------------------------------------------------------
// Reading Allegro's answer
// ---------------------------------------------------------------------------

/** What the create answered, once the two success shapes have been told apart. */
export interface AllegroCreatedOffer {
  /** Allegro's offer id — present on both a 201 and a 202, since the offer row exists either way. */
  offerId: string | null;
  /** The asynchronous validation a 202 started, where Allegro named one. */
  operationId: string | null;
}

/**
 * Read the offer id and the operation id out of a create's answer.
 *
 * A 202 is *accepted*, not *created*: the offer exists but its validation has not run, and it can
 * still be refused for a duplicate or a policy breach. Both ids are looked for in the body and then
 * in the `Location` header, because Allegro states them in either place depending on the shape of
 * the answer, and a publish that could not name what it created has nothing to poll and nothing to
 * record.
 */
export function readCreatedOffer(
  body: unknown,
  location: string | null
): AllegroCreatedOffer {
  const record = (body ?? {}) as Record<string, unknown>;
  const operation = (record.operation ?? {}) as Record<string, unknown>;
  const fromLocation = location ? parseOperationLocation(location) : null;

  return {
    offerId: str(record.id) ?? fromLocation?.offerId ?? null,
    operationId:
      str(record.operationId) ?? str(operation.id) ?? fromLocation?.operationId ?? null,
  };
}

/** `/sale/product-offers/{offerId}/operations/{operationId}`, as a `Location` states it. */
function parseOperationLocation(
  location: string
): { offerId: string | null; operationId: string | null } | null {
  const path = location.split("?")[0].replace(/\/+$/, "");
  const match = /\/sale\/product-offers\/([^/]+)(?:\/operations\/([^/]+))?$/.exec(path);
  if (!match) return null;
  return { offerId: match[1] ?? null, operationId: match[2] ?? null };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** How an operation ended, in this app's words. `pending` is the poll giving up rather than Allegro
 *  saying anything, which is why it is here and not in Allegro's own vocabulary. */
export type AllegroOperationOutcome = "succeeded" | "failed" | "pending";

/** One poll of `GET /sale/product-offers/{offerId}/operations/{operationId}`. */
export interface AllegroOperationStatus {
  outcome: AllegroOperationOutcome;
  /** Allegro's own account of a refusal, as it stated it. Null while the operation is running. */
  message: string | null;
}

/**
 * Read one operation poll.
 *
 * Anything that is not positively a conclusion reads as **pending**, deliberately: an unrecognised
 * status is Allegro still working as far as this app can tell, and treating it as success would
 * record a listing that may yet be refused.
 */
export function readOperationStatus(body: unknown): AllegroOperationStatus {
  const record = (body ?? {}) as Record<string, unknown>;
  const status = (str(record.status) ?? "").toUpperCase();
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const message =
    errors
      .map((error) => {
        const entry = (error ?? {}) as Record<string, unknown>;
        return str(entry.userMessage) ?? str(entry.message);
      })
      .filter((text): text is string => text !== null)
      .join(" ") || null;

  if (status === "SUCCESS" || status === "SUCCEEDED" || status === "FINISHED") {
    return { outcome: "succeeded", message: null };
  }
  if (status === "FAILED" || status === "ERROR" || status === "REJECTED") {
    return { outcome: "failed", message: message ?? "Allegro refused the listing." };
  }
  return { outcome: "pending", message: null };
}

/** The public address of an Allegro listing. Built rather than read back, because the create answers
 *  an id and the address is `/oferta/<id>` — the canonical shape #355 and #467 both match on, so a
 *  listing published here is found by the very rule everything posted by hand is found by. */
export function allegroOfferUrl(offerId: string, sandbox: boolean): string {
  const host = sandbox ? "https://allegro.pl.allegrosandbox.pl" : "https://allegro.pl";
  return `${host}/oferta/${offerId}`;
}
