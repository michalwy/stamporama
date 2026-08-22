import "server-only";
import { prisma } from "./db";
import { assertTradeOwner } from "./trade-access";
import { isTradeSide, type TradeSide } from "./trade-rules";

// The Colnect lists an exchange is about (#645).
//
// A Colnect trade *is* two lists: the partner exports what they want out of this collection, the
// collector exports what they want back, and both go on living on Colnect while the trade is
// negotiated here. So the link is part of the agreement rather than a note about it — it is what
// either side opens to check a row, and it is most needed on the **partner's** page (#640), because
// the partner is reading a list of stamps they wrote themselves and otherwise has no way back to
// their own copy of it.
//
// Deliberately **not** an import record. Nothing here remembers which lines came out of which file:
// a line is a promise about a copy and stands on its own, and a provenance column would be a second
// story about it that nothing keeps true. What a collector needs is the address of the list, and
// that is what this is — kept whether or not anything was ever imported from it, and kept after a
// list is imported twice.
//
// **Not gated by status**, unlike the lines and the sections. `assertContentEditable` guards the
// *contents* of a list the partner is holding a copy of; an address is not contents. Adding the
// partner's own list to a trade already shared is precisely when it is most useful — it puts the
// link on the page they are reading — and taking a dead one off a closed trade changes nothing that
// was agreed. This is `updateTrade`'s rule (the header, the notes, the terms), not
// `addTradeGiveLines`'s.

/** One list, as both screens draw it. */
export interface TradeColnectListData {
  id: string;
  url: string;
  /** What to call it. Blank renders as the bare link rather than as an invented name. */
  label: string;
  side: TradeSide;
  position: number;
}

/** What adding or renaming one states. */
export interface TradeColnectListInput {
  url: string;
  label?: string;
  side: TradeSide;
}

const LIST_SELECT = {
  id: true,
  url: true,
  label: true,
  side: true,
  position: true,
} as const;

function toData(row: {
  id: string;
  url: string;
  label: string;
  side: string;
  position: number;
}): TradeColnectListData {
  return {
    id: row.id,
    url: row.url,
    label: row.label,
    // A row can only have been written through this module, so the column is always one of the two;
    // the fallback is what keeps the type honest rather than a case anybody can reach.
    side: isTradeSide(row.side) ? row.side : "give",
    position: row.position,
  };
}

/**
 * A URL the app is willing to keep and put in front of a partner.
 *
 * `http`/`https` only, and nothing else about it is judged: a Colnect list lives under several
 * hosts and paths (`/en/stamps/list/custom_list__18/…`, a wantlist, a collection view), and refusing
 * one because it did not match a pattern would be refusing the collector's own list. What is refused
 * is a scheme a browser would not follow safely — `javascript:` above all, on a page the partner
 * opens.
 */
function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("A link is required.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("That is not a link — paste the address of the list on Colnect.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("A link has to be http or https.");
  }
  return parsed.toString();
}

/** Every list on a trade, in the order the collector put them. */
export async function listTradeColnectLists(
  ownerId: string,
  tradeId: string
): Promise<TradeColnectListData[]> {
  await assertTradeOwner(ownerId, tradeId);
  const rows = await prisma.tradeColnectList.findMany({
    where: { tradeId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: LIST_SELECT,
  });
  return rows.map(toData);
}

/** What the partner's page needs: the same rows, read without an owner because the token is the
 *  authorization (#640). The caller has already resolved the token to this trade. */
export async function readTradeColnectListsForShare(
  tradeId: string
): Promise<TradeColnectListData[]> {
  const rows = await prisma.tradeColnectList.findMany({
    where: { tradeId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: LIST_SELECT,
  });
  return rows.map(toData);
}

/**
 * Add a list, appended after the ones already there.
 *
 * The same URL twice is the same list, so it is **updated rather than duplicated** — the import
 * offers the file's own list every time it reads one, and a collector who imports two sections off
 * one file should end up with one link, not two identical ones.
 */
export async function addTradeColnectList(
  ownerId: string,
  tradeId: string,
  input: TradeColnectListInput
): Promise<TradeColnectListData> {
  await assertTradeOwner(ownerId, tradeId);
  const url = normalizeUrl(input.url);
  const label = (input.label ?? "").trim();

  const existing = await prisma.tradeColnectList.findUnique({
    where: { tradeId_url: { tradeId, url } },
    select: LIST_SELECT,
  });
  if (existing) {
    // Keep the name it already carries where the caller offers none: an import proposing a blank
    // must not wipe a name the collector typed.
    const updated = await prisma.tradeColnectList.update({
      where: { id: existing.id },
      data: { label: label || existing.label, side: input.side },
      select: LIST_SELECT,
    });
    return toData(updated);
  }

  const last = await prisma.tradeColnectList.findFirst({
    where: { tradeId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const created = await prisma.tradeColnectList.create({
    data: {
      tradeId,
      url,
      label,
      side: input.side,
      position: (last?.position ?? -1) + 1,
    },
    select: LIST_SELECT,
  });
  return toData(created);
}

/** Restate a list — its address, its name or which side it belongs to. */
export async function updateTradeColnectList(
  ownerId: string,
  listId: string,
  input: TradeColnectListInput
): Promise<TradeColnectListData> {
  const { tradeId } = await assertColnectListOwner(ownerId, listId);
  const url = normalizeUrl(input.url);
  const clash = await prisma.tradeColnectList.findUnique({
    where: { tradeId_url: { tradeId, url } },
    select: { id: true },
  });
  if (clash && clash.id !== listId) throw new Error("That list is already on this trade.");

  const updated = await prisma.tradeColnectList.update({
    where: { id: listId },
    data: { url, label: (input.label ?? "").trim(), side: input.side },
    select: LIST_SELECT,
  });
  return toData(updated);
}

/** Take a list off the trade. Nothing hangs off it, so nothing is guarded. */
export async function deleteTradeColnectList(ownerId: string, listId: string): Promise<void> {
  await assertColnectListOwner(ownerId, listId);
  await prisma.tradeColnectList.delete({ where: { id: listId } });
}

/** Hand-ordered, dragged rather than typed — the sections' idiom. Ids not on the trade are ignored. */
export async function reorderTradeColnectLists(
  ownerId: string,
  tradeId: string,
  orderedIds: readonly string[]
): Promise<void> {
  await assertTradeOwner(ownerId, tradeId);
  const rows = await prisma.tradeColnectList.findMany({
    where: { tradeId },
    select: { id: true },
  });
  const mine = new Set(rows.map((row) => row.id));
  const ordered = orderedIds.filter((id) => mine.has(id));
  await prisma.$transaction(
    ordered.map((id, index) =>
      prisma.tradeColnectList.update({ where: { id }, data: { position: index } })
    )
  );
}

/** Whose trade a list is on. The same shape the other guards return, for the same reason. */
async function assertColnectListOwner(
  ownerId: string,
  listId: string
): Promise<{ tradeId: string }> {
  const row = await prisma.tradeColnectList.findUnique({
    where: { id: listId },
    select: { tradeId: true, trade: { select: { collection: { select: { ownerId: true } } } } },
  });
  if (!row || row.trade.collection.ownerId !== ownerId) {
    throw new Error("Colnect list not found or access denied.");
  }
  return { tradeId: row.tradeId };
}
