import "server-only";
import { prisma } from "./db";
import { readKitLots } from "./facebook-auctions";
import {
  applyPostPhotoSettingsPatch,
  isEmptyPostPhotoSettingsPatch,
  samePhotoConfig,
  sharedPhotoSettings,
  type PostPhotoSettingsPatch,
  type SharedPhotoSettings,
} from "./facebook-post-photo-settings-rules";
import {
  facebookLotOrderRefusal,
  facebookTitleWithWords,
  isFacebookLotPosted,
  type FacebookTitleEdge,
  type FacebookTitleWordsMode,
} from "./facebook-post-rules";
import type { LotGroup } from "./offer-lot-group-rules";
import { OFFER_PHOTO_CONFIG_SELECT, offerPhotoConfigFromRow, type PlatformPhotoLimits } from "./offer-photo-config";
import type { OfferState } from "./offer-rules";
import {
  OfferActionBlockedError,
  patchOffer,
  regenerateOfferText,
  regenerateOfferTitleAndDescription,
  syncGeneratedTexts,
  updateOfferPhotoConfig,
  type OfferBlockReason,
} from "./offers";
import { DIRECT_PLATFORM_MODULE } from "./platform-modules";
import { proposalLotsRefusal, proposalStatusOf } from "./proposal-rules";

// The tools a group of lots is worked on with from its screen (#2313) — a Facebook post's lots, or a
// proposal's: every lot's photo settings in one dialog (#2032), their texts regenerated (#1983), their
// titles from one template or with the same words on or off (#2033), and their order (#1986). One
// implementation, told which group: the post's screen grew them first, and a proposal is the same
// thing for one buyer. Each lot is an ordinary offer keeping its own settings and texts, written
// exactly as its own screen writes them; the group holds nothing of its own.
//
// A group is worked on only while it may change: a post until it is up — its photos, text and order
// are then what was posted (#1800) — and a proposal while it is Preparing — once sent it stays as the
// buyer saw it until it is reopened (#2307). Pure rules in `offer-lot-group-rules.ts`.

/** A group's lots as the tools read them, in lot order, once the group is known to be the owner's. */
export interface LotGroupScope {
  group: LotGroup;
  collectionId: string;
  /** The platform the group's lots are offered on — whose title template the lots fall back to. */
  platformId: string | null;
  lots: { id: string; state: OfferState; nameEdited: boolean }[];
}

const LOT_SELECT = { id: true, state: true, nameEdited: true } as const;

/** What each refusal is filed under: the post's lots are refused as Facebook's, a proposal's as any
 *  other offer's that is not eligible. */
function blockReason(group: LotGroup): OfferBlockReason {
  return group.kind === "post" ? "facebook-group" : "not-eligible";
}

/**
 * The group's lots, in lot order, refused when the group is not the owner's — *Post not found.*,
 * *Proposal not found.* — and when it may no longer change: a post with a lot up, with `postUp` (what
 * is kept as posted differs by tool), and a proposal no longer Preparing.
 */
export async function readLotGroup(ownerId: string, group: LotGroup, postUp: string): Promise<LotGroupScope> {
  if (group.kind === "post") {
    const post = await prisma.facebookPost.findUnique({
      where: { id: group.id },
      select: { collectionId: true, collection: { select: { ownerId: true } }, group: { select: { platformId: true } } },
    });
    if (!post || post.collection.ownerId !== ownerId) throw new Error("Post not found.");
    const lots = await prisma.offer.findMany({
      where: { facebookPostId: group.id },
      select: LOT_SELECT,
      orderBy: { facebookLotNo: "asc" },
    });
    if (lots.some((l) => isFacebookLotPosted(l.state))) throw new OfferActionBlockedError("facebook-group", postUp);
    return {
      group,
      collectionId: post.collectionId,
      platformId: post.group.platformId,
      lots: lots.map((l) => ({ ...l, state: l.state as OfferState })),
    };
  }
  const proposal = await prisma.proposal.findUnique({
    where: { id: group.id },
    select: { collectionId: true, status: true, collection: { select: { ownerId: true } } },
  });
  if (!proposal || proposal.collection.ownerId !== ownerId) throw new Error("Proposal not found.");
  const refusal = proposalLotsRefusal(proposalStatusOf(proposal.status));
  if (refusal) throw new OfferActionBlockedError("not-eligible", refusal);
  const [lots, direct] = await Promise.all([
    prisma.offer.findMany({
      where: { proposalId: group.id },
      select: LOT_SELECT,
      orderBy: [{ proposalLotNo: "asc" }, { offerNo: "asc" }],
    }),
    prisma.platform.findFirst({
      where: { collectionId: proposal.collectionId, platformModule: DIRECT_PLATFORM_MODULE },
      select: { id: true },
    }),
  ]);
  return {
    group,
    collectionId: proposal.collectionId,
    platformId: direct?.id ?? null,
    lots: lots.map((l) => ({ ...l, state: l.state as OfferState })),
  };
}

// ── Photo settings (#2032) ──────────────────────────────────────────────────────────────────────

/** What the group's *Photo settings…* dialog opens on. */
export interface LotGroupPhotoSettings {
  lotCount: number;
  settings: SharedPhotoSettings;
  /** The lots' platform — one for every lot of a group — whose limits and cover rule the dialog states. */
  platformName: string;
  platformCoverSymbols: boolean;
  limits: PlatformPhotoLimits;
}

const PHOTOS_POSTED = "The post is up, so its photos stay as they were posted.";

async function readPhotoLots(ownerId: string, group: LotGroup) {
  const scope = await readLotGroup(ownerId, group, PHOTOS_POSTED);
  if (scope.lots.length === 0) {
    throw new OfferActionBlockedError(blockReason(group), group.kind === "post" ? "Post not found." : "The proposal has no lots yet.");
  }
  const rows = await prisma.offer.findMany({
    where: { id: { in: scope.lots.map((l) => l.id) } },
    select: {
      id: true,
      ...OFFER_PHOTO_CONFIG_SELECT,
      platform: {
        select: { name: true, coverSymbols: true, maxPhotos: true, maxPhotoEdge: true, maxPhotoFileSizeMib: true },
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return scope.lots.flatMap((l) => byId.get(l.id) ?? []);
}

/** Every lot's photo settings, as one dialog shows them: shared, or differing by lot. */
export async function getLotGroupPhotoSettings(ownerId: string, group: LotGroup): Promise<LotGroupPhotoSettings> {
  const lots = await readPhotoLots(ownerId, group);
  const { platform } = lots[0];
  return {
    lotCount: lots.length,
    settings: sharedPhotoSettings(lots.map(offerPhotoConfigFromRow)),
    platformName: platform.name,
    platformCoverSymbols: platform.coverSymbols,
    limits: {
      maxPhotos: platform.maxPhotos,
      maxPhotoEdge: platform.maxPhotoEdge,
      maxPhotoFileSizeMib: platform.maxPhotoFileSizeMib,
    },
  };
}

/**
 * Write the changed settings to every lot of the group. A lot the patch leaves as it was is not
 * written. Answers the lots whose settings changed, in lot order — the ones whose photos are now out
 * of date, and so the ones *Regenerate photos after saving* goes through.
 */
export async function updateLotGroupPhotoSettings(
  ownerId: string,
  group: LotGroup,
  patch: PostPhotoSettingsPatch
): Promise<string[]> {
  const lots = await readPhotoLots(ownerId, group);
  if (isEmptyPostPhotoSettingsPatch(patch)) return [];
  const changed: string[] = [];
  for (const lot of lots) {
    const before = offerPhotoConfigFromRow(lot);
    const after = applyPostPhotoSettingsPatch(before, patch);
    if (samePhotoConfig(before, after)) continue;
    await updateOfferPhotoConfig(ownerId, lot.id, after);
    changed.push(lot.id);
  }
  return changed;
}

// ── Texts and titles (#1983, #2033) ─────────────────────────────────────────────────────────────

const TEXT_POSTED = "The post is up, so its text stays as it was posted.";

/**
 * *Regenerate lot texts* (#1983): the given lots' titles and descriptions rendered again from their
 * templates, in lot order — the twenty round trips of each offer's own ↻ in one. A lot in `overwrite`
 * is regenerated as ↻ does, its hand-written text replaced (the collector ticked it); any other is
 * brought back in step by `syncGeneratedTexts`, which keeps hand-written words. Only the group's own
 * lots. Answers how many lots were gone through.
 */
export async function regenerateLotGroupTexts(
  ownerId: string,
  group: LotGroup,
  offerIds: readonly string[],
  overwrite: readonly string[]
): Promise<number> {
  const { lots } = await readLotGroup(ownerId, group, TEXT_POSTED);
  const own = new Set(lots.map((l) => l.id));
  if (offerIds.some((id) => !own.has(id)) || overwrite.some((id) => !own.has(id))) {
    throw new OfferActionBlockedError(blockReason(group), `Only this ${group.kind}'s own lots can be regenerated here.`);
  }
  const asked = new Set(offerIds);
  const replace = new Set(overwrite);
  const chosen = lots.filter((l) => asked.has(l.id) || replace.has(l.id));
  for (const lot of chosen) {
    if (replace.has(lot.id)) await regenerateOfferTitleAndDescription(ownerId, lot.id);
    else await syncGeneratedTexts(ownerId, lot.id, ["name", "description"]);
  }
  return chosen.length;
}

/**
 * *Title template for all lots…* (#2033): `template` becomes every lot's own title template — preferred
 * over the platform's wherever a title is rendered (#774) — and the titles are regenerated from it, as
 * each offer's ↻ does. A lot whose title was written by hand is given the template too but keeps its
 * words unless it is in `overwrite` (the collector ticked it). Nothing is kept on the group itself, so
 * a lot added later keeps its own title. Refused blank — a blank own template would render no title —
 * and for an offer that is not the group's lot. Answers how many titles were regenerated.
 */
export async function setLotGroupTitleTemplate(
  ownerId: string,
  group: LotGroup,
  template: string,
  overwrite: readonly string[]
): Promise<number> {
  const { lots } = await readLotGroup(ownerId, group, TEXT_POSTED);
  const text = template.trim();
  if (!text) throw new OfferActionBlockedError(blockReason(group), "Write a title template for the lots.");
  const own = new Set(lots.map((l) => l.id));
  if (overwrite.some((id) => !own.has(id))) {
    throw new OfferActionBlockedError(blockReason(group), `Only this ${group.kind}'s own lots can be retitled here.`);
  }
  const replace = new Set(overwrite);
  await prisma.offer.updateMany({ where: { id: { in: [...own] } }, data: { nameTemplate: text } });
  let count = 0;
  for (const lot of lots) {
    if (lot.nameEdited && !replace.has(lot.id)) continue;
    await regenerateOfferText(ownerId, lot.id, "name");
    count += 1;
  }
  return count;
}

/**
 * *Add to titles…* / *Remove from titles…* (#2033): `words` added at, or removed from, the `edge` of
 * every lot's title, hand-written ones included (`facebookTitleWithWords`). A title changed is written
 * as by hand, as an edit on the offer's screen is — it no longer follows its template. Refused for
 * blank words. Answers how many titles changed.
 */
export async function changeLotGroupTitleWords(
  ownerId: string,
  group: LotGroup,
  words: string,
  edge: FacebookTitleEdge,
  mode: FacebookTitleWordsMode
): Promise<number> {
  const { collectionId, lots } = await readLotGroup(ownerId, group, TEXT_POSTED);
  if (!words.trim()) {
    throw new OfferActionBlockedError(blockReason(group), mode === "add" ? "Write the words to add." : "Write the words to remove.");
  }
  // The titles as the group's screen shows them — a lot with no title of its own reads its derived one.
  const titled = await readKitLots(collectionId, { id: { in: lots.map((l) => l.id) } });
  const byId = new Map(titled.map((l) => [l.offerId, l.title]));
  let count = 0;
  for (const lot of lots) {
    const title = byId.get(lot.id);
    if (title === undefined) continue;
    const next = facebookTitleWithWords(title, words, edge, mode);
    if (next === null || next === title) continue;
    await patchOffer(ownerId, lot.id, { name: next });
    count += 1;
  }
  return count;
}

/** The lots' titles as *Title template for all lots…* sees them (#2033). */
export interface LotGroupTitles {
  /** The template the dialog opens on: the lots' own title template when they all share one — the one
   *  given to the group before — else the platform's. Empty when neither has one. */
  template: string;
  /** The lots whose title was written by hand (`nameEdited`), by offer id, in lot order. */
  handWritten: string[];
}

/** What *Title template for all lots…* works from, for the lots `offerIds` in lot order. */
export async function readLotGroupTitles(
  collectionId: string,
  platformId: string | null,
  offerIds: readonly string[]
): Promise<LotGroupTitles> {
  const [offers, platform] = await Promise.all([
    prisma.offer.findMany({
      where: { id: { in: [...offerIds] }, collectionId },
      select: { id: true, nameTemplate: true, nameEdited: true },
    }),
    platformId ? prisma.platform.findUnique({ where: { id: platformId }, select: { titleTemplate: true } }) : null,
  ]);
  const own = new Set(offers.map((o) => o.nameTemplate));
  const shared = own.size === 1 ? [...own][0] : null;
  const edited = new Set(offers.filter((o) => o.nameEdited).map((o) => o.id));
  return {
    template: shared?.trim() ? shared : (platform?.titleTemplate ?? ""),
    handWritten: offerIds.filter((id) => edited.has(id)),
  };
}

// ── Order (#1986) ───────────────────────────────────────────────────────────────────────────────

/**
 * Put the group's lots in a new order — dragged on its screen, or sorted by catalogue number or
 * price. The lot numbers are the order, so whatever is numbered by them follows at once. An order
 * naming a lot the group no longer holds, or missing one, is refused as stale.
 */
export async function reorderLotGroup(ownerId: string, group: LotGroup, offerIds: readonly string[]): Promise<void> {
  const { lots } = await readLotGroup(ownerId, group, "The post is up, so its lots stay in the order they were posted.");
  const refusal = facebookLotOrderRefusal(
    lots.map((l) => l.id),
    offerIds
  );
  if (refusal) throw new OfferActionBlockedError(blockReason(group), refusal);
  const number = (n: number) => (group.kind === "post" ? { facebookLotNo: n } : { proposalLotNo: n });
  // Renumbered in two passes, as `detachFacebookLot` does: the unique (group, lot) index would refuse a
  // lot moved onto a number another has not left yet.
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of offerIds.entries()) {
      await tx.offer.update({ where: { id }, data: number(-1 - index) });
    }
    for (const [index, id] of offerIds.entries()) {
      await tx.offer.update({ where: { id }, data: number(index + 1) });
    }
  });
}

// ── What a lot's row shows ──────────────────────────────────────────────────────────────────────

/** The sales each lot left on, keyed by offer id — a lot sold on none is absent, and several only when
 *  its sets were sold apart. */
export async function readLotSales(offerIds: readonly string[]): Promise<Record<string, { id: string; saleNo: number }[]>> {
  if (offerIds.length === 0) return {};
  const lines = await prisma.saleLine.findMany({
    where: { offerId: { in: [...offerIds] } },
    select: { offerId: true, sale: { select: { id: true, saleNo: true } } },
    orderBy: { sale: { saleNo: "asc" } },
  });
  const sales: Record<string, { id: string; saleNo: number }[]> = {};
  for (const line of lines) {
    if (!line.offerId) continue;
    const list = (sales[line.offerId] ??= []);
    if (!list.some((s) => s.id === line.sale.id)) list.push(line.sale);
  }
  return sales;
}

/** Each lot's first copy's front photo, keyed by offer id — what its row shows while the lot has no
 *  photo of its own yet, so its stamps are always in view (#2313). A lot none of whose copies has a
 *  front photo is absent. */
export async function readLotCopyPhotos(
  collectionId: string,
  offerIds: readonly string[]
): Promise<Record<string, string>> {
  if (offerIds.length === 0) return {};
  const offers = await prisma.offer.findMany({
    where: { id: { in: [...offerIds] }, collectionId },
    select: {
      id: true,
      sets: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          items: {
            orderBy: [{ sortOrder: "asc" }, { itemId: "asc" }],
            select: {
              item: { select: { photos: { where: { role: "front" }, select: { id: true }, orderBy: { sortOrder: "asc" }, take: 1 } } },
            },
          },
        },
      },
    },
  });
  const photos: Record<string, string> = {};
  for (const offer of offers) {
    const photo = offer.sets.flatMap((s) => s.items).find((i) => i.item.photos.length > 0)?.item.photos[0];
    if (photo) photos[offer.id] = photo.id;
  }
  return photos;
}
