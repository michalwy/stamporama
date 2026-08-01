// Is this stamp already in a lot I am winning? (#369)
//
// The rules only, with no Prisma and no server-only import, so the server read that gathers the
// candidates and the dialogs that draw the banner apply one definition of "the same stamp" rather
// than two — the same split `variant-classification.ts` makes for the variant flag.
//
// The signal is the **composition**, deliberately: not the URL, not the title. A collector who
// pastes a link and moves on gets no warning at all, which is a consequence of that choice and not
// a gap to paper over with a fuzzy title match. What the warning is actually about is bidding twice
// on the same stamp, and only the lines say which stamp a lot holds.
//
// Nothing here blocks anything. The same stamp genuinely does appear in two lots — a better copy
// turning up mid-sale is an ordinary reason to bid on both — so the output is a strength, and the
// surface renders it louder or quieter.

/** What separates a *hard* warning from a *soft* one. Never "no": absence of a match is an empty
 * result, not a third strength. */
export type DuplicateStrength = "hard" | "soft";

/**
 * One line of a lot the collector is **winning**, as the matcher reads it.
 *
 * `familyIds` is the variant family of `stampId` **through the umbrella**: its unknown-variant
 * ancestors and all of its variant descendants, never its siblings. The server resolves it, so the
 * dialogs can match a freshly picked stamp by id alone — they hold no variant tree, and shipping
 * the relation pre-resolved is what keeps them from needing one.
 */
export interface AtRiskLine {
  lotId: string;
  auctionLotNo: number;
  saleId: string;
  /** For naming the lot in the banner when the collector never titled it. */
  lotTitle: string | null;
  stampId: string;
  /** `stampId`'s umbrella ancestors and variant descendants. Excludes `stampId` itself. */
  familyIds: string[];
  /** `Mi·PL 12`, the stamp's name, or a plain dash — what the banner calls it. */
  stampLabel: string;
  conditionId: string;
  conditionLabel: string;
  formatId: string | null;
  formatLabel: string | null;
  certificateStatusId: string | null;
  /** Null is **no certificate**, the unmarked default (ADR-0006 §2) — which the banner has to be
   * able to name, since "with an Attest" versus "without" is exactly the difference it reports. */
  certificateStatusLabel: string | null;
}

/** A line of the lot being composed — pending in the add dialog, stored in the composition one. */
export interface ComposedLine {
  stampId: string;
  conditionId: string;
  formatId: string | null;
  certificateStatusId: string | null;
}

/** One candidate line that matched, and why it did. */
export interface DuplicateMatch {
  strength: DuplicateStrength;
  line: AtRiskLine;
  /**
   * Hard, but the certificates differ. The stamp is the same stamp and the pairing is still a
   * duplicate — a Fotoattest changes what a copy is worth, not which stamp it is — so this only
   * asks the banner to name the difference rather than softening the warning.
   */
  certificateDiffers: boolean;
}

/**
 * The same stamp, allowing for "variant not identified yet".
 *
 * A line on an unknown-variant umbrella and a line on one of its descendants are the same stamp:
 * `Mi. 12, variant unrecorded` and `Mi. 12 II` are two ways of tracking one thing, and winning both
 * is the mistake #369 exists to catch.
 *
 * **Ancestor ↔ descendant only, never siblings.** `Mi. 12 I` and `Mi. 12 II` share an umbrella but
 * are different stamps, and bidding on both is an ordinary thing to do — matching through the
 * shared root would turn every variant-rich issue into a wall of false warnings. That exclusion is
 * why `familyIds` is a family *chain* rather than everything under a common root.
 */
export function sameStamp(stampId: string, candidate: AtRiskLine): boolean {
  return candidate.stampId === stampId || candidate.familyIds.includes(stampId);
}

/**
 * How loudly one pair should warn, or null when the stamps are unrelated.
 *
 * `condition` and `format` both have to agree for a hard warning. Format is in there because a
 * single and a block of four are two different things to own — worth mentioning, not worth an
 * alarm. Certificate is not, for the opposite reason: it prices a copy differently but does not
 * make it a different copy.
 */
function pairStrength(
  line: ComposedLine,
  candidate: AtRiskLine
): { strength: DuplicateStrength; certificateDiffers: boolean } | null {
  if (!sameStamp(line.stampId, candidate)) return null;
  if (line.conditionId !== candidate.conditionId || line.formatId !== candidate.formatId) {
    return { strength: "soft", certificateDiffers: false };
  }
  return {
    strength: "hard",
    certificateDiffers: line.certificateStatusId !== candidate.certificateStatusId,
  };
}

/**
 * Every lot the composition being edited collides with, hard matches first so the banner can take
 * the head of the list and speak in the strongest terms that apply.
 *
 * A lot is reported at most once even when several of its lines collide: the collector needs to know
 * *which lot* to look at, and repeating it would only pad the banner.
 */
export function duplicateMatches(lines: ComposedLine[], atRisk: AtRiskLine[]): DuplicateMatch[] {
  const byLot = new Map<string, DuplicateMatch>();
  for (const line of lines) {
    for (const candidate of atRisk) {
      const result = pairStrength(line, candidate);
      if (!result) continue;
      const existing = byLot.get(candidate.lotId);
      // A lot already recorded as hard stays hard; a soft one is upgraded when a later line collides
      // harder, because the loudest true statement about that lot is the one worth making.
      if (existing && (existing.strength === "hard" || result.strength === "soft")) continue;
      byLot.set(candidate.lotId, {
        strength: result.strength,
        line: candidate,
        certificateDiffers: result.certificateDiffers,
      });
    }
  }
  return [...byLot.values()].sort((x, y) =>
    x.strength === y.strength
      ? x.line.auctionLotNo - y.line.auctionLotNo
      : x.strength === "hard"
        ? -1
        : 1
  );
}

/**
 * The lots that collide **with each other** — every lot holding a stamp another winning lot also
 * holds, at the same condition and format.
 *
 * Hard matches only, deliberately. The dialog can afford to murmur about a different condition
 * because the collector is looking straight at the line; a standing filter and a notification badge
 * cannot, and a soft match there would be a permanent amber chip over something that is usually
 * fine.
 *
 * Ids come back in a stable order (first appearance), so a filtered page does not reshuffle between
 * two reads of the same data.
 */
export function collidingLotIds(lines: AtRiskLine[]): string[] {
  const hit = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      // Two lines of the *same* lot are not a duplicate of each other: one lot holding a stamp twice
      // is a lot with two of them, which is what quantity is for and never a double purchase.
      if (a.lotId === b.lotId) continue;
      if (pairStrength(a, b)?.strength !== "hard") continue;
      hit.add(a.lotId);
      hit.add(b.lotId);
    }
  }
  const ordered: string[] = [];
  for (const line of lines) {
    if (hit.has(line.lotId) && !ordered.includes(line.lotId)) ordered.push(line.lotId);
  }
  return ordered;
}

/** The strength the banner takes as a whole: hard when any match is hard, else soft, else nothing. */
export function overallStrength(matches: DuplicateMatch[]): DuplicateStrength | null {
  if (matches.length === 0) return null;
  return matches.some((m) => m.strength === "hard") ? "hard" : "soft";
}
