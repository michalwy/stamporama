import "server-only";
import { prisma } from "../../db";
import { COMMON_CURRENCIES } from "../../currencies";
import { parseTrackingUrlTemplate } from "../../tracking-rules";
import {
  createCarrier,
  createCarrierService,
  getCarriers,
  updateCarrier,
  updateCarrierService,
  type CarrierData,
} from "../../carriers";
import {
  createShippingOption,
  getShippingOptions,
  updateShippingOption,
  type ShippingOptionData,
} from "../../shipping-options";
import {
  createPackingSupply,
  getSuppliesStock,
  listPackingSupplies,
  renamePackingSupply,
  type SupplyStockData,
} from "../../packing-supplies";
import {
  createSupplyOwnUse,
  SupplyOwnUseShortError,
  updateSupplyOwnUse,
} from "../../supply-own-uses";
import { invalidRequest, notFound } from "../errors";
import { listResponse, parseListWindow } from "../list";
import {
  optionalString,
  requiredInteger,
  optionalInteger,
  requiredString,
  stringList,
} from "../params";
import { parseIsoDate } from "../purchase-reads";
import { resolveVocabularyValue } from "../vocabulary";
import {
  assertUnits,
  carrier as carrierProjection,
  packingSupply as supplyProjection,
  parseMoney,
  parseSupplyEntry,
  resolveNamedRow,
  serviceRows,
  shippingOption as optionProjection,
  supplyRows,
  supplyUse as supplyUseProjection,
} from "../shipping-reads";
import { readCollectionVocabulary } from "./vocabulary";
import { loadCollectionHeader } from "./reads-shared";
import type {
  AgentCarrier,
  AgentPackingSupply,
  AgentShippingOption,
  AgentSupplyUse,
} from "../shipping-reads";
import type { ListResponse } from "../list";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// Carriers and their rate lists, platform shipping options, packing supplies and their uses without a
// sale (#1910) — the shipping and packing data an agent sets up and keeps, instead of the collector
// typing it in under Settings, on a platform's contact dialog and on the Supplies screen.
//
// ## What it writes, and the boundary
//
// **Creates and edits; never a delete** — the collector's decision on #1910, as #1438 and #1539
// have it: deleting a carrier, a service, an option, a supply or a use stays in the app.
// `tests/unit/agent-api-operation-boundary.test.ts` holds it as a fact about what this module
// imports (`SHIPPING_WRITES`). A supply line on a purchase order is `add_purchase_supply_line`, in
// `operations/purchases.ts` beside the order's lots and expenses, under that module's boundary.
//
// **Every write is the screen's own domain call**, and every rule the screens hold is checked here
// first so the refusal is written for an agent: the domain throws plain `Error`s, and the screens'
// duplicate-name refusals are a unique index caught in the server action, neither of which #706
// relays. **No rule is the API's own.** A name already used where the screen's unique index would
// refuse it — a carrier or a supply in the collection, a service within its carrier, an option on
// its platform — is refused with the row that holds it; a tracking address goes through the
// carrier form's own `parseTrackingUrlTemplate`; a use that would take more than is on hand is the
// domain's `SupplyOwnUseShortError`, relayed.
//
// **An edit restates what it does not change**, because every domain update writes the whole row;
// only what the agent sent, or named in `clear`, moves.

// ── Shared parameters ────────────────────────────────────────────────────────

const CURRENCY_VALUES = COMMON_CURRENCIES;

function nothingToChange(fields: readonly string[]): never {
  throw invalidRequest(`Nothing to change: send at least one of ${fields.map((f) => `"${f}"`).join(", ")}.`);
}

function sentAndCleared(field: string): never {
  throw invalidRequest(`"${field}" is both sent and named in "clear". Send one or the other.`);
}

// ── Carriers ─────────────────────────────────────────────────────────────────

/** How many platform options each service is linked from. */
async function optionCountsByService(context: OperationContext): Promise<Map<string, number>> {
  const rows = await prisma.shippingOption.groupBy({
    by: ["serviceId"],
    where: { collectionId: context.collectionId, serviceId: { not: null } },
    _count: { _all: true },
  });
  return new Map(rows.flatMap((row) => (row.serviceId ? [[row.serviceId, row._count._all] as const] : [])));
}

async function loadCarriers(context: OperationContext): Promise<CarrierData[]> {
  return getCarriers(context.ownerId, context.collectionId);
}

async function carrierById(context: OperationContext, carrierId: string): Promise<AgentCarrier> {
  const [carriers, counts] = await Promise.all([loadCarriers(context), optionCountsByService(context)]);
  const found = carriers.find((c) => c.id === carrierId);
  if (!found) throw new Error(`Carrier ${carrierId} vanished after its write.`);
  return carrierProjection(found, counts);
}

/** The carrier a path names, in the token's collection. */
async function assertCarrier(
  context: OperationContext,
  carrierId: string
): Promise<{ id: string; name: string; trackingUrlTemplate: string | null }> {
  const row = await prisma.carrier.findFirst({
    where: { id: carrierId, collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { id: true, name: true, trackingUrlTemplate: true },
  });
  if (!row) {
    throw notFound(
      `No carrier with id "${carrierId}" is in this token's collection. \`list_carriers\` lists them with their ids.`
    );
  }
  return row;
}

/** Refuse a carrier name another carrier of the collection already has — the unique index's rule. */
async function assertCarrierNameFree(context: OperationContext, name: string, exceptId?: string) {
  const holder = await prisma.carrier.findFirst({
    where: { collectionId: context.collectionId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (holder) {
    throw invalidRequest(
      `This collection already has a carrier named "${name}" (id "${holder.id}"). Use it, or choose another name.`
    );
  }
}

function parseTrackingUrl(value: string): string {
  const parsed = parseTrackingUrlTemplate(value);
  if (!parsed.ok) throw invalidRequest(`"tracking_url": ${parsed.message}`);
  // Blank parses to null; a sent value is never blank here (`parseParameters` refuses it).
  return parsed.value ?? "";
}

export async function listCarriers(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentCarrier>> {
  const window = parseListWindow(params);
  const [carriers, counts] = await Promise.all([loadCarriers(context), optionCountsByService(context)]);
  const page = carriers.slice(window.offset, window.offset + window.limit);
  return listResponse(
    page.map((c) => carrierProjection(c, counts)),
    carriers.length,
    window
  );
}

export const listCarriersOperation: Operation = {
  name: "list_carriers",
  method: "GET",
  path: "/carriers",
  description:
    "The carriers the collection posts with — the post office or courier that moves a parcel — each with where a parcel is tracked and its rate list: every service, what sending by it costs the collector, and the packing supplies a parcel sent that way usually takes. The rate list is the collection's, never a platform's; what a buyer pays is a platform's shipping option (`list_shipping_options`).",
  writes: false,
  parameters: [],
  result: {
    kind: "list",
    description:
      "The carriers by name, each with its services by name. A service's `label` is what `service` on a shipping option takes; `optionCount` says how many platform options are sent by it.",
  },
  handler: async (context, params) => listCarriers(context, params),
};

const CARRIER_ID_PARAMETER: ParameterSpec = {
  name: "carrierId",
  in: "path",
  type: "string",
  required: true,
  description: "The carrier's id, from `list_carriers` or `create_carrier`.",
};

const CARRIER_NAME_PARAMETER: ParameterSpec = {
  name: "name",
  in: "body",
  type: "string",
  required: true,
  description: "The carrier's name — \"Poczta Polska\", \"InPost\", \"DHL\". Unique in the collection.",
};

const TRACKING_URL_PARAMETER: ParameterSpec = {
  name: "tracking_url",
  in: "body",
  type: "string",
  required: false,
  description:
    "Where a parcel is looked up, starting with http:// or https://, with {code} where the tracking number goes — \"https://emonitoring.poczta-polska.pl/?numer={code}\". Leave it out for a carrier with no tracking page.",
};

export async function addCarrier(context: OperationContext, params: ParsedParams): Promise<AgentCarrier> {
  const name = requiredString(params, "name");
  const trackingRaw = optionalString(params, "tracking_url");
  const trackingUrlTemplate = trackingRaw !== null ? parseTrackingUrl(trackingRaw) : null;
  await assertCarrierNameFree(context, name);
  await createCarrier(context.ownerId, context.collectionId, { name, trackingUrlTemplate });
  const created = await prisma.carrier.findFirstOrThrow({
    where: { collectionId: context.collectionId, name },
    select: { id: true },
  });
  return carrierById(context, created.id);
}

export const createCarrierOperation: Operation = {
  name: "create_carrier",
  method: "POST",
  path: "/carriers",
  description:
    "Add a carrier to the collection, with where its parcels are tracked. It starts with no services; add its rate list with `add_carrier_service`. Check `list_carriers` first so a carrier is not entered twice.",
  writes: true,
  parameters: [CARRIER_NAME_PARAMETER, TRACKING_URL_PARAMETER],
  result: { kind: "object", description: "The new carrier, in `list_carriers`' shape." },
  handler: async (context, params) => addCarrier(context, params),
};

export async function editCarrier(context: OperationContext, params: ParsedParams): Promise<AgentCarrier> {
  const current = await assertCarrier(context, requiredString(params, "carrierId"));
  const name = optionalString(params, "name");
  const trackingRaw = optionalString(params, "tracking_url");
  const clearTracking = stringList(params, "clear").includes("tracking_url");
  if (trackingRaw !== null && clearTracking) sentAndCleared("tracking_url");
  if (name === null && trackingRaw === null && !clearTracking) {
    nothingToChange(["name", "tracking_url", "clear"]);
  }
  if (name !== null && name !== current.name) await assertCarrierNameFree(context, name, current.id);
  await updateCarrier(context.ownerId, current.id, {
    name: name ?? current.name,
    trackingUrlTemplate: clearTracking
      ? null
      : trackingRaw !== null
        ? parseTrackingUrl(trackingRaw)
        : current.trackingUrlTemplate,
  });
  return carrierById(context, current.id);
}

export const updateCarrierOperation: Operation = {
  name: "update_carrier",
  method: "PATCH",
  path: "/carriers/{carrierId}",
  description:
    "Correct a carrier's name or tracking address. Only what is sent changes; parcels already recorded follow a new tracking address, since their links are built when they are read.",
  writes: true,
  parameters: [
    CARRIER_ID_PARAMETER,
    { ...CARRIER_NAME_PARAMETER, required: false },
    TRACKING_URL_PARAMETER,
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: "Send [\"tracking_url\"] to take the tracking address off — for a carrier with no tracking page.",
      values: ["tracking_url"],
    },
  ],
  result: { kind: "object", description: "The carrier as it now stands, in `list_carriers`' shape." },
  handler: async (context, params) => editCarrier(context, params),
};

// ── Carrier services ─────────────────────────────────────────────────────────

/** The supplies a service's `supplies` list names, resolved — each supply at most once. */
async function resolveServiceSupplies(
  context: OperationContext,
  entries: readonly string[]
): Promise<{ supplyId: string; quantity: number }[]> {
  if (entries.length === 0) return [];
  const rows = supplyRows(await listPackingSupplies(context.ownerId, context.collectionId));
  const seen = new Set<string>();
  return entries.map((text) => {
    const entry = parseSupplyEntry(text, "supplies");
    const supplyId = resolveNamedRow(entry.supply, rows, {
      what: "packing supply",
      parameter: "supplies",
      listedBy: "list_packing_supplies",
    });
    if (seen.has(supplyId)) {
      throw invalidRequest(`"${entry.supply}" is listed twice in "supplies". Each packing supply can be listed once per service.`);
    }
    seen.add(supplyId);
    return { supplyId, quantity: entry.quantity };
  });
}

async function assertServiceNameFree(carrierId: string, name: string, exceptId?: string) {
  const holder = await prisma.carrierService.findFirst({
    where: { carrierId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (holder) {
    throw invalidRequest(
      `This carrier already has a service named "${name}" (id "${holder.id}"). Correct that one with \`update_carrier_service\`, or choose another name.`
    );
  }
}

const SERVICE_NAME_PARAMETER: ParameterSpec = {
  name: "name",
  in: "body",
  type: "string",
  required: true,
  description: "The service's name — \"List polecony ekonomiczny\", \"Paczkomat A\". Unique within its carrier.",
};

const SERVICE_COST_PARAMETER: ParameterSpec = {
  name: "cost",
  in: "body",
  type: "string",
  required: true,
  description:
    "What sending by this service costs the collector now, as \"9.50\" — the postage, not what a buyer is charged. Sales already recorded keep the postage they were given.",
};

const SERVICE_CURRENCY_PARAMETER: ParameterSpec = {
  name: "currency",
  in: "body",
  type: "string",
  required: false,
  description: "The currency the postage is paid in. Defaults to the collection's base currency on a new service.",
  values: CURRENCY_VALUES,
};

const SERVICE_SUPPLIES_PARAMETER: ParameterSpec = {
  name: "supplies",
  in: "body",
  type: "string[]",
  required: false,
  description:
    "The packing supplies a parcel sent this way usually takes, each as \"supply name: quantity\" — [\"C6 envelope: 1\", \"Transport card A6: 2\"]; a supply's id works in place of its name. Filled in on a sale when an option sent by this service is chosen. On an update it replaces the whole list.",
};

export async function addCarrierService(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentCarrier> {
  const owner = await assertCarrier(context, requiredString(params, "carrierId"));
  const name = requiredString(params, "name");
  const cost = parseMoney(requiredString(params, "cost"), "cost");
  const currency =
    optionalString(params, "currency") ?? (await loadCollectionHeader(context)).baseCurrency;
  const supplies = await resolveServiceSupplies(context, stringList(params, "supplies"));
  await assertServiceNameFree(owner.id, name);
  await createCarrierService(context.ownerId, owner.id, { name, cost, currency, supplies });
  return carrierById(context, owner.id);
}

export const addCarrierServiceOperation: Operation = {
  name: "add_carrier_service",
  method: "POST",
  path: "/carriers/{carrierId}/services",
  description:
    "Add a service to a carrier's rate list: its name, what it costs the collector to send by it, and the packing supplies a parcel sent that way usually takes. Link it to a platform's shipping option with `create_shipping_option` or `update_shipping_option`.",
  writes: true,
  parameters: [
    CARRIER_ID_PARAMETER,
    SERVICE_NAME_PARAMETER,
    SERVICE_COST_PARAMETER,
    SERVICE_CURRENCY_PARAMETER,
    SERVICE_SUPPLIES_PARAMETER,
  ],
  result: { kind: "object", description: "The carrier with its rate list as it now stands, in `list_carriers`' shape." },
  handler: async (context, params) => addCarrierService(context, params),
};

const SERVICE_ID_PARAMETER: ParameterSpec = {
  name: "serviceId",
  in: "path",
  type: "string",
  required: true,
  description: "The service's id, from `list_carriers`.",
};

export async function editCarrierService(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentCarrier> {
  const serviceId = requiredString(params, "serviceId");
  const current = await prisma.carrierService.findFirst({
    where: { id: serviceId, collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { id: true, carrierId: true, name: true, cost: true, currency: true },
  });
  if (!current) {
    throw notFound(
      `No carrier service with id "${serviceId}" is in this token's collection. \`list_carriers\` lists each carrier's services with their ids.`
    );
  }
  const name = optionalString(params, "name");
  const costRaw = optionalString(params, "cost");
  const currency = optionalString(params, "currency");
  const sentSupplies = params.supplies !== undefined;
  const clearSupplies = stringList(params, "clear").includes("supplies");
  if (sentSupplies && clearSupplies) sentAndCleared("supplies");
  if (name === null && costRaw === null && currency === null && !sentSupplies && !clearSupplies) {
    nothingToChange(["name", "cost", "currency", "supplies", "clear"]);
  }
  const supplies = clearSupplies
    ? []
    : sentSupplies
      ? await resolveServiceSupplies(context, stringList(params, "supplies"))
      : undefined;
  if (name !== null && name !== current.name) await assertServiceNameFree(current.carrierId, name, current.id);
  await updateCarrierService(context.ownerId, current.id, {
    name: name ?? current.name,
    cost: costRaw !== null ? parseMoney(costRaw, "cost") : current.cost.toFixed(2),
    currency: currency ?? current.currency,
    supplies,
  });
  return carrierById(context, current.carrierId);
}

export const updateCarrierServiceOperation: Operation = {
  name: "update_carrier_service",
  method: "PATCH",
  path: "/carrier-services/{serviceId}",
  description:
    "Correct a carrier service: its name, its cost, its currency or its usual packing supplies. Only what is sent changes, and `supplies` replaces the whole list. Sales already recorded keep their postage and their supplies — both are defaults read when an option is chosen.",
  writes: true,
  parameters: [
    SERVICE_ID_PARAMETER,
    { ...SERVICE_NAME_PARAMETER, required: false },
    { ...SERVICE_COST_PARAMETER, required: false },
    { ...SERVICE_CURRENCY_PARAMETER, description: "The currency the postage is paid in." },
    SERVICE_SUPPLIES_PARAMETER,
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: "Send [\"supplies\"] to empty the service's usual packing supplies.",
      values: ["supplies"],
    },
  ],
  result: { kind: "object", description: "The service's carrier with its rate list as it now stands, in `list_carriers`' shape." },
  handler: async (context, params) => editCarrierService(context, params),
};

// ── Platform shipping options ────────────────────────────────────────────────

/** The service a `service` value names, by id, label or unique name. */
async function resolveService(context: OperationContext, value: string): Promise<string> {
  return resolveNamedRow(value, serviceRows(await loadCarriers(context)), {
    what: "carrier service",
    parameter: "service",
    listedBy: "list_carriers",
  });
}

async function platformParam(context: OperationContext, value: string) {
  const vocabulary = await readCollectionVocabulary(context);
  const id = resolveVocabularyValue(value, vocabulary.platforms, {
    vocabulary: "platform",
    parameter: "platform",
  });
  const entry = vocabulary.platforms.find((p) => p.id === id)!;
  return { id, name: entry.name, currency: entry.currency };
}

function projectOptions(
  options: readonly ShippingOptionData[],
  platformName: string
): AgentShippingOption[] {
  return options.map((o) => optionProjection(o, platformName));
}

async function optionById(context: OperationContext, optionId: string): Promise<AgentShippingOption> {
  const row = await prisma.shippingOption.findFirstOrThrow({
    where: { id: optionId, collectionId: context.collectionId },
    select: { platformId: true, platform: { select: { name: true } } },
  });
  const options = await getShippingOptions(context.ownerId, row.platformId);
  const found = options.find((o) => o.id === optionId);
  if (!found) throw new Error(`Shipping option ${optionId} vanished after its write.`);
  return optionProjection(found, row.platform.name);
}

async function assertOptionNameFree(platformId: string, name: string, exceptId?: string) {
  const holder = await prisma.shippingOption.findFirst({
    where: { platformId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (holder) {
    throw invalidRequest(
      `This platform already has a shipping option named "${name}" (id "${holder.id}"). Correct that one with \`update_shipping_option\`, or choose another name.`
    );
  }
}

const PLATFORM_PARAMETER: ParameterSpec = {
  name: "platform",
  in: "query",
  type: "string",
  required: false,
  description:
    "Only this platform's options — its name from `get_collection_vocabulary`, or its id. Leave it out for every platform's.",
};

export async function listOptions(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentShippingOption>> {
  const window = parseListWindow(params);
  const platformValue = optionalString(params, "platform");
  const vocabulary = await readCollectionVocabulary(context);
  const platforms =
    platformValue === null
      ? vocabulary.platforms
      : vocabulary.platforms.filter(
          (p) =>
            p.id ===
            resolveVocabularyValue(platformValue, vocabulary.platforms, {
              vocabulary: "platform",
              parameter: "platform",
            })
        );
  const all: AgentShippingOption[] = [];
  for (const platform of [...platforms].sort((a, b) => a.name.localeCompare(b.name))) {
    all.push(...projectOptions(await getShippingOptions(context.ownerId, platform.id), platform.name));
  }
  return listResponse(all.slice(window.offset, window.offset + window.limit), all.length, window);
}

export const listShippingOptionsOperation: Operation = {
  name: "list_shipping_options",
  method: "GET",
  path: "/shipping-options",
  description:
    "The shipping options a platform offers its buyers, at the price the buyer pays, each with the carrier service a parcel sent that way goes by and what that costs the collector. The buyer message's shipping list is read from these.",
  writes: false,
  parameters: [PLATFORM_PARAMETER],
  result: {
    kind: "list",
    description:
      "The options by platform, then by name. `service` is absent on an option linked to no carrier service — a sale choosing it has its postage entered by hand.",
  },
  handler: async (context, params) => listOptions(context, params),
};

const OPTION_NAME_PARAMETER: ParameterSpec = {
  name: "name",
  in: "body",
  type: "string",
  required: true,
  description: "The option's name as the buyer sees it — \"Registered letter\", \"Courier\". Unique on its platform.",
};

const OPTION_PRICE_PARAMETER: ParameterSpec = {
  name: "price",
  in: "body",
  type: "string",
  required: true,
  description: "What the buyer pays for this option on this platform, as \"12.00\". Not the collector's cost — that is the linked service's.",
};

const OPTION_SERVICE_PARAMETER: ParameterSpec = {
  name: "service",
  in: "body",
  type: "string",
  required: false,
  description:
    "The carrier service a parcel sent this way goes by — its `label` from `list_carriers` (\"Poczta Polska / List polecony\"), its name alone where only one carrier uses it, or its id. Choosing the option on a sale then fills in that service's postage and packing supplies.",
};

export async function addOption(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentShippingOption> {
  const platform = await platformParam(context, requiredString(params, "platform"));
  const name = requiredString(params, "name");
  const price = parseMoney(requiredString(params, "price"), "price");
  const currency =
    optionalString(params, "currency") ??
    platform.currency ??
    (await loadCollectionHeader(context)).baseCurrency;
  const serviceValue = optionalString(params, "service");
  const serviceId = serviceValue !== null ? await resolveService(context, serviceValue) : null;
  await assertOptionNameFree(platform.id, name);
  await createShippingOption(context.ownerId, context.collectionId, platform.id, {
    name,
    price,
    currency,
    serviceId,
  });
  const created = await prisma.shippingOption.findFirstOrThrow({
    where: { platformId: platform.id, name },
    select: { id: true },
  });
  return optionById(context, created.id);
}

export const createShippingOptionOperation: Operation = {
  name: "create_shipping_option",
  method: "POST",
  path: "/shipping-options",
  description:
    "Add a shipping option to a platform: what its buyers are offered, at what price, and the carrier service it is sent by. Check `list_shipping_options` first so an option is not entered twice.",
  writes: true,
  parameters: [
    { ...PLATFORM_PARAMETER, in: "body", required: true, description: "The platform it is offered on — its name from `get_collection_vocabulary`, or its id." },
    OPTION_NAME_PARAMETER,
    OPTION_PRICE_PARAMETER,
    {
      name: "currency",
      in: "body",
      type: "string",
      required: false,
      description: "The currency the buyer pays in. Defaults to the platform's currency, or the collection's base currency where the platform has none.",
      values: CURRENCY_VALUES,
    },
    OPTION_SERVICE_PARAMETER,
  ],
  result: { kind: "object", description: "The new option, in `list_shipping_options`' shape." },
  handler: async (context, params) => addOption(context, params),
};

export async function editOption(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentShippingOption> {
  const optionId = requiredString(params, "optionId");
  const current = await prisma.shippingOption.findFirst({
    where: { id: optionId, collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { id: true, platformId: true, name: true, price: true, currency: true, serviceId: true },
  });
  if (!current) {
    throw notFound(
      `No shipping option with id "${optionId}" is in this token's collection. \`list_shipping_options\` lists them with their ids.`
    );
  }
  const name = optionalString(params, "name");
  const priceRaw = optionalString(params, "price");
  const currency = optionalString(params, "currency");
  const serviceValue = optionalString(params, "service");
  const clearService = stringList(params, "clear").includes("service");
  if (serviceValue !== null && clearService) sentAndCleared("service");
  if (name === null && priceRaw === null && currency === null && serviceValue === null && !clearService) {
    nothingToChange(["name", "price", "currency", "service", "clear"]);
  }
  const serviceId = clearService
    ? null
    : serviceValue !== null
      ? await resolveService(context, serviceValue)
      : current.serviceId;
  if (name !== null && name !== current.name) await assertOptionNameFree(current.platformId, name, current.id);
  await updateShippingOption(context.ownerId, current.id, {
    name: name ?? current.name,
    price: priceRaw !== null ? parseMoney(priceRaw, "price") : current.price.toFixed(2),
    currency: currency ?? current.currency,
    serviceId,
  });
  return optionById(context, current.id);
}

export const updateShippingOptionOperation: Operation = {
  name: "update_shipping_option",
  method: "PATCH",
  path: "/shipping-options/{optionId}",
  description:
    "Correct a platform's shipping option: its name, its buyer price, its currency or the carrier service it is sent by. Only what is sent changes. Sales already recorded keep what they were given.",
  writes: true,
  parameters: [
    {
      name: "optionId",
      in: "path",
      type: "string",
      required: true,
      description: "The option's id, from `list_shipping_options` or `create_shipping_option`.",
    },
    { ...OPTION_NAME_PARAMETER, required: false },
    { ...OPTION_PRICE_PARAMETER, required: false },
    {
      name: "currency",
      in: "body",
      type: "string",
      required: false,
      description: "The currency the buyer pays in.",
      values: CURRENCY_VALUES,
    },
    OPTION_SERVICE_PARAMETER,
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: "Send [\"service\"] to unlink the carrier service — a sale choosing the option then has its postage entered by hand.",
      values: ["service"],
    },
  ],
  result: { kind: "object", description: "The option as it now stands, in `list_shipping_options`' shape." },
  handler: async (context, params) => editOption(context, params),
};

// ── Packing supplies ─────────────────────────────────────────────────────────

async function loadStock(context: OperationContext) {
  return getSuppliesStock(context.ownerId, context.collectionId);
}

async function supplyStockById(context: OperationContext, supplyId: string): Promise<SupplyStockData> {
  const stock = await loadStock(context);
  const found = stock.supplies.find((s) => s.id === supplyId);
  if (!found) {
    throw notFound(
      `No packing supply with id "${supplyId}" is in this token's collection. \`list_packing_supplies\` lists them with their ids.`
    );
  }
  return found;
}

async function assertSupplyNameFree(context: OperationContext, name: string, exceptId?: string) {
  const holder = await prisma.packingSupply.findFirst({
    where: { collectionId: context.collectionId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (holder) {
    throw invalidRequest(
      `This collection already has a packing supply named "${name}" (id "${holder.id}"). Use it, or choose another name.`
    );
  }
}

/** A `supply` value — a name or an id — resolved against the collection's supplies. */
export async function resolveSupplyParam(context: OperationContext, value: string): Promise<string> {
  return resolveNamedRow(value, supplyRows(await listPackingSupplies(context.ownerId, context.collectionId)), {
    what: "packing supply",
    parameter: "supply",
    listedBy: "list_packing_supplies",
  });
}

export async function listSupplies(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentPackingSupply> & { baseCurrency: string; totalValueBase?: string }> {
  const window = parseListWindow(params);
  const stock = await loadStock(context);
  const page = stock.supplies.slice(window.offset, window.offset + window.limit);
  return {
    ...listResponse(page.map(supplyProjection), stock.supplies.length, window),
    baseCurrency: stock.baseCurrency,
    ...(stock.totalValueBase !== null ? { totalValueBase: stock.totalValueBase } : {}),
  };
}

export const listPackingSuppliesOperation: Operation = {
  name: "list_packing_supplies",
  method: "GET",
  path: "/packing-supplies",
  description:
    "The packing supplies — envelopes, transport cards and the like — with what is on hand, its value at first-in-first-out cost, and the batches it was bought in. A supply's price is never typed: each batch is a purchase-order line, costed at its price plus its share of the order's shipping.",
  writes: false,
  parameters: [],
  result: {
    kind: "list",
    description:
      "The supplies by name. `valueBase` and `totalValueBase` are in `baseCurrency`, absent where a batch with units left has no exchange rate into it. `shortUnits` are units sales used that were not in stock, waiting for a purchase. `uses` counts what `get_packing_supply_history` lists.",
  },
  handler: async (context, params) => listSupplies(context, params),
};

const SUPPLY_ID_PARAMETER: ParameterSpec = {
  name: "supplyId",
  in: "path",
  type: "string",
  required: true,
  description: "The supply's id, from `list_packing_supplies` or `create_packing_supply`.",
};

export async function supplyHistory(
  context: OperationContext,
  params: ParsedParams
): Promise<ListResponse<AgentSupplyUse> & { supplyId: string; name: string; onHand: number }> {
  const window = parseListWindow(params);
  const supply = await supplyStockById(context, requiredString(params, "supplyId"));
  const page = supply.history.slice(window.offset, window.offset + window.limit);
  return {
    supplyId: supply.id,
    name: supply.name,
    onHand: supply.onHand,
    ...listResponse(page.map(supplyUseProjection), supply.history.length, window),
  };
}

export const getPackingSupplyHistoryOperation: Operation = {
  name: "get_packing_supply_history",
  method: "GET",
  path: "/packing-supplies/{supplyId}/history",
  description:
    "Everything that took a packing supply out of stock, newest first: the sales that packed with it, and the uses without a sale — transport cards kept for storage. A use without a sale is corrected with `update_supply_use`; a sale's supplies are the sale's.",
  writes: false,
  parameters: [SUPPLY_ID_PARAMETER],
  result: {
    kind: "list",
    description:
      "The uses, newest first, each costed at the units' batch costs in the base currency. `shortUnits` were not in stock and carry no cost; `unratedUnits` came from a batch with no exchange rate.",
  },
  handler: async (context, params) => supplyHistory(context, params),
};

const SUPPLY_NAME_PARAMETER: ParameterSpec = {
  name: "name",
  in: "body",
  type: "string",
  required: true,
  description: "The supply's name — \"C6 envelope\", \"Bubble envelope 15×21\", \"Transport card A6\". Unique in the collection.",
};

export async function addSupply(context: OperationContext, params: ParsedParams): Promise<AgentPackingSupply> {
  const name = requiredString(params, "name");
  await assertSupplyNameFree(context, name);
  const id = await createPackingSupply(context.ownerId, context.collectionId, name);
  return supplyProjection(await supplyStockById(context, id));
}

export const createPackingSupplyOperation: Operation = {
  name: "create_packing_supply",
  method: "POST",
  path: "/packing-supplies",
  description:
    "Add a packing supply to the collection. It is a name and nothing else — none is on hand until a purchase brings some in (`add_purchase_supply_line`). Check `list_packing_supplies` first so a supply is not entered twice.",
  writes: true,
  parameters: [SUPPLY_NAME_PARAMETER],
  result: { kind: "object", description: "The new supply, in `list_packing_supplies`' shape." },
  handler: async (context, params) => addSupply(context, params),
};

export async function editSupply(context: OperationContext, params: ParsedParams): Promise<AgentPackingSupply> {
  const current = await supplyStockById(context, requiredString(params, "supplyId"));
  const name = requiredString(params, "name");
  if (name !== current.name) await assertSupplyNameFree(context, name, current.id);
  await renamePackingSupply(context.ownerId, current.id, name);
  return supplyProjection(await supplyStockById(context, current.id));
}

export const updatePackingSupplyOperation: Operation = {
  name: "update_packing_supply",
  method: "PATCH",
  path: "/packing-supplies/{supplyId}",
  description: "Rename a packing supply. Its batches, its uses and the services that list it follow.",
  writes: true,
  parameters: [SUPPLY_ID_PARAMETER, { ...SUPPLY_NAME_PARAMETER, description: "The supply's new name. Unique in the collection." }],
  result: { kind: "object", description: "The supply as it now stands, in `list_packing_supplies`' shape." },
  handler: async (context, params) => editSupply(context, params),
};

// ── Uses without a sale ──────────────────────────────────────────────────────

/** A write on a use answers with it and what the supply now has on hand. */
export interface AgentSupplyUseChange {
  readonly use: AgentSupplyUse;
  readonly supply: { readonly supplyId: string; readonly name: string; readonly onHand: number };
}

async function supplyUseChange(context: OperationContext, supplyId: string, useId: string): Promise<AgentSupplyUseChange> {
  const supply = await supplyStockById(context, supplyId);
  const entry = supply.history.find((h) => h.kind === "own" && h.id === useId);
  if (!entry) throw new Error(`Use ${useId} is not in ${supplyId}'s history.`);
  return {
    use: supplyUseProjection(entry),
    supply: { supplyId: supply.id, name: supply.name, onHand: supply.onHand },
  };
}

/** The domain's refusal of a use stock cannot cover, relayed; anything else is a defect. */
async function withShortRefused<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (e instanceof SupplyOwnUseShortError) {
      throw invalidRequest(
        `${e.message} A use without a sale can take only what is on hand; record the purchase that brought them in first (\`add_purchase_supply_line\`).`
      );
    }
    throw e;
  }
}

const SUPPLY_PARAMETER: ParameterSpec = {
  name: "supply",
  in: "body",
  type: "string",
  required: true,
  description: "The packing supply — its name from `list_packing_supplies`, or its id.",
};

const USE_QUANTITY_PARAMETER: ParameterSpec = {
  name: "quantity",
  in: "body",
  type: "integer",
  required: true,
  description: "How many units were taken, at least 1. No more than are on hand.",
};

const USED_ON_PARAMETER: ParameterSpec = {
  name: "used_on",
  in: "body",
  type: "string",
  required: true,
  description: "The day they were used, yyyy-mm-dd — what decides which batch they come from beside the sales' dates.",
};

const NOTE_PARAMETER: ParameterSpec = {
  name: "note",
  in: "body",
  type: "string",
  required: false,
  description: "What they were used for — \"storage\".",
};

export async function recordUse(context: OperationContext, params: ParsedParams): Promise<AgentSupplyUseChange> {
  const supplyId = await resolveSupplyParam(context, requiredString(params, "supply"));
  const quantity = assertUnits(requiredInteger(params, "quantity"), "quantity");
  const usedOn = parseIsoDate(requiredString(params, "used_on"), "used_on");
  const useId = await withShortRefused(() =>
    createSupplyOwnUse(context.ownerId, context.collectionId, {
      supplyId,
      quantity,
      usedOn,
      note: optionalString(params, "note"),
    })
  );
  return supplyUseChange(context, supplyId, useId);
}

export const recordSupplyUseOperation: Operation = {
  name: "record_supply_use",
  method: "POST",
  path: "/supply-uses",
  description:
    "Take packing supplies out of stock without a sale — transport cards the collector keeps stamps in at home. The units leave the oldest batches first; their cost is charged to no sale and is stated on the Supplies screen as a cost of its own. Taking more than is on hand is refused. A sale's packing supplies are recorded on the sale, never here.",
  writes: true,
  parameters: [SUPPLY_PARAMETER, USE_QUANTITY_PARAMETER, USED_ON_PARAMETER, NOTE_PARAMETER],
  result: { kind: "object", description: "The use, costed, and what the supply now has on hand." },
  handler: async (context, params) => recordUse(context, params),
};

export async function editUse(context: OperationContext, params: ParsedParams): Promise<AgentSupplyUseChange> {
  const useId = requiredString(params, "useId");
  const current = await prisma.supplyOwnUse.findFirst({
    where: { id: useId, collectionId: context.collectionId, collection: { ownerId: context.ownerId } },
    select: { id: true, supplyId: true, quantity: true, usedAt: true, note: true },
  });
  if (!current) {
    throw notFound(
      `No supply use with id "${useId}" is in this token's collection. \`get_packing_supply_history\` lists a supply's uses with their ids.`
    );
  }
  const supplyValue = optionalString(params, "supply");
  const quantity = optionalInteger(params, "quantity");
  const usedOnRaw = optionalString(params, "used_on");
  const note = optionalString(params, "note");
  const clearNote = stringList(params, "clear").includes("note");
  if (note !== null && clearNote) sentAndCleared("note");
  if (supplyValue === null && quantity === null && usedOnRaw === null && note === null && !clearNote) {
    nothingToChange(["supply", "quantity", "used_on", "note", "clear"]);
  }
  const supplyId = supplyValue !== null ? await resolveSupplyParam(context, supplyValue) : current.supplyId;
  await withShortRefused(() =>
    updateSupplyOwnUse(context.ownerId, current.id, {
      supplyId,
      quantity: quantity !== null ? assertUnits(quantity, "quantity") : current.quantity,
      usedOn: usedOnRaw !== null ? parseIsoDate(usedOnRaw, "used_on") : current.usedAt.toISOString().slice(0, 10),
      note: clearNote ? null : (note ?? current.note),
    })
  );
  return supplyUseChange(context, supplyId, current.id);
}

export const updateSupplyUseOperation: Operation = {
  name: "update_supply_use",
  method: "PATCH",
  path: "/supply-uses/{useId}",
  description:
    "Correct a use without a sale: its supply, quantity, date or note. Only what is sent changes. Fewer units go back to the batches they came from; more are taken oldest first and refused if stock does not have them.",
  writes: true,
  parameters: [
    {
      name: "useId",
      in: "path",
      type: "string",
      required: true,
      description: "The use's id — `useId` in `get_packing_supply_history` or `record_supply_use`'s answer.",
    },
    { ...SUPPLY_PARAMETER, required: false },
    { ...USE_QUANTITY_PARAMETER, required: false },
    { ...USED_ON_PARAMETER, required: false },
    NOTE_PARAMETER,
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: "Send [\"note\"] to take the note off.",
      values: ["note"],
    },
  ],
  result: { kind: "object", description: "The use as it now stands, costed, and what the supply now has on hand." },
  handler: async (context, params) => editUse(context, params),
};
