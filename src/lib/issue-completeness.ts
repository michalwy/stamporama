import "server-only";
import { prisma } from "./db";
import { UNAVAILABLE_DELIVERY_STATES } from "./delivery-state";
import {
  computeIssueCompleteness,
  type CompletenessCount,
  type IssueCompletenessGrid,
} from "./issue-completeness-rules";

// The I/O half of #519's completeness card: one `groupBy` over the issue's required members, fed
// straight into the pure grid. Deliberately **not** on the issues list — this is one issue's
// question, and the list keeps #54's lightweight indicator (the reasoning #133 wrote down).

/** The grid plus the condition dictionary it is laid out against. */
export interface IssueCompleteness extends IssueCompletenessGrid {
  conditions: { id: string; name: string; abbreviation: string }[];
}

/**
 * How complete an issue is, from the copies actually held. Exclusions are `copy-counts.ts`'s
 * exactly — sold, disposed and never-usably-delivered copies are not held — so this card and the
 * copy-count badge beside it cannot disagree about what "having one" means.
 */
export async function getIssueCompleteness(
  ownerId: string,
  collectionId: string,
  issueId: string
): Promise<IssueCompleteness> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }

  const [members, conditions] = await Promise.all([
    prisma.issueMember.findMany({
      where: { issueId, issue: { collectionId }, requiredForCompleteness: true },
      select: { stampId: true },
    }),
    prisma.stampCondition.findMany({
      where: { collectionId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, abbreviation: true },
    }),
  ]);

  const stampIds = members.map((m) => m.stampId);
  const rows =
    stampIds.length === 0
      ? []
      : await prisma.item.groupBy({
          by: ["stampId", "conditionId", "inCollection", "forSale", "forTrade"],
          where: {
            collectionId,
            stampId: { in: stampIds },
            saleLineItems: { none: {} },
            disposedAt: null,
            deliveryState: { notIn: [...UNAVAILABLE_DELIVERY_STATES] },
          },
          _count: { _all: true },
        });

  const counts: CompletenessCount[] = rows.map((r) => ({
    stampId: r.stampId,
    conditionId: r.conditionId,
    inCollection: r.inCollection,
    forSale: r.forSale,
    forTrade: r.forTrade,
    count: r._count._all,
  }));

  return {
    ...computeIssueCompleteness(stampIds, counts, conditions.map((c) => c.id)),
    conditions,
  };
}
