// Pure Colnect catalog-number matching core (no Prisma, no server imports) so it can run in
// `test:unit` and be shared by the matcher endpoint (#250, part of #155).
//
// The browser extension (#249/#251) extracts, per Colnect item, its numeric Colnect ID plus the
// catalog references printed on the page — `{ catalog, number }` such as `{ "Mi", "PL 200" }`. The
// server resolves each `catalog` (a Colnect abbreviation) to a local catalog vendor and each stamp
// catalog number to its full identity, then hands both sides here as normalized keys. Matching is
// **strict full-key**: a Colnect ref matches a stamp only when `vendorAbbrev + areaPrefix + number`
// (spacing/punctuation folded away) is exactly equal — see `catalogMatchKey` in `catalog-number.ts`.

import { normalizeCatalogKey } from "./catalog-number";

/**
 * The strict comparison key for one Colnect catalog reference: the resolved vendor's abbreviation
 * concatenated with the printed Colnect number (which may embed a country prefix), normalized the
 * same way as a stamp's `catalogMatchKey`. `("Mi", "PL 200")` → `"mipl200"`, matching a Poland
 * Michel #200 stamp keyed as `catalogMatchKey("Mi", "PL", "200")`.
 */
export function colnectRefKey(vendorAbbreviation: string, colnectNumber: string): string {
  return normalizeCatalogKey(`${vendorAbbreviation}${colnectNumber}`);
}

/** One resolved catalog reference: a local catalog vendor plus its full normalized match key. */
export interface ResolvedRef {
  catalogVendorId: string;
  key: string;
}

/** A stamp considered during candidate discovery: its identity, current Colnect ID, and the full
 *  normalized keys of its catalog numbers. */
export interface CandidateStampRefs {
  stampId: string;
  existingColnectId: string | null;
  refs: ResolvedRef[];
}

export type ColnectMatchStatus = "auto" | "needs-confirm" | "skipped";

/** Why an item needs the user to confirm before a write. */
export type ColnectNeedsConfirmReason =
  | "multiple-candidates"
  | "partial-conflict"
  | "existing-different";

/** Why an item was skipped without a write. */
export type ColnectSkippedReason = "unresolved-refs" | "no-candidates";

export type ColnectItemDecision =
  | { status: "auto"; stampId: string; alreadySet: boolean }
  | { status: "needs-confirm"; reason: ColnectNeedsConfirmReason; candidateStampIds: string[] }
  | { status: "skipped"; reason: ColnectSkippedReason };

/** Per candidate: does it agree with the item on any shared vendor, and does it conflict on any? */
interface CandidateVerdict {
  stampId: string;
  existingColnectId: string | null;
  agrees: boolean;
  conflicts: boolean;
}

/** For a vendor present on both sides, agree iff a key pair is equal, else conflict. */
function evaluateCandidate(
  itemByVendor: Map<string, Set<string>>,
  candidate: CandidateStampRefs
): CandidateVerdict {
  let agrees = false;
  let conflicts = false;
  const seen = new Set<string>();
  for (const ref of candidate.refs) {
    const itemKeys = itemByVendor.get(ref.catalogVendorId);
    if (!itemKeys || seen.has(ref.catalogVendorId)) continue;
    seen.add(ref.catalogVendorId);
    // Shared vendor: the stamp may hold several numbers for it, so agree if any matches.
    const vendorKeys = candidate.refs
      .filter((r) => r.catalogVendorId === ref.catalogVendorId)
      .map((r) => r.key);
    if (vendorKeys.some((k) => itemKeys.has(k))) agrees = true;
    else conflicts = true;
  }
  return {
    stampId: candidate.stampId,
    existingColnectId: candidate.existingColnectId,
    agrees,
    conflicts,
  };
}

/**
 * Decide what to do with a single Colnect item against its candidate stamps, applying the agreed
 * matrix (#250):
 *   - no resolvable refs → skipped (`unresolved-refs`);
 *   - a **candidate** shares ≥1 exact `(vendor, key)` pair with the item;
 *   - 0 candidates → skipped (`no-candidates`);
 *   - >1 candidates → needs-confirm (`multiple-candidates`);
 *   - exactly 1 candidate that also conflicts on some shared vendor → needs-confirm (`partial-conflict`);
 *   - exactly 1 clean candidate already carrying a different Colnect ID → needs-confirm
 *     (`existing-different`), never silently overwritten;
 *   - exactly 1 clean candidate → auto (`alreadySet` true when it already holds this exact ID).
 * Pure: the caller supplies resolved keys and owns any labelling and persistence.
 */
export function decideColnectItem(
  colnectId: string,
  itemRefs: readonly ResolvedRef[],
  candidates: readonly CandidateStampRefs[]
): ColnectItemDecision {
  if (itemRefs.length === 0) return { status: "skipped", reason: "unresolved-refs" };

  const itemByVendor = new Map<string, Set<string>>();
  for (const ref of itemRefs) {
    let set = itemByVendor.get(ref.catalogVendorId);
    if (!set) {
      set = new Set<string>();
      itemByVendor.set(ref.catalogVendorId, set);
    }
    set.add(ref.key);
  }

  const qualifying = candidates
    .map((c) => evaluateCandidate(itemByVendor, c))
    .filter((v) => v.agrees);

  if (qualifying.length === 0) return { status: "skipped", reason: "no-candidates" };
  if (qualifying.length > 1) {
    return {
      status: "needs-confirm",
      reason: "multiple-candidates",
      candidateStampIds: qualifying.map((v) => v.stampId),
    };
  }

  const only = qualifying[0];
  if (only.conflicts) {
    return { status: "needs-confirm", reason: "partial-conflict", candidateStampIds: [only.stampId] };
  }
  if (only.existingColnectId !== null && only.existingColnectId !== colnectId) {
    return { status: "needs-confirm", reason: "existing-different", candidateStampIds: [only.stampId] };
  }
  return { status: "auto", stampId: only.stampId, alreadySet: only.existingColnectId === colnectId };
}
