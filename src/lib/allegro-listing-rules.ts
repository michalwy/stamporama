/**
 * What stops an offer being **listed on Allegro at all**, whichever path posts it (#493) — pure, no
 * Prisma and no network.
 *
 * There are two such paths and they are not variants of one another: `POST /sale/product-offers`
 * (#477; ADR-0027) and the Assistant filling Allegro's own sale form. The refusals #477 wrote were
 * all in one list, and it mixed two vocabularies. The **connection**, the write scope and the
 * account's eligibility are the API's alone — a form filled in the collector's own browser needs
 * none of them, and a private account that Allegro refuses to publish for through the API lists
 * perfectly well by hand. What is left is about the *listing*: a title Allegro will not take, a stock
 * figure that is not truthful, a missing price, no profile to go out with, no category, no pictures.
 * Those are the same refusals on both paths, so they are stated **once**, here, and the API's
 * evaluation is this list with its own group in front of it.
 *
 * The split is not cosmetic: a rule written twice is a rule the two paths eventually disagree about,
 * and the disagreement shows up as a listing one path refuses and the other posts.
 */

import { isAuctionListing, type OfferListingType, type OfferState } from "./offer-rules";

/** Allegro's own cap on a listing title. The listing kit does not enforce one — a title is a text
 *  about the goods and every platform caps it differently — so it is checked here, where the
 *  platform is known. Allegro's sale form states the same 75 in its own counter. */
export const ALLEGRO_TITLE_MAX_LENGTH = 75;

/** Every reason a listing cannot go out, whichever path posts it. */
export type AllegroListingBlockerCode =
  | "not-ready"
  | "no-sets"
  | "mixed-sets"
  | "no-price"
  | "no-starting-price"
  | "no-title"
  | "title-too-long"
  | "no-profile"
  | "incomplete-profile"
  | "photos-not-ready"
  | "no-photos"
  | "no-category"
  | "missing-category-parameters";

/** One reason this offer cannot be listed, ready to show verbatim. Shaped like #406's blocker so the
 *  two read alike wherever they are rendered side by side. */
export interface AllegroListingBlocker<Code extends string = AllegroListingBlockerCode> {
  code: Code;
  message: string;
}

/** The profile's own half of a listing — the account-side settings it goes out with (#486). Every
 *  field maps onto the sale form as directly as onto the API request: the option values of
 *  `#shippingRatesId`, `#estimatedShippingTimeId` and `#return-policies` are these very ids. */
export interface AllegroProfileForPublish {
  id: string;
  name: string;
  shippingRatesId: string;
  handlingTime: string;
  returnPolicyId: string | null;
  impliedWarrantyId: string | null;
  locationCountryCode: string;
  locationCity: string;
  locationPostCode: string;
  invoiceType: string;
}

/** Everything the listing-side refusals are decided from — the offer as either path holds it. */
export interface AllegroListingReadiness {
  state: OfferState;
  listingType: OfferListingType;
  title: string | null;
  /** The current figure, as the kit states it. `0` on an auction nobody has bid on (#449). */
  price: string;
  startingPrice: string | null;
  /** How many interchangeable sets there are — `stock.available`, and the form's `#quantity`. */
  quantity: number;
  /** Whether every set holds the same goods (#406's homogeneity, asked again here because what it
   *  guarantees on Allegro is the truthfulness of that one figure). */
  setsInterchangeable: boolean;
  /** The set labels that differ from the first one, for the sentence. */
  differingSetLabels: readonly string[];
  profile: AllegroProfileForPublish | null;
  /** The photo generation's state, and how many pictures the upload set holds. */
  photosReady: boolean;
  photoCount: number;
  /** The category this offer is configured to be listed in (#494) — stored on the offer, not worked
   *  out here. Null when nothing has been matched, which is a refusal pointing at the offer's own
   *  Allegro card rather than a question asked where the listing is posted. */
  categoryId: string | null;
  /** The **required** parameters of that category that this offer has no answer for. Allegro refuses
   *  a listing missing one, and it refuses it by a name the collector never saw — so they are named
   *  before anything is posted. Empty where the category's parameters could not be read at all,
   *  which is not a refusal: Allegro being unreachable is not this offer being wrong. */
  unansweredParameters: readonly string[];
}

export function allegroBlocker(
  code: AllegroListingBlockerCode,
  message: string
): AllegroListingBlocker {
  return { code, message };
}

/**
 * Every reason this offer cannot be listed on Allegro, in the order they are worth fixing.
 *
 * `not-ready` and `no-sets` stand **alone** for #406's reason — an offer that is not finished has
 * nothing else worth saying about it. Everything after that is reported together, because each is
 * fixed somewhere different: the price on the header, the profile in Settings, the category on the
 * offer's own Allegro card, the photos on the card below.
 */
export function evaluateAllegroListingBlockers(
  input: AllegroListingReadiness
): AllegroListingBlocker[] {
  if (input.state !== "ready") {
    return [
      allegroBlocker(
        "not-ready",
        `This offer is ${input.state}, not Ready — only a Ready offer can be listed on Allegro.`
      ),
    ];
  }
  if (input.quantity === 0) {
    return [allegroBlocker("no-sets", "This offer holds no copies — there is nothing to list.")];
  }

  const blockers: AllegroListingBlocker[] = [];

  if (!input.setsInterchangeable) {
    blockers.push(
      allegroBlocker(
        "mixed-sets",
        `The sets are not interchangeable, so one stock figure cannot describe them: ${input.differingSetLabels.join(", ")} ${input.differingSetLabels.length === 1 ? "differs" : "differ"} from the first. List them separately, or make the sets match.`
      )
    );
  }

  const title = input.title?.trim() ?? "";
  if (!title) {
    blockers.push(
      allegroBlocker("no-title", "This listing has no title, and Allegro will not take an offer without one.")
    );
  } else if (title.length > ALLEGRO_TITLE_MAX_LENGTH) {
    // Neither written nor truncated, exactly as an over-long Colnect text is (#405): shortening
    // mangles wording the collector chose, and sending it would be refused by Allegro anyway.
    blockers.push(
      allegroBlocker(
        "title-too-long",
        `The listing title is ${title.length} characters and Allegro takes ${ALLEGRO_TITLE_MAX_LENGTH}. Shorten it — it is not truncated here, because a title cut by the app is not the title that was written.`
      )
    );
  }

  // Which figure is required is the format's own question (#449): a seller states an opening price on
  // an auction and an asking price on a quick buy, and the other one is an observation.
  if (isAuctionListing(input.listingType)) {
    if (!hasAmount(input.startingPrice)) {
      blockers.push(
        allegroBlocker("no-starting-price", "This auction has no starting price, which is what it opens at.")
      );
    }
  } else if (!hasAmount(input.price)) {
    blockers.push(allegroBlocker("no-price", "This listing has no asking price."));
  }

  if (!input.profile) {
    blockers.push(
      allegroBlocker(
        "no-profile",
        "There is no Allegro listing profile to list with — a listing needs delivery, returns and a sending address. Create one under Settings → Allegro and mark it the default."
      )
    );
  } else {
    const missing = incompleteProfileFields(input.profile);
    if (missing.length > 0) {
      blockers.push(
        allegroBlocker(
          "incomplete-profile",
          `The listing profile "${input.profile.name}" is missing ${missing.join(", ")}. Complete it under Settings → Allegro.`
        )
      );
    }
  }

  // The category and its answers live on the offer (#494), so a gap in them is fixed on the offer's
  // own screen — one line saying where, exactly like the profile and the price above.
  if (!input.categoryId) {
    blockers.push(
      allegroBlocker(
        "no-category",
        "This offer has no Allegro category. Allegro will not take a listing without one — set it on the offer's Allegro card."
      )
    );
  } else if (input.unansweredParameters.length > 0) {
    blockers.push(
      allegroBlocker(
        "missing-category-parameters",
        `This offer's Allegro category requires ${input.unansweredParameters.join(", ")}, which ${input.unansweredParameters.length === 1 ? "has" : "have"} no answer. Fill ${input.unansweredParameters.length === 1 ? "it" : "them"} in on the offer's Allegro card — Allegro refuses a listing missing one, naming a field you never saw.`
      )
    );
  }

  if (!input.photosReady) {
    blockers.push(
      allegroBlocker(
        "photos-not-ready",
        "This offer's listing images have not finished generating. Generate them on the Photos card first."
      )
    );
  } else if (input.photoCount === 0) {
    blockers.push(
      allegroBlocker("no-photos", "This offer has no publishable images, and an Allegro listing needs at least one.")
    );
  }

  return blockers;
}

/** Whether a decimal string states a figure at all. `0.00` is not a price — it is the auction's
 *  "nobody has bid" (#449). */
function hasAmount(amount: string | null): boolean {
  if (!amount) return false;
  const value = Number(amount);
  return Number.isFinite(value) && value > 0;
}

/** The profile fields a listing cannot go out without, by the names the editor calls them. The two
 *  after-sales ids are deliberately **not** here: Allegro defaults them for accounts that have none
 *  defined, and refusing over a field a private collector's account never had is refusing a listing
 *  Allegro would take. */
function incompleteProfileFields(profile: AllegroProfileForPublish): string[] {
  const missing: string[] = [];
  if (!profile.shippingRatesId.trim()) missing.push("a delivery price list");
  if (!profile.handlingTime.trim()) missing.push("a handling time");
  if (!profile.locationCity.trim()) missing.push("a city");
  if (!profile.locationPostCode.trim()) missing.push("a post code");
  if (!profile.locationCountryCode.trim()) missing.push("a country");
  return missing;
}
