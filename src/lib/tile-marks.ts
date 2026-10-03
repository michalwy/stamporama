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
 *
 * **Faults** (#1558) are the mark's third part: any number of the collection's faults (#1557), seen
 * with the piece in hand as the condition is. They follow the halves' rules except where a fault is
 * not an alternative to another fault — a crease and a thinned gum are both true of one piece, where
 * MNH and MH cannot be — so where two marks meet as **one piece** (a merge, a pairing) the faults are
 * the union of both rather than one side's. "No faults" is not a mark either.
 */

export interface TileMark {
  conditionId: string | null;
  certificateStatusId: string | null;
  /** The faults marked (#1558), by id. Absent — never empty — on a mark without any, so a mark of
   * the two halves alone is the shape it was before faults existed. */
  faultIds?: readonly string[];
}

/** A mark's faults, each once, in the order given — never undefined. */
export function markFaultIds(mark: Pick<TileMark, "faultIds"> | null | undefined): string[] {
  return [...new Set((mark?.faultIds ?? []).filter(Boolean))];
}

/** A mark as stored: the two halves and the faults, or null when none of them is given — one shape
 * for "unmarked". */
export function normalizeMark(mark: Partial<TileMark> | null | undefined): TileMark | null {
  const conditionId = mark?.conditionId || null;
  const certificateStatusId = mark?.certificateStatusId || null;
  const faultIds = markFaultIds(mark);
  if (!conditionId && !certificateStatusId && faultIds.length === 0) return null;
  return faultIds.length > 0
    ? { conditionId, certificateStatusId, faultIds }
    : { conditionId, certificateStatusId };
}

/** Whether two fault lists name the same faults, in whatever order. */
export function sameFaults(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined
): boolean {
  const x = new Set(a ?? []);
  const y = new Set(b ?? []);
  return x.size === y.size && [...x].every((id) => y.has(id));
}

export function sameMark(a: TileMark | null | undefined, b: TileMark | null | undefined): boolean {
  const x = normalizeMark(a);
  const y = normalizeMark(b);
  if (!x || !y) return x === y;
  return (
    x.conditionId === y.conditionId &&
    x.certificateStatusId === y.certificateStatusId &&
    sameFaults(x.faultIds, y.faultIds)
  );
}

/** A mark with its faults set aside — the two halves alone, which is what a merge and a pairing
 * decide between. */
function halves(mark: TileMark | null | undefined): TileMark | null {
  return normalizeMark({
    conditionId: mark?.conditionId ?? null,
    certificateStatusId: mark?.certificateStatusId ?? null,
  });
}

/** Every fault any of the marks carries, each once, in the order met. */
function unionFaults(marks: readonly (TileMark | null | undefined)[]): string[] {
  return [...new Set(marks.flatMap((m) => markFaultIds(m)))];
}

/**
 * The mark a box keeps when several are merged into one in the cut editor: the condition and
 * certificate **only when every half had the same ones**, and the faults of all of them (#1558).
 * Two halves that disagree on the condition are two answers about what may turn out to be two
 * pieces, and picking either would be the app answering for the collector. Faults do not disagree —
 * a merge says the boxes are one piece, and a crease on one half is a crease on it.
 */
export function mergedMark(marks: readonly (TileMark | null | undefined)[]): TileMark | null {
  if (marks.length === 0) return null;
  const first = halves(marks[0]);
  const agreed = marks.every((m) => sameMark(halves(m), first)) ? first : null;
  return normalizeMark({ ...agreed, faultIds: unionFaults(marks) });
}

/**
 * A change to a mark: absent leaves a half alone, null clears it. Faults (#1558) are **added and
 * removed** by name rather than replaced, so one pick over several tiles with different faults
 * changes only the fault picked — the bulk edit's rule for a copy's faults (#1557).
 */
export interface MarkPatch {
  conditionId?: string | null;
  certificateStatusId?: string | null;
  addFaultIds?: readonly string[];
  removeFaultIds?: readonly string[];
}

export function applyMarkPatch(mark: TileMark | null | undefined, patch: MarkPatch): TileMark | null {
  const remove = new Set(patch.removeFaultIds ?? []);
  return normalizeMark({
    conditionId: patch.conditionId !== undefined ? patch.conditionId : (mark?.conditionId ?? null),
    certificateStatusId:
      patch.certificateStatusId !== undefined
        ? patch.certificateStatusId
        : (mark?.certificateStatusId ?? null),
    faultIds: [
      ...markFaultIds(mark).filter((id) => !remove.has(id)),
      ...(patch.addFaultIds ?? []).filter((id) => !remove.has(id)),
    ],
  });
}

/** Whether a patch says anything at all. */
export function isEmptyPatch(patch: MarkPatch): boolean {
  return (
    patch.conditionId === undefined &&
    patch.certificateStatusId === undefined &&
    (patch.addFaultIds?.length ?? 0) === 0 &&
    (patch.removeFaultIds?.length ?? 0) === 0
  );
}

/**
 * The change picking one fault makes to the marks it is aimed at (#1558) — a **toggle**, as a typed
 * abbreviation is ({@link keyPatch}): when every target already carries it, it comes off them all;
 * otherwise it goes on every one that lacks it.
 */
export function faultTogglePatch(
  faultId: string,
  targets: readonly (TileMark | null | undefined)[]
): MarkPatch {
  const allCarry = targets.length > 0 && targets.every((m) => markFaultIds(m).includes(faultId));
  return allCarry ? { removeFaultIds: [faultId] } : { addFaultIds: [faultId] };
}

/** *Clear the mark*: both halves, and every fault any of the targets carries. */
export function clearMarkPatch(targets: readonly (TileMark | null | undefined)[]): MarkPatch {
  const faults = unionFaults(targets);
  return {
    conditionId: null,
    certificateStatusId: null,
    ...(faults.length > 0 ? { removeFaultIds: faults } : {}),
  };
}

// ── Marking every unmarked tile at once ────────────────────────────────────────────────────────

/**
 * The part of a *Mark all unmarked* pick (#1556) that reaches one mark: **each half only where the
 * mark has none**. A card is mostly one condition, so the exceptions are marked first and the rest in
 * one pick — and that only works if the pick leaves the exceptions alone. The halves are separate: a
 * condition fills the tiles without a condition, whatever certificate they carry, and the other way
 * round. A fill never clears, so a half the pick sets to null is not part of it.
 *
 * **Faults are never part of a fill** (#1558): a fault belongs to one piece, so giving it to every
 * tile without one would be wrong far more often than right — the reason identification never
 * carries one over from the last tile either.
 */
export function fillPatch(mark: TileMark | null | undefined, patch: MarkPatch): MarkPatch {
  const m = normalizeMark(mark);
  const out: MarkPatch = {};
  if (patch.conditionId && !m?.conditionId) out.conditionId = patch.conditionId;
  if (patch.certificateStatusId && !m?.certificateStatusId) {
    out.certificateStatusId = patch.certificateStatusId;
  }
  return out;
}

/** How many of the marks a fill would reach, half by half — what *Mark all unmarked* says it will
 * do before it does it. */
export function unmarkedCounts(marks: readonly (TileMark | null | undefined)[]): {
  condition: number;
  certificate: number;
} {
  return {
    condition: marks.filter((m) => !m?.conditionId).length,
    certificate: marks.filter((m) => !m?.certificateStatusId).length,
  };
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
 * **Faults are the union of both sides** (#1558, decided with the collector): a crease is seen on
 * the front and a thinned gum on the back, and both are true of the piece. So "given last wins" and
 * "replaced" are about the condition and certificate alone.
 *
 * `markedAt: null` on a side that carries a mark means *given just now* — a box marked in the editor
 * session being committed — and is later than any stored time.
 */
export function pairedMark(front: TimedMark, back: TimedMark): PairedMark {
  const decided = pairedHalves(
    { mark: halves(front.mark), markedAt: front.markedAt },
    { mark: halves(back.mark), markedAt: back.markedAt }
  );
  const faultIds = unionFaults([front.mark, back.mark]);
  if (faultIds.length === 0) return decided;
  const mark = normalizeMark({ ...decided.mark, faultIds });
  // The time of the halves where they decided anything; otherwise of the sides the faults came from.
  const markedAt = decided.mark
    ? decided.markedAt
    : latest(
        [front, back].filter((s) => markFaultIds(s.mark).length > 0).map((s) => s.markedAt)
      );
  return { mark, markedAt, replaced: decided.replaced };
}

function pairedHalves(front: TimedMark, back: TimedMark): PairedMark {
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

/** The latest of several times, null — *given just now* — beating any of them. */
function latest(times: readonly (Date | null)[]): Date | null {
  return times.reduce<Date | null | undefined>(
    (acc, t) => (acc === undefined ? t : later(acc, t)),
    undefined
  ) ?? null;
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

/** What the faults field of the identification step opens on (#1558), and which tiles keep their
 * own marked faults. */
export interface FaultSeed {
  faultIds: string[];
  /** `marked` or nothing — faults have no other source. */
  origin: "marked" | null;
  keepers: { tileId: string; faultIds: string[] }[];
}

/**
 * {@link seedField} for the faults (#1558) — with one difference that is the point: **there is no
 * fallback**. A fault belongs to one piece, so the last tile's, or a repeated identification's, would
 * be carried onto the next piece wrongly far more often than rightly (settled with the collector).
 *
 * - **Every tile marked with the same faults** opens on them, labelled *marked on the tile*.
 * - **Otherwise** the field opens empty, and the tiles marked with faults keep theirs — the faults
 *   given in the field apply to the rest. A tile with no faults marked is not marked; it has no
 *   faults to keep.
 */
export function seedFaults(
  pieces: readonly { tileId: string; faultIds: readonly string[] }[]
): FaultSeed {
  const marked = pieces.filter((p) => p.faultIds.length > 0);
  if (
    pieces.length > 0 &&
    marked.length === pieces.length &&
    marked.every((p) => sameFaults(p.faultIds, marked[0].faultIds))
  ) {
    return { faultIds: [...marked[0].faultIds], origin: "marked", keepers: [] };
  }
  return {
    faultIds: [],
    origin: null,
    keepers: marked.map((p) => ({ tileId: p.tileId, faultIds: [...p.faultIds] })),
  };
}

/** One tile's own answers where it keeps its marks — what the identification write is handed, so
 * what the step said is exactly what is created. */
export interface TileOwnAnswer {
  tileId: string;
  conditionId?: string;
  certificateStatusId?: string;
  /** The faults the tile keeps (#1558), in place of the step's shared ones. */
  faultIds?: string[];
}

export function keeperAnswers(
  condition: FieldSeed,
  certificate: FieldSeed,
  faults?: FaultSeed
): TileOwnAnswer[] {
  const byTile = new Map<string, TileOwnAnswer>();
  const entry = (tileId: string) => {
    let a = byTile.get(tileId);
    if (!a) byTile.set(tileId, (a = { tileId }));
    return a;
  };
  for (const k of condition.keepers) entry(k.tileId).conditionId = k.value;
  for (const k of certificate.keepers) entry(k.tileId).certificateStatusId = k.value;
  for (const k of faults?.keepers ?? []) entry(k.tileId).faultIds = [...k.faultIds];
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
    if (Array.isArray(r.faultIds)) {
      const faultIds = [
        ...new Set(r.faultIds.filter((id): id is string => typeof id === "string" && id !== "")),
      ];
      if (faultIds.length > 0) answer.faultIds = faultIds;
    }
    if (answer.conditionId || answer.certificateStatusId || answer.faultIds) out.push(answer);
  }
  return out;
}
