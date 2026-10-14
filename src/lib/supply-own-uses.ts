import "server-only";
import { prisma, type DbTransaction } from "./db";
import { settleSupplies } from "./supply-settlement";

// Packing supplies taken out of stock **without a sale** (#1900, ADR-0068 §9) — transport cards the
// collector keeps stamps in at home. Stock would otherwise drift above what is really on hand.
//
// An own use is a quantity of one supply, the day it was used and an optional note. Its units leave
// stock FIFO under the same rule as a sale's supply line (`settleSupplies`), each at its batch's unit
// cost, and its cost is charged to no sale and no copy: the Supplies screen states it as a cost of
// its own, by period.
//
// **Taking more than is on hand is refused** — unlike a sale, nothing waits on it. The write and the
// settling run in one transaction, and a use the stock could not cover rolls the whole write back.
// A batch lowered or deleted later can still leave a use short, as it can a sale (the collector's
// call, 2026-10-14); the next purchase then covers it.
//
// All access is collection-owner-scoped; the checks live here, server-side.

export interface SupplyOwnUseInput {
  supplyId: string;
  /** Whole units, at least one. */
  quantity: number;
  /** yyyy-mm-dd. */
  usedOn: string;
  /** What the supplies were used for — *storage*. Blank is no note. */
  note: string | null;
}

/** Thrown when an own use asks for more than the supply has on hand. */
export class SupplyOwnUseShortError extends Error {
  constructor(
    readonly supplyName: string,
    readonly onHand: number
  ) {
    super(
      onHand === 0
        ? `No “${supplyName}” on hand — record the purchase that brought them in first.`
        : `Only ${onHand} “${supplyName}” on hand.`
    );
    this.name = "SupplyOwnUseShortError";
  }
}

function validated(input: SupplyOwnUseInput): { quantity: number; usedAt: Date; note: string | null } {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error("A use's quantity must be a whole number of at least 1.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.usedOn)) throw new Error("A use needs a date.");
  const usedAt = new Date(`${input.usedOn}T00:00:00.000Z`);
  if (Number.isNaN(usedAt.getTime()) || usedAt.toISOString().slice(0, 10) !== input.usedOn) {
    throw new Error("A use needs a valid date.");
  }
  const note = input.note?.trim() || null;
  return { quantity: input.quantity, usedAt, note };
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function assertSupplyInCollection(collectionId: string, supplyId: string): Promise<void> {
  const supply = await prisma.packingSupply.findFirst({
    where: { id: supplyId, collectionId },
    select: { id: true },
  });
  if (!supply) throw new Error("Packing supply not found in this collection.");
}

/** The use this call is about, proved to be the caller's. */
async function assertUse(
  ownerId: string,
  useId: string
): Promise<{ collectionId: string; supplyId: string }> {
  const use = await prisma.supplyOwnUse.findUnique({
    where: { id: useId },
    select: { collectionId: true, supplyId: true, collection: { select: { ownerId: true } } },
  });
  if (!use || use.collection.ownerId !== ownerId) {
    throw new Error("Supply use not found or access denied.");
  }
  return { collectionId: use.collectionId, supplyId: use.supplyId };
}


/** Units a use asked for that it does not hold. */
async function shortOf(tx: DbTransaction, useId: string): Promise<{ short: number; held: number; name: string }> {
  const use = await tx.supplyOwnUse.findUniqueOrThrow({
    where: { id: useId },
    select: { quantity: true, supply: { select: { name: true } }, takes: { select: { quantity: true } } },
  });
  const held = use.takes.reduce((sum, t) => sum + t.quantity, 0);
  return { short: Math.max(0, use.quantity - held), held, name: use.supply.name };
}

/** After settling: the write left the use no shorter than it was, or it is refused. A new use, or one
 * moved to another supply, was short of nothing. The units a short use does hold are all the stock
 * had — the rule takes whatever is left before leaving a line short — so they are what is on hand.
 *
 * Only a write that asks for *more* than stock has is refused: a use a lowered batch already left
 * short (#1898's rule, which own uses share) can still have its note, date or a lower quantity
 * corrected, and can always be deleted. */
async function assertCovered(tx: DbTransaction, useId: string, shortBefore: number): Promise<void> {
  const after = await shortOf(tx, useId);
  if (after.short > shortBefore) throw new SupplyOwnUseShortError(after.name, after.held);
}

/** Take supplies out of stock without a sale. Returns the use's id. */
export async function createSupplyOwnUse(
  ownerId: string,
  collectionId: string,
  input: SupplyOwnUseInput
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  await assertSupplyInCollection(collectionId, input.supplyId);
  const data = validated(input);
  return prisma.$transaction(async (tx) => {
    const created = await tx.supplyOwnUse.create({
      data: { collectionId, supplyId: input.supplyId, ...data },
      select: { id: true },
    });
    await settleSupplies(tx, [input.supplyId]);
    await assertCovered(tx, created.id, 0);
    return created.id;
  });
}

/** Correct a use's supply, quantity, date or note. Fewer units go back to the batches they came
 * from, newest first; more are taken FIFO, and refused if stock does not have them; another supply
 * gives back every unit and takes the new one's. */
export async function updateSupplyOwnUse(
  ownerId: string,
  useId: string,
  input: SupplyOwnUseInput
): Promise<void> {
  const { collectionId, supplyId: before } = await assertUse(ownerId, useId);
  await assertSupplyInCollection(collectionId, input.supplyId);
  const data = validated(input);
  await prisma.$transaction(async (tx) => {
    const shortBefore = before === input.supplyId ? (await shortOf(tx, useId)).short : 0;
    if (before !== input.supplyId) await tx.supplyOwnUseTake.deleteMany({ where: { useId } });
    await tx.supplyOwnUse.update({
      where: { id: useId },
      data: { supplyId: input.supplyId, ...data },
    });
    await settleSupplies(tx, [before, input.supplyId]);
    await assertCovered(tx, useId, shortBefore);
  });
}

/** Delete a use: its units go back to the batches they came from, and cover any sale still short of
 * them. */
export async function deleteSupplyOwnUse(ownerId: string, useId: string): Promise<void> {
  const { supplyId } = await assertUse(ownerId, useId);
  await prisma.$transaction(async (tx) => {
    await tx.supplyOwnUse.delete({ where: { id: useId } });
    await settleSupplies(tx, [supplyId]);
  });
}
