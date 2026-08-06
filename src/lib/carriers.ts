import "server-only";
import { prisma } from "./db";

// Carriers (#491) — who actually moves the parcel, and where its consignments are tracked.
//
// Shaped after `shipping-methods.ts` (owner assertion, `*InUseError` on delete), with the one
// difference that gives it a reason to exist: the parent is the **collection**, not a platform. A
// shipping method is per marketplace because postage is quoted by the marketplace; a carrier is not,
// because Poczta Polska tracks an Allegro parcel and a Delcampe one at the same address.
//
// Ordered by name, like the method price list: a short list read by looking for a name you know.

/** One carrier as the settings panel and the shipping-method picker read it. */
export interface CarrierData {
  id: string;
  name: string;
  /** Where a consignment is looked up, `{code}` standing in for the number (see `tracking-rules`).
   * Null where the carrier has no tracking page — its parcels still record their number. */
  trackingUrlTemplate: string | null;
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

async function assertCarrierOwner(ownerId: string, carrierId: string): Promise<void> {
  const carrier = await prisma.carrier.findUnique({
    where: { id: carrierId },
    select: { collectionId: true },
  });
  if (!carrier) throw new Error("Carrier not found.");
  await assertCollectionOwner(ownerId, carrier.collectionId);
}

export async function getCarriers(ownerId: string, collectionId: string): Promise<CarrierData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.carrier.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, trackingUrlTemplate: true },
  });
  return rows;
}

export interface CarrierInput {
  name: string;
  /** Already validated by `parseTrackingUrlTemplate` — null when the carrier has no tracking page. */
  trackingUrlTemplate: string | null;
}

export async function createCarrier(
  ownerId: string,
  collectionId: string,
  input: CarrierInput
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.carrier.create({
    data: {
      collectionId,
      name: input.name,
      trackingUrlTemplate: input.trackingUrlTemplate,
    },
  });
}

export async function updateCarrier(
  ownerId: string,
  carrierId: string,
  input: CarrierInput
): Promise<void> {
  await assertCarrierOwner(ownerId, carrierId);
  await prisma.carrier.update({
    where: { id: carrierId },
    data: { name: input.name, trackingUrlTemplate: input.trackingUrlTemplate },
  });
}

/** How many shipping methods still post with this carrier. The FK is `Restrict`, so this only turns
 * the database error into a sentence naming the count. */
export async function countMethodsUsingCarrier(carrierId: string): Promise<number> {
  return prisma.shippingMethod.count({ where: { carrierId } });
}

export class CarrierInUseError extends Error {
  constructor(readonly methodCount: number) {
    super("Carrier is in use by shipping methods.");
    this.name = "CarrierInUseError";
  }
}

export async function deleteCarrier(ownerId: string, carrierId: string): Promise<void> {
  await assertCarrierOwner(ownerId, carrierId);
  const methodCount = await countMethodsUsingCarrier(carrierId);
  if (methodCount > 0) throw new CarrierInUseError(methodCount);
  await prisma.carrier.delete({ where: { id: carrierId } });
}

/** Resolve a carrier a shipping method claims to post with: it must exist in the method's own
 * collection, since the dictionary is the collection's. Blank/absent is a legitimate answer — a
 * method whose carrier was never said. */
export async function assertCarrierInCollection(
  collectionId: string,
  carrierId: string
): Promise<void> {
  const carrier = await prisma.carrier.findFirst({
    where: { id: carrierId, collectionId },
    select: { id: true },
  });
  if (!carrier) throw new Error("Carrier not found in this collection.");
}
