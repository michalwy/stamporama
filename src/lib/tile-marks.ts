/**
 * A tile's condition and certificate, **marked before it is identified** (#1550) — the pure rules.
 *
 * A scanned card mixes conditions, and the scan alone often cannot tell MNH from MNG. The collector
 * can, with the card in hand, but identification comes later, stamp by stamp, when the cards may be
 * put away. So the marks are given straight after scanning — on the strip, or on the boxes in the cut
 * editor where they sit at their places on the physical card — and identification picks them up.
 *
 * **A mark only seeds the dialog.** The copy takes what the dialog confirms; once the tile is
 * identified its mark has no further effect. Everything here is therefore about where a mark lives
 * before that moment and how it reaches the fields: what a merge, a split or a pairing does to it,
 * what a key typed on a focused tile means, and how the identification step is seeded from it.
 *
 * Each half is independent and optional: a tile can be marked with a condition, a certificate, both
 * or neither. "No certificate" is not a mark — it is a tile not marked with one.
 */

export interface TileMark {
  conditionId: string | null;
  certificateStatusId: string | null;
}

/** A mark as stored: both halves, or null when neither is given — one shape for "unmarked". */
export function normalizeMark(mark: Partial<TileMark> | null | undefined): TileMark | null {
  const conditionId = mark?.conditionId || null;
  const certificateStatusId = mark?.certificateStatusId || null;
  return conditionId || certificateStatusId ? { conditionId, certificateStatusId } : null;
}

export function sameMark(a: TileMark | null | undefined, b: TileMark | null | undefined): boolean {
  const x = normalizeMark(a);
  const y = normalizeMark(b);
  if (!x || !y) return x === y;
  return x.conditionId === y.conditionId && x.certificateStatusId === y.certificateStatusId;
}

/**
 * The mark a box keeps when several are merged into one in the cut editor: **only when every half
 * had the same one**. Two halves that disagree are two answers about what may turn out to be two
 * pieces, and picking either would be the app answering for the collector.
 */
export function mergedMark(marks: readonly (TileMark | null | undefined)[]): TileMark | null {
  if (marks.length === 0) return null;
  const first = normalizeMark(marks[0]);
  return marks.every((m) => sameMark(m, first)) ? first : null;
}

/** A change to one or both halves of a mark: absent leaves a half alone, null clears it. */
export interface MarkPatch {
  conditionId?: string | null;
  certificateStatusId?: string | null;
}

export function applyMarkPatch(mark: TileMark | null | undefined, patch: MarkPatch): TileMark | null {
  return normalizeMark({
    conditionId: patch.conditionId !== undefined ? patch.conditionId : (mark?.conditionId ?? null),
    certificateStatusId:
      patch.certificateStatusId !== undefined
        ? patch.certificateStatusId
        : (mark?.certificateStatusId ?? null),
  });
}

/** Whether a patch says anything at all. */
export function isEmptyPatch(patch: MarkPatch): boolean {
  return patch.conditionId === undefined && patch.certificateStatusId === undefined;
}

// ── Pairing a back with its front ───────────────────────────────────────────────────────────────

export interface TimedMark {
  mark: TileMark | null;
  /** When the mark was given — null for no mark, and for one given in an editor session that has
   * not been committed yet, which is later than anything already stored. */
  markedAt: Date | null;
}

export interface PairedMark extends TimedMark {
  /** The mark the pairing replaced, when front and back disagreed — what the pairing says it did. */
  replaced: TileMark | null;
}

/**
 * The tile's mark once a back is paired with its front (#1550).
 *
 * A back paired with a front **is the same tile**, so the two marks become one. Where only one side
 * carries a mark it is the tile's; where they agree there is nothing to decide; where they differ,
 * **the mark given last wins** and the other is reported as replaced — the back is often where the
 * condition shows (gum or no gum), so a back marked after the front is the better answer, and a front
 * re-marked after the back the same the other way round. A tie goes to the back, the side being
 * paired now.
 *
 * `markedAt: null` on a side that carries a mark means *given just now* — a box marked in the editor
 * session being committed — and is later than any stored time.
 */
export function pairedMark(front: TimedMark, back: TimedMark): PairedMark {
  const f = normalizeMark(front.mark);
  const b = normalizeMark(back.mark);
  if (!b) return { mark: f, markedAt: f ? front.markedAt : null, replaced: null };
  if (!f) return { mark: b, markedAt: back.markedAt, replaced: null };
  if (sameMark(f, b)) {
    return { mark: f, markedAt: later(front.markedAt, back.markedAt), replaced: null };
  }
  const backWins =
    back.markedAt == null ||
    (front.markedAt != null && back.markedAt.getTime() >= front.markedAt.getTime());
  return backWins
    ? { mark: b, markedAt: back.markedAt, replaced: f }
    : { mark: f, markedAt: front.markedAt, replaced: b };
}

function later(a: Date | null, b: Date | null): Date | null {
  if (a == null || b == null) return null;
  return a.getTime() >= b.getTime() ? a : b;
}

// ── Marking from the keyboard ───────────────────────────────────────────────────────────────────

/** One thing a key can mark: a condition or a certificate status, by its abbreviation. */
export interface MarkKey {
  kind: "condition" | "certificate";
  id: string;
  abbreviation: string;
}

/** The collection's dictionaries as the keys they can be typed as. Conditions first: where a
 * condition and a certificate share an abbreviation, the condition is what is typed far more often. */
export function markKeys(
  conditions: readonly { id: string; abbreviation: string }[],
  certificateStatuses: readonly { id: string; abbreviation: string }[]
): MarkKey[] {
  return [
    ...conditions.map((c) => ({ kind: "condition" as const, id: c.id, abbreviation: c.abbreviation })),
    ...certificateStatuses.map((c) => ({
      kind: "certificate" as const,
      id: c.id,
      abbreviation: c.abbreviation,
    })),
  ].filter((k) => k.abbreviation.trim() !== "");
}

export interface MarkKeyMatch {
  /** The entry the typed letters name exactly, if any. */
  match: MarkKey | null;
  /** Whether nothing longer could still be meant — the caller applies `match` at once when true,
   * and otherwise waits a moment for the next letter (*M* could still become *MH* or *MNH*). A
   * buffer naming nothing and leading nowhere is final too, so the caller starts over. */
  final: boolean;
}

/**
 * What the letters typed so far name (#1550). Abbreviations are several letters long and share
 * prefixes (*MH*, *MNH*, *MNG*), so a key is collected into a buffer: one that names an entry and
 * leads to no longer one is applied at once, one that could still grow waits for the next letter or
 * a short pause. Case does not matter.
 */
export function matchMarkKey(buffer: string, keys: readonly MarkKey[]): MarkKeyMatch {
  const typed = buffer.trim().toLowerCase();
  if (typed === "") return { match: null, final: false };
  const exact = keys.find((k) => k.abbreviation.trim().toLowerCase() === typed) ?? null;
  const longer = keys.some((k) => {
    const a = k.abbreviation.trim().toLowerCase();
    return a.length > typed.length && a.startsWith(typed);
  });
  return { match: exact, final: !longer };
}

/**
 * The change a typed abbreviation makes to the marks it is aimed at — a **toggle**: when every target
 * already carries it, typing it again clears that half; otherwise every target is marked with it.
 * One key both gives and takes away, so a card can be worked through without the mouse.
 */
export function keyPatch(key: MarkKey, targets: readonly (TileMark | null | undefined)[]): MarkPatch {
  const field = key.kind === "condition" ? "conditionId" : "certificateStatusId";
  const allCarry = targets.length > 0 && targets.every((m) => (m?.[field] ?? null) === key.id);
  return { [field]: allCarry ? null : key.id };
}

// ── Seeding the identification step ─────────────────────────────────────────────────────────────

/** Where a seeded value came from, said beside the field so the two are told apart. */
export type SeedOrigin = "marked" | "last-used" | "repeated";

export const SEED_ORIGIN_LABEL: Record<SeedOrigin, string> = {
  marked: "marked on the tile",
  "last-used": "last used",
  repeated: "as repeated",
};

export interface FieldSeed {
  value: string;
  origin: SeedOrigin | null;
  /** Tiles that keep their own marked value rather than taking the shared answer — set only when
   * several tiles are identified as one stamp and their marks do not all agree. */
  keepers: { tileId: string; value: string }[];
}

/**
 * The value one field of the identification step opens on (#1550), and which tiles keep their own.
 *
 * - **Every tile marked, all alike** — the field opens on the mark, labelled *marked on the tile*,
 *   and the answer given there is every tile's: one tile is this case, and so is a run of one stamp
 *   marked the same throughout.
 * - **Otherwise** the field opens as it did before marks existed — the fallback, the last used
 *   choice or a repeated identification's — and the tiles that **are** marked keep their marks, the
 *   shared answer applying to the rest. The step says how many keep what.
 *
 * A value is labelled only when there is one: an empty field was not seeded from anywhere.
 */
export function seedField(
  pieces: readonly { tileId: string; marked: string | null }[],
  fallback: { value: string; origin: SeedOrigin }
): FieldSeed {
  const marked = pieces.filter((p) => p.marked);
  if (
    pieces.length > 0 &&
    marked.length === pieces.length &&
    marked.every((p) => p.marked === marked[0].marked)
  ) {
    return { value: marked[0].marked as string, origin: "marked", keepers: [] };
  }
  return {
    value: fallback.value,
    origin: fallback.value ? fallback.origin : null,
    keepers: marked.map((p) => ({ tileId: p.tileId, value: p.marked as string })),
  };
}

/** One tile's own answers where it keeps its marks — what the identification write is handed, so
 * what the step said is exactly what is created. */
export interface TileOwnAnswer {
  tileId: string;
  conditionId?: string;
  certificateStatusId?: string;
}

export function keeperAnswers(condition: FieldSeed, certificate: FieldSeed): TileOwnAnswer[] {
  const byTile = new Map<string, TileOwnAnswer>();
  const entry = (tileId: string) => {
    let a = byTile.get(tileId);
    if (!a) byTile.set(tileId, (a = { tileId }));
    return a;
  };
  for (const k of condition.keepers) entry(k.tileId).conditionId = k.value;
  for (const k of certificate.keepers) entry(k.tileId).certificateStatusId = k.value;
  return [...byTile.values()];
}

/** The keepers grouped by value, most first — *3 tiles keep their marked MNG*. */
export function keeperGroups(keepers: readonly { value: string }[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const k of keepers) counts.set(k.value, (counts.get(k.value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Parse the per-tile answers a form carries (`tileAnswers`, JSON) — anything malformed is dropped
 * rather than guessed at, and the write checks every id it is handed against the collection.
 */
export function parseTileOwnAnswers(raw: unknown): TileOwnAnswer[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: TileOwnAnswer[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.tileId !== "string" || r.tileId === "") continue;
    const answer: TileOwnAnswer = { tileId: r.tileId };
    if (typeof r.conditionId === "string" && r.conditionId) answer.conditionId = r.conditionId;
    if (typeof r.certificateStatusId === "string" && r.certificateStatusId) {
      answer.certificateStatusId = r.certificateStatusId;
    }
    if (answer.conditionId || answer.certificateStatusId) out.push(answer);
  }
  return out;
}
