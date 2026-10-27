import "server-only";
import { prisma } from "./db";
import { COPY_VALUATION_SELECT, copyValuationOf, valuateItemRows } from "./item-valuation";
import { readCollectionAreas } from "./areas";
import { buildAreaVendorMaps, formatStampCN } from "./area-vendor";
import { loadIssuePrefixMap } from "./issue-prefix";
import { makeFormatFactorLookup } from "./format-pricing";
import { compareSetItems } from "./offer-set-order";
import { isFacebookLotPosted } from "./facebook-post-rules";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import type { PhotoSummary } from "./photos";
import type { CatalogueFillLine } from "./lot-catalogue-fill";

// A Facebook post's copies as *Fill catalogue values* lines (#2220): what the post's screen types its
// lots' missing catalogue values down, one window for the whole post or for one lot.
//
// Each copy is valued exactly as the copies list values it (`valuateItemRows` over `copyValuationOf`),
// so a copy is missing a value here exactly when it is unpriced there. The window's own choice —
// marked, unsettled and unidentified lines left out — is `needsCatalogueValue`'s, applied on the
// client; this read only says what each copy is. Two kinds of copy are told to it as unidentified:
//
// - a copy with a **candidate set** (#1651) — which stamp it is has still to be settled, and its
//   `stampId` is only the set's pointer;
// - and, alongside it, an **unknown-variant** copy (#238), whose value is its variants'.
//
// A **multi-stamp** piece (ADR-0044) is not a line at all: it is valued at the figure recorded on the
// piece and never from the catalogue (#747), so there is no catalogue value to type for it.

/** One copy's photo summary, as the stamp's pictures are — front, back, then the rest. */
function toPhotoSummary(p: { id: string; role: string | null; title: string | null; sortOrder: number }): PhotoSummary {
  return {
    id: p.id,
    role: (p.role === "main" || p.role === "front" || p.role === "back" ? p.role : null) as PhotoSummary["role"],
    title: p.title,
    sortOrder: p.sortOrder,
  };
}

const PHOTO_SELECT = { select: { id: true, role: true, title: true, sortOrder: true } } as const;

/**
 * Every copy of every lot of the post, as fill lines, keyed by the lot's offer id — each lot's in its
 * own order, set by set. Null once any lot is up: the values are typed while the lots are priced, and
 * pricing belongs to before (#1800), as {@link getFacebookPostLotsPrepare} decides.
 */
export async function getFacebookPostCatalogueFill(
  ownerId: string,
  collectionId: string,
  postId: string
): Promise<Record<string, CatalogueFillLine[]> | null> {
  const post = await prisma.facebookPost.findFirst({
    where: { id: postId, collectionId, collection: { ownerId } },
    select: {
      lots: {
        orderBy: { facebookLotNo: "asc" },
        select: {
          id: true,
          state: true,
          sets: {
            orderBy: { sortOrder: "asc" },
            select: {
              items: {
                select: {
                  itemId: true,
                  sortOrder: true,
                  item: {
                    select: {
                      id: true,
                      stampId: true,
                      conditionId: true,
                      certificateStatusId: true,
                      formatId: true,
                      ...COPY_VALUATION_SELECT,
                      condition: { select: { name: true, abbreviation: true } },
                      certificateStatus: { select: { name: true, abbreviation: true } },
                      format: { select: { name: true, abbreviation: true } },
                      photos: PHOTO_SELECT,
                      stamp: {
                        select: {
                          name: true,
                          primaryCatalogSortKey: true,
                          catalogNumbers: { select: { catalogVendorId: true, number: true } },
                          stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
                          issueMemberships: {
                            orderBy: { issueId: "asc" },
                            take: 1,
                            select: { issueId: true, issue: { select: { name: true, year: true } } },
                          },
                          photos: PHOTO_SELECT,
                          variants: { select: VARIANT_FLAG_SELECT },
                          ...VARIANT_FLAG_SELECT,
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
    },
  });
  if (!post) throw new Error("Post not found.");
  if (post.lots.some((l) => isFacebookLotPosted(l.state))) return null;

  type SetItem = (typeof post.lots)[number]["sets"][number]["items"][number];
  const lotItems = post.lots.map((lot) => ({
    offerId: lot.id,
    items: lot.sets.flatMap((set) =>
      [...set.items]
        .sort((a, b) =>
          compareSetItems(
            { itemId: a.itemId, sortOrder: a.sortOrder, catalogSortKey: a.item.stamp.primaryCatalogSortKey },
            { itemId: b.itemId, sortOrder: b.sortOrder, catalogSortKey: b.item.stamp.primaryCatalogSortKey }
          )
        )
        .map((li: SetItem) => li.item)
        .filter((item) => copyValuationOf(item).carrier === null)
    ),
  }));
  const copies = [...new Map(lotItems.flatMap((lot) => lot.items).map((item) => [item.id, item])).values()];
  if (copies.length === 0) return Object.fromEntries(lotItems.map((lot) => [lot.offerId, []]));

  const [valuations, areas, issuePrefixes, factorOf] = await Promise.all([
    valuateItemRows(
      collectionId,
      copies.map((item) => ({
        id: item.id,
        stampId: item.stampId,
        conditionId: item.conditionId,
        certificateStatusId: item.certificateStatusId,
        formatId: item.formatId,
        unknownVariant: isUnknownVariantStamp(item.stamp),
        ...copyValuationOf(item),
      }))
    ),
    readCollectionAreas(collectionId),
    loadIssuePrefixMap(collectionId),
    copies.some((item) => item.formatId !== null)
      ? makeFormatFactorLookup(collectionId)
      : Promise.resolve(() => null),
  ]);
  const { primaryVendorByArea, vendorMapFor } = buildAreaVendorMaps(areas, issuePrefixes);

  const lineOf = (offerId: string, item: (typeof copies)[number]): CatalogueFillLine => {
    const value = valuations.get(item.id);
    const link = item.stamp.stampAreaLinks.find((l) => l.isPrimary) ?? item.stamp.stampAreaLinks[0];
    const areaId = link?.collectionAreaId ?? null;
    const primaryVendorId = areaId ? (primaryVendorByArea.get(areaId) ?? null) : null;
    const catalogNumbers = primaryVendorId
      ? [
          ...item.stamp.catalogNumbers.filter((cn) => cn.catalogVendorId === primaryVendorId),
          ...item.stamp.catalogNumbers.filter((cn) => cn.catalogVendorId !== primaryVendorId),
        ]
      : item.stamp.catalogNumbers;
    const leading = catalogNumbers[0] ?? null;
    const membership = item.stamp.issueMemberships[0] ?? null;
    const vendorMap = vendorMapFor(areaId, membership?.issueId ?? null);
    // The stamp's picture, as on an auction lot; the copy's own where the stamp has none — a post
    // made from a stockbook is mostly copies photographed and stamps that never were.
    const photos = item.stamp.photos.length > 0 ? item.stamp.photos : item.photos;
    return {
      id: `${offerId}~${item.id}`,
      stampId: item.stampId,
      stampName: item.stamp.name,
      catalogLabel: leading ? formatStampCN(leading.number, vendorMap.get(leading.catalogVendorId)) : null,
      catalogNumbers,
      areaId,
      issueId: membership?.issueId ?? null,
      issueName: membership?.issue.name ?? null,
      issueYear: membership?.issue.year ?? null,
      photos: photos.map(toPhotoSummary).sort((a, b) => a.sortOrder - b.sortOrder),
      conditionId: item.conditionId,
      conditionName: item.condition.name,
      conditionAbbreviation: item.condition.abbreviation,
      certificateStatusId: item.certificateStatusId,
      certificateStatusName: item.certificateStatus?.name ?? null,
      certificateStatusAbbreviation: item.certificateStatus?.abbreviation ?? null,
      formatId: item.formatId,
      formatName: item.format?.name ?? null,
      formatAbbreviation: item.format?.abbreviation ?? null,
      formatFactor: factorOf(item.formatId, areaId, membership?.issueId ?? null, item.conditionId),
      quantity: 1,
      unpriced: value?.unpriced ?? true,
      mark: value?.mark ?? null,
      unknownVariant: isUnknownVariantStamp(item.stamp) || item.candidates.length > 1,
    };
  };

  return Object.fromEntries(lotItems.map((lot) => [lot.offerId, lot.items.map((item) => lineOf(lot.offerId, item))]));
}
