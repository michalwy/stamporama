// **A lot line's condition can be unknown, or one of several** (#1623). The rules only, with no
// Prisma and no server-only import, so the server, the line editor and the agent API read one
// definition of what a line's condition says.
//
// A listing often does not say what condition its stamps are in: *Czysty* (unused) can be MNH or MH,
// and the two can differ twofold in value. A composition that is quietly wrong is worse than one
// left open, because every headroom and recommendation is computed from it — so a line holds one of
// three, and never a guess:
//
//   settled   one condition                       `conditionId` set
//   one of    a set of possible conditions        `conditionId` null, two or more ids
//   unknown   any of the collection's conditions  `conditionId` null, no ids
//
// Such a line is valued as a range over its possible conditions (`lotLineRangeOf`,
// `auction-lot.ts`), and a won lot cannot be settled into its purchase until every line has one.

/** A line's condition as it is stored and submitted. */
export interface LineConditionValue {
  /** The condition the line is settled at; null while it is not. */
  conditionId: string | null;
  /** The conditions an unsettled line may be in. Empty when settled, and empty when unknown. */
  possibleConditionIds: string[];
}

/** Which of the three a line's condition is. */
export type LineConditionKind = "settled" | "oneOf" | "unknown";

/**
 * The one shape a submitted condition is stored in.
 *
 * A settled condition wins over any set sent beside it. A set is deduplicated, and **a set of one is
 * that condition** — *one of MNH* is MNH, and storing it as a set would mark the lot *condition to
 * settle* over a question already answered. An empty set is unknown.
 */
export function normalizeLineCondition(input: {
  conditionId?: string | null;
  possibleConditionIds?: readonly string[] | null;
}): LineConditionValue {
  const settled = input.conditionId?.trim();
  if (settled) return { conditionId: settled, possibleConditionIds: [] };
  const ids = [...new Set((input.possibleConditionIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 1) return { conditionId: ids[0], possibleConditionIds: [] };
  return { conditionId: null, possibleConditionIds: ids };
}

/** Which of the three a stored condition is. */
export function lineConditionKind(line: LineConditionValue): LineConditionKind {
  if (line.conditionId !== null) return "settled";
  return line.possibleConditionIds.length > 0 ? "oneOf" : "unknown";
}

/**
 * The conditions a line may be in, in the collection's own order — the one condition of a settled
 * line, the set of a *one of* line, and **every** condition of an unknown one.
 *
 * `collectionConditionIds` is the collection's conditions in their sort order; a possible condition
 * missing from it is kept at the end rather than dropped, since dropping it would narrow the range
 * without anyone saying so.
 */
export function lineConditionCandidates(
  line: LineConditionValue,
  collectionConditionIds: readonly string[]
): string[] {
  if (line.conditionId !== null) return [line.conditionId];
  if (line.possibleConditionIds.length === 0) return [...collectionConditionIds];
  const wanted = new Set(line.possibleConditionIds);
  const ordered = collectionConditionIds.filter((id) => wanted.has(id));
  const rest = line.possibleConditionIds.filter((id) => !collectionConditionIds.includes(id));
  return [...ordered, ...rest];
}

/** A condition as it is named on screen. */
export interface NamedCondition {
  id: string;
  name: string;
  abbreviation: string;
}

/** What a line's condition is called: `MNH`, `MNH or MH`, or `condition unknown`. The short form
 * is what a chip prints, the long one what a sentence does. */
export function lineConditionLabel(
  line: LineConditionValue,
  conditions: readonly NamedCondition[]
): { short: string; long: string } {
  const byId = new Map(conditions.map((condition) => [condition.id, condition]));
  const shortOf = (id: string) => {
    const condition = byId.get(id);
    return condition ? condition.abbreviation || condition.name : "?";
  };
  const longOf = (id: string) => byId.get(id)?.name ?? "?";
  switch (lineConditionKind(line)) {
    case "settled":
      return { short: shortOf(line.conditionId!), long: longOf(line.conditionId!) };
    case "oneOf": {
      const ids = lineConditionCandidates(line, conditions.map((condition) => condition.id));
      return {
        short: ids.map(shortOf).join(" or "),
        long: ids.map(longOf).join(" or "),
      };
    }
    case "unknown":
      return { short: "Cond. ?", long: "Condition unknown" };
  }
}

/** A line whose condition is settled, typed as such. */
export type SettledConditionLine<L extends { conditionId: string | null; condition: object | null }> = Omit<
  L,
  "conditionId" | "condition"
> & { conditionId: string; condition: NonNullable<L["condition"]> };

/** A lot whose every line has its condition settled. */
export type SettledConditionLot<
  T extends { lines: { conditionId: string | null; condition: object | null }[] },
> = Omit<T, "lines"> & { lines: SettledConditionLine<T["lines"][number]>[] };

/**
 * The lots whose **every** line has its condition settled, their lines typed as such (#1623).
 *
 * A closed lot is market evidence (ADR-0022) only once its price can be attributed to keys, and a
 * key is a `stamp × condition × certificate × format`: a line that is *MNH or MH* cannot say which
 * key its share of the price belongs to, and a split over the lot's other lines would then be
 * weighed against a guess. So such a lot stays out of the market values and the realization ratios
 * until its conditions are settled — the readers ask the database for these lots already, and this
 * is the same rule kept by the type.
 */
export function onlySettledLots<
  T extends { lines: { conditionId: string | null; condition: object | null }[] },
>(lots: T[]): SettledConditionLot<T>[] {
  return lots.flatMap((lot) => {
    const lines = lot.lines.flatMap((line) =>
      line.conditionId !== null && line.condition !== null
        ? [line as unknown as SettledConditionLine<T["lines"][number]>]
        : []
    );
    return lines.length === lot.lines.length ? [{ ...lot, lines }] : [];
  });
}
