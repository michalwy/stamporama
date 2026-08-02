import { OFFER_STATE_LABEL, type OfferState } from "./offer-rules";
import { hasListingModule } from "./platform-modules";

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

export type ListingBlockerCode =
  | "no-platform-module"
  | "not-ready"
  | "no-sets"
  | "missing-catalog-id"
  | "unmapped-condition"
  | "mixed-sets";

/** One reason an offer cannot be listed, ready to show verbatim. */
export interface ListingBlocker {
  code: ListingBlockerCode;
  /** English, complete, and naming what is at fault — the extension has no vocabulary of its own. */
  message: string;
  /** What has to be fixed, by the name the collector knows it under (copy labels, condition names,
   *  set labels). Deduplicated, in listing order. */
  subjects: string[];
  /** The stamps carrying the fault, for the surface that offers to go and match them (#406). Empty
   *  for a blocker that is not about stamps. */
  stampIds: string[];
}

/** One copy as the preconditions see it: the two platform-side values that may be missing, plus the
 *  names to report them under. */
export interface PreconditionCopy {
  itemId: string;
  /** The copy's own label — its leading catalog number (#379). */
  label: string;
  stampId: string;
  /** The platform's catalog item-ID for this copy's stamp (Colnect's item-ID, #247), or null when
   *  the stamp carries none. */
  catalogItemId: string | null;
  conditionId: string;
  /** Our own condition's name, which is what an unmapped condition is reported under. */
  conditionName: string;
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
   *  it names none. Every other check here is the *listing* module's rule, so a platform without one
   *  — including one whose module cannot list (#471) — has nothing to fail; see
   *  {@link evaluateListingPreconditions}. */
  platformModule: string | null;
  state: OfferState;
  sets: readonly PreconditionSet[];
}

/**
 * The identity a set is compared by for homogeneity — **what the platform's form receives**, not
 * what we hold: the catalog item-ID and the platform's own grade, order-insensitive because two sets
 * holding the same goods in a different order are still the same goods.
 *
 * Where either is missing the local id stands in, so a set is never silently judged interchangeable
 * with another on the strength of two nulls being equal; the missing value has its own blocker.
 */
function setIdentity(set: PreconditionSet): string {
  return set.copies
    .map((c) => {
      const item = c.catalogItemId ?? `stamp:${c.stampId}`;
      const cond = c.platformCondition ?? `cond:${c.conditionId}`;
      return `${item}@${cond}`;
    })
    .sort()
    .join("|");
}

/** Distinct values in first-seen order — subjects are read, so a name repeated once per copy is
 *  noise. */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Every reason this offer cannot be handed over, in the order they are worth fixing. An empty array
 * means the listing kit is servable.
 *
 * `no-platform-module`, `not-ready` and `no-sets` are checked first and each stands **alone**: every
 * other check is one module's rule, with no sets there is no composition to say anything else about,
 * and repeating "no catalog item-ID" under an offer that simply is not finished buries the one thing
 * to do about it.
 *
 * `no-platform-module` is a refusal, not a fault to fix: a marketplace the Assistant cannot post to
 * is a perfectly good marketplace, listed by hand. A surface that only ever asks "what do I fix"
 * — the workspace card — should therefore not evaluate at all for such a platform rather than draw
 * this blocker, which is a fact about the platform and not about the offer.
 */
export function evaluateListingPreconditions(input: PreconditionInput): ListingBlocker[] {
  // A module with no listing half is the same answer as no module at all (#471): every check below
  // is Colnect's rule — its item-ID, its grades — and asking them about an Allegro offer reports a
  // fault in a form nobody is going to fill from here. See {@link hasListingModule}.
  if (!hasListingModule(input.platformModule)) {
    return [
      {
        code: "no-platform-module",
        message:
          "This platform has no Assistant module that can fill its listing form. Post it by hand.",
        subjects: [],
        stampIds: [],
      },
    ];
  }

  if (input.state !== "ready") {
    return [
      {
        code: "not-ready",
        message: `This offer is ${OFFER_STATE_LABEL[input.state]}, not Ready — only a Ready offer can be listed.`,
        subjects: [],
        stampIds: [],
      },
    ];
  }

  const sets = input.sets.filter((s) => s.copies.length > 0);
  if (sets.length === 0) {
    return [
      {
        code: "no-sets",
        message: "This offer holds no copies — there is nothing to list.",
        subjects: [],
        stampIds: [],
      },
    ];
  }

  const blockers: ListingBlocker[] = [];
  const copies = sets.flatMap((s) => s.copies);

  const unmatched = copies.filter((c) => c.catalogItemId === null);
  if (unmatched.length > 0) {
    const subjects = distinct(unmatched.map((c) => c.label));
    blockers.push({
      code: "missing-catalog-id",
      message: `${subjects.length === 1 ? "One stamp has" : `${subjects.length} stamps have`} no catalog item-ID on this platform: ${subjects.join(", ")}. Match ${subjects.length === 1 ? "it" : "them"} with the Assistant on the platform's own catalog pages first — the listing form has nothing to point at without one.`,
      subjects,
      stampIds: distinct(unmatched.map((c) => c.stampId)),
    });
  }

  const unmapped = copies.filter((c) => c.platformCondition === null);
  if (unmapped.length > 0) {
    const subjects = distinct(unmapped.map((c) => c.conditionName));
    blockers.push({
      code: "unmapped-condition",
      message: `${subjects.length === 1 ? "One condition has" : `${subjects.length} conditions have`} no grade mapped for this platform: ${subjects.join(", ")}. Map them under Settings → Colnect — a wrong grade on a published listing is worse than a blank.`,
      subjects,
      stampIds: [],
    });
  }

  // Homogeneity (#406): the quantity says "N of the same thing", so it is only truthful when every
  // set holds the same goods. The first set is the reference because it is the one the kit describes.
  const reference = setIdentity(sets[0]);
  const differing = sets.slice(1).filter((s) => setIdentity(s) !== reference);
  if (differing.length > 0) {
    const subjects = distinct(differing.map((s) => s.label));
    blockers.push({
      code: "mixed-sets",
      message: `The sets are not interchangeable, so one quantity cannot describe them: ${subjects.join(", ")} ${subjects.length === 1 ? "differs" : "differ"} from ${sets[0].label}. List them separately, or make the sets match.`,
      subjects,
      stampIds: [],
    });
  }

  return blockers;
}
