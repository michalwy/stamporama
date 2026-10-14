import "server-only";
import { prisma } from "./db";
import { assertCarrierInCollection } from "./carriers";
import type { SupplyQuantity } from "./method-supplies";

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
  /** Which carrier posts by this method (#491), or null where it was never said. The only thing it
   * decides is whether a sale's tracking number becomes a link. */
  carrierId: string | null;
  name: string;
  /** The method's **current** cost, fixed to 2 decimals. Copied onto a sale when picked, never read
   * back into one already recorded. */
  cost: string;
  currency: string;
  /** The packing supplies a parcel sent this way usually takes (#1899), by supply name. Filled in as
   * a sale's supply lines when the method is chosen on it. */
  supplies: ShippingMethodSupplyData[];
}

/** One entry of a method's usual supplies. */
export interface ShippingMethodSupplyData {
  supplyId: string;
  name: string;
  quantity: number;
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
    select: {
      id: true,
      platformId: true,
      carrierId: true,
      name: true,
      cost: true,
      currency: true,
      supplies: {
        orderBy: { supply: { name: "asc" } },
        select: { supplyId: true, quantity: true, supply: { select: { name: true } } },
      },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    platformId: m.platformId,
    carrierId: m.carrierId,
    name: m.name,
    cost: m.cost.toFixed(2),
    currency: m.currency,
    supplies: m.supplies.map((s) => ({
      supplyId: s.supplyId,
      name: s.supply.name,
      quantity: s.quantity,
    })),
  }));
}

export interface ShippingMethodInput {
  name: string;
  cost: string;
  currency: string;
  /** The carrier that posts by this method (#491), or null for none. Checked against the method's
   * own collection, since the carrier dictionary is the collection's. */
  carrierId: string | null;
  /** The supplies a parcel sent this way usually takes (#1899) — the whole list, replacing what the
   * method had; left out, an update keeps the list and a new method has none. Each supply at most
   * once, each quantity a whole number of at least 1. */
  supplies?: SupplyQuantity[];
}

/** A method's supply list that cannot be saved as given; the message says why. */
export class ShippingMethodSuppliesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShippingMethodSuppliesError";
  }
}

/** Check a method's supply list: every supply the collection's own, none twice, every quantity a
 * whole number of at least 1. */
async function resolveSupplies(
  collectionId: string,
  supplies: readonly SupplyQuantity[]
): Promise<SupplyQuantity[]> {
  const ids = new Set<string>();
  for (const s of supplies) {
    if (!Number.isInteger(s.quantity) || s.quantity < 1) {
      throw new ShippingMethodSuppliesError(
        "A supply's quantity must be a whole number of at least 1."
      );
    }
    if (ids.has(s.supplyId)) {
      throw new ShippingMethodSuppliesError("Each packing supply can be listed once per method.");
    }
    ids.add(s.supplyId);
  }
  if (ids.size > 0) {
    const found = await prisma.packingSupply.count({ where: { id: { in: [...ids] }, collectionId } });
    if (found !== ids.size) {
      throw new ShippingMethodSuppliesError("Packing supply not found in this collection.");
    }
  }
  return supplies.map((s) => ({ supplyId: s.supplyId, quantity: s.quantity }));
}

/** Resolve the carrier half of a method's input, checking it belongs to the same collection. */
async function resolveCarrier(
  collectionId: string,
  carrierId: string | null
): Promise<string | null> {
  if (!carrierId) return null;
  await assertCarrierInCollection(collectionId, carrierId);
  return carrierId;
}

export async function createShippingMethod(
  ownerId: string,
  collectionId: string,
  platformId: string,
  input: ShippingMethodInput
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await assertPlatform(collectionId, platformId);
  const supplies = await resolveSupplies(collectionId, input.supplies ?? []);
  await prisma.shippingMethod.create({
    data: {
      collectionId,
      platformId,
      carrierId: await resolveCarrier(collectionId, input.carrierId),
      name: input.name,
      cost: input.cost,
      currency: input.currency,
      supplies: { create: supplies },
    },
  });
}

export async function updateShippingMethod(
  ownerId: string,
  methodId: string,
  input: ShippingMethodInput
): Promise<void> {
  const { collectionId } = await assertMethodOwner(ownerId, methodId);
  const supplies = input.supplies && (await resolveSupplies(collectionId, input.supplies));
  // The list is replaced whole. Sales already recorded keep their lines: the list is a default, read
  // only when a sale's method is chosen or changed.
  await prisma.shippingMethod.update({
    where: { id: methodId },
    data: {
      carrierId: await resolveCarrier(collectionId, input.carrierId),
      name: input.name,
      cost: input.cost,
      currency: input.currency,
      ...(supplies ? { supplies: { deleteMany: {}, create: supplies } } : {}),
    },
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
