// Colnect's own stamp-condition vocabulary (#404, part of #155) — pure, no Prisma.
//
// `StampCondition` is the collector's grade list; Colnect ships a closed one. Listing a copy means
// translating between the two, and that translation is stored per collection (`ColnectConditionMapping`)
// rather than re-chosen per listing. What lives here is the constant side of it: Colnect's list and
// the guess behind the Settings panel's *Fill matching* button.

/** One grade as Colnect's sale form offers it. */
export interface ColnectGrade {
  /** The option value the form submits, and what a mapping row stores. */
  value: string;
  /** What the collector picks against, verbatim from the form. Never stored — it lives here. */
  label: string;
  /** The leading token of the label. Not part of Colnect's markup; it is what
   *  {@link guessColnectGrade} matches a local condition's abbreviation against. */
  abbrev: string;
  /** How the **marketplace search** names this grade in a URL path (#423) — a different vocabulary
   *  from `value`, which is the *form's*. Colnect's market list addresses a condition by a slug
   *  (`…/condition/mint_never_hinged/…`) rather than by the form's numeric option, so the two are
   *  stated separately instead of one being derived from the other. */
  marketSlug: string;
}

/**
 * Colnect's stamp condition list (#402) — **fixed and global**: the identical five options render
 * under every item of a multi-item sale form, so a static table is enough and there is no per-item
 * variation to handle. The form keys conditions per category (`data-cat="stamps"`), so strictly the
 * vocabulary belongs to a (platform, category) pair; Stamporama is stamps-only, which is why a flat
 * per-collection mapping stays correct.
 */
export const COLNECT_CONDITIONS: readonly ColnectGrade[] = [
  { value: "1", label: "MNH - Mint Never Hinged", abbrev: "MNH", marketSlug: "mint_never_hinged" },
  { value: "2", label: "MH - Mint Hinged", abbrev: "MH", marketSlug: "mint_hinged" },
  { value: "3", label: "MNG - Mint No Gum", abbrev: "MNG", marketSlug: "mint_no_gum" },
  { value: "4", label: "U - Used", abbrev: "U", marketSlug: "used" },
  { value: "5", label: "CTO - Cancelled To Order", abbrev: "CTO", marketSlug: "cancelled_to_order" },
];

/** The grade for a stored value, or null when the value is not one Colnect offers. */
export function colnectGradeFor(value: string): ColnectGrade | null {
  const key = value.trim();
  return COLNECT_CONDITIONS.find((g) => g.value === key) ?? null;
}

/** Whether a value is one Colnect actually offers — the write-side guard, so a stored mapping can
 *  always be rendered and posted. */
export function isColnectConditionValue(value: string): boolean {
  return colnectGradeFor(value) !== null;
}

/**
 * The Colnect grade a local condition most likely means, matched on the **abbreviation** alone and
 * case-insensitively — the collection's seeded conditions (`MNH`, `MH`, `MNG`, `U`, `CTO`) are
 * exactly Colnect's own tokens, so the common case needs no picking at all. Deliberately not a fuzzy
 * name match: a wrong grade on a published listing is worse than a blank the collector fills in, and
 * the fill button only ever proposes.
 */
export function guessColnectGrade(abbreviation: string): ColnectGrade | null {
  const key = abbreviation.trim().toLowerCase();
  if (!key) return null;
  return COLNECT_CONDITIONS.find((g) => g.abbrev.toLowerCase() === key) ?? null;
}
