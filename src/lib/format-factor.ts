// Resolving the multiplier that derives a format's catalog price from the single's.
//
// Pure — no Prisma, no `server-only` — so it can be unit-tested and imported from domain modules
// the same way `catalog-price.ts` is.
//
// A format price is *explicit or derived*: an explicit `StampCatalogPrice` row for the format
// always wins, and only in its absence does the single's price get multiplied. Catalogs are
// published this way — Michel Spezial prints one Viererblock factor per issue and an explicit
// price only where the multiple deviates — so following the source keeps data entry proportional
// to what is actually printed, rather than demanding a condition × certificate × format grid on
// every stamp.

/**
 * Key of the (format, condition) → multiplier lookup the price grid is handed. It lives in this
 * module rather than beside the server-side resolver because the grid is a client component and
 * must not reach into anything importing `server-only`.
 */
export function formatFactorKey(formatId: string, conditionId: string): string {
  return `${formatId}~${conditionId}`;
}

/** A stored factor row. Null anchors mean "any" — that dimension does not narrow the row. */
export interface FormatFactorRow {
  formatId: string;
  factor: number;
  collectionAreaId: string | null;
  issueId: string | null;
  conditionId: string | null;
}

/** What the stamp being priced looks like to the resolver. */
export interface FormatFactorSubject {
  formatId: string;
  /** The stamp's area and every ancestor of it, nearest first. An area-anchored row matches when
   *  its area appears here, so a factor on "German Reich" covers "Infla" — and the row's position
   *  in this list *is* its depth for precedence purposes. */
  areaPath: string[];
  issueId: string | null;
  conditionId: string | null;
}

/** The winning row plus why it won, so the UI can name its origin ("Infla 1923 → block of 4"). */
export interface ResolvedFormatFactor {
  factor: number;
  row: FormatFactorRow;
  /** Which anchors the winning row set. Everything false is the collection default. */
  matchedOn: { issue: boolean; area: boolean; condition: boolean };
}

/** Whether a row's anchors are all satisfied by the subject. An anchor that is null never
 *  disqualifies a row; a set anchor must match exactly, except the area, which matches any
 *  ancestor-or-self of the stamp's area. */
function rowApplies(row: FormatFactorRow, subject: FormatFactorSubject): boolean {
  if (row.formatId !== subject.formatId) return false;
  if (row.issueId !== null && row.issueId !== subject.issueId) return false;
  if (row.conditionId !== null && row.conditionId !== subject.conditionId) return false;
  if (row.collectionAreaId !== null && !subject.areaPath.includes(row.collectionAreaId)) {
    return false;
  }
  return true;
}

/**
 * Precedence key, compared lexicographically — higher wins on the first differing element:
 *
 *   1. an issue anchor (the narrowest thing a catalog factor is ever printed against),
 *   2. area depth — a nearer area beats a further ancestor; no area anchor is furthest of all,
 *   3. a condition anchor.
 *
 * A fixed order rather than a specificity score, deliberately. Scoring independent dimensions
 * against one another produces orderings nobody can predict from the UI, whereas this one is
 * always explainable in a sentence. The consequence — *where* outranks *for which condition*, so
 * an issue-anchored factor beats a collection-wide "used" factor — is intended.
 */
function precedenceKey(row: FormatFactorRow, subject: FormatFactorSubject): number[] {
  // `areaPath` is nearest-first, so a lower index is a nearer area; negate it to make nearer
  // larger. An unanchored area sorts below every anchored one.
  const areaRank =
    row.collectionAreaId === null ? -subject.areaPath.length - 1 : -subject.areaPath.indexOf(row.collectionAreaId);
  return [row.issueId !== null ? 1 : 0, areaRank, row.conditionId !== null ? 1 : 0];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * The factor that applies to `subject`, or null when no row does. Rows for other formats, or
 * whose anchors the subject does not satisfy, are discarded first; the rest are ranked by
 * {@link precedenceKey}. The uniqueness index makes ties impossible in stored data, so a tie
 * here can only come from a caller passing duplicates — the first such row wins, stably.
 */
export function resolveFormatFactor(
  rows: FormatFactorRow[],
  subject: FormatFactorSubject
): ResolvedFormatFactor | null {
  let best: FormatFactorRow | null = null;
  let bestKey: number[] | null = null;
  for (const row of rows) {
    if (!rowApplies(row, subject)) continue;
    const key = precedenceKey(row, subject);
    if (bestKey === null || compareKeys(key, bestKey) > 0) {
      best = row;
      bestKey = key;
    }
  }
  if (!best) return null;
  return {
    factor: best.factor,
    row: best,
    matchedOn: {
      issue: best.issueId !== null,
      area: best.collectionAreaId !== null,
      condition: best.conditionId !== null,
    },
  };
}

/**
 * The price of one multiple: the single's price scaled by the factor, rounded to two decimals so
 * it reads like every other stored amount. Null when there is no single price to scale or no
 * factor to scale it by — a derived price is an inference from two facts, and with either missing
 * there is nothing to show. Currency is the single's; a factor is a pure multiplier and never
 * changes it.
 */
export function deriveFormatPrice(
  singleAmount: number,
  factor: number
): number {
  return Math.round(singleAmount * factor * 100) / 100;
}
