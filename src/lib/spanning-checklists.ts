import "server-only";
import { prisma } from "./db";
import { getSpanningChecklistsCompleteness } from "./checklist-completeness";
import { headlineCompleteness, type CompletenessRow } from "./checklist-completeness-rules";
import { getSpanningChecklistTotals } from "./issues";
import type { IssuePriceTotal } from "./catalog-price";
import { orderedChecklistStampIds } from "./checklists";
import { translationsByLanguage } from "./translations";

// Checklists that span issues (#1416) — the Checklists screen's read. A module of its own because it
// joins three that must not import one another: the checklist storage (`checklists.ts`), the
// completeness grids and the issue list's valuation, which already imports `checklists.ts`.
//
// Every figure is one an issue's checklist is read by, taken from the same reader: completeness from
// `checklist-completeness.ts`, summed by its any × any cell (`headlineCompleteness`, #1278), and the
// catalogue value from the issue list's own total. So a set spanning issues and a set of one issue
// read alike, which is the point of listing them the same way.

/** One checklist spanning issues, as its row on the Checklists screen draws it. */
export interface SpanningChecklistOverview {
  id: string;
  name: string;
  /** Per-language names (#1308), for the rename form's translations. */
  nameByLanguage: Record<string, string>;
  /** Its stamps, in the order the set reads (#764). */
  stampIds: string[];
  /** How many issues its stamps come from. */
  issueCount: number;
  /** The completeness grid's any × any cell — the figure the issue page's Checklists card shows. */
  completeness: CompletenessRow;
  priceTotal: IssuePriceTotal | null;
  priceStale: boolean;
  /** The albums it is an entry of (#767) — what the row says it is in, and what deleting it takes
   *  with it. */
  albums: { id: string; name: string }[];
}

/** Every checklist of the collection that spans issues, in their own order, with their figures. */
export async function getSpanningChecklistOverview(
  ownerId: string,
  collectionId: string
): Promise<SpanningChecklistOverview[]> {
  // Owner-checked by the completeness read, which runs first for exactly that reason.
  const completeness = await getSpanningChecklistsCompleteness(ownerId, collectionId);
  const rows = await prisma.checklist.findMany({
    where: { collectionId, issueId: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      translations: { select: { language: true, name: true } },
      stamps: { select: { stampId: true, sortOrder: true } },
      albumEntries: {
        select: { album: { select: { id: true, name: true } } },
        orderBy: { album: { name: "asc" } },
      },
    },
  });
  if (rows.length === 0) return [];

  const lists = rows.map((r) => ({ id: r.id, stampIds: orderedChecklistStampIds(r.stamps) }));
  const allStampIds = [...new Set(lists.flatMap((l) => l.stampIds))];
  const [totals, memberships] = await Promise.all([
    getSpanningChecklistTotals(collectionId, lists),
    allStampIds.length === 0
      ? Promise.resolve([])
      : prisma.issueMember.findMany({
          where: { stampId: { in: allStampIds }, issue: { collectionId } },
          select: { stampId: true, issueId: true },
        }),
  ]);
  const issuesOf = new Map<string, string[]>();
  for (const m of memberships) issuesOf.set(m.stampId, [...(issuesOf.get(m.stampId) ?? []), m.issueId]);
  const gridOf = new Map(completeness.checklists.map((g) => [g.checklistId, g]));

  return rows.map((row, i) => {
    const stampIds = lists[i].stampIds;
    const grid = gridOf.get(row.id);
    const total = totals.get(row.id);
    return {
      id: row.id,
      name: row.name,
      nameByLanguage: translationsByLanguage(row.translations, (t) => t.name),
      stampIds,
      issueCount: new Set(stampIds.flatMap((id) => issuesOf.get(id) ?? [])).size,
      completeness: grid
        ? headlineCompleteness(grid)
        : { disposition: "any", conditionId: null, owned: 0, completeSets: 0 },
      priceTotal: total?.priceTotal ?? null,
      priceStale: total?.priceStale ?? false,
      albums: row.albumEntries.map((e) => e.album),
    };
  });
}
