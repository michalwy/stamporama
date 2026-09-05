import "server-only";
import { prisma } from "./db";
import { buildDescendantMap } from "./pricing";
import { satisfiedMember, type VariantChain } from "./checklist-completeness-rules";
import { childIsVariant, VARIANT_FLAG_SELECT } from "./variant-classification";

// Which stamp a copy counts *for* when a checklist asks whether the set is complete (#661).
//
// A checklist names the stamp the catalogue names — `226` — and the copy in the album is a
// `226yw`, filed under it because that is what the collector eventually identified it as. Nothing
// about that copy stopped being a `226`: ADR-0010 §3's rule, the one the unknown-variant valuation
// (#101/#130) and the headline-price rollup (#238) already read the tree by, says a **variant**
// child is another way of holding its parent, while a distinct entry — an error, a plate flaw, an
// overprint — is its own thing to collect. So the copy satisfies the requirement, and #130 said
// completeness would read it that way; the readers were left counting `stampId` literally.
//
// The I/O half only. Which member a chain satisfies is `satisfiedMember` in the rules module,
// where the arithmetic it feeds lives.

/** The rollup for one screen's checklists: what to count, and what each copy counts toward. */
export interface ChecklistVariantRollup {
  /**
   * Every stamp whose copies can satisfy one of the members — the members themselves, plus the
   * variant descendants that roll up to one. What a completeness query asks for instead of the
   * membership alone, since the copies it is looking for hang below it.
   */
  countingStampIds: string[];
  /**
   * The member of `members` that a copy on `stampId` satisfies, or null for a copy that satisfies
   * none of them. `members` is **one checklist's** membership, never the union: the same
   * `226yw` copy answers the basic checklist as `226` and the specialized one as itself, and a map
   * built over both at once could only pick one of those answers.
   */
  memberFor(stampId: string, members: ReadonlySet<string>): string | null;
}

const EMPTY_ROLLUP: ChecklistVariantRollup = {
  countingStampIds: [],
  memberFor: () => null,
};

/**
 * The rollup for the given checklist members, batched over every checklist on screen.
 *
 * Two queries whatever the page holds: one recursive walk of the members' subtrees (`pricing.ts`'s
 * `buildDescendantMap`, the same walk the price rollup takes), then one read of the variant flags
 * and parent edges along it. Every completeness reader is already batched over its issues for
 * `getLotSetCompleteness`' reason, and a rollup costing a query per row would undo that.
 *
 * The chain each stamp gets is **itself first, then upward while the node it came from is a
 * variant** — so `309APa → 309AP → 309A → 309` is walked whole (#239: an intermediate node is as
 * much a variant as a direct child), and a walk that meets a distinct entry stops there, taking its
 * ancestors with it. Ancestors outside the loaded subtrees are unreachable and that is not a
 * limitation: every member is a root of the walk, so any member ancestor is loaded by construction.
 */
export async function loadChecklistVariantRollup(
  collectionId: string,
  memberStampIds: readonly string[]
): Promise<ChecklistVariantRollup> {
  const memberIds = new Set(memberStampIds);
  if (memberIds.size === 0) return EMPTY_ROLLUP;

  const descendantsByMember = await buildDescendantMap(collectionId, memberIds);
  const ids = new Set(memberIds);
  for (const set of descendantsByMember.values()) for (const id of set) ids.add(id);

  const rows = await prisma.stamp.findMany({
    where: { id: { in: [...ids] }, collectionId },
    select: { id: true, parentId: true, ...VARIANT_FLAG_SELECT },
  });
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  const isVariant = new Map(rows.map((r) => [r.id, childIsVariant(r)]));

  const chains = new Map<string, VariantChain>();
  for (const row of rows) {
    const chain: string[] = [row.id];
    let cursor: string | null = row.id;
    while (cursor !== null && isVariant.get(cursor) === true) {
      const parent: string | null = parentOf.get(cursor) ?? null;
      // A parent outside the loaded set cannot be a member — members are the roots of the walk —
      // so there is nothing above it worth reaching.
      if (parent === null || !parentOf.has(parent)) break;
      chain.push(parent);
      cursor = parent;
    }
    chains.set(row.id, chain);
  }

  return {
    countingStampIds: [...ids].filter((id) =>
      (chains.get(id) ?? [id]).some((ancestor) => memberIds.has(ancestor))
    ),
    memberFor: (stampId, members) => satisfiedMember(chains.get(stampId) ?? [stampId], members),
  };
}

/** How deep a variant chain is walked before the loop gives up. A stamp tree that deep does not
 *  exist; the bound is here so a cycle written by hand cannot spin a read forever. */
const MAX_VARIANT_DEPTH = 8;

/**
 * The variant chain of each of the given stamps — **itself first, then upward while the node it
 * came from is a variant** — for a caller holding copies rather than checklist members (#759).
 *
 * {@link loadChecklistVariantRollup} walks *down* from a known membership and can only answer about
 * the subtrees it loaded. The bulk-lot builder starts from the other end: it holds a pool of copies
 * and asks two questions of each one — which checklist slot it covers ({@link satisfiedMember}) and
 * which duplicate pile it belongs to (`lot-builder-rules.ts`' `duplicateKey`, the top of the chain).
 * Both are this same chain, so it is loaded once and handed to the pure rules rather than being
 * re-derived per question.
 *
 * One query per level, and the levels are few: the walk stops the moment a node is a distinct entry
 * (an error, a plate flaw, an overprint), which keeps its own identity and takes its ancestors out
 * of reach with it — ADR-0010 §3's rule, the one this whole module reads the tree by. A stamp with
 * no variant edge above it gets a chain of one, which is the correct answer and not an absence.
 */
export async function loadVariantChains(
  collectionId: string,
  stampIds: readonly string[]
): Promise<Map<string, VariantChain>> {
  const chains = new Map<string, string[]>();
  if (stampIds.length === 0) return chains;
  for (const id of new Set(stampIds)) chains.set(id, [id]);

  // The frontier is "the nodes whose parent we still might climb to", carrying the origins that
  // reached them — several copies routinely share an ancestor, and it is read once for all of them.
  let frontier = new Map<string, Set<string>>(
    [...chains.keys()].map((id) => [id, new Set([id])])
  );
  for (let depth = 0; depth < MAX_VARIANT_DEPTH && frontier.size > 0; depth += 1) {
    const rows = await prisma.stamp.findMany({
      where: { id: { in: [...frontier.keys()] }, collectionId },
      select: { id: true, parentId: true, ...VARIANT_FLAG_SELECT },
    });
    const next = new Map<string, Set<string>>();
    for (const row of rows) {
      // A child that does not act as a variant is a stamp in its own right: the chain ends at it.
      if (row.parentId === null || !childIsVariant(row)) continue;
      const origins = frontier.get(row.id)!;
      for (const origin of origins) chains.get(origin)!.push(row.parentId);
      const carried = next.get(row.parentId) ?? new Set<string>();
      for (const origin of origins) carried.add(origin);
      next.set(row.parentId, carried);
    }
    frontier = next;
  }
  return chains;
}

/**
 * One checklist's copy tallies, re-stamped onto the members they satisfy — rows answering for no
 * member dropped.
 *
 * Shape-agnostic on purpose: the grid counts a copy by condition, disposition and format, the
 * group header by condition alone, and both re-attribute it the same way. Rows can collide after
 * the rewrite — a `226xw` and a `226yw` in the same condition both become `226` — and that is
 * correct rather than tolerated: every reading downstream sums per stamp, and two variant copies of
 * one listed stamp *are* two copies of it.
 */
export function rollUpCounts<T extends { stampId: string }>(
  counts: readonly T[],
  rollup: ChecklistVariantRollup,
  members: ReadonlySet<string>
): T[] {
  return counts.flatMap((count) => {
    const member = rollup.memberFor(count.stampId, members);
    return member === null ? [] : [{ ...count, stampId: member }];
  });
}

/** The same rewrite over a plain list of stamp ids — the shape {@link ChecklistVariantRollup}'s
 *  for-sale reader hands its two sets in (#563). Duplicates are the caller's to ignore: both sides
 *  of that reading are sets. */
export function rollUpStampIds(
  stampIds: Iterable<string>,
  rollup: ChecklistVariantRollup,
  members: ReadonlySet<string>
): string[] {
  const rolled: string[] = [];
  for (const stampId of stampIds) {
    const member = rollup.memberFor(stampId, members);
    if (member !== null) rolled.push(member);
  }
  return rolled;
}
