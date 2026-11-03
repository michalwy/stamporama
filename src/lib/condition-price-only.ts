// Conditions that are a **price column only** (#2374). Pure and import-free, so every module that
// accepts a condition can use it without an import cycle (`docs/agents/platform.md`).
//
// A condition may be a **price column only** (#2374): a column the catalogues print — a cover's FP /
// FW / FM, Michel's ⊠ EF / MeF / MiF — that no copy is ever in, since a cover is used and its franking
// is read off what is on it. Every price surface reads it as a condition, which is the point; nothing
// a copy, a want, a line, a lot or an observation is described by may name one. So
// `getStampConditions` (`conditions.ts`) leaves them out unless a price surface asks, and a condition
// accepted for anything but a price is checked with {@link COPY_CONDITION_WHERE}.

/** The `where` a condition must match to describe a copy — or a want, an acceptance profile, a trade
 *  or auction line, a lot, a price observation, a Colnect mapping: a price column only is refused
 *  (#2374). */
export const COPY_CONDITION_WHERE = { priceOnly: false } as const;

/** The records a condition can be used by, in the order the refusal names them, each as one and as
 *  several. */
export const CONDITION_RECORD_KINDS = [
  ["copy", "copies"],
  ["want", "wants"],
  ["acceptance profile", "acceptance profiles"],
  ["trade line", "trade lines"],
  ["trade section's default", "trade sections' defaults"],
  ["auction lot line", "auction lot lines"],
  ["auction lot line that may be in it", "auction lot lines that may be in it"],
  ["offer's listed variant", "offers' listed variants"],
  ["price observation", "price observations"],
  ["marked scan tile", "marked scan tiles"],
  ["Colnect condition mapping", "Colnect condition mappings"],
  ["platform category choice", "platform category choices"],
] as const;

export interface ConditionRecordUse {
  /** The kind of record, as several (`copies`). */
  kind: (typeof CONDITION_RECORD_KINDS)[number][1];
  count: number;
}

/** `…while it is used by 3 copies, 1 want.` — the sentence the refusal shows. */
export function conditionRecordUsesText(uses: readonly ConditionRecordUse[]): string {
  const parts = uses.map((u) => {
    const kind = CONDITION_RECORD_KINDS.find(([, several]) => several === u.kind);
    return `${u.count} ${u.count === 1 && kind ? kind[0] : u.kind}`;
  });
  return `This condition cannot be a price column only while it is used by ${parts.join(", ")}.`;
}
