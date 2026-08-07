import "server-only";
import { prisma } from "./db";
import {
  getAllegroCategoryForm,
  suggestAllegroCategoryForOffer,
  recordAllegroCategoryLesson,
} from "./allegro-category";
import type { AllegroCategoryParameter } from "./allegro-api";
import {
  isBlankParameterValue,
  readParameterValue,
  type AllegroParameterValue,
} from "./allegro-category-rules";
import {
  listAllegroListingProfiles,
  resolveAllegroListingProfileForOffer,
  type AllegroListingProfileData,
} from "./allegro-listing-profile";
import { ALLEGRO_PLATFORM_MODULE } from "./platform-modules";

// What an offer is configured to be listed as on Allegro (#494) — the category, its parameter
// answers, and which listing profile it goes out with.
//
// **Why it lives on the offer.** There are two ways a listing reaches Allegro: the API (#477) and
// the Assistant filling Allegro's own sale form (#493). Both need the same four things, and while
// the category was resolved *inside the publish dialog* only one of them could reach it. A value
// each path works out for itself is a value the two eventually disagree about — so it is worked out
// once, stored on the offer, shown on the offer's own screen, and read from there by whichever path
// actually posts.
//
// **Nothing here is a gate.** The category is filled in the moment the offer gains its first copy,
// and whatever was matched is what publishes; every value is correctable in place and none of them
// asks to be confirmed first. What the card carries instead is *provenance* — learned, guessed by
// Allegro, or picked by hand — because a value nobody can account for is one that gets re-checked by
// hand every time, which is the cost this was meant to remove.
//
// **The register learns when the offer is finished being prepared** — `preparing → ready`, not at
// publication. ADR-0026 §5 said "on a successful publish" and #477 read that literally, which is the
// wrong moment for the way a collection is worked: offers are prepared in runs and published later,
// so a register that only learns at publication asks the same question twenty times and answers it
// the day after it stopped mattering. `ready` is where the collector has said what these stamps are,
// which is the whole of what a lesson claims. An offer left in `preparing` still teaches nothing.

/** One answered parameter as the offer stores it, and as both listing paths send it. */
export interface AllegroOfferParameter {
  parameterId: string;
  parameterName: string | null;
  /** Whether Allegro files this parameter under the **product** rather than the offer.
   *
   *  Both sections are held, because the two listing paths need different subsets: Allegro's own sale
   *  form (#493) asks for both and the collector answers both, while `POST /sale/product-offers`
   *  refuses a product parameter among the offer's own (ADR-0027 §2). The flag rides with the answer
   *  so that restriction is applied where the API request is built — and nowhere else, an earlier
   *  pass having filtered at the *read* and thereby stopped the collector being asked for values the
   *  other path needs. */
  describesProduct: boolean;
  value: AllegroParameterValue;
}

/** Where a stored category came from. Display only — nothing branches on it. */
export type AllegroCategorySourceKind = "learned" | "allegro" | "manual";

/** The offer's Allegro listing configuration as the screen and both listing paths read it. */
export interface AllegroOfferListingConfig {
  categoryId: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  source: AllegroCategorySourceKind | null;
  /** One sentence saying what the category was matched on, or null on a hand-picked one — a manual
   *  choice answers for itself. */
  matchedOn: string | null;
  parameters: AllegroOfferParameter[];
  /** The profile this offer would publish with, resolved through #486's single fallback rule: the
   *  offer's own, else the platform's default. Null when there is neither. */
  profile: { id: string; name: string; isPlatformDefault: boolean } | null;
  /** Whether the offer names a profile itself, as opposed to following the platform's default. The
   *  card needs the distinction: "(platform default)" and "this offer only" are different answers. */
  profileIsOverride: boolean;
  /** Every profile the platform has, so the card's select needs no read of its own. */
  profileOptions: { id: string; name: string; isDefault: boolean }[];
}

const CONFIG_SELECT = {
  collectionId: true,
  allegroListingProfileId: true,
  allegroCategoryId: true,
  allegroCategoryName: true,
  allegroCategoryPath: true,
  allegroCategorySource: true,
  allegroCategoryMatchedOn: true,
  allegroCategoryParameters: true,
  platform: { select: { id: true, platformModule: true } },
} as const;

function readSource(raw: string | null): AllegroCategorySourceKind | null {
  return raw === "learned" || raw === "allegro" || raw === "manual" ? raw : null;
}

/**
 * The stored parameter answers, narrowed.
 *
 * Every entry is re-read through `readParameterValue` rather than trusted: the column is JSON, and a
 * row written by an older shape or edited in the database costs one parameter to fill in again if it
 * is dropped, and a refused publish if it is sent (ADR-0026's rule for the register, applied to the
 * same values held here).
 */
export function readOfferParameters(raw: unknown): AllegroOfferParameter[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const parameterId = typeof row.parameterId === "string" ? row.parameterId.trim() : "";
    const value = readParameterValue(row.value);
    if (!parameterId || !value) return [];
    return [
      {
        parameterId,
        parameterName: typeof row.parameterName === "string" ? row.parameterName : null,
        // Absent on a row written before the flag existed. `false` is the safe reading: an offer
        // parameter sent as one is accepted, while a product parameter mistaken for an offer one is
        // the refusal this exists to prevent — so an unknown is treated as the section the API takes
        // and is corrected the next time the card is saved.
        describesProduct: row.describesProduct === true,
        value,
      },
    ];
  });
}

/** Whether this offer is even on the platform this collection calls Allegro. Everything below is a
 *  no-op for one that is not — an offer on Colnect has no Allegro category and asking for one would
 *  be #471's mistake in a new place. */
async function allegroOfferRef(offerId: string) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: CONFIG_SELECT });
  if (!offer || offer.platform.platformModule !== ALLEGRO_PLATFORM_MODULE) return null;
  return offer;
}

/** What this offer would be listed as, or null when it is not an Allegro offer. */
export async function getAllegroOfferListingConfig(
  ownerId: string,
  offerId: string
): Promise<AllegroOfferListingConfig | null> {
  const offer = await allegroOfferRef(offerId);
  if (!offer) return null;

  const [profile, profiles] = await Promise.all([
    resolveAllegroListingProfileForOffer(offerId),
    listAllegroListingProfiles(ownerId, offer.collectionId),
  ]);

  return {
    categoryId: offer.allegroCategoryId,
    categoryName: offer.allegroCategoryName,
    categoryPath: offer.allegroCategoryPath,
    source: readSource(offer.allegroCategorySource),
    matchedOn: offer.allegroCategoryMatchedOn,
    parameters: readOfferParameters(offer.allegroCategoryParameters),
    profile: profile
      ? {
          id: profile.id,
          name: profile.name,
          isPlatformDefault: profile.id === profiles.defaultProfileId,
        }
      : null,
    profileIsOverride: offer.allegroListingProfileId !== null,
    profileOptions: profiles.profiles.map((row) => ({
      id: row.id,
      name: row.name,
      isDefault: row.isDefault,
    })),
  };
}

/** What a category write stores. `parameters` is the answers as they will be sent. */
export interface AllegroCategoryChoiceInput {
  categoryId: string;
  categoryName: string | null;
  categoryPath: string | null;
  parameters: AllegroOfferParameter[];
}

/**
 * Write a category the collector chose by hand.
 *
 * `source` becomes `manual` and `matchedOn` is cleared: a choice somebody made answers for itself,
 * and leaving the old sentence beside it would have the card explaining a match that is no longer
 * the reason this category is here.
 */
export async function setAllegroOfferCategory(
  ownerId: string,
  offerId: string,
  input: AllegroCategoryChoiceInput
): Promise<AllegroOfferListingConfig | null> {
  const offer = await allegroOfferRef(offerId);
  if (!offer) return null;
  await prisma.offer.update({
    where: { id: offerId },
    data: {
      allegroCategoryId: input.categoryId,
      allegroCategoryName: input.categoryName?.trim() || null,
      allegroCategoryPath: input.categoryPath?.trim() || null,
      allegroCategorySource: "manual",
      allegroCategoryMatchedOn: null,
      allegroCategoryParameters: sendableParameters(input.parameters),
    },
  });
  return getAllegroOfferListingConfig(ownerId, offerId);
}

/**
 * Answer **one** parameter of the category the offer already holds (#494).
 *
 * The counterpart of {@link setAllegroOfferCategory} for the case that is not a category change at
 * all: the category is right and one answer is wrong. Sending the whole set back would make every
 * correction a re-pick of the category — which is what the card's inline edit exists to stop — so
 * this merges by `parameterId` and leaves the rest of the answers, the category, its provenance and
 * `matchedOn` exactly as they stood. Correcting an answer says nothing about where the category came
 * from, and a card that started reading *chosen by you* because a dictionary value was fixed would
 * be claiming something nobody did.
 *
 * A blank value **removes** the answer rather than storing an empty one, which is the same rule
 * `sendableParameters` applies: an unanswered parameter is not an answer, and an optional field sent
 * empty is a refusal.
 */
export async function setAllegroOfferParameter(
  ownerId: string,
  offerId: string,
  input: {
    parameterId: string;
    parameterName: string | null;
    describesProduct: boolean;
    value: AllegroParameterValue | null;
  }
): Promise<AllegroOfferListingConfig | null> {
  const offer = await allegroOfferRef(offerId);
  if (!offer) return null;

  const stored = readOfferParameters(offer.allegroCategoryParameters);
  const answer =
    input.value && !isBlankParameterValue(input.value)
      ? {
          parameterId: input.parameterId,
          parameterName: input.parameterName,
          describesProduct: input.describesProduct,
          value: input.value,
        }
      : null;
  // Replaced where it is rather than dropped and appended: the stored order is what a listing path
  // sends, and moving a corrected parameter to the end changes a request for no reason.
  const held = stored.some((entry) => entry.parameterId === input.parameterId);
  const next = held
    ? stored.flatMap((entry) =>
        entry.parameterId === input.parameterId ? (answer ? [answer] : []) : [entry]
      )
    : answer
      ? [...stored, answer]
      : stored;

  await prisma.offer.update({
    where: { id: offerId },
    data: { allegroCategoryParameters: sendableParameters(next) },
  });
  return getAllegroOfferListingConfig(ownerId, offerId);
}

/** Which profile this offer publishes with. `null` hands it back to the platform's default, which is
 *  a state rather than a gap — and is what almost every listing wants. */
export async function setAllegroOfferProfile(
  ownerId: string,
  offerId: string,
  profileId: string | null
): Promise<AllegroOfferListingConfig | null> {
  const offer = await allegroOfferRef(offerId);
  if (!offer) return null;
  if (profileId) {
    // Checked against this offer's own platform rather than taken on trust: a profile belongs to the
    // marketplace it was written for, and one from another platform would publish somebody else's
    // delivery terms.
    const owned = await prisma.allegroListingProfile.findFirst({
      where: { id: profileId, platformId: offer.platform.id, collectionId: offer.collectionId },
      select: { id: true },
    });
    if (!owned) throw new Error("That listing profile does not belong to this offer's platform.");
  }
  await prisma.offer.update({
    where: { id: offerId },
    data: { allegroListingProfileId: profileId },
  });
  return getAllegroOfferListingConfig(ownerId, offerId);
}

/** Blank answers are dropped rather than stored: an unanswered parameter is not an answer, and
 *  sending an empty one is how an optional field becomes a refusal. */
function sendableParameters(parameters: readonly AllegroOfferParameter[]) {
  return parameters
    .filter((entry) => !isBlankParameterValue(entry.value))
    .map((entry) => ({
      parameterId: entry.parameterId,
      parameterName: entry.parameterName,
      describesProduct: entry.describesProduct,
      value: entry.value,
    })) as object[];
}

/**
 * Fill the category in when the offer first has something to categorise (#494).
 *
 * Called from the three mutations that add copies, exactly where `syncGeneratedTexts` is (#365/#380)
 * — and with one deliberate difference from it: this is a **backfill, never a refresh**. A generated
 * title follows the composition because it *describes* it; a category is a decision about what the
 * goods are, and re-deriving it under a collector who has corrected it would undo that silently. So
 * it writes only while the offer has none, and re-matching is an explicit ↻ (see {@link
 * rematchAllegroOfferCategory}).
 *
 * **It can never fail the mutation it hangs off.** Adding a set is the collector's own act and has
 * nothing to do with Allegro; a marketplace that is down, a connection that has expired or a
 * category tree that has moved must cost a blank card and a ↻, not a refused set. Every failure is
 * therefore swallowed here rather than reported — the card says the offer has no category, which is
 * both true and the thing to act on.
 */
export async function backfillAllegroCategory(ownerId: string, offerId: string): Promise<void> {
  try {
    const offer = await allegroOfferRef(offerId);
    if (!offer || offer.allegroCategoryId) return;
    await matchAndStore(ownerId, offer.collectionId, offerId);
  } catch {
    // Deliberately silent — see above.
  }
}

/**
 * Match the category again, overwriting whatever is stored — the ↻ on the offer's Allegro card.
 *
 * Explicit, and destructive by design: it is the one way back to the register's own answer after a
 * correction, and after the composition has changed enough that the first match no longer describes
 * the goods. Unlike the backfill it **reports** its failures, because somebody is watching it.
 */
export async function rematchAllegroOfferCategory(
  ownerId: string,
  offerId: string
): Promise<AllegroOfferListingConfig | null> {
  const offer = await allegroOfferRef(offerId);
  if (!offer) return null;
  await matchAndStore(ownerId, offer.collectionId, offerId);
  return getAllegroOfferListingConfig(ownerId, offerId);
}

/**
 * Run #488's suggestion and write it onto the offer.
 *
 * The parameters stored are the register's **recalled** answers for the chosen category — which is
 * the whole point of the second register (ADR-0026 §1): the questions are Allegro's and read live,
 * and only the answers are remembered. A required parameter nothing recalls is simply absent, and
 * the card shows it as unanswered rather than inventing a value for it.
 */
async function matchAndStore(
  ownerId: string,
  collectionId: string,
  offerId: string
): Promise<void> {
  const suggestion = await suggestAllegroCategoryForOffer(ownerId, collectionId, offerId);
  if (!suggestion?.categoryId) return;

  const parameters = suggestion.parameters.flatMap((prefill) =>
    prefill.recalled
      ? [
          {
            parameterId: prefill.parameter.id,
            parameterName: prefill.parameter.name,
            describesProduct: prefill.parameter.describesProduct,
            value: prefill.recalled,
          },
        ]
      : []
  );

  await prisma.offer.update({
    where: { id: offerId },
    data: {
      allegroCategoryId: suggestion.categoryId,
      allegroCategoryName: suggestion.categoryName,
      allegroCategoryPath: suggestion.categoryPath,
      allegroCategorySource: suggestion.source === "learned" ? "learned" : "allegro",
      allegroCategoryMatchedOn: suggestion.matchedOn,
      allegroCategoryParameters: sendableParameters(parameters),
    },
  });
}

/** One parameter of the stored category, with what Allegro asks and what this offer answers — what
 *  the card renders and what says whether a required one is still open. */
export interface AllegroOfferParameterView {
  parameterId: string;
  name: string;
  required: boolean;
  /** Product-section, and so **not** sendable through the API (ADR-0027 §2). The card says so rather
   *  than hiding it: it is a field of Allegro's own sale form, the collector fills it in there, and a
   *  value that quietly never reaches a listing is worse than one labelled as belonging to the other
   *  route. */
  describesProduct: boolean;
  /** Allegro's own wording for the answer, where it has one — a dictionary option's label rather
   *  than its opaque id, which is what the collector recognises. */
  answer: string | null;
  /** What Allegro asks, in full — the type, the dictionary's options and the bounds — so the card
   *  can put the *right field* under the collector's click rather than a text box for everything.
   *  The three fields above are the row's own reading of it and stay where they are: the display is
   *  what the card renders, this is what its editor is built from. */
  field: AllegroCategoryParameter;
  /** The answer as it is stored and as it will be sent, which is what an inline edit opens on — the
   *  displayed `answer` is words, and a dictionary's words cannot be turned back into option ids. */
  value: AllegroParameterValue | null;
}

/** The stored category's parameters as the card shows them, read live from Allegro (the questions
 *  are Allegro's) and answered from the offer. Null when the offer holds no category, or Allegro
 *  could not be reached — which the card reports rather than rendering as "nothing required". */
export async function describeAllegroOfferParameters(
  ownerId: string,
  collectionId: string,
  offerId: string
): Promise<
  | { parameters: AllegroOfferParameterView[]; categoryName: string | null; categoryPath: string | null }
  | { error: string }
  | null
> {
  const offer = await allegroOfferRef(offerId);
  if (!offer?.allegroCategoryId) return null;

  const answers = new Map(
    readOfferParameters(offer.allegroCategoryParameters).map((p) => [p.parameterId, p.value])
  );

  try {
    const form = await getAllegroCategoryForm(ownerId, collectionId, offer.allegroCategoryId);
    return {
      // The breadcrumb comes back with them, so a category matched before the path was recorded gets
      // one without a re-match. The stored value still leads where there is one — it is the snapshot
      // of what this offer was categorised as, and this is a live read of what the tree says today.
      categoryName: form.categoryName,
      categoryPath: form.categoryPath,
      parameters: form.parameters.map((prefill) => ({
        parameterId: prefill.parameter.id,
        name: prefill.parameter.name,
        required: prefill.parameter.required,
        describesProduct: prefill.parameter.describesProduct,
        answer: describeAnswer(prefill.parameter.dictionary, answers.get(prefill.parameter.id)),
        field: prefill.parameter,
        value: answers.get(prefill.parameter.id) ?? null,
      })),
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "This category's parameters could not be read.",
    };
  }
}

/** An answer in words. A dictionary value is stored as Allegro's option id, which means nothing on
 *  screen, so it is resolved back through the options the same read already carried. */
function describeAnswer(
  dictionary: readonly { id: string; value: string }[],
  value: AllegroParameterValue | undefined
): string | null {
  if (!value) return null;
  if (value.valuesIds?.length) {
    return value.valuesIds
      .map((id) => dictionary.find((option) => option.id === id)?.value ?? id)
      .join(", ");
  }
  if (value.values?.length) return value.values.join(", ");
  const range = value.rangeValue;
  if (range && (range.from || range.to)) return `${range.from ?? "…"} – ${range.to ?? "…"}`;
  return null;
}

/**
 * Record what an offer the collector has finished preparing is categorised as (ADR-0026 §5 as
 * amended by #494).
 *
 * Called from `setOfferState` on the move to **`ready`** — the point the collector has said what
 * these stamps are, and the point at which the answer is worth having for the *next* offer in the
 * same run. Not at publication: offers are prepared in batches and published later, and a register
 * that learns only when something goes live answers the question the day after it stopped mattering.
 *
 * Swallows its own failures: a register write is not worth failing a transition over, and the lesson
 * is an optimisation for the next listing rather than a part of this one.
 */
export async function learnAllegroCategoryFromReadyOffer(offerId: string): Promise<void> {
  try {
    const offer = await allegroOfferRef(offerId);
    if (!offer?.allegroCategoryId) return;
    await recordAllegroCategoryLesson(offer.collectionId, offerId, {
      categoryId: offer.allegroCategoryId,
      categoryName: offer.allegroCategoryName,
      categoryPath: offer.allegroCategoryPath,
      parameters: readOfferParameters(offer.allegroCategoryParameters),
    });
  } catch {
    // Deliberately silent — see above.
  }
}

/** The stored configuration as a listing path consumes it: the category, the answers and the
 *  resolved profile, with nothing worked out a second time. */
export async function readAllegroListingInputs(offerId: string): Promise<{
  categoryId: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  parameters: AllegroOfferParameter[];
  profile: AllegroListingProfileData | null;
} | null> {
  const offer = await allegroOfferRef(offerId);
  if (!offer) return null;
  return {
    categoryId: offer.allegroCategoryId,
    categoryName: offer.allegroCategoryName,
    categoryPath: offer.allegroCategoryPath,
    parameters: readOfferParameters(offer.allegroCategoryParameters),
    profile: await resolveAllegroListingProfileForOffer(offerId),
  };
}
