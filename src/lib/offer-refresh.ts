import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { FACEBOOK_PLATFORM_MODULE } from "./platform-modules";
import { effectiveRefreshQuickBuysAfterDays } from "./facebook-group-rules";
import { refreshCutoff } from "./offer-refresh-rules";

// Each platform's refresh threshold for quick buys (#1718), read once per request, and the `where`
// that finds the offers past theirs. The rules themselves are `offer-refresh-rules.ts`.
//
// Deliberately imports nothing of `offers.ts` (which imports this): lib cycles throw at module-init.

/** The thresholds a collection states: per platform off Facebook, per group on it. A platform or
 *  group missing from its map has none. */
export interface RefreshThresholds {
  platforms: ReadonlyMap<string, number>;
  facebookGroups: ReadonlyMap<string, number>;
}

/**
 * Every threshold in the collection. A non-Facebook platform states its own on the contact; the
 * Facebook platform's lives in its defaults row (#1661), and each group follows it unless it holds
 * its own — the contact's column is not read for Facebook.
 */
export async function readRefreshThresholds(collectionId: string): Promise<RefreshThresholds> {
  const [platforms, groups] = await Promise.all([
    prisma.contact.findMany({
      where: {
        collectionId,
        platform: true,
        refreshQuickBuysAfterDays: { not: null },
        OR: [{ platformModule: null }, { platformModule: { not: FACEBOOK_PLATFORM_MODULE } }],
      },
      select: { id: true, refreshQuickBuysAfterDays: true },
    }),
    prisma.facebookGroup.findMany({
      where: { collectionId, platform: { platformModule: FACEBOOK_PLATFORM_MODULE } },
      select: {
        id: true,
        customSettings: true,
        refreshQuickBuysAfterDays: true,
        platform: { select: { facebookDefaults: { select: { refreshQuickBuysAfterDays: true } } } },
      },
    }),
  ]);
  const facebookGroups = new Map<string, number>();
  for (const group of groups) {
    const days = effectiveRefreshQuickBuysAfterDays(
      { custom: group.customSettings, refreshQuickBuysAfterDays: group.refreshQuickBuysAfterDays },
      { refreshQuickBuysAfterDays: group.platform.facebookDefaults?.refreshQuickBuysAfterDays ?? null }
    );
    if (days !== null) facebookGroups.set(group.id, days);
  }
  return {
    platforms: new Map(platforms.map((p) => [p.id, p.refreshQuickBuysAfterDays!])),
    facebookGroups,
  };
}

/** The threshold one offer is held to: its group's on Facebook, its platform's elsewhere. */
export function refreshThresholdFor(
  thresholds: RefreshThresholds,
  offer: { platformId: string; facebookGroupId: string | null }
): number | null {
  if (offer.facebookGroupId !== null) return thresholds.facebookGroups.get(offer.facebookGroupId) ?? null;
  return thresholds.platforms.get(offer.platformId) ?? null;
}

/** Posted at or before `cutoff`: the later of the listing date and the last repost is, and at least
 *  one of them is known — `lastPostedOn`'s reading, asked of the database. */
function postedBy(cutoff: Date): Prisma.OfferWhereInput {
  return {
    AND: [
      { OR: [{ listingDate: null }, { listingDate: { lte: cutoff } }] },
      { OR: [{ lastPostedAt: null }, { lastPostedAt: { lte: cutoff } }] },
      { OR: [{ listingDate: { not: null } }, { lastPostedAt: { not: null } }] },
    ],
  };
}

/**
 * The `where` for an active quick buy past its threshold — the *Needs refresh* filter. One clause
 * per platform and per group stating one, since each counts against its own; a collection stating
 * none matches nothing.
 */
export function needsRefreshWhere(thresholds: RefreshThresholds, now: Date): Prisma.OfferWhereInput {
  const clauses: Prisma.OfferWhereInput[] = [
    ...[...thresholds.platforms].map(([platformId, days]) => ({
      platformId,
      facebookGroupId: null,
      ...postedBy(refreshCutoff(days, now)),
    })),
    ...[...thresholds.facebookGroups].map(([facebookGroupId, days]) => ({
      facebookGroupId,
      ...postedBy(refreshCutoff(days, now)),
    })),
  ];
  if (clauses.length === 0) return { id: { in: [] } };
  return { state: "active", listingType: "fixed", OR: clauses };
}
