import "server-only";
import { prisma } from "./db";
import { assertCarrierServiceInCollection } from "./carriers";

// Per-platform shipping options (#468, #1909, ADR-0069) — what a platform offers its buyers, at the
// price **the buyer** pays, and the list a sale's shipping is picked from. What sending costs the
// collector is not here: each option links to at most one service of a carrier's global rate list
// (`carriers.ts`), and choosing the option on a sale takes the postage and the usual packing supplies
// from that service.
//
// Shaped after `certificate-statuses.ts` (owner assertion, `*InUseError` on delete); the parent is
// the **platform**, since what buyers are offered is the marketplace's. Ordered by name.

/** One shipping option as the dictionary UI and the sale pickers read it. */
export interface ShippingOptionData {
  id: string;
  platformId: string;
  name: string;
  /** What the buyer pays for it now, fixed to 2 decimals — what `{shippingOptions}` lists. */
  price: string;
  currency: string;
  /** The carrier service it is sent by, or null where it was never said: a sale choosing it then has
   * its postage entered by hand and no supplies filled in. */
  service: ShippingOptionServiceData | null;
}

/** The linked service, as much of it as the option's readers need. */
export interface ShippingOptionServiceData {
  id: string;
  carrierId: string;
  carrierName: string;
  name: string;
  /** The collector's postage now, fixed to 2 decimals — what a sale's postage is pre-filled with. */
  cost: string;
  currency: string;
  /** Its usual packing supplies, by supply name (#1899). */
  supplies: { supplyId: string; name: string; quantity: number }[];
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

/** Resolve the collection an option belongs to, checking it is the caller's. */
async function assertOptionOwner(ownerId: string, optionId: string): Promise<{ collectionId: string }> {
  const option = await prisma.shippingOption.findUnique({
    where: { id: optionId },
    select: { collectionId: true },
  });
  if (!option) throw new Error("Shipping option not found.");
  await assertCollectionOwner(ownerId, option.collectionId);
  return { collectionId: option.collectionId };
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

const SERVICE_SELECT = {
  select: {
    id: true,
    carrierId: true,
    name: true,
    cost: true,
    currency: true,
    carrier: { select: { name: true } },
    supplies: {
      orderBy: { supply: { name: "asc" } },
      select: { supplyId: true, quantity: true, supply: { select: { name: true } } },
    },
  },
} as const;

export async function getShippingOptions(
  ownerId: string,
  platformId: string
): Promise<ShippingOptionData[]> {
  const contact = await prisma.contact.findUnique({
    where: { id: platformId },
    select: { collectionId: true },
  });
  if (!contact) throw new Error("Platform not found.");
  await assertCollectionOwner(ownerId, contact.collectionId);
  const rows = await prisma.shippingOption.findMany({
    where: { platformId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      platformId: true,
      name: true,
      price: true,
      currency: true,
      service: SERVICE_SELECT,
    },
  });
  return rows.map((o) => ({
    id: o.id,
    platformId: o.platformId,
    name: o.name,
    price: o.price.toFixed(2),
    currency: o.currency,
    service: o.service && {
      id: o.service.id,
      carrierId: o.service.carrierId,
      carrierName: o.service.carrier.name,
      name: o.service.name,
      cost: o.service.cost.toFixed(2),
      currency: o.service.currency,
      supplies: o.service.supplies.map((s) => ({
        supplyId: s.supplyId,
        name: s.supply.name,
        quantity: s.quantity,
      })),
    },
  }));
}

export interface ShippingOptionInput {
  name: string;
  /** What the buyer pays, already parsed to a 2-dp amount. */
  price: string;
  currency: string;
  /** The carrier service it is sent by, or null for none. Checked against the option's own
   * collection, since the rate list is the collection's. */
  serviceId: string | null;
}

async function resolveService(collectionId: string, serviceId: string | null): Promise<string | null> {
  if (!serviceId) return null;
  await assertCarrierServiceInCollection(collectionId, serviceId);
  return serviceId;
}

export async function createShippingOption(
  ownerId: string,
  collectionId: string,
  platformId: string,
  input: ShippingOptionInput
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await assertPlatform(collectionId, platformId);
  await prisma.shippingOption.create({
    data: {
      collectionId,
      platformId,
      serviceId: await resolveService(collectionId, input.serviceId),
      name: input.name,
      price: input.price,
      currency: input.currency,
    },
  });
}

export async function updateShippingOption(
  ownerId: string,
  optionId: string,
  input: ShippingOptionInput
): Promise<void> {
  const { collectionId } = await assertOptionOwner(ownerId, optionId);
  await prisma.shippingOption.update({
    where: { id: optionId },
    data: {
      serviceId: await resolveService(collectionId, input.serviceId),
      name: input.name,
      price: input.price,
      currency: input.currency,
    },
  });
}

/** How many sales still point at this option. The FK is `Restrict`, so this only turns the database
 * error into a sentence naming the count — and a rename remains the way to correct an option whose
 * sales you want to keep. */
export async function countSalesUsingShippingOption(optionId: string): Promise<number> {
  return prisma.sale.count({ where: { shippingOptionId: optionId } });
}

export class ShippingOptionInUseError extends Error {
  constructor(readonly saleCount: number) {
    super("Shipping option is in use by sales.");
    this.name = "ShippingOptionInUseError";
  }
}

export async function deleteShippingOption(ownerId: string, optionId: string): Promise<void> {
  await assertOptionOwner(ownerId, optionId);
  const saleCount = await countSalesUsingShippingOption(optionId);
  if (saleCount > 0) throw new ShippingOptionInUseError(saleCount);
  await prisma.shippingOption.delete({ where: { id: optionId } });
}

/** An option a sale claims its buyer chose, as the sale writer needs it: its name to snapshot and the
 * linked service's postage to pre-fill, or null postage where it links to none. */
export interface ResolvedShippingOption {
  id: string;
  name: string;
  /** The carrier service the option is linked to — what a sale choosing it is *sent as* unless the
   * sale names another (#1923). */
  serviceId: string | null;
  postage: { cost: string; currency: string } | null;
}

/** Resolve an option a sale claims its buyer chose (#468): it must exist and belong to the sale's own
 * platform, since the list is the platform's. */
export async function resolveShippingOptionForPlatform(
  platformId: string,
  optionId: string
): Promise<ResolvedShippingOption> {
  const option = await prisma.shippingOption.findFirst({
    where: { id: optionId, platformId },
    select: { id: true, name: true, serviceId: true, service: { select: { cost: true, currency: true } } },
  });
  if (!option) throw new Error("Shipping option not found on this sale's platform.");
  return {
    id: option.id,
    name: option.name,
    serviceId: option.serviceId,
    postage: option.service
      ? { cost: option.service.cost.toFixed(2), currency: option.service.currency }
      : null,
  };
}
