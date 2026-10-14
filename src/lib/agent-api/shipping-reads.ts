// Carriers, their rate lists, platform shipping options and packing supplies through the agent API
// (#1910) — the pure half: what an agent is told about each, the two small grammars it writes in,
// and naming a supply or a carrier service by name instead of by id.
//
// Typed **structurally**, as the other `*-reads.ts` modules are, so it unit-tests without Prisma: the
// shapes below are the parts of `CarrierData`, `ShippingOptionData` and `SupplyStockData` the
// projections read, not imports of them.
//
// Pure: no Prisma, no `server-only`.

import { invalidRequest } from "./errors";

// ── Money ────────────────────────────────────────────────────────────────────

/**
 * An amount as an agent sends it: a string to the cent, `"9.50"` — the offer and purchase surfaces'
 * convention. A third decimal or a comma is refused rather than rounded behind the agent's back, and
 * the answer is the same string the domain stores.
 */
export function parseMoney(value: string, parameter: string): string {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw invalidRequest(
      `"${text}" is not an amount for "${parameter}". Send a number with at most two decimal places and a period as the separator — "9.50".`
    );
  }
  return Number(text).toFixed(2);
}

/** A whole number of units, at least one — every quantity on this surface. */
export function assertUnits(value: number, parameter: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidRequest(`"${parameter}" must be a whole number of at least 1.`);
  }
  return value;
}

// ── A service's usual supplies ───────────────────────────────────────────────

/** One entry of a service's usual supplies as the agent wrote it, before the supply is resolved. */
export interface SupplyEntry {
  /** The supply's name or id, as sent. */
  readonly supply: string;
  readonly quantity: number;
}

/**
 * `"C6 envelope: 1"` — a supply and how many a parcel takes. The quantity is the digits after the
 * **last** colon, so a supply whose name carries a colon of its own still reads; it is required,
 * because the screen asks for it too and a guessed `1` would be the agent's figure, not the
 * collector's.
 */
export function parseSupplyEntry(text: string, parameter: string): SupplyEntry {
  const match = /^(.*\S)\s*:\s*(\d+)\s*$/.exec(text.trim());
  if (!match) {
    throw invalidRequest(
      `"${text}" in "${parameter}" is not a supply and a quantity. Write each as "name: quantity" — "C6 envelope: 1", "Transport card A6: 2".`
    );
  }
  const quantity = Number(match[2]);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw invalidRequest(`"${text}" in "${parameter}" needs a quantity of at least 1.`);
  }
  return { supply: match[1].trim(), quantity };
}

// ── Naming a supply or a service ─────────────────────────────────────────────

export interface NamedRow {
  readonly id: string;
  /** Every spelling the row answers to besides its id. */
  readonly names: readonly string[];
}

function fold(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * The id `value` names: an id exactly, or a name once case and the space around it are set aside.
 * Unknown is refused with the names (capped), ambiguous with the ids — `resolveVocabularyValue`'s
 * rule, with the sentence pointing at the read that lists these rows instead of the vocabulary.
 */
export function resolveNamedRow(
  value: string,
  rows: readonly NamedRow[],
  context: { readonly what: string; readonly parameter: string; readonly listedBy: string }
): string {
  const trimmed = value.trim();
  const exact = rows.find((row) => row.id === trimmed);
  if (exact) return exact.id;
  const wanted = fold(trimmed);
  const matched = rows.filter((row) => row.names.some((name) => fold(name) === wanted));
  if (matched.length === 1) return matched[0].id;
  if (matched.length === 0) {
    const names = rows.slice(0, MAX_NAMES).map((row) => row.names[0]);
    throw invalidRequest(
      rows.length === 0
        ? `"${trimmed}" is not a ${context.what} in this collection, and it has none yet.`
        : `"${trimmed}" is not a ${context.what} in this collection. Send one of the accepted names, or an id from \`${context.listedBy}\`, as "${context.parameter}".`,
      names
    );
  }
  throw invalidRequest(
    `"${trimmed}" matches ${matched.length} entries, so the name is not enough. Send one of these ids as "${context.parameter}"; \`${context.listedBy}\` says which is which.`,
    matched.map((row) => row.id)
  );
}

/** How many names a refusal hands back — `MAX_ACCEPTED_VALUES`'s argument. */
const MAX_NAMES = 40;

/** A supply answers to its name. */
export function supplyRows(supplies: readonly { id: string; name: string }[]): NamedRow[] {
  return supplies.map((supply) => ({ id: supply.id, names: [supply.name] }));
}

/** The label a service is read and named by: its carrier, a slash, its own name. */
export function serviceLabel(carrierName: string, serviceName: string): string {
  return `${carrierName} / ${serviceName}`;
}

/**
 * A service answers to its label — `"Poczta Polska / List polecony"` — and to its own name alone,
 * which is refused as ambiguous only where two carriers use it.
 */
export function serviceRows(
  carriers: readonly { name: string; services: readonly { id: string; name: string }[] }[]
): NamedRow[] {
  return carriers.flatMap((carrier) =>
    carrier.services.map((service) => ({
      id: service.id,
      names: [serviceLabel(carrier.name, service.name), service.name],
    }))
  );
}

// ── Carriers and their services ──────────────────────────────────────────────

/** One entry of a service's usual supplies. */
export interface AgentServiceSupply {
  readonly supplyId: string;
  readonly name: string;
  readonly quantity: number;
}

export interface AgentCarrierService {
  readonly serviceId: string;
  readonly name: string;
  /** `"Carrier / Service"` — what `service` on a shipping option accepts. */
  readonly label: string;
  /** What sending by it costs the collector now, to the cent. */
  readonly cost: string;
  readonly currency: string;
  /** The packing supplies a parcel sent this way usually takes. */
  readonly supplies: readonly AgentServiceSupply[];
  /** How many platform shipping options are sent by it. */
  readonly optionCount: number;
}

export interface AgentCarrier {
  readonly carrierId: string;
  readonly name: string;
  /** Where a parcel is looked up, `{code}` standing for its tracking number; absent where none. */
  readonly trackingUrl?: string;
  readonly services: readonly AgentCarrierService[];
}

interface CarrierSource {
  readonly id: string;
  readonly name: string;
  readonly trackingUrlTemplate: string | null;
  readonly services: readonly {
    readonly id: string;
    readonly name: string;
    readonly cost: string;
    readonly currency: string;
    readonly supplies: readonly { supplyId: string; name: string; quantity: number }[];
  }[];
}

export function carrier(
  source: CarrierSource,
  optionCounts: ReadonlyMap<string, number>
): AgentCarrier {
  return {
    carrierId: source.id,
    name: source.name,
    ...(source.trackingUrlTemplate ? { trackingUrl: source.trackingUrlTemplate } : {}),
    services: source.services.map((service) => ({
      serviceId: service.id,
      name: service.name,
      label: serviceLabel(source.name, service.name),
      cost: service.cost,
      currency: service.currency,
      supplies: service.supplies.map((s) => ({ supplyId: s.supplyId, name: s.name, quantity: s.quantity })),
      optionCount: optionCounts.get(service.id) ?? 0,
    })),
  };
}

// ── Shipping options ─────────────────────────────────────────────────────────

export interface AgentShippingOption {
  readonly optionId: string;
  readonly platformId: string;
  readonly platform: string;
  readonly name: string;
  /** What the buyer pays for it on this platform, to the cent. */
  readonly price: string;
  readonly currency: string;
  /** The carrier service it is sent by; absent where none is linked, and a sale choosing it then has
   *  its postage entered by hand. */
  readonly service?: {
    readonly serviceId: string;
    readonly label: string;
    readonly cost: string;
    readonly currency: string;
  };
}

interface OptionSource {
  readonly id: string;
  readonly platformId: string;
  readonly name: string;
  readonly price: string;
  readonly currency: string;
  readonly service: {
    readonly id: string;
    readonly carrierName: string;
    readonly name: string;
    readonly cost: string;
    readonly currency: string;
  } | null;
}

export function shippingOption(source: OptionSource, platformName: string): AgentShippingOption {
  return {
    optionId: source.id,
    platformId: source.platformId,
    platform: platformName,
    name: source.name,
    price: source.price,
    currency: source.currency,
    ...(source.service
      ? {
          service: {
            serviceId: source.service.id,
            label: serviceLabel(source.service.carrierName, source.service.name),
            cost: source.service.cost,
            currency: source.service.currency,
          },
        }
      : {}),
  };
}

// ── Packing supplies ─────────────────────────────────────────────────────────

/** One batch of a supply — a purchase-order line — as the Supplies screen lists it. */
export interface AgentSupplyBatch {
  readonly lineId: string;
  readonly purchaseId: string;
  readonly purchaseNo: number;
  /** `purchase` or `opening_balance`. */
  readonly purchaseKind: string;
  /** yyyy-mm-dd — what "first" means in first in, first out. */
  readonly boughtOn: string;
  readonly quantity: number;
  readonly onHand: number;
  /** The batch's whole cost in the order's currency — line price plus its share of the shipping. */
  readonly cost: string;
  readonly currency: string;
  /** One unit in the base currency, to 4 places; absent when the order has no rate into it. */
  readonly unitCostBase?: string;
}

export interface AgentPackingSupply {
  readonly supplyId: string;
  readonly name: string;
  readonly onHand: number;
  /** On hand at first-in-first-out cost, base currency; absent when a batch with units left has no
   *  rate into it, with `unvaluedBatches` saying how many. */
  readonly valueBase?: string;
  readonly unvaluedBatches?: number;
  /** Units sales used that were not in stock, waiting for a purchase to cover them. */
  readonly shortUnits?: number;
  /** Units used without a sale that are not in stock — only a batch lowered after the use leaves any. */
  readonly ownShortUnits?: number;
  readonly batches: readonly AgentSupplyBatch[];
  /** How many entries `get_packing_supply_history` holds for it. */
  readonly uses: number;
}

interface SupplySource {
  readonly id: string;
  readonly name: string;
  readonly onHand: number;
  readonly valueBase: string | null;
  readonly unvaluedBatches: number;
  readonly shortUnits: number;
  readonly ownShortUnits: number;
  readonly batches: readonly {
    readonly id: string;
    readonly purchase: { id: string; purchaseNo: number; kind: string; purchasedAt: string };
    readonly quantity: number;
    readonly onHand: number;
    readonly currency: string;
    readonly costTx: string;
    readonly unitCostBase: string | null;
  }[];
  readonly history: readonly unknown[];
}

export function packingSupply(source: SupplySource): AgentPackingSupply {
  return {
    supplyId: source.id,
    name: source.name,
    onHand: source.onHand,
    ...(source.valueBase !== null ? { valueBase: source.valueBase } : {}),
    ...(source.unvaluedBatches > 0 ? { unvaluedBatches: source.unvaluedBatches } : {}),
    ...(source.shortUnits > 0 ? { shortUnits: source.shortUnits } : {}),
    ...(source.ownShortUnits > 0 ? { ownShortUnits: source.ownShortUnits } : {}),
    batches: source.batches.map((batch) => ({
      lineId: batch.id,
      purchaseId: batch.purchase.id,
      purchaseNo: batch.purchase.purchaseNo,
      purchaseKind: batch.purchase.kind,
      boughtOn: batch.purchase.purchasedAt,
      quantity: batch.quantity,
      onHand: batch.onHand,
      cost: batch.costTx,
      currency: batch.currency,
      ...(batch.unitCostBase !== null ? { unitCostBase: batch.unitCostBase } : {}),
    })),
    uses: source.history.length,
  };
}

/** One use of a supply: a sale that packed with it, or a use without a sale. */
export interface AgentSupplyUse {
  /** `sale` or `own`. Only an `own` use is the agent's to correct, by `useId`. */
  readonly kind: "sale" | "own";
  /** The own use's id — what `update_supply_use` takes. Absent on a sale's line. */
  readonly useId?: string;
  /** yyyy-mm-dd: the sale's date, or the day the supplies were used. */
  readonly usedOn: string;
  readonly quantity: number;
  /** What the units cost at their batches' unit costs, base currency. */
  readonly costBase: string;
  /** Units not in stock when they were taken, so uncosted. */
  readonly shortUnits?: number;
  /** Units taken from a batch with no rate into the base currency, so not in `costBase`. */
  readonly unratedUnits?: number;
  readonly note?: string;
  readonly sale?: { readonly saleId: string; readonly saleNo: number; readonly platform: string };
}

type UseSource =
  | {
      readonly kind: "sale";
      readonly id: string;
      readonly usedOn: string;
      readonly quantity: number;
      readonly costBase: string;
      readonly shortUnits: number;
      readonly unratedUnits: number;
      readonly sale: { id: string; saleNo: number; platformName: string };
    }
  | {
      readonly kind: "own";
      readonly id: string;
      readonly usedOn: string;
      readonly quantity: number;
      readonly costBase: string;
      readonly shortUnits: number;
      readonly unratedUnits: number;
      readonly note: string | null;
    };

export function supplyUse(source: UseSource): AgentSupplyUse {
  const shared = {
    usedOn: source.usedOn,
    quantity: source.quantity,
    costBase: source.costBase,
    ...(source.shortUnits > 0 ? { shortUnits: source.shortUnits } : {}),
    ...(source.unratedUnits > 0 ? { unratedUnits: source.unratedUnits } : {}),
  };
  if (source.kind === "sale") {
    return {
      kind: "sale",
      ...shared,
      sale: { saleId: source.sale.id, saleNo: source.sale.saleNo, platform: source.sale.platformName },
    };
  }
  return { kind: "own", useId: source.id, ...shared, ...(source.note ? { note: source.note } : {}) };
}
