import "server-only";
import { prisma } from "./db";
import { getAllegroCategoryForm } from "./allegro-category";
import type { AllegroParameterValue } from "./allegro-category-rules";
import {
  evaluateAllegroListingBlockers,
  type AllegroListingBlocker,
} from "./allegro-listing-rules";
import { readAllegroListingInputs } from "./allegro-offer-listing";
import { normalizeListingType } from "./offer-rules";
import type { OfferState } from "./offer-rules";

// **What an Allegro sale form needs that the listing kit does not carry** (#493) — the category, the
// answers to its parameters and the profile the listing goes out with.
//
// The listing kit (#405) is platform-neutral *in shape*: it says what a listing holds and never how
// anyone's form is laid out. Allegro's configuration is not that — it is four values that mean
// nothing on any other marketplace — so it travels as a **named section beside** the neutral fields
// rather than as Allegro-shaped fields sprinkled through them. A third marketplace with its own
// configuration gets its own section; nothing about the kit moves.
//
// Everything here is **read, never resolved a second time**: the category, both parameter sections
// and the profile are what #494 stored on the offer, through the one read both listing paths go
// through (`readAllegroListingInputs`). The single thing this adds is each answer's **display
// value** — the sale form's parameter control submits the option's *label*, not the dictionary id
// the API takes (mapped 2026-08-05), so an answer travels as both.

/** One answered parameter, as Allegro's own sale form needs it. */
export interface AllegroTaskParameter {
  /** Allegro's parameter id — and, on the sale form, the **element id** of the control that answers
   *  it (`#213`). */
  parameterId: string;
  parameterName: string | null;
  /** Whether Allegro files this under the **product** rather than the offer (#494). The API drops
   *  these; the sale form asks for both, so the module fills them and this is not a filter. */
  describesProduct: boolean;
  /** What the sale form's own control shows for this answer, in Allegro's words — what a `select`'s
   *  option `value` is. Empty where the category's dictionary could not be read, which is a skipped
   *  field on the form and never a wrong one. */
  displayValues: string[];
  /** The same answer as the API takes it (#488), carried so the two paths cannot drift. */
  value: AllegroParameterValue;
}

/** The profile as a sale form takes it (#486). The three ids are the option values of
 *  `#shippingRatesId`, `#estimatedShippingTimeId` and `#return-policies` verbatim; the address is
 *  Allegro's own account setting and has no field, so it travels to be *reported*, not typed. */
export interface AllegroTaskProfile {
  id: string;
  name: string;
  shippingRatesId: string;
  shippingRatesName: string | null;
  handlingTime: string;
  /** How long the listing runs (#493) — null leaves the form's own choice standing. */
  durationLimit: string | null;
  /** Whether Allegro re-lists it when that runs out (#493) — set either way, being a decision. */
  autoRepublish: boolean;
  returnPolicyId: string | null;
  returnPolicyName: string | null;
  impliedWarrantyId: string | null;
  locationCountryCode: string;
  locationCity: string;
  locationPostCode: string;
  invoiceType: string;
}

/** Allegro's half of a listing task. */
export interface AllegroListingSection {
  categoryId: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  parameters: AllegroTaskParameter[];
  profile: AllegroTaskProfile | null;
  /** Whether it opens as an auction (#449), and at what — the form's `#auction-checkbox` and the
   *  opening figure, which is a different number from the kit's `price`. */
  listingType: "fixed" | "auction";
  startingPrice: string | null;
  /** Why this offer cannot be listed on Allegro at all — the **listing-scope** refusals (#493),
   *  which are the very ones the API path refuses on once its connection is in order. Empty on a
   *  servable task; the endpoint refuses on any, exactly as it does on #406's. */
  blockers: AllegroListingBlocker[];
}

/** The kit's own half of what the refusals are decided from — passed in rather than re-read, so the
 *  two can never describe different offers. */
export interface AllegroSectionContext {
  offerId: string;
  state: OfferState;
  title: string;
  price: string;
  quantity: number;
  photosReady: boolean;
  photoCount: number;
  /** Whether every set holds the same goods — the shell-wide precondition (#406), already evaluated
   *  over this very kit. Asked here because on Allegro it is what makes `#quantity` truthful. */
  setsInterchangeable: boolean;
  /** The set labels that differ from the first, for the sentence. */
  differingSetLabels: readonly string[];
}

/**
 * Allegro's section of the listing task, or null when this offer is not on the Allegro platform.
 *
 * The **category read is best-effort**: Allegro is asked for the category's parameters in order to
 * put a label on each stored answer and to name the required ones nothing answers, and a read that
 * fails costs labels rather than the task. That is the same rule the publish plan applies (ADR-0026
 * §1) — Allegro being unreachable is not this offer being wrong — and it matters more here, since
 * this is the path a collector reaches for precisely when the API will not serve them.
 */
export async function readAllegroListingSection(
  ownerId: string,
  collectionId: string,
  context: AllegroSectionContext
): Promise<AllegroListingSection | null> {
  const inputs = await readAllegroListingInputs(context.offerId);
  if (!inputs) return null;

  const offer = await prisma.offer.findUnique({
    where: { id: context.offerId },
    select: { listingType: true, startingPrice: true },
  });
  const listingType = normalizeListingType(offer?.listingType ?? null);
  const startingPrice = offer?.startingPrice?.toFixed(2) ?? null;

  const form = await readCategoryForm(ownerId, collectionId, inputs.categoryId);
  const answered = new Set(inputs.parameters.map((p) => p.parameterId));

  const profile = inputs.profile;
  const blockers = evaluateAllegroListingBlockers({
    state: context.state,
    listingType,
    title: context.title,
    price: context.price,
    startingPrice,
    quantity: context.quantity,
    setsInterchangeable: context.setsInterchangeable,
    differingSetLabels: context.differingSetLabels,
    profile,
    photosReady: context.photosReady,
    photoCount: context.photoCount,
    categoryId: inputs.categoryId,
    // The **offer** section only, and only what Allegro says is required: a product parameter the
    // sale form asks for is one the collector answers on the form, not a reason to refuse the task.
    unansweredParameters: (form ?? [])
      .filter((p) => p.required && !p.describesProduct && !answered.has(p.id))
      .map((p) => p.name),
  });

  return {
    categoryId: inputs.categoryId,
    categoryName: inputs.categoryName,
    categoryPath: inputs.categoryPath,
    parameters: inputs.parameters.map((parameter) => ({
      parameterId: parameter.parameterId,
      parameterName: parameter.parameterName,
      describesProduct: parameter.describesProduct,
      displayValues: displayValuesFor(parameter.value, form, parameter.parameterId),
      value: parameter.value,
    })),
    profile: profile
      ? {
          id: profile.id,
          name: profile.name,
          shippingRatesId: profile.shippingRatesId,
          shippingRatesName: profile.shippingRatesName,
          handlingTime: profile.handlingTime,
          durationLimit: profile.durationLimit,
          autoRepublish: profile.autoRepublish,
          returnPolicyId: profile.returnPolicyId,
          returnPolicyName: profile.returnPolicyName,
          impliedWarrantyId: profile.impliedWarrantyId,
          locationCountryCode: profile.locationCountryCode,
          locationCity: profile.locationCity,
          locationPostCode: profile.locationPostCode,
          invoiceType: profile.invoiceType,
        }
      : null,
    listingType,
    startingPrice,
    blockers,
  };
}

/** One parameter as this file needs it — Allegro's own question, with its options. */
interface CategoryParameterShape {
  id: string;
  name: string;
  required: boolean;
  describesProduct: boolean;
  dictionary: readonly { id: string; value: string }[];
}

/** The category's parameters, or null where Allegro could not be asked. Never throws — see
 *  {@link readAllegroListingSection}. */
async function readCategoryForm(
  ownerId: string,
  collectionId: string,
  categoryId: string | null
): Promise<CategoryParameterShape[] | null> {
  if (!categoryId) return null;
  try {
    const form = await getAllegroCategoryForm(ownerId, collectionId, categoryId);
    return form.parameters.map((prefill) => prefill.parameter);
  } catch {
    return null;
  }
}

/**
 * What the sale form's control shows for one stored answer.
 *
 * A dictionary answer is held as Allegro's **value ids** (#488), because that is what the API takes;
 * the form's `select` submits the option's text. So the ids are translated through the category's
 * own dictionary, and an id the dictionary does not name is left out rather than guessed — a wrong
 * option is worse than a field the collector fills in.
 *
 * A free-text or range answer is already its own display value, and needs no dictionary at all,
 * which is why those still work when the category could not be read.
 */
function displayValuesFor(
  value: AllegroParameterValue,
  form: CategoryParameterShape[] | null,
  parameterId: string
): string[] {
  if (value.values?.length) return value.values.filter((v) => v.trim());
  if (value.rangeValue) {
    return [value.rangeValue.from, value.rangeValue.to].filter(
      (v): v is string => typeof v === "string" && v.trim() !== ""
    );
  }
  if (!value.valuesIds?.length) return [];
  const dictionary = form?.find((p) => p.id === parameterId)?.dictionary ?? [];
  return value.valuesIds.flatMap((id) => {
    const option = dictionary.find((entry) => entry.id === id);
    return option ? [option.value] : [];
  });
}
