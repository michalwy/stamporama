import type { Prisma } from "@/generated/prisma/client";

// Which reads a copy with a **candidate set** (#1651, ADR-0065) reaches — the one place the spelling
// lives, for `multi-stamp.ts`'s reason: the copy counts, the checklists, the wants and the Colnect
// source predicates must not come to disagree about which copies they are counting.
//
// - **In one variant tree** the copy points at the candidates' nearest common variant ancestor and
//   counts as an umbrella copy of it, so the counts need nothing.
// - **Across trees** it counts towards no completeness until it is settled: it is shown under each
//   candidate as *possibly this copy*, apart from the copies that certainly are.
// - **Wants**: a set satisfies a want only if every candidate would, and a want names one stamp
//   matched exactly (ADR-0032 §7), so no set of two or more different stamps ever does.

/** `Item` fragment: not a copy whose candidates span several variant trees. Spread beside
 *  `NOT_MULTI_STAMP` in every read that counts held copies of a catalogue position. */
export const NOT_ACROSS_TREES: Prisma.ItemWhereInput = { candidateTrees: { lt: 2 } };

/** The same copy the other way round: one whose candidates span several variant trees. */
export const ACROSS_TREES: Prisma.ItemWhereInput = { candidateTrees: { gte: 2 } };

/** {@link NOT_ACROSS_TREES} as SQL without the table alias, for the raw Colnect reads. */
export const NOT_ACROSS_TREES_SQL = '"candidateTrees" < 2';

/** `Item` fragment: no candidate set at all — what may answer a want. */
export const NO_CANDIDATES: Prisma.ItemWhereInput = { candidateTrees: 0 };

/** Whether a copy's `candidateTrees` puts it outside every completeness count. */
export function isAcrossTrees(candidateTrees: number): boolean {
  return candidateTrees >= 2;
}

/**
 * `Item` fragment: the copy's **variant is to settle** — it has a candidate set, or it points at an
 * unknown-variant umbrella (a stamp with a variant child, ADR-0010 §3). The filter the Copies list
 * and `list_holdings` narrow by.
 */
export const VARIANT_TO_SETTLE: Prisma.ItemWhereInput = {
  OR: [
    { candidateTrees: { gt: 0 } },
    {
      stamp: {
        variants: {
          some: {
            OR: [
              { actsAsVariantOverride: true },
              { actsAsVariantOverride: null, subtype: { actsAsVariant: true } },
            ],
          },
        },
      },
    },
  ],
};

/** {@link VARIANT_TO_SETTLE}, negated. */
export const VARIANT_SETTLED: Prisma.ItemWhereInput = { NOT: VARIANT_TO_SETTLE };
