// Pure, Prisma-free rules for offer composition (ADR-0013). An offer owns N `OfferSet`s; a set is
// the atomic sellable unit — one or more copies that leave together (a series / komplet never
// breaks apart). There is no unit/quantity discriminator. These label + validation helpers are
// unit-tested without a DB and reused verbatim by the server domain module (`offers.ts`). No side
// effects.

/**
 * Human-readable label for one **set**, falling back to its copies when the collector left the
 * title blank. A multi-copy set (a komplet) reads as its copies joined by `+`; a single-copy set
 * reads as that copy.
 */
export function deriveSetLabel(
  title: string | null | undefined,
  copyLabels: readonly string[]
): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  if (copyLabels.length === 0) return "Empty set";
  return copyLabels.join(" + ");
}

/**
 * Human-readable label for a whole **offer**, derived from its sets. One set reads as that set's
 * label; several identical sets read as a quantity (`3× (X)`); a mixed bag reads as its set count.
 */
export function deriveOfferLabel(setLabels: readonly string[]): string {
  if (setLabels.length === 0) return "Empty offer";
  if (setLabels.length === 1) return setLabels[0];
  const allSame = setLabels.every((l) => l === setLabels[0]);
  return allSame ? `${setLabels.length}× (${setLabels[0]})` : `${setLabels.length} sets`;
}

/** An offer set must hold at least one copy to be meaningful. Returns a violation message, or
 * `null` when valid. */
export function checkSetNonEmpty(copyCount: number): string | null {
  return copyCount === 0 ? "A set must hold at least one copy." : null;
}
