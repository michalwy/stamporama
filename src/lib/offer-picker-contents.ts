import "server-only";
import { prisma } from "./db";
import { STAMP_LABEL_SELECT, makeOfferLabeller, orderedLabelItems } from "./offer-labels";
import { offerPickerContents, type OfferPickerContents } from "./offer-picker-contents-rules";

/**
 * What each offer picker row shows of its offer (#2309) — its own title, its first copy's photo and
 * its sets' stamps — for *Add offers to the proposal* and a post's *Add lots…*, keyed by offer id. One
 * read for the whole list, and the area tree once, as a page of offers labels its sets.
 */
export async function readOfferPickerContents(
  collectionId: string,
  offerIds: readonly string[]
): Promise<Map<string, OfferPickerContents>> {
  if (offerIds.length === 0) return new Map();
  const [offers, labeller] = await Promise.all([
    prisma.offer.findMany({
      where: { id: { in: [...offerIds] }, collectionId },
      select: {
        id: true,
        name: true,
        sets: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: {
            items: {
              select: {
                itemId: true,
                sortOrder: true,
                item: {
                  select: {
                    condition: { select: { id: true, abbreviation: true } },
                    photos: { where: { role: "front" }, select: { id: true }, orderBy: { sortOrder: "asc" }, take: 1 },
                    stamp: {
                      select: {
                        ...STAMP_LABEL_SELECT.stamp.select,
                        issueMemberships: {
                          select: { issueId: true, issue: { select: { name: true, year: true } } },
                          take: 1,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    makeOfferLabeller(collectionId),
  ]);

  return new Map(
    offers.map((offer) => {
      const sets = offer.sets.map((set) => orderedLabelItems(set.items));
      const photoId = sets.flat().find((line) => line.item.photos.length > 0)?.item.photos[0]!.id ?? null;
      return [
        offer.id,
        offerPickerContents(
          offer.name,
          photoId,
          sets.map((items) => ({
            catalog: labeller.set({ title: null, items }),
            copies: items.map(({ item }) => ({
              condition: item.condition,
              issue: item.stamp.issueMemberships[0]?.issue ?? null,
              stampName: item.stamp.name,
              catalogNumbers: labeller.catalogNumbers(item.stamp),
            })),
          }))
        ),
      ] as const;
    })
  );
}
