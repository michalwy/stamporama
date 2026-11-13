import "server-only";
import { prisma } from "./db";
import {
  isCollectionPath,
  isSidebarPinKind,
  type SidebarPinData,
  type SidebarPinKind,
  type SidebarPinRecordKind,
} from "./sidebar-pin-rules";

// The Pinned section of the sidebar (#2504) — the database half. Pins belong to the collection and
// live on the server, so the same entries are pinned on every device. What can be pinned and how a
// drag reorders them is `sidebar-pin-rules.ts`.
//
// **A deleted record leaves Pinned by itself.** A pin names its record by id with no foreign key —
// the six kinds are six tables — so reading the pins asks which of the pinned records are still in
// the collection and leaves the rest out. A record that is only *closed* (a sold offer, a completed
// purchase) is still there and stays pinned until it is unpinned.

export class SidebarPinInvalidError extends Error {}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** The ids among `ids` of records of `kind` that are in the collection. */
async function existingIds(
  collectionId: string,
  kind: SidebarPinRecordKind,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const where = { collectionId, id: { in: ids } };
  const select = { id: true } as const;
  let rows: { id: string }[];
  switch (kind) {
    case "purchase":
      rows = await prisma.purchase.findMany({ where, select });
      break;
    case "offer":
      rows = await prisma.offer.findMany({ where, select });
      break;
    case "post":
      rows = await prisma.facebookPost.findMany({ where, select });
      break;
    case "sale":
      rows = await prisma.sale.findMany({ where, select });
      break;
    case "issue":
      rows = await prisma.issue.findMany({ where, select });
      break;
    case "contact":
      rows = await prisma.contact.findMany({ where, select });
      break;
  }
  return new Set(rows.map((r) => r.id));
}

/** The collection's pins in the order dragged into, without any whose record has been deleted. */
export async function listSidebarPins(
  ownerId: string,
  collectionId: string
): Promise<SidebarPinData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.sidebarPin.findMany({
    where: { collectionId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, kind: true, target: true, href: true, label: true },
  });

  const idsByKind = new Map<SidebarPinRecordKind, string[]>();
  for (const row of rows) {
    if (row.kind === "screen" || !isSidebarPinKind(row.kind)) continue;
    const kind = row.kind as SidebarPinRecordKind;
    idsByKind.set(kind, [...(idsByKind.get(kind) ?? []), row.target]);
  }
  const alive = new Map<SidebarPinRecordKind, Set<string>>();
  await Promise.all(
    [...idsByKind].map(async ([kind, ids]) => {
      alive.set(kind, await existingIds(collectionId, kind, ids));
    })
  );

  const pins: SidebarPinData[] = [];
  for (const row of rows) {
    if (!isSidebarPinKind(row.kind)) continue;
    if (row.kind !== "screen" && !alive.get(row.kind)?.has(row.target)) continue;
    pins.push({ id: row.id, kind: row.kind, target: row.target, href: row.href, label: row.label });
  }
  return pins;
}

export interface SidebarPinInput {
  kind: string;
  target: string;
  href: string;
  /** A record's name; ignored for a screen. */
  label?: string | null;
}

/** The pin checked and normalised, or an error saying what is wrong with it. */
async function checkedPin(collectionId: string, input: SidebarPinInput) {
  const { kind, target, href } = input;
  if (!isSidebarPinKind(kind)) throw new SidebarPinInvalidError("This cannot be pinned.");
  if (!isCollectionPath(href)) throw new SidebarPinInvalidError("Not an address in this collection.");
  if (kind === "screen") {
    if (target !== href) throw new SidebarPinInvalidError("A screen is pinned by its own address.");
    return { kind: kind as SidebarPinKind, target, href, label: null };
  }
  const label = input.label?.trim() ?? "";
  if (!label) throw new SidebarPinInvalidError("A pinned record needs a name.");
  const found = await existingIds(collectionId, kind, [target]);
  if (!found.has(target)) throw new SidebarPinInvalidError("That record is not in this collection.");
  return { kind: kind as SidebarPinKind, target, href, label };
}

/**
 * Pin a screen or a record, last in the order. Pinning what is already pinned keeps its place and
 * takes the address and name given, which is how a renamed record's pin catches up.
 */
export async function pinToSidebar(
  ownerId: string,
  collectionId: string,
  input: SidebarPinInput
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  const pin = await checkedPin(collectionId, input);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.sidebarPin.findUnique({
      where: { collectionId_kind_target: { collectionId, kind: pin.kind, target: pin.target } },
      select: { id: true },
    });
    if (existing) {
      await tx.sidebarPin.update({
        where: { id: existing.id },
        data: { href: pin.href, label: pin.label },
      });
      return existing;
    }
    const last = await tx.sidebarPin.aggregate({ where: { collectionId }, _max: { position: true } });
    return tx.sidebarPin.create({
      data: { collectionId, ...pin, position: (last._max.position ?? -1) + 1 },
      select: { id: true },
    });
  });
}

/**
 * Bring a pinned record's name and address up to date with its screen — called by the screen when
 * the two differ. Does nothing for a record that is not pinned.
 */
export async function refreshSidebarPin(
  ownerId: string,
  collectionId: string,
  input: SidebarPinInput
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const pin = await checkedPin(collectionId, input);
  await prisma.sidebarPin.updateMany({
    where: { collectionId, kind: pin.kind, target: pin.target },
    data: { href: pin.href, label: pin.label },
  });
}

export async function unpinFromSidebar(
  ownerId: string,
  collectionId: string,
  kind: string,
  target: string
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.sidebarPin.deleteMany({ where: { collectionId, kind, target } });
}

/**
 * Lay the pins out in the order given, by id. Ids not among the collection's pins are ignored, and a
 * pin missing from the list keeps its place after the ones named.
 */
export async function reorderSidebarPins(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.sidebarPin.findMany({
    where: { collectionId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const known = new Set(rows.map((r) => r.id));
  const named = orderedIds.filter((id, i) => known.has(id) && orderedIds.indexOf(id) === i);
  const rest = rows.map((r) => r.id).filter((id) => !named.includes(id));
  const order = [...named, ...rest];
  await prisma.$transaction(
    order.map((id, position) => prisma.sidebarPin.update({ where: { id }, data: { position } }))
  );
}
