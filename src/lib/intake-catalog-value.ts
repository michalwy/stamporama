// What the intake step's catalogue-value field is holding, and the one rule that decides whether it
// is worth writing (#593).
//
// Pure — no DOM, no React, no Prisma — and separate from the field that draws it for the reason
// `tile-photo-roles.ts` is separate from the list it filters: the rule is what must not drift, and
// it is the thing worth a test rather than a screen.

import { normalizeDecimalInput } from "./decimal-input";

/** What the field is holding, read by the intake dialog's submit. */
export interface IntakeCatalogValue {
  /** The primary catalogue the figure would land on (its latest edition), or null when the stamp's
   * area has none — in which case there is no field on screen either. */
  catalogNameId: string | null;
  /** Exactly what is in the input. Blank is the ordinary case, not a missing answer: the paper
   * catalogue is not always to hand, and this step must never start blocking on it. */
  amount: string;
  /** What is already on file for the chosen condition × certificate × format, so an untouched
   * prefill is not written back as though it were an edit. */
  recorded: string | null;
  /**
   * Still reading the context for the axes currently chosen.
   *
   * A submit while this is true must write **nothing**: the figure on screen belongs to the answer
   * that has just been left, and writing it would be exactly the silent reassignment onto a newly
   * chosen condition that #593 exists to prevent.
   */
  loading: boolean;
}

export const EMPTY_INTAKE_CATALOG_VALUE: IntakeCatalogValue = {
  catalogNameId: null,
  amount: "",
  recorded: null,
  loading: false,
};

/**
 * The one entry to write, or **null when there is nothing to write** — which is most intakes.
 *
 * Three ways to be nothing, and they are different: no catalogue to write to, a blank field (the
 * ordinary case), and a prefill nobody changed. That last one is compared as a **number** rather
 * than as text: the recorded value arrives as `12.00`, a collector who retypes it as `12` or `12,00`
 * has changed nothing, and a textual comparison would send a pointless write on every intake of an
 * already-priced stamp.
 */
export function catalogValueEntry(
  value: IntakeCatalogValue
): { catalogNameId: string; amount: string } | null {
  const amount = value.amount.trim();
  if (!value.catalogNameId || amount === "" || value.loading) return null;
  if (value.recorded != null) {
    const typed = Number(normalizeDecimalInput(amount));
    // An unparseable figure is *not* silently treated as unchanged — the action is the one place
    // that judges an amount, and it refuses with a message the collector can act on.
    if (Number.isFinite(typed) && typed === Number(value.recorded)) return null;
  }
  return { catalogNameId: value.catalogNameId, amount };
}

/**
 * What the value is keyed on — a change to any part of it re-reads, and drops what was typed.
 *
 * The stamp is in it beside the three chosen axes, because the intake dialog is re-used for the
 * next pick without unmounting, and a catalogue price is a fact about a stamp before it is a fact
 * about a condition.
 *
 * **Format is in the key even though #593 does not mention it**: prices are recorded against it
 * (#343), this dialog has a format field (#573), and leaving it out would file a block of four's
 * catalogue value as the single's.
 */
export function catalogValueSubjectKey(
  stampId: string,
  conditionId: string,
  certificateStatusId: string,
  formatId: string
): string {
  return `${stampId}|${conditionId}|${certificateStatusId}|${formatId}`;
}
