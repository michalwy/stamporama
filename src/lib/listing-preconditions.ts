import { OFFER_STATE_LABEL, type OfferState } from "./offer-rules";
import { listingModuleRules } from "./platform-modules";

// What has to be true before an offer can be handed to the Assistant to post (#406, part of #155) —
// pure, no Prisma. The listing kit (#405) evaluates these over its own payload and refuses to serve
// one that fails, and the bulk listing workspace shows the same list on the card before the handoff
// is offered, so the card and the endpoint can never disagree about why an offer cannot be listed.
//
// Every check here is about the *goods being misdescribed*, never about wording: an unmapped
// condition posts a wrong grade, a missing catalog item-ID points the form at nothing, and a
// quantity over sets that are not interchangeable claims N of something that does not exist. A text
// that overruns the platform's cap is deliberately **not** here (#403) — that is a paste the
// platform's own field will visibly refuse, not a false claim about the stamps.
//
// **Which checks apply is the module's own answer** (#493). The first two are one module's rules —
// Colnect's catalogue and Colnect's grades — and a second listable marketplace does not inherit them
// by gaining a sale form; `listingModuleRules` is where each module states what its form asks for.
// What is left over is shell-wide, being about the offer rather than about anyone's form.

/**
 * Which act a listing task is (#462): posting a listing that does not exist yet, or re-filling one
 * that is already live on the platform.
 *
 * The two share every rule about the *goods* — a wrong grade is as wrong on an edit form as on a new
 * one — and differ only in what the offer has to **be**: `create` starts from a Ready offer with
 * nothing posted, `update` from an Active one whose listing has an address to go back to.
 */
export type ListingMode = "create" | "update";

export type ListingBlockerCode =
  | "no-platform-module"
  | "not-ready"
  | "no-sets"
  | "missing-catalog-id"
  // #617, the second way an unknown-variant umbrella fails to resolve an item-ID through the price
  // rollup (#616). Its own code and not a second wording of `missing-catalog-id`, because the codes
  // are what the surfaces route on and a shared code with a variable sentence is how a link ends up
  // pointing at the wrong screen.
  | "no-variant-price"
  | "unmapped-condition"
  | "mixed-sets"
  // #462, the update mode's own three. Each stands alone, exactly as `not-ready` does: an offer that
  // is not live has no listing to correct, and there is nothing else worth saying about it.
  | "not-active"
  | "no-listing-url"
  | "no-update-support";

/**
 * Why a copy's catalogue item-ID could not be **derived from its variants** (#617) — asked only of an
 * unknown-variant umbrella that carries no item-ID of its own, whose listing stands under its
 * cheapest variant (#616). The two answers are different faults fixed on different screens, which is
 * the whole reason they are told apart rather than sharing one blocker:
 *
 *   - `unpriced-variants` — some fully identified variant carries no price at the copy's own key, so
 *     **which variant is cheapest is not known**: a gap in the **catalogue prices**, fixed in each
 *     variant's own price grid, and named against those variants. It takes precedence over the
 *     matching gap below, and covers the wholly unpriced tree as its extreme case. The rollup's
 *     *figure* is still the lowest of what is priced — a catalogue value is allowed to be an
 *     estimate and is marked as one (#238) — but a listing may not rest on one, since a price
 *     recorded on the dearest variant alone would list the copy under exactly that variant.
 *   - `unmatched-variant` — every variant is priced, so the cheapest one is known, and it carries no
 *     item-ID of its own: a gap in **matching**, fixed in the match window, and reported against
 *     *that variant*, since it is the stamp that is actually unmatched.
 *
 * Neither loosens the refusal (#405's rule): listing under a *dearer* variant because the cheapest
 * one is unmatched would quietly turn a data gap into a pricing decision.
 *
 * Absent on every other copy — including an umbrella whose **own** catalogue price won the valuation
 * (#616's precedence), where nothing was rolled up at all and the umbrella itself is the stamp that
 * wants matching.
 */
export type CatalogRollupGap =
  | { kind: "unmatched-variant"; stampId: string; label: string }
  /** `variants` are the unpriced ones themselves, each already named — they are what wants a price,
   *  so they are what the blocker reports and links to. */
  | { kind: "unpriced-variants"; variants: { stampId: string; label: string }[] };

/** One reason an offer cannot be listed, ready to show verbatim. */
export interface ListingBlocker {
  code: ListingBlockerCode;
  /** The fault in **one short line**, for a surface with no room for the sentence below — the ready
   *  gate's hover hint states four of these at once, and four full sentences there are a wall of
   *  text nobody reads. It names the fault and, where it is short enough to be useful, where it is
   *  fixed; the `subjects` are stated beside it rather than inside it. Never a replacement for
   *  {@link ListingBlocker.message}, which is what a surface with room shows and what the server's
   *  own refusal says. */
  title: string;
  /** English, complete, and naming what is at fault — the extension has no vocabulary of its own. */
  message: string;
  /** What has to be fixed, by the name the collector knows it under (copy labels, condition names,
   *  set labels). Deduplicated, in listing order. */
  subjects: string[];
  /** The stamps carrying the fault, for the surface that offers to go and match them (#406). Empty
   *  for a blocker that is not about stamps. */
  stampIds: string[];
  /** The same stamps as {@link ListingBlocker.stampIds}, each with the name it is reported under, for
   *  a surface that draws **one link per stamp** (#617 — the unpriced tree links through to the price
   *  grid). A field of its own rather than an index into `subjects`: the two lists are deduplicated on
   *  different things — a name a collector reads, and an identity — so positions cannot be paired
   *  without eventually naming the wrong stamp. Absent wherever `stampIds` is empty. */
  stampSubjects?: StampSubject[];
}

/** The rest of the key a catalog price is recorded against, beside the condition a copy already
 *  states (#616). Carried onward by the one blocker that is about prices, so the grid it links to
 *  opens at the cell the listing is blocked on (#633). Null is *no certificate* and *single*. */
export interface PriceAxes {
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
}

/** One copy as the preconditions see it: the two platform-side values that may be missing, plus the
 *  names to report them under. */
export interface PreconditionCopy {
  itemId: string;
  /** The copy's own label — its leading catalog number (#379). */
  label: string;
  stampId: string;
  /** The platform's catalog item-ID for this copy's stamp (Colnect's item-ID, #247), or null when
   *  the stamp carries none. For an unknown-variant umbrella it is **derived** from the cheapest
   *  variant (#616), which is why a null one has {@link PreconditionCopy.catalogRollup} to explain
   *  itself. */
  catalogItemId: string | null;
  /** Why the derivation came back empty (#617), on a copy whose item-ID was to come from the variant
   *  rollup. Null on every copy that resolved one and on every copy whose own stamp is the thing at
   *  fault — see {@link CatalogRollupGap}. */
  catalogRollup?: CatalogRollupGap | null;
  conditionId: string;
  /** Our own condition's name, which is what an unmapped condition is reported under. */
  conditionName: string;
  /** The rest of the price key this copy is valued on (#616) — reported onward by the unpriced-tree
   *  blocker alone (#633). Null is *no certificate* and *single*. */
  certificateStatusId: string | null;
  formatId: string | null;
  /** The condition translated into the platform's vocabulary (#404), or null when unmapped. */
  platformCondition: string | null;
}

export interface PreconditionSet {
  setId: string;
  label: string;
  copies: readonly PreconditionCopy[];
}

export interface PreconditionInput {
  /** The Assistant platform module the offer's platform names (`platform-modules.ts`), or null when
   *  it names none. It decides **which** checks below are asked as well as whether any are: a
   *  platform with no listing half (#471) has nothing to fail, and one that lists by category rather
   *  than against a catalogue is not asked for item-IDs it has no use for (#493). See
   *  {@link evaluateListingPreconditions}. */
  platformModule: string | null;
  state: OfferState;
  sets: readonly PreconditionSet[];
  /** Which act this is (#462). Absent means `create`, which is what every caller predating the update
   *  flow asks for and what every rule below was written against. */
  mode?: ListingMode;
  /** The listing's own address on the platform (`Offer.url`, #412) — what an update navigates to.
   *  Only read in `update` mode, where its absence is the `no-listing-url` refusal. */
  listingUrl?: string | null;
}

/**
 * The identity a set is compared by for homogeneity — **what the platform's form receives**, not
 * what we hold: the catalog item-ID and the platform's own grade, order-insensitive because two sets
 * holding the same goods in a different order are still the same goods.
 *
 * Where either is missing the local id stands in, so a set is never silently judged interchangeable
 * with another on the strength of two nulls being equal; the missing value has its own blocker.
 */
export function setIdentity(set: PreconditionSet): string {
  return set.copies
    .map((c) => {
      const item = c.catalogItemId ?? `stamp:${c.stampId}`;
      const cond = c.platformCondition ?? `cond:${c.conditionId}`;
      return `${item}@${cond}`;
    })
    .sort()
    .join("|");
}

/**
 * The sets that are **not** interchangeable with the first one — the rule behind `mixed-sets`,
 * exported because it is asked in two vocabularies and must have one answer.
 *
 * Colnect asks it about a quantity field, Allegro about `stock.available` (#477); both are one
 * number claiming "N of the same thing", and both are only truthful over sets holding the same
 * goods. {@link setIdentity}'s fallback to the local ids is what makes it answerable on a platform
 * that has no catalog item-ID and no grade of its own to compare by.
 */
export function differingSets(sets: readonly PreconditionSet[]): PreconditionSet[] {
  const listed = sets.filter((s) => s.copies.length > 0);
  if (listed.length < 2) return [];
  const reference = setIdentity(listed[0]);
  return listed.slice(1).filter((s) => setIdentity(s) !== reference);
}

/** Distinct values in first-seen order — subjects are read, so a name repeated once per copy is
 *  noise. */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** One stamp as a blocker names it: the id to link to and the label to link under. */
interface StampSubject {
  stampId: string;
  label: string;
  /** The axes of the copy this stamp was reported for (#633), where the fault is about a *price* —
   *  what narrows the grid the link opens to the cell the listing is actually blocked on. Absent on
   *  a fault that is not about one: matching is a fact about a stamp, not about a copy. */
  axes?: PriceAxes;
}

/** The stamps of a fault, one entry per **stamp** in first-seen order — deduplicated on identity
 *  rather than on the name, since this is what a link is built from. */
/** The three axes a price is keyed on beside the stamp, off the copy that is blocked. */
function axesOf(copy: PreconditionCopy): PriceAxes {
  return {
    conditionId: copy.conditionId,
    certificateStatusId: copy.certificateStatusId,
    formatId: copy.formatId,
  };
}

function distinctStamps(subjects: readonly StampSubject[]): StampSubject[] {
  const byId = new Map<string, StampSubject>();
  for (const subject of subjects) if (!byId.has(subject.stampId)) byId.set(subject.stampId, subject);
  return [...byId.values()];
}

/**
 * The stamp a copy's missing item-ID is reported **against** — the cheapest variant where the id was
 * to be derived from one (#617), and the copy's own stamp otherwise.
 *
 * The variant, and not the umbrella, because it is the stamp that is actually unmatched: the surface
 * that offers to go and match one (#406) has to point at the stamp an item-ID would be recorded on,
 * and nothing is ever recorded on the umbrella (#616 — that would assert it *is* that variant).
 */
function unmatchedStamp(copy: PreconditionCopy): StampSubject {
  return copy.catalogRollup?.kind === "unmatched-variant"
    ? { stampId: copy.catalogRollup.stampId, label: copy.catalogRollup.label }
    : { stampId: copy.stampId, label: copy.label };
}

/**
 * Every reason this offer cannot be handed over, in the order they are worth fixing. An empty array
 * means the listing kit is servable.
 *
 * `no-platform-module`, the mode's own state check and `no-sets` are checked first and each stands
 * **alone**: there is no form to fill, with no sets there is no composition to say anything else
 * about, and repeating "no catalog item-ID" under an offer that simply is not finished buries the one
 * thing to do about it.
 *
 * Everything **after** that check is asked identically in both modes (#462), which is the point of
 * one evaluation rather than two: a stamp with no item-ID and a condition with no grade misdescribe
 * the goods just as badly on an edit form as on a new one.
 *
 * Of what follows, the catalogue pair (#617) and the grade are the **module's** rules and are asked
 * only where its own entry claims them (#493); the homogeneity of the sets is asked of every module,
 * being a fact about the offer.
 *
 * `no-platform-module` is a refusal, not a fault to fix: a marketplace the Assistant cannot post to
 * is a perfectly good marketplace, listed by hand. A surface that only ever asks "what do I fix"
 * — the workspace card — should therefore not evaluate at all for such a platform rather than draw
 * this blocker, which is a fact about the platform and not about the offer.
 */
export function evaluateListingPreconditions(input: PreconditionInput): ListingBlocker[] {
  // A module with no listing half is the same answer as no module at all (#471): there is no form to
  // fill, so there is nothing this offer could be wrong for. See {@link listingModuleRules}.
  const rules = listingModuleRules(input.platformModule);
  if (!rules) {
    return [
      {
        code: "no-platform-module",
        title: "No Assistant module for this platform",
        message:
          "This platform has no Assistant module that can fill its listing form. Post it by hand.",
        subjects: [],
        stampIds: [],
      },
    ];
  }

  // What the offer has to **be** is the one thing the two modes disagree about (#462), and each
  // answer stands alone for `not-ready`'s reason: there is nothing else worth saying about an offer
  // that is not in a position to be listed at all.
  const standalone = (
    code: ListingBlockerCode,
    title: string,
    message: string
  ): ListingBlocker[] => [{ code, title, message, subjects: [], stampIds: [] }];

  if ((input.mode ?? "create") === "update") {
    if (!rules.supportsUpdate) {
      return standalone(
        "no-update-support",
        "This platform's listings cannot be edited by the Assistant",
        "This platform's Assistant module can post a listing but cannot go back and edit one. Correct it on the platform's own page."
      );
    }
    if (input.state !== "active") {
      return standalone(
        "not-active",
        `Not Active — it is ${OFFER_STATE_LABEL[input.state]}`,
        `This offer is ${OFFER_STATE_LABEL[input.state]}, not Active — only a live listing can be updated.`
      );
    }
    if (!input.listingUrl?.trim()) {
      return standalone(
        "no-listing-url",
        "No listing URL recorded on this offer",
        "This offer carries no listing URL, so there is no listing to go back to. Paste the platform's address into the offer first."
      );
    }
  } else if (input.state !== "ready") {
    return standalone(
      "not-ready",
      `Not Ready — it is ${OFFER_STATE_LABEL[input.state]}`,
      `This offer is ${OFFER_STATE_LABEL[input.state]}, not Ready — only a Ready offer can be listed.`
    );
  }

  const sets = input.sets.filter((s) => s.copies.length > 0);
  if (sets.length === 0) {
    return [
      {
        code: "no-sets",
        title: "No copies to list",
        message: "This offer holds no copies — there is nothing to list.",
        subjects: [],
        stampIds: [],
      },
    ];
  }

  const blockers: ListingBlocker[] = [];
  const copies = sets.flatMap((s) => s.copies);

  // A copy with no item-ID fails in **two** ways once one can be derived from a variant (#617), and
  // they are fixed in different places — one in the match window, one in the price grid — so they are
  // never printed as one line. Both are still refusals: nothing is substituted for a missing id.
  const unresolved = rules.requiresCatalogItemId
    ? copies.filter((c) => c.catalogItemId === null)
    : [];
  const unpriced = unresolved.filter((c) => c.catalogRollup?.kind === "unpriced-variants");
  const unmatched = unresolved.filter((c) => c.catalogRollup?.kind !== "unpriced-variants");

  if (unmatched.length > 0) {
    // Named against the stamp that is actually unmatched — the cheapest variant where the id was to
    // come from one, the copy's own stamp otherwise. See {@link unmatchedStamp}.
    const stamps = distinctStamps(unmatched.map(unmatchedStamp));
    const subjects = distinct(stamps.map((s) => s.label));
    blockers.push({
      code: "missing-catalog-id",
      title: `${subjects.length === 1 ? "A stamp has" : `${subjects.length} stamps have`} no catalog item-ID on this platform`,
      message: `${subjects.length === 1 ? "One stamp has" : `${subjects.length} stamps have`} no catalog item-ID on this platform: ${subjects.join(", ")}. Match ${subjects.length === 1 ? "it" : "them"} with the Assistant on the platform's own catalog pages first — the listing form has nothing to point at without one.`,
      subjects,
      stampIds: stamps.map((s) => s.stampId),
      stampSubjects: stamps,
    });
  }

  if (unpriced.length > 0) {
    // Named against the **unpriced variants**, not the umbrella: they are what wants a price, and each
    // has a price grid of its own to go and fill.
    // Each variant carries the axes of the copy it was reported for (#633) — the cell the listing is
    // blocked on, and so the cell the grid behind the link opens at. Where two copies at different
    // grades name the same variant, `distinctStamps` keeps the first, as it does for the label.
    const stamps = distinctStamps(
      unpriced.flatMap((c) =>
        c.catalogRollup?.kind === "unpriced-variants"
          ? c.catalogRollup.variants.map((v) => ({ ...v, axes: axesOf(c) }))
          : []
      )
    );
    const subjects = distinct(stamps.map((s) => s.label));
    const one = subjects.length === 1;
    blockers.push({
      code: "no-variant-price",
      title: `${one ? "A variant is" : `${subjects.length} variants are`} unpriced, so the cheapest one is unknown`,
      message: `${one ? "One variant has" : `${subjects.length} variants have`} no catalog price at the condition being listed: ${subjects.join(", ")}. A listing stands under the cheapest variant, and which one that is cannot be known until every variant is priced — a price recorded on the dearest one alone would list the copy under exactly that variant. Price ${one ? "it" : "them"} on ${one ? "its" : "their"} own stamp screen first.`,
      subjects,
      stampIds: stamps.map((s) => s.stampId),
      stampSubjects: stamps,
    });
  }

  const unmapped = rules.requiresPlatformCondition
    ? copies.filter((c) => c.platformCondition === null)
    : [];
  if (unmapped.length > 0) {
    const subjects = distinct(unmapped.map((c) => c.conditionName));
    blockers.push({
      code: "unmapped-condition",
      title: `${subjects.length === 1 ? "A condition has" : `${subjects.length} conditions have`} no grade mapped for this platform`,
      message: `${subjects.length === 1 ? "One condition has" : `${subjects.length} conditions have`} no grade mapped for this platform: ${subjects.join(", ")}. Map them under ${rules.conditionMappingLocation} — a wrong grade on a published listing is worse than a blank.`,
      subjects,
      stampIds: [],
    });
  }

  // Homogeneity (#406): the quantity says "N of the same thing", so it is only truthful when every
  // set holds the same goods. The first set is the reference because it is the one the kit describes.
  const differing = differingSets(sets);
  if (differing.length > 0) {
    const subjects = distinct(differing.map((s) => s.label));
    blockers.push({
      code: "mixed-sets",
      title: "The sets are not interchangeable, so one quantity cannot describe them",
      message: `The sets are not interchangeable, so one quantity cannot describe them: ${subjects.join(", ")} ${subjects.length === 1 ? "differs" : "differ"} from ${sets[0].label}. List them separately, or make the sets match.`,
      subjects,
      stampIds: [],
    });
  }

  return blockers;
}
