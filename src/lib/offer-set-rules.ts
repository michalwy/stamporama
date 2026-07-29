// Pure, Prisma-free rules for offer composition (ADR-0013). An offer owns N `OfferSet`s; a set is
// the atomic sellable unit — one or more copies that leave together (a series / komplet never
// breaks apart). There is no unit/quantity discriminator. These label + validation helpers are
// unit-tested without a DB and reused verbatim by the server domain module (`offers.ts`). No side
// effects.

import {
  compactCatalogNumberGroups,
  type CatalogNumberGroupEntry,
} from "./offer-title-template";

/** One copy of a set as the label derivation sees it (#379): the catalog number it is named by —
 * its area's leading vendor's, already carrying that vendor's abbreviation and the area prefix — and
 * the stamp's name, which stands in when no catalogue numbered it. */
export interface SetLabelCopy {
  catalog: CatalogNumberGroupEntry | null;
  stampName: string | null;
}

/** How many stamp names a nameless-catalogue set spells out before it counts them instead. */
const MAX_LABEL_NAMES = 3;

/**
 * Human-readable label for one **set**, falling back to its copies when the collector left the
 * title blank.
 *
 * The derived form is the offer title's own catalogue vocabulary (#379): numbers carry their vendor
 * and area prefix and collapse into ranges — `Mi·RU-NW 15-19`, not `15 + 16 + 17 + 18 + 19`, which
 * named no catalogue and could not be read at a glance once a listing held a series. It goes through
 * `compactCatalogNumberGroups`, the same helper `{catalog}` resolves with, so a set reads the way the
 * generated title it sits under does. A set whose stamps carry no numbers falls back to their names,
 * and a large nameless set to its size — a label is scanned, not studied.
 */
export function deriveSetLabel(
  title: string | null | undefined,
  copies: readonly SetLabelCopy[]
): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  if (copies.length === 0) return "Empty set";

  const numbers = copies
    .map((c) => c.catalog)
    .filter((c): c is CatalogNumberGroupEntry => c !== null);
  const collapsed = compactCatalogNumberGroups(numbers);
  if (collapsed) return collapsed;

  const names = [...new Set(copies.map((c) => c.stampName?.trim()).filter((n): n is string => !!n))];
  if (names.length === 0) return `${copies.length} cop${copies.length === 1 ? "y" : "ies"}`;
  const shown = names.slice(0, MAX_LABEL_NAMES).join(" + ");
  const extra = names.length - Math.min(MAX_LABEL_NAMES, names.length);
  return extra > 0 ? `${shown} +${extra} more` : shown;
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
