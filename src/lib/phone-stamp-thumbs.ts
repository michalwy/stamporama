import "server-only";
import { prisma } from "./db";
import { phoneStampThumbIds } from "./phone-stamp-view";

// The thumbnails of the phone's stamp rows (#2075, ADR-0072): an issue's stamps when browsing and the
// search's hits. One read for the page; the choice is `phoneStampThumbIds`, the stamp screen's own
// picture rule, so a row and the screen it opens show the same photo.

/**
 * Each of `stampIds`' thumbnail photo id — its own lead photo, else the lead photo of its copies
 * still on record (not disposed of), as the stamp screen reads them. A stamp with neither is absent.
 * The callers have already read the stamps as this collection's; the copies are held to it too.
 */
export async function loadPhoneStampThumbs(
  collectionId: string,
  stampIds: readonly string[]
): Promise<Map<string, string>> {
  if (stampIds.length === 0) return new Map();
  const ids = [...stampIds];
  const photos = await prisma.photo.findMany({
    where: {
      OR: [
        { stampId: { in: ids } },
        { item: { stampId: { in: ids }, collectionId, disposedAt: null } },
      ],
    },
    select: {
      id: true,
      role: true,
      sortOrder: true,
      stampId: true,
      item: { select: { stampId: true, itemNo: true } },
    },
  });
  return phoneStampThumbIds(
    photos.map((p) => ({
      id: p.id,
      role: p.role,
      sortOrder: p.sortOrder,
      stampId: p.stampId,
      copy: p.item ? { stampId: p.item.stampId, itemNo: p.item.itemNo } : null,
    }))
  );
}
