import "server-only";
import { prisma } from "./db";
import { makeCatalogLabeller } from "./collection-search";
import type { NotedStamp } from "./phone-purchase-rules";

/**
 * The stamps the phone noted as bought on a purchase (#2006), in the order picked, each with its
 * catalogue numbers labelled as the phone search and the stamp pickers label them — the area from
 * the stamp's primary area link, the issue from its first membership, `searchStampsForPicker`'s
 * reading. Empty for a purchase entered at the desk, and for one that is not the caller's.
 */
export async function listPurchaseNotedStamps(
  ownerId: string,
  purchaseId: string
): Promise<NotedStamp[]> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      collectionId: true,
      collection: { select: { ownerId: true } },
      notedStamps: {
        orderBy: { position: "asc" },
        select: {
          stamp: {
            select: {
              id: true,
              stampNo: true,
              name: true,
              catalogNumbers: { select: { catalogVendorId: true, number: true } },
              stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
              issueMemberships: { select: { issueId: true }, take: 1 },
            },
          },
        },
      },
    },
  });
  if (!purchase || purchase.collection.ownerId !== ownerId) return [];
  if (purchase.notedStamps.length === 0) return [];

  const vendors = await prisma.catalogVendor.findMany({
    where: { collectionId: purchase.collectionId },
    select: { id: true, abbreviation: true },
  });
  const labeller = await makeCatalogLabeller(purchase.collectionId, vendors);

  return purchase.notedStamps.map(({ stamp }) => {
    const link = stamp.stampAreaLinks.find((l) => l.isPrimary) ?? stamp.stampAreaLinks[0];
    return {
      stampId: stamp.id,
      stampNo: stamp.stampNo,
      name: stamp.name,
      catalogNumbers: labeller
        .labelFor(
          link?.collectionAreaId ?? null,
          stamp.issueMemberships[0]?.issueId ?? null,
          stamp.catalogNumbers
        )
        .map((cn) => cn.label),
    };
  });
}
