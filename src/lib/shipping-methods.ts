import "server-only";
import { prisma } from "./db";

// Per-platform shipping methods (#468) — the dictionary a sale's shipping method is picked from.
// Shaped after `certificate-statuses.ts` (owner assertion, `*InUseError` on delete), with one
// difference that follows from the domain: the parent is a **platform**, not the collection, since
// postage is quoted by the marketplace the parcel was sold on.
//
// Methods are ordered by name. There is no manual ordering here: a price list is read by looking
// for a service you already know the name of, unlike a condition scale whose order is the scale.

/** One shipping method as the dictionary UI and the sale pickers read it. */
export interface ShippingMethodData {
  id: string;
  platformId: string;
  name: string;
  /** The method's **current** cost, fixed to 2 decimals. Copied onto a sale when picked, never read
   * back into one already recorded. */
  cost: string;
  currency: string;
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

/** Resolve the platform a method is offered on, checking the collection is the caller's. Returns
 * the collection so callers can scope follow-up writes. */
async function assertMethodOwner(ownerId: string, methodId: string): Promise<{ collectionId: string }> {
  const method = await prisma.shippingMethod.findUnique({
    where: { id: methodId },
    select: { collectionId: true },
  });
  if (!method) throw new Error("Shipping method not found.");
  await assertCollectionOwner(ownerId, method.collectionId);
  return { collectionId: method.collectionId };
}

/** Check the platform exists in the collection and carries the `platform` role — the same guard the
 * sale/offer writers apply before routing anything to a contact as a platform. */
async function assertPlatform(collectionId: string, platformId: string): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: { id: platformId, collectionId },
    select: { platform: true },
  });
  if (!contact) throw new Error("Platform not found in this collection.");
  if (!contact.platform) throw new Error("This contact is not a platform.");
}

export async function getShippingMethods(
  ownerId: string,
  platformId: string
): Promise<ShippingMethodData[]> {
  const contact = await prisma.contact.findUnique({
    where: { id: platformId },
    select: { collectionId: true },
  });
  if (!contact) throw new Error("Platform not found.");
  await assertCollectionOwner(ownerId, contact.collectionId);
  const rows = await prisma.shippingMethod.findMany({
    where: { platformId },
    orderBy: { name: "asc" },
    select: { id: true, platformId: true, name: true, cost: true, currency: true },
  });
  return rows.map((m) => ({
    id: m.id,
    platformId: m.platformId,
    name: m.name,
    cost: m.cost.toFixed(2),
    currency: m.currency,
  }));
}

export interface ShippingMethodInput {
  name: string;
  cost: string;
  currency: string;
}

export async function createShippingMethod(
  ownerId: string,
  collectionId: string,
  platformId: string,
  input: ShippingMethodInput
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await assertPlatform(collectionId, platformId);
  await prisma.shippingMethod.create({
    data: {
      collectionId,
      platformId,
      name: input.name,
      cost: input.cost,
      currency: input.currency,
    },
  });
}

export async function updateShippingMethod(
  ownerId: string,
  methodId: string,
  input: ShippingMethodInput
): Promise<void> {
  await assertMethodOwner(ownerId, methodId);
  await prisma.shippingMethod.update({
    where: { id: methodId },
    data: { name: input.name, cost: input.cost, currency: input.currency },
  });
}

/** How many sales still point at this method. The FK is `Restrict`, so this only turns the database
 * error into a sentence naming the count — and a rename remains the way to correct a method whose
 * sales you want to keep. */
export async function countSalesUsingShippingMethod(methodId: string): Promise<number> {
  return prisma.sale.count({ where: { shippingMethodId: methodId } });
}

export class ShippingMethodInUseError extends Error {
  constructor(readonly saleCount: number) {
    super("Shipping method is in use by sales.");
    this.name = "ShippingMethodInUseError";
  }
}

export class DuplicateShippingMethodError extends Error {
  constructor() {
    super("A shipping method with this name already exists on this platform.");
    this.name = "DuplicateShippingMethodError";
  }
}

export async function deleteShippingMethod(ownerId: string, methodId: string): Promise<void> {
  await assertMethodOwner(ownerId, methodId);
  const saleCount = await countSalesUsingShippingMethod(methodId);
  if (saleCount > 0) throw new ShippingMethodInUseError(saleCount);
  await prisma.shippingMethod.delete({ where: { id: methodId } });
}

/** Resolve a method a sale claims to have been sent by (#468): it must exist and belong to the
 * sale's own platform, since the dictionary is the platform's. Returns the row so the writer can
 * snapshot its name and pre-fill the cost. */
export async function resolveShippingMethodForPlatform(
  platformId: string,
  methodId: string
): Promise<{ id: string; name: string; cost: string; currency: string }> {
  const method = await prisma.shippingMethod.findFirst({
    where: { id: methodId, platformId },
    select: { id: true, name: true, cost: true, currency: true },
  });
  if (!method) throw new Error("Shipping method not found on this sale's platform.");
  return {
    id: method.id,
    name: method.name,
    cost: method.cost.toFixed(2),
    currency: method.currency,
  };
}
