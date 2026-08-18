import "server-only";
import { prisma } from "./db";
import { DELCAMPE_PLATFORM_MODULE } from "./platform-modules";
import {
  type PlatformCategoryLessonRow,
  assertCollectionOwner,
  listPlatformCategoryLessons,
} from "./platform-category";
import {
  type DelcampeCatalogStatus,
  delcampeCategoryCatalogStatus,
} from "./delcampe-category-catalog";

// What Settings → Delcampe shows about categories (#609; ADR-0035 §5) — the collection's own learned
// associations, and how current Delcampe's published list is.
//
// A read and two corrections, no creation. Nothing here makes an association: a row appears when an
// offer is finished being prepared with a category (#494's moment, applied to the marketplace next
// door), which is the whole point of the feature. What the panel exists for is the other direction —
// a wrong association learned once must never be a thing that can only be fixed by preparing
// something wrong again (ADR-0026 §6) — and both corrections are the shared register's, called
// straight from the actions file.
//
// Its own module rather than more of `delcampe-listing-profile.ts`, which is the collector's own
// settings, or of `delcampe-category-catalog.ts`, which is Delcampe's public dictionary. This is the
// third thing: what *this collection* has worked out about where its stamps go.

/** What the panel renders: the platform the register hangs off, what it holds, and the state of the
 *  catalogue the picker searches. */
export interface DelcampeLearnedCategoryList {
  platformId: string | null;
  platformName: string | null;
  lessons: PlatformCategoryLessonRow[];
  /** How many categories Delcampe's own list holds, when it was last read, and whether that was
   *  read here or is the snapshot this release shipped with. The two are different states and read
   *  differently: one is dated by a pass, the other by a release. */
  catalog: DelcampeCatalogStatus;
}

export async function listDelcampeLearnedCategories(
  ownerId: string,
  collectionId: string
): Promise<DelcampeLearnedCategoryList> {
  await assertCollectionOwner(ownerId, collectionId);
  const platform = await prisma.contact.findFirst({
    where: { collectionId, platform: true, platformModule: DELCAMPE_PLATFORM_MODULE },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // The catalogue is instance-wide and is read either way: an instance that has not yet named a
  // Delcampe platform still wants to be told the list has never been fetched, that being the thing
  // it is about to need.
  const catalog = await delcampeCategoryCatalogStatus();
  if (!platform) {
    return {
      platformId: null,
      platformName: null,
      lessons: [],
      catalog,
    };
  }

  return {
    platformId: platform.id,
    platformName: platform.name,
    lessons: await listPlatformCategoryLessons(platform.id),
    catalog,
  };
}
