import "server-only";
import { prisma } from "./db";
import type { SupplyQuantity } from "./service-supplies";

// Carriers (#491) and their rate lists (#1909, ADR-0069) — who actually moves the parcel, where its
// consignments are tracked, and what each of its services costs the collector.
//
// A dictionary of the **collection**, tied to no platform: Poczta Polska tracks an Allegro parcel and
// a Delcampe one at the same address and charges the same for both. What a platform has is its
// shipping options (`shipping-options.ts`), at the buyer's price, each linked to a service here.
//
// Owner assertion and `*InUseError` on delete, the shape of the other dictionaries. Ordered by name:
// a short list read by looking for a name you know.

/** One carrier as the settings panel and the option picker read it. */
export interface CarrierData {
  id: string;
  name: string;
  /** Where a consignment is looked up, `{code}` standing in for the number (see `tracking-rules`).
   * Null where the carrier has no tracking page — its parcels still record their number. */
  trackingUrlTemplate: string | null;
  /** Its rate list, by name. */
  services: CarrierServiceData[];
}

/** One service of a carrier's. */
export interface CarrierServiceData {
  id: string;
  carrierId: string;
  name: string;
  /** What sending by it costs the collector now, fixed to 2 decimals. Copied onto a sale when an
   * option linked to it is chosen, never read back into one already recorded. */
  cost: string;
  currency: string;
  /** The packing supplies a parcel sent this way usually takes (#1899), by supply name. Filled in as
   * a sale's supply lines when an option linked here is chosen on it. */
  supplies: CarrierServiceSupplyData[];
}

/** One entry of a service's usual supplies. */
export interface CarrierServiceSupplyData {
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

async function assertCarrierOwner(ownerId: string, carrierId: string): Promise<{ collectionId: string }> {
  const carrier = await prisma.carrier.findUnique({
    where: { id: carrierId },
    select: { collectionId: true },
  });
  if (!carrier) throw new Error("Carrier not found.");
  await assertCollectionOwner(ownerId, carrier.collectionId);
  return { collectionId: carrier.collectionId };
}

async function assertServiceOwner(ownerId: string, serviceId: string): Promise<{ collectionId: string }> {
  const service = await prisma.carrierService.findUnique({
    where: { id: serviceId },
    select: { collectionId: true },
  });
  if (!service) throw new Error("Carrier service not found.");
  await assertCollectionOwner(ownerId, service.collectionId);
  return { collectionId: service.collectionId };
}

export async function getCarriers(ownerId: string, collectionId: string): Promise<CarrierData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.carrier.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      trackingUrlTemplate: true,
      services: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          carrierId: true,
          name: true,
          cost: true,
          currency: true,
          supplies: {
            orderBy: { supply: { name: "asc" } },
            select: { supplyId: true, quantity: true, supply: { select: { name: true } } },
          },
        },
      },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    trackingUrlTemplate: c.trackingUrlTemplate,
    services: c.services.map((s) => ({
      id: s.id,
      carrierId: s.carrierId,
      name: s.name,
      cost: s.cost.toFixed(2),
      currency: s.currency,
      supplies: s.supplies.map((x) => ({ supplyId: x.supplyId, name: x.supply.name, quantity: x.quantity })),
    })),
  }));
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

/** A carrier that cannot be deleted yet: it still has services, or sales name it as the one that
 * carried their parcel. Both FKs are `Restrict`; this turns the database error into a sentence. */
export class CarrierInUseError extends Error {
  constructor(
    readonly serviceCount: number,
    readonly saleCount: number
  ) {
    super("Carrier is in use.");
    this.name = "CarrierInUseError";
  }
}

export async function deleteCarrier(ownerId: string, carrierId: string): Promise<void> {
  await assertCarrierOwner(ownerId, carrierId);
  const [serviceCount, saleCount] = await Promise.all([
    prisma.carrierService.count({ where: { carrierId } }),
    prisma.sale.count({ where: { carrierId } }),
  ]);
  if (serviceCount > 0 || saleCount > 0) throw new CarrierInUseError(serviceCount, saleCount);
  await prisma.carrier.delete({ where: { id: carrierId } });
}

/** Resolve a carrier a sale claims carried its parcel: it must exist in the sale's own collection,
 * since the dictionary is the collection's. */
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

// ── Services ─────────────────────────────────────────────────────────────────────────────────

export interface CarrierServiceInput {
  name: string;
  /** Already parsed to a 2-dp amount. Required: a rate list whose row has no price is the free-entry
   * amount it exists to replace. */
  cost: string;
  currency: string;
  /** The supplies a parcel sent this way usually takes (#1899) — the whole list, replacing what the
   * service had; left out, an update keeps the list and a new service has none. Each supply at most
   * once, each quantity a whole number of at least 1. */
  supplies?: SupplyQuantity[];
}

/** A service's supply list that cannot be saved as given; the message says why. */
export class CarrierServiceSuppliesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CarrierServiceSuppliesError";
  }
}

/** Check a service's supply list: every supply the collection's own, none twice, every quantity a
 * whole number of at least 1. */
async function resolveSupplies(
  collectionId: string,
  supplies: readonly SupplyQuantity[]
): Promise<SupplyQuantity[]> {
  const ids = new Set<string>();
  for (const s of supplies) {
    if (!Number.isInteger(s.quantity) || s.quantity < 1) {
      throw new CarrierServiceSuppliesError("A supply's quantity must be a whole number of at least 1.");
    }
    if (ids.has(s.supplyId)) {
      throw new CarrierServiceSuppliesError("Each packing supply can be listed once per service.");
    }
    ids.add(s.supplyId);
  }
  if (ids.size > 0) {
    const found = await prisma.packingSupply.count({ where: { id: { in: [...ids] }, collectionId } });
    if (found !== ids.size) {
      throw new CarrierServiceSuppliesError("Packing supply not found in this collection.");
    }
  }
  return supplies.map((s) => ({ supplyId: s.supplyId, quantity: s.quantity }));
}

export async function createCarrierService(
  ownerId: string,
  carrierId: string,
  input: CarrierServiceInput
): Promise<void> {
  const { collectionId } = await assertCarrierOwner(ownerId, carrierId);
  const supplies = await resolveSupplies(collectionId, input.supplies ?? []);
  await prisma.carrierService.create({
    data: {
      collectionId,
      carrierId,
      name: input.name,
      cost: input.cost,
      currency: input.currency,
      supplies: { create: supplies },
    },
  });
}

export async function updateCarrierService(
  ownerId: string,
  serviceId: string,
  input: CarrierServiceInput
): Promise<void> {
  const { collectionId } = await assertServiceOwner(ownerId, serviceId);
  const supplies = input.supplies && (await resolveSupplies(collectionId, input.supplies));
  // The list is replaced whole. Sales already recorded keep their lines and their postage: both are
  // defaults, read only when a sale's option is chosen or changed.
  await prisma.carrierService.update({
    where: { id: serviceId },
    data: {
      name: input.name,
      cost: input.cost,
      currency: input.currency,
      ...(supplies ? { supplies: { deleteMany: {}, create: supplies } } : {}),
    },
  });
}

/** A service platform options still link to, or sales say their parcel was sent as (#1923). Both
 * FKs are `Restrict`; this names the counts. */
export class CarrierServiceInUseError extends Error {
  constructor(
    readonly optionCount: number,
    readonly saleCount: number = 0
  ) {
    super("Carrier service is in use.");
    this.name = "CarrierServiceInUseError";
  }
}

export async function deleteCarrierService(ownerId: string, serviceId: string): Promise<void> {
  await assertServiceOwner(ownerId, serviceId);
  const [optionCount, saleCount] = await Promise.all([
    prisma.shippingOption.count({ where: { serviceId } }),
    prisma.sale.count({ where: { sentAsServiceId: serviceId } }),
  ]);
  if (optionCount > 0 || saleCount > 0) throw new CarrierServiceInUseError(optionCount, saleCount);
  await prisma.carrierService.delete({ where: { id: serviceId } });
}

/** Resolve a service a platform option claims to be sent by: it must exist in the option's own
 * collection, since the rate list is the collection's. */
export async function assertCarrierServiceInCollection(
  collectionId: string,
  serviceId: string
): Promise<void> {
  const service = await prisma.carrierService.findFirst({
    where: { id: serviceId, collectionId },
    select: { id: true },
  });
  if (!service) throw new Error("Carrier service not found in this collection.");
}
