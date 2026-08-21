// Turning a **requirement** into a **copy** (#659) — the pure half.
//
// A partner's wish list says one thing: *this stamp, in this condition*. It never says which of your
// copies, because it cannot know you hold three. Something has to choose, and this module is that
// choice — written down once, here, so the trade screen's add-by-stamp path and the Colnect import
// (#645) pick the same copies for the same list.
//
// **The candidate set is #657's**, narrowed by the requirement rather than by a copy's own key: what
// `listOfferableCopies` allows (in hand, unsold, not disposed of, not named by another live trade),
// minus the copies held back on this trade, minus those already on it. That part is the database
// half's; this one ranks what it hands over.
//
// **The order is fixed, and each step is a decision a collector would recognise:**
//
//  1. **`forTrade` first.** The disposition is precisely where a collector files what they are
//     willing to part with (ADR-0007 §4). Picking past it would offer a partner the album copy while
//     a duplicate sat in the box.
//  2. **The plain single next** — no certificate, no format. Unlike #657's pool, whose members share
//     the full valuation key and are therefore worth the same, these candidates differ on exactly
//     the two axes that carry value: sending a block of four or a certified piece because somebody
//     asked for "this stamp" would be a bad trade *and* a silent change to the balance.
//  3. **A copy with a photo**, because the partner is going to look at it and the shared page has
//     nothing to show otherwise.
//  4. **Lowest `itemNo`**, arbitrary but stable — so importing the same list twice picks the same
//     copies rather than shuffling a list the partner is already reading.
//
// **A quantity of N takes N distinct copies**, best-first down that order, and no copy is served
// twice across a batch: a wish list asking for the same stamp on two rows is two rows to fill, not
// one copy promised twice.
//
// **Nothing to serve is information, not an error.** *You do not hold this in this condition* is
// exactly what the collector has to send back, and on a whole imported list it is the main output —
// so a gap is a resolution with nothing on it, and it survives to the report rather than being
// dropped or thrown.

/**
 * A narrowing on one of the two optional axes.
 *
 * Three states, and the difference between two of them is the whole reason this is not just
 * `string | null`: **absent** (`undefined`) means the source said nothing — a wish list never does —
 * and every value matches; **present** means it said this exactly, where `null` is the value *no
 * certificate* (ADR-0006 §2) or *single* (ADR-0020), never a blank.
 */
export type GiveAxisNarrowing = string | null | undefined;

/**
 * The three states as a form and a server action can carry them.
 *
 * A select has strings and nothing else, so *not narrowed* and *narrowed to none* need two of them.
 * The empty string is the one the control opens on — **any** — because a wish list says nothing
 * about either axis, and a form that opened on *no certificate* would quietly turn silence into a
 * requirement.
 */
export const GIVE_AXIS_ANY = "";
/** Explicitly *no certificate* (ADR-0006 §2) or *single* (ADR-0020) — a value, not a blank. Spelt
 *  with the underscores so it can never collide with a cuid coming from the same select. */
export const GIVE_AXIS_NONE = "__none__";

/** Read one of those strings back into a narrowing. */
export function parseGiveAxis(raw: string | null | undefined): GiveAxisNarrowing {
  const value = (raw ?? "").trim();
  if (value === GIVE_AXIS_ANY) return undefined;
  if (value === GIVE_AXIS_NONE) return null;
  return value;
}

/** What a partner asked for, in the only terms a wish list has. */
export interface GiveRequirement {
  stampId: string;
  conditionId: string;
  /** Narrowed only where the source says something about it. See {@link GiveAxisNarrowing}. */
  certificateStatusId?: GiveAxisNarrowing;
  formatId?: GiveAxisNarrowing;
  /** How many pieces are wanted. A give line's own quantity is always 1 (ADR-0020), so N is N
   *  lines over N distinct copies. */
  quantity: number;
}

/** A copy that could serve one, as the ranking needs to read it: the four key columns, the
 *  disposition, and whether there is anything to show the partner. */
export interface GiveCandidateCopy {
  id: string;
  itemNo: number;
  stampId: string;
  conditionId: string;
  certificateStatusId: string | null;
  formatId: string | null;
  forTrade: boolean;
  hasPhoto: boolean;
}

/** Whether a copy answers a requirement at all. The two required axes must agree; the optional two
 *  only where the requirement narrowed them. */
export function servesRequirement(
  requirement: GiveRequirement,
  copy: GiveCandidateCopy
): boolean {
  if (copy.stampId !== requirement.stampId) return false;
  if (copy.conditionId !== requirement.conditionId) return false;
  if (
    requirement.certificateStatusId !== undefined &&
    copy.certificateStatusId !== requirement.certificateStatusId
  ) {
    return false;
  }
  if (requirement.formatId !== undefined && copy.formatId !== requirement.formatId) return false;
  return true;
}

/** Is this the plain piece — no certificate, no format? Step 2 of the order, named because the
 *  reason it exists is not obvious from a boolean expression. */
function isPlainSingle(copy: GiveCandidateCopy): boolean {
  return copy.certificateStatusId === null && copy.formatId === null;
}

/**
 * The order, as a comparator. Negative means the first copy goes out before the second.
 *
 * Total and deterministic: `itemNo` is unique within a collection, so no two candidates ever
 * compare equal and the sort has nothing left to decide by arrival order.
 */
export function compareGiveCandidates(a: GiveCandidateCopy, b: GiveCandidateCopy): number {
  if (a.forTrade !== b.forTrade) return a.forTrade ? -1 : 1;
  const plainA = isPlainSingle(a);
  const plainB = isPlainSingle(b);
  if (plainA !== plainB) return plainA ? -1 : 1;
  if (a.hasPhoto !== b.hasPhoto) return a.hasPhoto ? -1 : 1;
  return a.itemNo - b.itemNo;
}

/** The candidates for one requirement, best first. */
export function rankGiveCandidates(
  requirement: GiveRequirement,
  candidates: readonly GiveCandidateCopy[]
): GiveCandidateCopy[] {
  return candidates.filter((c) => servesRequirement(requirement, c)).sort(compareGiveCandidates);
}

/** What one requirement came to. `missing` is stated rather than left to be computed, because it is
 *  the number the collector sends back to the partner. */
export interface GiveResolution {
  /** Where the requirement sat in the batch — the report is read next to the list it came from. */
  index: number;
  requirement: GiveRequirement;
  /** The chosen copies, best first. Empty is a **gap**, not a failure. */
  itemIds: string[];
  requested: number;
  served: number;
  missing: number;
}

/** A whole requirement went unserved — the sentence the collector sends back. */
export function isGiveGap(resolution: GiveResolution): boolean {
  return resolution.served === 0;
}

/** Fewer copies than asked for, but not none. Never silently rounded down. */
export function isGiveShortfall(resolution: GiveResolution): boolean {
  return resolution.missing > 0 && resolution.served > 0;
}

/**
 * Resolve a batch of requirements against one pool of candidates.
 *
 * In the order given, and **without serving a copy twice**: two rows asking for the same stamp in
 * the same condition are two pieces the partner expects, and one copy answering both would be a
 * promise the packing list could not keep. Requirement order therefore decides who gets the better
 * copy when the pool runs short — which is the order the collector typed, or the order the file was
 * read in, and stable either way.
 */
export function resolveGiveRequirements(
  requirements: readonly GiveRequirement[],
  candidates: readonly GiveCandidateCopy[]
): GiveResolution[] {
  const taken = new Set<string>();
  return requirements.map((requirement, index) => {
    const requested = Math.max(1, Math.trunc(requirement.quantity || 1));
    const itemIds = rankGiveCandidates(requirement, candidates)
      .filter((c) => !taken.has(c.id))
      .slice(0, requested)
      .map((c) => c.id);
    for (const id of itemIds) taken.add(id);
    return {
      index,
      requirement,
      itemIds,
      requested,
      served: itemIds.length,
      missing: requested - itemIds.length,
    };
  });
}

/** How a resolution reads on the report, given the subject already named beside it. Counted, not
 *  named: which copies they are is what the line itself says. */
export function describeGiveResolution(resolution: GiveResolution): string {
  if (resolution.served === 0) {
    return resolution.requested === 1
      ? "You hold no copy to give for this one."
      : `You hold no copy to give for this one — ${resolution.requested} asked for.`;
  }
  if (resolution.missing > 0) {
    return `${resolution.served} of ${resolution.requested} — ${resolution.missing} more asked for than you can give.`;
  }
  return resolution.served === 1 ? "1 copy" : `${resolution.served} copies`;
}

/** The batch in one sentence, for the toast and the report's heading. Gaps are counted separately
 *  from shortfalls: one is *I do not have it*, the other *I do not have enough of it*. */
export function summariseGiveResolutions(resolutions: readonly GiveResolution[]): {
  served: number;
  gaps: number;
  shortfalls: number;
} {
  return {
    served: resolutions.reduce((sum, r) => sum + r.served, 0),
    gaps: resolutions.filter(isGiveGap).length,
    shortfalls: resolutions.filter(isGiveShortfall).length,
  };
}
