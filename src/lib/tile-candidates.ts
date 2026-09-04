import { effectiveActsAsVariant, isUnknownVariantStamp } from "./variant-classification";

/**
 * The shortlist a parked tile carries (#607), and the one rule that decides when the shortlist is
 * the **wrong** answer.
 *
 * Pure, and read by both halves: the server puts the candidates in the read model, the tile dialog
 * draws them and says the sentence below, and the strip prints them under the parked squares. No
 * Prisma and no `server-only`, for `variant-classification.ts`' own reason.
 */

/** One possibility on a parked tile's shortlist, as every surface reads it.
 *
 * Catalogue numbers are the stamp's **raw** ones, not prefix-formatted labels — the same call the
 * consumed tile's identity makes (`ScanTileData.item`): this read is a card's tiles, and formatting
 * would drag the area tree and the per-issue prefix overrides into it. */
export interface TileCandidate {
  stampId: string;
  stampName: string | null;
  catalogNumbers: string[];
  /** The issue this stamp is reported under, and that issue's area — the **first** membership, the
   * one-issue-per-stamp rule every other read follows.
   *
   * They are here so a candidate can be drawn as the picker's own row rather than as a bare label:
   * the row wants the stamp's thumbnail, its subtype, its prefix-formatted numbers, its catalogue
   * price, the copies-held badge and the want marker, all of which the client already has a query
   * for — per issue, and keyed by area for the vendor map. Null for a stamp on no issue, which
   * falls back to the label. */
  issueId: string | null;
  collectionAreaId: string | null;
  /** True when this candidate is itself an unknown-variant umbrella (ADR-0010 §3) — it has variant
   * children of its own. Drawn as the picker draws it, because picking such a stamp means *this
   * stamp, variant not yet known*, and that is a different answer from picking a leaf. */
  unknownVariant: boolean;
  /** The node this stamp hangs under, when it hangs under one — with enough of it to be named,
   * because naming it is the whole of the correction below. */
  parent: { stampId: string; stampName: string | null; catalogNumbers: string[] } | null;
  /** What the stamp states about its **perforation** and **watermark** (#740) — the two attributes
   * the intake measuring stack can produce a reading for (#598/#614 gauge one, #625 shows the
   * other). They ride on the candidate because the comparison happens where the shortlist is drawn,
   * and because a card of forty tiles reads them once with everything else about the tile.
   *
   * Perforation travels **as printed**, the way #72 stores it: `perforation.ts` reads it where the
   * comparison is made, and a value it cannot read narrows nothing. The watermark is a dictionary
   * row, so it travels as an id — what the collector picks is one — with its name for saying which
   * one it is. Null on both is the ordinary case; a stamp stating neither is neither marked nor
   * ruled out. */
  perforation: string | null;
  watermark: { id: string; name: string } | null;
  /** This stamp's **effective** `actsAsVariant` (ADR-0010 §2a/§3): its own override when set,
   * otherwise its subtype's flag, false when unclassified. What separates *watermark A* from
   * *the overprint* — see {@link sharedVariantParent}. */
  actsAsVariant: boolean;
}

/** How a candidate is written in one line — its numbers, then its name. The consumed tile's
 * identity and the assign list's rows lead with the same two, so a stamp reads the same way
 * wherever this screen names one. */
export function candidateLabel(candidate: {
  stampName: string | null;
  catalogNumbers: string[];
}): string {
  return (
    [candidate.catalogNumbers.join(" · ") || null, candidate.stampName || null]
      .filter(Boolean)
      .join(" — ") || "(unnamed stamp)"
  );
}

/** The one number a candidate is reached for by — the primary catalogue's leads a stamp's numbers,
 * so the first of them is the one the collector thinks in, and a stamp with no number at all falls
 * back to its name. The same fallback chain #595's *Same as the last* uses on a picked stamp. */
export function candidateShortLabel(candidate: {
  stampName: string | null;
  catalogNumbers: string[];
}): string {
  return candidate.catalogNumbers[0] ?? candidate.stampName ?? "(unnamed stamp)";
}

/**
 * The parent that can be used **instead of** parking this tile — or null, which is the ordinary
 * answer.
 *
 * Much of the case a shortlist serves already has a better answer, and this is where the UI gets to
 * say so. A copy may point at a stamp at **any** level of the variant tree, and pointing at the
 * parent *is* the statement "I know which stamp, not which variant": the copy is created, flagged
 * unknown-variant, valued cautiously (#238), given an internal number and a place in the box, and
 * *Identify variant* re-points it later with the change written to its refinement history
 * (#101/#130). *It is Mi 200, but watermark A or B?* therefore needs **no parking at all** — parking
 * it keeps the piece loose in a tray instead.
 *
 * **The condition is narrow on purpose, and getting it wrong would be worse than not offering it.**
 * Every candidate must be a child of the *same* parent **and** each one's effective `actsAsVariant`
 * must be true. An error, a plate flaw or an overprint is its own collectible and the parent is a
 * concrete stamp in its own right, so a shortlist of *the base stamp or its overprint* must not be
 * offered the parent: there the parent would be **one of the answers**, not the question, and
 * identifying against it would record a decision the collector has not made.
 *
 * Fewer than two candidates is nothing to correct — one possibility is not a shortlist — and a
 * candidate with no parent settles it immediately, which is exactly the case #607 keeps candidates
 * for: possibilities in no parent/child relation, two different issues, or a base stamp that is not
 * settled.
 */
export function sharedVariantParent(
  candidates: readonly TileCandidate[]
): TileCandidate["parent"] {
  if (candidates.length < 2) return null;
  const parent = candidates[0].parent;
  if (!parent) return null;
  for (const c of candidates) {
    if (!c.actsAsVariant) return null;
    if (c.parent?.stampId !== parent.stampId) return null;
  }
  return parent;
}

/**
 * One shortlist over a **run of ticked tiles**, and how many of them carry each possibility.
 *
 * Ticking several tiles asserts they are the same stamp (#596), so *what they could be* is one
 * question asked of the run rather than N private ones — five pieces narrowed to the same pair is
 * one trip to the colour key, which is the whole of what a shortlist is for.
 *
 * **The union, never the intersection.** The tiles come to the selection with shortlists of their
 * own — one was narrowed yesterday, another parked without a list — and an intersection would
 * silently drop the very narrowing the collector is coming back to read. So every possibility any
 * ticked tile carries is here, with `onCount` saying how many of them it is written on: a candidate
 * on some-but-not-all is a fact about the run and is said in words rather than smoothed over.
 * Adding writes to all of them and removing takes it off all of them, so the ordinary run converges
 * on `onCount === total` and the partial state is what a mixed selection *arrives* in.
 *
 * Ordered by the tiles' own order, first appearance first — the shortlist has no order worth storing
 * (`ScanTileCandidate` has no `position`), so the one it is drawn in is the card's.
 */
export interface MergedTileCandidate {
  candidate: TileCandidate;
  /** How many of the tiles in the selection carry this possibility. Equal to the selection's size
   * for a shortlist that was built through it. */
  onCount: number;
}

export function mergeTileCandidates(
  tiles: readonly { candidates: readonly TileCandidate[] }[]
): MergedTileCandidate[] {
  const merged = new Map<string, MergedTileCandidate>();
  for (const tile of tiles) {
    // Per tile, so one tile listing a stamp twice — which the `(tileId, stampId)` primary key makes
    // impossible in the database and which a caller could still hand in — cannot inflate the count
    // past the number of tiles.
    for (const stampId of new Set(tile.candidates.map((c) => c.stampId))) {
      const candidate = tile.candidates.find((c) => c.stampId === stampId)!;
      const seen = merged.get(stampId);
      if (seen) seen.onCount += 1;
      else merged.set(stampId, { candidate, onCount: 1 });
    }
  }
  return [...merged.values()];
}

/** {@link sharedVariantParent}'s input, built from a stamp row selected with `VARIANT_FLAG_SELECT`
 * plus its parent — the one place the effective flag is resolved, so no caller has to remember the
 * `override ?? subtype ?? false` order. */
export function toTileCandidate(stamp: {
  id: string;
  name: string | null;
  catalogNumbers: { number: string }[];
  perforation?: string | null;
  watermarkId?: string | null;
  watermark?: { name: string } | null;
  actsAsVariantOverride: boolean | null;
  subtype: { actsAsVariant: boolean } | null;
  parent: { id: string; name: string | null; catalogNumbers: { number: string }[] } | null;
  issueMemberships?: { issue: { id: string; collectionAreaId: string } }[];
  variants?: {
    actsAsVariantOverride: boolean | null;
    subtype: { actsAsVariant: boolean } | null;
  }[];
}): TileCandidate {
  const membership = stamp.issueMemberships?.[0]?.issue ?? null;
  return {
    stampId: stamp.id,
    stampName: stamp.name,
    catalogNumbers: stamp.catalogNumbers.map((c) => c.number),
    perforation: stamp.perforation ?? null,
    watermark:
      stamp.watermarkId && stamp.watermark
        ? { id: stamp.watermarkId, name: stamp.watermark.name }
        : null,
    issueId: membership?.id ?? null,
    collectionAreaId: membership?.collectionAreaId ?? null,
    unknownVariant: isUnknownVariantStamp({ variants: stamp.variants ?? [] }),
    parent: stamp.parent
      ? {
          stampId: stamp.parent.id,
          stampName: stamp.parent.name,
          catalogNumbers: stamp.parent.catalogNumbers.map((c) => c.number),
        }
      : null,
    actsAsVariant: effectiveActsAsVariant(
      stamp.actsAsVariantOverride,
      stamp.subtype?.actsAsVariant ?? null
    ),
  };
}
