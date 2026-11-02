import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { listItemsPaginated, type ItemListItem } from "./items";
import { OPEN_OFFER_STATES } from "./offer-rules";
import { LISTABLE_DELIVERY_STATES } from "./delivery-state";
import { NOT_TRADED_AWAY } from "./trade-exit";
import { assertCollectionOwner } from "./platform-category";
import { markListingContentChanged } from "./offer-listing-sync";
import { syncGeneratedTexts } from "./offers";
import { isProposalOpen, proposalStatusOf } from "./proposal-rules";
import { formatItemNo } from "./item-number";
import {
  assignTwins,
  twinDifference,
  twinKey,
  type ListedElsewhereCopy,
  type TwinCopy,
} from "./listed-elsewhere-rules";

// The read behind the *listed elsewhere* note (#2339), and the swap *Convert to sale…* makes with it.
// The rule — which twin, and how a difference is worded — is `listed-elsewhere-rules.ts`.

/** A copy listed elsewhere, with its twin's row for the dialogs that draw the copies they make. */
export interface ListedElsewhereEntry extends ListedElsewhereCopy {
  /** The twin as the Copies list's own row reads it, so a swap can put it in the dialog's list. */
  twinRow: ItemListItem | null;
}

/** The entry without its row, for a reader that swaps on the server. */
export function withoutTwinRow(entry: ListedElsewhereEntry): ListedElsewhereCopy {
  return { itemId: entry.itemId, itemNo: entry.itemNo, offers: entry.offers, twin: entry.twin };
}

const TWIN_SELECT = {
  id: true,
  itemNo: true,
  stampId: true,
  conditionId: true,
  formatId: true,
  certificateStatusId: true,
  stampCount: true,
  faults: { select: { faultId: true } },
  _count: { select: { candidates: true } },
} as const;

type TwinRow = Prisma.ItemGetPayload<{ select: typeof TWIN_SELECT }>;

function twinCopy(row: TwinRow): TwinCopy {
  return {
    itemId: row.id,
    stampId: row.stampId,
    conditionId: row.conditionId,
    formatId: row.formatId,
    certificateStatusId: row.certificateStatusId,
    faultIds: row.faults.map((fault) => fault.faultId),
    // A piece of several stamps, or a copy that might be one of several stamps, is not one stamp.
    twinnable: row.stampCount <= 1 && row._count.candidates === 0,
  };
}

/** A copy that is in no open offer — on any platform. */
const IN_NO_OPEN_OFFER: Prisma.ItemWhereInput = {
  offerSetMemberships: { none: { offerSet: { offer: { state: { in: [...OPEN_OFFER_STATES] } } } } },
};

/**
 * What may stand in for a listed copy: held and for sale, still the collector's, in no open offer, and
 * — when the offer's platform is known — not set aside as never to be listed there (#506).
 */
function twinPoolWhere(collectionId: string, platformId: string | null): Prisma.ItemWhereInput {
  return {
    collectionId,
    forSale: true,
    disposedAt: null,
    deliveryState: { in: [...LISTABLE_DELIVERY_STATES] },
    saleLineItems: { none: {} },
    ...NOT_TRADED_AWAY,
    ...IN_NO_OPEN_OFFER,
    ...(platformId ? { platformExclusions: { none: { platformId } } } : {}),
  };
}

/** The Copies list's own order (*Added*, oldest first), which picks among several twins. */
const COPY_LIST_ORDER: Prisma.ItemOrderByWithRelationInput[] = [
  { createdAt: "asc" },
  { stamp: { primaryCatalogSortKey: { sort: "asc", nulls: "last" } } },
  { itemNo: "asc" },
  { id: "asc" },
];

/**
 * The copies among `itemIds` that are already in an open offer — other than `exceptOfferIds`, the
 * offers being made or sold — each with those offers and a twin listed nowhere where there is one, in
 * the order asked. Every copy in `itemIds` is what is being made, so none of them is ever a twin.
 */
export async function readListedElsewhere(
  ownerId: string,
  collectionId: string,
  itemIds: readonly string[],
  opts: { exceptOfferIds?: readonly string[]; platformId?: string | null } = {}
): Promise<ListedElsewhereEntry[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const asked = [...new Set(itemIds)];
  if (asked.length === 0) return [];
  const except = [...(opts.exceptOfferIds ?? [])];

  const memberships = await prisma.offerSetItem.findMany({
    where: {
      itemId: { in: asked },
      offerSet: {
        offer: {
          collectionId,
          state: { in: [...OPEN_OFFER_STATES] },
          ...(except.length > 0 ? { id: { notIn: except } } : {}),
        },
      },
    },
    select: {
      itemId: true,
      offerSet: { select: { offer: { select: { id: true, offerNo: true, platform: { select: { name: true } } } } } },
    },
  });
  if (memberships.length === 0) return [];
  const offersOf = new Map<string, Map<string, { offerId: string; offerNo: number; platformName: string }>>();
  for (const row of memberships) {
    const offer = row.offerSet.offer;
    const offers = offersOf.get(row.itemId) ?? new Map();
    offers.set(offer.id, { offerId: offer.id, offerNo: offer.offerNo, platformName: offer.platform.name });
    offersOf.set(row.itemId, offers);
  }

  const listedRows = await prisma.item.findMany({
    where: { collectionId, id: { in: [...offersOf.keys()] } },
    select: TWIN_SELECT,
  });
  const listedById = new Map(listedRows.map((row) => [row.id, row]));
  const listed = asked.flatMap((id) => (listedById.has(id) ? [twinCopy(listedById.get(id)!)] : []));
  const wanted = listed.filter((copy) => copy.twinnable);

  const candidateRows =
    wanted.length === 0
      ? []
      : await prisma.item.findMany({
          where: {
            ...twinPoolWhere(collectionId, opts.platformId ?? null),
            id: { notIn: asked },
            stampId: { in: [...new Set(wanted.map((copy) => copy.stampId))] },
            conditionId: { in: [...new Set(wanted.map((copy) => copy.conditionId))] },
          },
          orderBy: COPY_LIST_ORDER,
          select: TWIN_SELECT,
        });
  const candidateById = new Map(candidateRows.map((row) => [row.id, row]));
  const twins = assignTwins(listed, candidateRows.map(twinCopy));

  const twinIds = [...twins.values()].map((twin) => twin.itemId);
  const certificateIds = new Set<string>();
  const faultIds = new Set<string>();
  for (const copy of [...listed, ...twins.values()]) {
    if (copy.certificateStatusId) certificateIds.add(copy.certificateStatusId);
    for (const id of copy.faultIds) faultIds.add(id);
  }
  const [certificates, faults, twinRows] = await Promise.all([
    certificateIds.size === 0
      ? []
      : prisma.certificateStatus.findMany({ where: { collectionId, id: { in: [...certificateIds] } }, select: { id: true, name: true } }),
    faultIds.size === 0
      ? []
      : prisma.fault.findMany({ where: { collectionId, id: { in: [...faultIds] } }, select: { id: true, name: true } }),
    twinIds.length === 0
      ? Promise.resolve({ items: [] as ItemListItem[] })
      : listItemsPaginated(ownerId, collectionId, { ids: twinIds, pageSize: twinIds.length }),
  ]);
  const certificateName = new Map(certificates.map((row) => [row.id, row.name]));
  const faultName = new Map(faults.map((row) => [row.id, row.name]));
  const names = {
    certificate: (id: string) => certificateName.get(id) ?? "another certificate",
    fault: (id: string) => faultName.get(id) ?? "another fault",
  };
  const rowById = new Map(twinRows.items.map((row) => [row.id, row]));

  return listed.map((copy): ListedElsewhereEntry => {
    const twin = twins.get(copy.itemId);
    return {
      itemId: copy.itemId,
      itemNo: listedById.get(copy.itemId)!.itemNo,
      offers: [...offersOf.get(copy.itemId)!.values()].sort((a, b) => a.offerNo - b.offerNo),
      twin: twin
        ? {
            itemId: twin.itemId,
            itemNo: candidateById.get(twin.itemId)!.itemNo,
            difference: twinDifference(copy, twin, names),
          }
        : null,
      twinRow: twin ? (rowById.get(twin.itemId) ?? null) : null,
    };
  });
}

/** The copies a proposal's lots hold, for the note on *Convert to sale…* — each lot asked apart, so a
 *  copy is listed elsewhere when it is in any open offer but its own lot. */
export async function readProposalLotsListedElsewhere(
  ownerId: string,
  proposalId: string,
  offerIds: readonly string[]
): Promise<{ offerId: string; copies: ListedElsewhereCopy[] }[]> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { collectionId: true } });
  if (!proposal) throw new Error("Proposal not found.");
  const { collectionId } = proposal;
  await assertCollectionOwner(ownerId, collectionId);
  const lots = await prisma.offer.findMany({
    where: { id: { in: [...offerIds] }, proposalId, state: { in: [...OPEN_OFFER_STATES] } },
    select: {
      id: true,
      platformId: true,
      sets: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { items: { select: { itemId: true } } } },
    },
  });
  const byId = new Map(lots.map((lot) => [lot.id, lot]));
  const result: { offerId: string; copies: ListedElsewhereCopy[] }[] = [];
  for (const offerId of offerIds) {
    const lot = byId.get(offerId);
    if (!lot) continue;
    const entries = await readListedElsewhere(
      ownerId,
      collectionId,
      lot.sets.flatMap((set) => set.items.map((item) => item.itemId)),
      { exceptOfferIds: [lot.id], platformId: lot.platformId }
    );
    // The row is for a dialog that lists copies; this one swaps on the server.
    if (entries.length > 0) result.push({ offerId, copies: entries.map(withoutTwinRow) });
  }
  return result;
}

/**
 * *Swap* on *Convert to sale…* (#2339): the twin takes the listed copy's place in the lot, before the
 * sale is made, so the sale sends the copy listed nowhere and the other offer keeps its own. Asked
 * again here: the proposal still open, the lot one of its open lots holding the copy in a set still
 * unsold, and the twin of the same stamp, condition and format, held, for sale and in no open offer.
 */
export async function swapProposalLotCopy(
  ownerId: string,
  proposalId: string,
  offerId: string,
  fromItemId: string,
  toItemId: string
): Promise<void> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { collectionId: true, status: true },
  });
  if (!proposal) throw new Error("Proposal not found.");
  const { collectionId } = proposal;
  await assertCollectionOwner(ownerId, collectionId);
  if (!isProposalOpen(proposalStatusOf(proposal.status))) {
    throw new Error("The proposal is closed — nothing in it can change.");
  }
  const lot = await prisma.offer.findFirst({
    where: { id: offerId, proposalId, state: { in: [...OPEN_OFFER_STATES] } },
    select: { id: true, offerNo: true, platformId: true },
  });
  if (!lot) throw new Error("That lot is no longer open in the proposal.");

  await prisma.$transaction(async (tx) => {
    const membership = await tx.offerSetItem.findFirst({
      // A set is whole or nothing (`setsToSell`): one copy sold retires it.
      where: { itemId: fromItemId, offerSet: { offerId, items: { none: { item: { saleLineItems: { some: {} } } } } } },
      select: { offerSetId: true, item: { select: TWIN_SELECT } },
    });
    if (!membership) throw new Error("That copy is no longer in an unsold set of the lot.");
    const twin = await tx.item.findFirst({
      where: { ...twinPoolWhere(collectionId, lot.platformId), id: toItemId },
      select: TWIN_SELECT,
    });
    const from = twinCopy(membership.item);
    if (!twin || !from.twinnable || !twinCopy(twin).twinnable || twinKey(twinCopy(twin)) !== twinKey(from)) {
      throw new Error(
        `${twin ? formatItemNo(twin.itemNo) : "That copy"} can no longer stand in for ${formatItemNo(membership.item.itemNo)} — it is listed now, sold or not the same stamp, condition and format.`
      );
    }
    await tx.offerSetItem.update({
      where: { offerSetId_itemId: { offerSetId: membership.offerSetId, itemId: fromItemId } },
      data: { itemId: toItemId },
    });
    await markListingContentChanged(offerId, tx); // #542
  });
  await syncGeneratedTexts(ownerId, offerId); // #380/#365, as in addOfferSet
}
