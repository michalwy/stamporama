import "server-only";
import { prisma } from "./db";
import { loadVariantChains } from "./checklist-variant-rollup";
import { satisfiedMember } from "./checklist-completeness-rules";
import { shownChecklistWhere } from "./checklist-kind";
import type { PlanChecklistSlot } from "./offer-photo-plan";

/**
 * The checklist slots an offer's copies fill (#1673), for the photo planner's grouping — the I/O half;
 * the grouping itself is `checklistGroupsOf` in the pure plan module.
 *
 * - **Standard checklists only** (#1617). Specialised ones are hidden by a switch remembered per
 *   browser, which a server-side render cannot read, and a finer goal — every colour of one stamp —
 *   is not the series a buyer is looking for.
 * - A copy fills the slot its **variant chain** reaches (#661), as the lot builder reads it: a `226yw`
 *   copy is a `226` to a checklist naming `226`, so a series identified down to its varieties still
 *   groups.
 * - The position is the slot's place in the checklist's own order (#764).
 *
 * Two reads whatever the offer holds, plus the chain walk.
 */
export async function loadChecklistSlots(
  collectionId: string,
  copies: readonly { itemId: string; stampId: string }[]
): Promise<Map<string, PlanChecklistSlot[]>> {
  const slots = new Map<string, PlanChecklistSlot[]>();
  if (copies.length === 0) return slots;

  const chains = await loadVariantChains(
    collectionId,
    copies.map((copy) => copy.stampId)
  );
  const chainIds = new Set<string>();
  for (const chain of chains.values()) for (const id of chain) chainIds.add(id);

  const rows = await prisma.checklistStamp.findMany({
    where: {
      stampId: { in: [...chainIds] },
      checklist: { collectionId, ...shownChecklistWhere(false) },
    },
    select: { checklistId: true, stampId: true, sortOrder: true },
  });
  // Each checklist's members among the chains, with their place in its order.
  const members = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const positions = members.get(row.checklistId) ?? new Map<string, number>();
    positions.set(row.stampId, row.sortOrder);
    members.set(row.checklistId, positions);
  }

  for (const copy of copies) {
    const chain = chains.get(copy.stampId) ?? [copy.stampId];
    const filled: PlanChecklistSlot[] = [];
    for (const [checklistId, positions] of members) {
      const member = satisfiedMember(chain, new Set(positions.keys()));
      if (member !== null) filled.push({ checklistId, position: positions.get(member)! });
    }
    if (filled.length > 0) slots.set(copy.itemId, filled);
  }
  return slots;
}
