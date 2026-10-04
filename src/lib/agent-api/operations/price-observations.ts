import "server-only";
import { prisma } from "../../db";
import { areaSubtreeIds } from "../../areas";
import { normalizeMarketCode } from "../../market-anchoring";
import { parseStampNoRef } from "../../quick-jump";
import {
  DuplicatePriceObservationError,
  PriceObservationError,
  createPriceObservation,
  deletePriceObservation,
  listPriceObservations,
  priceObservationRawOf,
  readPriceObservationViews,
  updatePriceObservation,
  type ObservationRateCache,
  type PriceObservationFilter,
  type PriceObservationRaw,
  type PriceObservationView,
} from "../../price-observations";
import { resolveAxisValue, unresolvedStampReason } from "../catalog-prices";
import { invalidRequest, isApiError, notFound } from "../errors";
import { listResponse, parseListWindow } from "../list";
import { optionalString, requiredString, stringList } from "../params";
import {
  NOT_ESTABLISHED,
  agentObservation,
  observationCountProblem,
  parseObservationSpec,
  summarizeObservations,
  type AgentObservationAnswer,
  type AgentObservationBatch,
  type AgentPriceObservation,
  type ObservationSpec,
} from "../price-observations";
import { resolveSeller } from "../purchase-reads";
import { resolveVocabularyValue, type VocabularyEntry } from "../vocabulary";
import { resolveCatalogStrings } from "./catalog";
import { loadAxes, type Axes } from "./catalog-prices";
import { loadSellerCandidates } from "./purchases";
import { loadStampLabels, resolveStampRefs } from "./stamp-refs";
import { readCollectionVocabulary } from "./vocabulary";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// **Realised prices from other people's auctions, through the agent API** (#1635; ADR-0063) — the
// bidding assistant reads them off Philasearch and similar results pages, often hundreds for one
// field, and records them here; it lists them, corrects them and deletes them. What an observation
// *is*, how it is judged and what it counts as are `price-observations.ts`'s and nothing here
// restates them: every write goes through the Valuation dialog's own `createPriceObservation` /
// `updatePriceObservation`, and every read is judged by the dialog's own `toView`, so *counted* means
// the same thing in both places.
//
// **A stamp is named as every other catalogue write names one** — an id, a short number, or a
// catalogue number in any catalogue through #1037's resolver — and **never guessed**: a number that
// names several stamps, or none, refuses its row. A number that names an unknown-variant umbrella is
// recorded on the umbrella, which is what the listing established, and is a hint until a variant is
// (ADR-0063 §3).
//
// **Contacts are matched and never created** (#1627's rule, and the collector's on #1635): a
// platform by `get_collection_vocabulary`'s names, a house by the address book. A house nobody knows
// refuses its row with the names close to it; `create_seller` adds one, with the market it sells in —
// a house naming no market counts as the home market, which is exactly what would let a German
// house's results anchor Polish valuations. So the domain is handed ids alone: given a name, its
// contact resolver would create one.
//
// **A source lot is recorded once.** The domain refuses a second observation of the same address, or
// of the same lot number in the same auction at the same house, and a batch answers that row
// `duplicate` with the one that has it.

// ── Shared ───────────────────────────────────────────────────────────────────

/** A refusal's sentence, for a row — an `ApiError`'s message with the values it would accept. */
function reasonOf(err: unknown): string {
  if (isApiError(err)) {
    const accepted = err.accepted && err.accepted.length > 0 ? ` Accepted: ${err.accepted.join(", ")}.` : "";
    return `${err.message}${accepted}`;
  }
  if (err instanceof PriceObservationError) return err.message;
  throw err;
}

/** A condition: a grade's name, or `?` for one the listing did not establish. */
function resolveCondition(value: string | null, axes: Axes): string | null {
  if (value === null || value.trim() === NOT_ESTABLISHED) return null;
  return resolveVocabularyValue(value, axes.conditions, { vocabulary: "condition", parameter: "condition" });
}

/** A certificate: a status's name, `none`, or `?` for whether there is one not being established. */
function resolveCertificate(
  value: string | null,
  axes: Axes
): { certificateStatusId: string | null; certificateUncertain: boolean } {
  if (value !== null && value.trim() === NOT_ESTABLISHED) {
    return { certificateStatusId: null, certificateUncertain: true };
  }
  return {
    certificateStatusId: resolveAxisValue(value, axes.certificates, "none", {
      vocabulary: "certificate status",
      parameter: "certificate",
    }),
    certificateUncertain: false,
  };
}

function resolveFormat(value: string | null, axes: Axes): string | null {
  return resolveAxisValue(value, axes.formats, "single", { vocabulary: "format", parameter: "format" });
}

function resolvePlatform(value: string, platforms: readonly VocabularyEntry[]): string {
  return resolveVocabularyValue(value, platforms, { vocabulary: "platform", parameter: "platform" });
}

/** A basis as sent: `hammer` or `all_in` (`all-in` read as the same), else the reason. */
function readBasis(value: string | null): string {
  if (value === null) return "hammer";
  const basis = value.trim().toLocaleLowerCase().replace("-", "_");
  if (basis !== "hammer" && basis !== "all_in") {
    throw invalidRequest(
      `"${value}" is not a price basis. Send \`hammer\` for the hammer price, or \`all_in\` for what the buyer paid with the premium.`,
      ["hammer", "all_in"]
    );
  }
  return basis;
}

/** What a house's own terms propose for an observation that does not state them (ADR-0063 §5). */
interface HouseTerms {
  readonly premium: string | null;
  readonly fee: string | null;
  readonly currency: string | null;
}

async function loadHouseTerms(context: OperationContext, houseIds: readonly string[]): Promise<Map<string, HouseTerms>> {
  if (houseIds.length === 0) return new Map();
  const rows = await prisma.contact.findMany({
    where: { id: { in: [...new Set(houseIds)] }, collectionId: context.collectionId },
    select: { id: true, buyerPremiumPercent: true, buyerPremiumFixed: true, defaultCurrency: true },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        premium: row.buyerPremiumPercent?.toFixed(2) ?? null,
        fee: row.buyerPremiumFixed?.toFixed(2) ?? null,
        currency: row.defaultCurrency ?? null,
      },
    ])
  );
}

/** Observations as the agent reads them, each with its stamp's short number and catalogue number. */
async function agentObservations(
  context: OperationContext,
  views: readonly PriceObservationView[]
): Promise<AgentPriceObservation[]> {
  const labels = await loadStampLabels(context, [...new Set(views.map((view) => view.stampId))]);
  return views.map((view) => {
    const label = labels.get(view.stampId);
    return agentObservation(view, label && { stampNo: label.stampNo, catalogNumber: label.catalogNumbers[0] ?? label.name });
  });
}

/** The observation this call is about, proved to be in the token's collection. */
async function loadObservation(context: OperationContext, observationId: string): Promise<PriceObservationView> {
  const view = (await readPriceObservationViews(context.collectionId, [observationId])).get(observationId);
  if (!view) {
    throw notFound(
      `No price observation with id "${observationId}" is in this token's collection. \`list_price_observations\` gives an observation's id.`
    );
  }
  return view;
}

// ── record_price_observations ────────────────────────────────────────────────

/**
 * Every row's `stamp`, resolved once for the batch and answered per row: an id here, a short number
 * (`st 123`), or a catalogue number naming exactly one stamp. Anything else is the row's refusal.
 */
async function resolveRowStamps(
  context: OperationContext,
  refs: readonly string[]
): Promise<Map<string, { stampId: string } | { reason: string }>> {
  const wanted = [...new Set(refs.map((ref) => ref.trim()))];
  const out = new Map<string, { stampId: string } | { reason: string }>();

  const shortRefs = wanted.filter((ref) => parseStampNoRef(ref) !== null);
  const numbers = shortRefs.map((ref) => parseStampNoRef(ref)!);
  const byNo =
    numbers.length === 0
      ? []
      : await prisma.stamp.findMany({
          where: { collectionId: context.collectionId, stampNo: { in: numbers } },
          select: { id: true, stampNo: true },
        });
  const idByNo = new Map(byNo.map((row) => [row.stampNo, row.id]));
  shortRefs.forEach((ref, i) => {
    const id = idByNo.get(numbers[i]);
    out.set(ref, id ? { stampId: id } : { reason: `No stamp ${ref} is in this collection.` });
  });

  const rest = wanted.filter((ref) => !out.has(ref));
  const byId = await prisma.stamp.findMany({
    where: { id: { in: rest }, collectionId: context.collectionId },
    select: { id: true },
  });
  for (const row of byId) out.set(row.id, { stampId: row.id });

  const catalogue = rest.filter((ref) => !out.has(ref));
  const resolutions = await resolveCatalogStrings(context, catalogue);
  catalogue.forEach((ref, i) => {
    const resolution = resolutions[i];
    out.set(
      ref,
      resolution.verdict === "resolved"
        ? { stampId: resolution.stamps[0].stampId }
        : { reason: unresolvedStampReason(resolution) }
    );
  });
  return out;
}

/** One row as the domain's form takes it, or the reason it cannot be one. Ids only, never names. */
function rowRaw(
  spec: ObservationSpec,
  resolved: {
    axes: Axes;
    platforms: readonly VocabularyEntry[];
    houseId: string | null;
    terms: HouseTerms | null;
  }
): PriceObservationRaw {
  const { certificateStatusId, certificateUncertain } = resolveCertificate(
    spec.certificateUncertain ? NOT_ESTABLISHED : spec.certificate,
    resolved.axes
  );
  const currency = spec.currency ?? resolved.terms?.currency ?? null;
  if (currency === null) {
    throw invalidRequest(
      `The observation has no \`currency\`${resolved.houseId ? ", and its house has no usual currency" : ""}. Send the currency the price is in, such as \`currency=EUR\`.`
    );
  }
  return {
    conditionId: resolveCondition(spec.condition, resolved.axes),
    certificateStatusId,
    certificateUncertain,
    formatId: resolveFormat(spec.format, resolved.axes),
    price: spec.price,
    currency,
    priceBasis: readBasis(spec.basis),
    premiumPercent: spec.premium ?? resolved.terms?.premium ?? "",
    premiumFixed: spec.fee ?? resolved.terms?.fee ?? "",
    soldOn: spec.soldOn,
    platformId: resolvePlatform(spec.platform, resolved.platforms),
    platformName: null,
    auctionHouseId: resolved.houseId,
    auctionHouseName: null,
    auctionName: spec.auction ?? "",
    lotNo: spec.lot ?? "",
    url: spec.url ?? "",
  };
}

export async function recordPriceObservations(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentObservationBatch> {
  const entries = stringList(params, "observations");
  const problem = observationCountProblem(entries.length);
  if (problem) throw invalidRequest(problem);

  const parsed = entries.map((entry) => parseObservationSpec(entry));
  const specs = parsed.flatMap((p) => (p.ok ? [p.spec] : []));
  const [stamps, axes, vocabulary, candidates] = await Promise.all([
    resolveRowStamps(context, specs.map((spec) => spec.stamp)),
    loadAxes(context),
    readCollectionVocabulary(context),
    loadSellerCandidates(context),
  ]);
  const houseOf = (spec: ObservationSpec): string | null =>
    spec.house === null ? null : resolveSeller(spec.house, candidates, "house");
  const houseIds = specs.flatMap((spec) => {
    try {
      const id = houseOf(spec);
      return id ? [id] : [];
    } catch {
      return [];
    }
  });
  const terms = await loadHouseTerms(context, houseIds);

  // Rows are written one at a time, in the order sent, so a later row of the batch is a duplicate of
  // an earlier one exactly as it would be of a row written yesterday.
  const rateCache: ObservationRateCache = new Map();
  const outcomes: { entry: string; id?: string; duplicateOf?: string; reason?: string }[] = [];
  for (const [i, p] of parsed.entries()) {
    const entry = entries[i];
    if (!p.ok) {
      outcomes.push({ entry, reason: p.reason });
      continue;
    }
    const stamp = stamps.get(p.spec.stamp.trim())!;
    if ("reason" in stamp) {
      outcomes.push({ entry, reason: stamp.reason });
      continue;
    }
    try {
      const houseId = houseOf(p.spec);
      const raw = rowRaw(p.spec, {
        axes,
        platforms: vocabulary.platforms,
        houseId,
        terms: houseId ? (terms.get(houseId) ?? null) : null,
      });
      const id = await createPriceObservation(context.ownerId, stamp.stampId, raw, { rateCache });
      outcomes.push({ entry, id });
    } catch (err) {
      if (err instanceof DuplicatePriceObservationError) {
        outcomes.push({ entry, duplicateOf: err.existingId, reason: err.message });
      } else {
        outcomes.push({ entry, reason: reasonOf(err) });
      }
    }
  }

  const recordedIds = outcomes.flatMap((o) => (o.id ? [o.id] : []));
  const views = await readPriceObservationViews(context.collectionId, recordedIds);
  const read = new Map(
    (await agentObservations(context, recordedIds.map((id) => views.get(id)!))).map((o) => [o.id, o])
  );
  const answers: AgentObservationAnswer[] = outcomes.map((o) => {
    if (o.id) return { entry: o.entry, outcome: "recorded", observation: read.get(o.id) };
    if (o.duplicateOf) {
      return { entry: o.entry, outcome: "duplicate", duplicateOf: o.duplicateOf, reason: o.reason };
    }
    return { entry: o.entry, outcome: "refused", reason: o.reason };
  });
  return summarizeObservations(answers);
}

export const recordPriceObservationsOperation: Operation = {
  name: "record_price_observations",
  method: "POST",
  path: "/price-observations",
  description:
    "Record realised prices from other people's auctions — a results page read off Philasearch, a house's price list, an ended Allegro offer — many at a time. An observation is a market fact, never the collector's purchase or lot: it shows on no watchlist and in no purchase history. One whose stamp, condition and certificate are all established, sold in a market that anchors the stamp's area, counts in the stamp's market value and teaches the realization ratio behind `recommend_bid`; any other is kept as a hint, and the answer says which and why. A stamp is named by id, short number or a catalogue number in any catalogue the collection keeps; a number naming several stamps or none refuses its row — nothing is guessed — and a number naming only an umbrella (variant not established) is recorded on it as a hint. Write `condition=?` or `certificate=?` when the listing does not establish one. The price is converted at the ECB rate of the sale's day. A house's usual premium, fee and currency fill those it does not state. A source lot already recorded — the same address, or the same lot number in the same auction at the same house (or platform, without one) — is answered `duplicate` and not recorded again. The platform and the house must be contacts already: an unknown one refuses its row with the names close to it — `create_seller` adds a house, with its market. Each row is answered on its own, and a refused row does not stop the others.",
  writes: true,
  parameters: [
    {
      name: "observations",
      in: "body",
      type: "string[]",
      required: true,
      description:
        "One observation per entry, at most 100, as `name=value` pairs separated by `;`: `stamp=Mi 5; condition=MNH; price=120; currency=EUR; sold_on=2024-03-14; platform=Philasearch; house=Köhler; auction=412; lot=1234; url=https://…`. Required: `stamp` (id, `st 123`, or a catalogue number such as `Mi 5a`), `price` (as the page states it), `sold_on` (yyyy-mm-dd) and `platform` (a platform's name from `get_collection_vocabulary`, or its id). `currency` is required unless the house has a usual one. Optional: `condition` (a name, abbreviation or id; `?` when not established — then it is a hint), `certificate` (default `none`; `?` when not established), `format` (default `single`), `basis` (`hammer`, the default, or `all_in` for a price with the premium in it), `premium` (the buyer's premium in percent) and `fee` (a per-lot fee), `house` (the auction house — a contact's name or id; leave it out for a marketplace seller), `auction` (the house's sale, as it names it), `lot` (the lot number) and `url` (the result's address).",
    },
  ],
  result: {
    kind: "object",
    description:
      "The counts `recorded`, `duplicate` and `refused`, `counted` — how many of the recorded ones count in a market value now — and `observations` in the order sent, each with the `entry` as sent and its `outcome`: `recorded` with `observation` as `list_price_observations` reads it (so `counted`, `notCounted` with `notCountedReason`, `doubts` and `market` say at once whether and why it counts); `duplicate` with `duplicateOf`, the observation already recording that lot; `refused` with `reason`.",
  },
  handler: async (context, params) => recordPriceObservations(context, params),
};

// ── list_price_observations ──────────────────────────────────────────────────

async function listObservations(context: OperationContext, params: ParsedParams) {
  const window = parseListWindow(params);
  const filter: PriceObservationFilter = {};

  const stamp = optionalString(params, "stamp");
  if (stamp !== null) filter.stampIds = await resolveStampRefs(context, [stamp], "stamp");

  const [vocabulary, candidates] = await Promise.all([
    readCollectionVocabulary(context),
    optionalString(params, "house") === null ? Promise.resolve([]) : loadSellerCandidates(context),
  ]);
  const area = optionalString(params, "area");
  if (area !== null) {
    const areaId = resolveVocabularyValue(area, vocabulary.areas, { vocabulary: "area", parameter: "area" });
    filter.areaIds = await areaSubtreeIds(context.collectionId, areaId);
  }
  const market = optionalString(params, "market");
  if (market !== null) {
    const code = normalizeMarketCode(market);
    if (!code) throw invalidRequest(`"market" is a two-letter country code, such as DE or PL; "${market}" is not one.`);
    filter.market = code;
  }
  const platform = optionalString(params, "platform");
  if (platform !== null) filter.platformId = resolvePlatform(platform, vocabulary.platforms);
  const house = optionalString(params, "house");
  if (house !== null) filter.auctionHouseId = resolveSeller(house, candidates, "house");
  const soldFrom = optionalString(params, "sold_from");
  if (soldFrom !== null) filter.soldFrom = parseDayParam(soldFrom, "sold_from");
  const soldTo = optionalString(params, "sold_to");
  if (soldTo !== null) filter.soldTo = parseDayParam(soldTo, "sold_to");

  const page = await listPriceObservations(context.ownerId, context.collectionId, filter, window);
  return listResponse(await agentObservations(context, page.observations), page.total, window);
}

function parseDayParam(value: string, parameter: string): Date {
  const trimmed = value.trim();
  const date = new Date(`${trimmed}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) {
    throw invalidRequest(`"${parameter}" must be a day, yyyy-mm-dd; "${value}" is not one.`);
  }
  return date;
}

export const listPriceObservationsOperation: Operation = {
  name: "list_price_observations",
  method: "GET",
  path: "/price-observations",
  description:
    "The realised prices recorded from other people's auctions, newest sale first — narrowed to a stamp, an area and everything nested under it, the market a result counts in, a platform, a house or a span of sale days, in any combination. Each says whether it counts in its stamp's market value and, if not, why: not everything established (a hint), no exchange rate for its day, or a market that does not anchor the stamp's area. Use it to check what is already recorded before recording a page, and to find an observation to correct or delete.",
  writes: false,
  parameters: [
    {
      name: "stamp",
      in: "query",
      type: "string",
      required: false,
      description: "Only this stamp's observations — its id, short number (`st 123`) or a catalogue number naming only it.",
    },
    {
      name: "area",
      in: "query",
      type: "string",
      required: false,
      description: "Only stamps filed in this area or any area nested under it — its name from `get_collection_vocabulary`, or its id.",
    },
    {
      name: "market",
      in: "query",
      type: "string",
      required: false,
      description:
        "Only results counting in this market, a two-letter country code: the house's market, else the platform's — and asking for the collection's home market also finds results whose contacts name none, which count there.",
    },
    {
      name: "platform",
      in: "query",
      type: "string",
      required: false,
      description: "Only results from this platform — its name from `get_collection_vocabulary`, or its id.",
    },
    {
      name: "house",
      in: "query",
      type: "string",
      required: false,
      description: "Only results from this auction house — a contact's name or id.",
    },
    {
      name: "sold_from",
      in: "query",
      type: "string",
      required: false,
      description: "Only results sold on or after this day, yyyy-mm-dd.",
    },
    {
      name: "sold_to",
      in: "query",
      type: "string",
      required: false,
      description: "Only results sold on or before this day, yyyy-mm-dd.",
    },
  ],
  result: {
    kind: "list",
    description:
      "One row per observation: `id`, `stampId`, `stampNo`, `stamp` (its catalogue number), `condition`, `certificate` (`?` where not established) and `format` (absent for none and single), `price` and `currency` as observed, `basis` (`hammer` or `all_in`), `premium` and `fee`, the price both ways as `hammer` and `allIn`, `soldOn`, `rateToBase` (the ECB rate of that day), `counted`, `countedAmount` in `baseCurrency` when counted, else `notCounted` (`uncertain`, `no-rate`, `no-hammer`, `other-market`) with `notCountedReason`, `doubts` (`variant`, `condition`, `certificate`), `market`, `platform`, `house`, `auction`, `lot` and `url`.",
  },
  handler: async (context, params) => listObservations(context, params),
};

// ── update_price_observation ─────────────────────────────────────────────────

/** The fields `clear` may empty. */
const CLEARABLE = ["premium", "fee", "house", "auction", "lot", "url"] as const;

const OBSERVATION_ID: ParameterSpec = {
  name: "observationId",
  in: "path",
  type: "string",
  required: true,
  description: "The observation's id, from `list_price_observations` or `record_price_observations`.",
};

export async function correctPriceObservation(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentPriceObservation> {
  const observationId = requiredString(params, "observationId");
  const current = await loadObservation(context, observationId);
  const raw = priceObservationRawOf(current);
  const clear = new Set(stringList(params, "clear"));
  const sent = (name: string): string | null => {
    const value = optionalString(params, name);
    if (value !== null && clear.has(name)) {
      throw invalidRequest(`"${name}" is both sent and named in "clear". Send one or the other.`);
    }
    return value;
  };

  let changed = clear.size > 0;
  const stamp = sent("stamp");
  if (stamp !== null) {
    [raw.stampId] = await resolveStampRefs(context, [stamp], "stamp");
    changed = true;
  }
  const condition = sent("condition");
  const certificate = sent("certificate");
  const format = sent("format");
  if (condition !== null || certificate !== null || format !== null) {
    const axes = await loadAxes(context);
    if (condition !== null) raw.conditionId = resolveCondition(condition, axes);
    if (certificate !== null) Object.assign(raw, resolveCertificate(certificate, axes));
    if (format !== null) raw.formatId = resolveFormat(format, axes);
    changed = true;
  }
  const scalar = (name: string, apply: (value: string) => void) => {
    const value = sent(name);
    if (value !== null) {
      apply(value);
      changed = true;
    }
  };
  scalar("price", (value) => (raw.price = value));
  scalar("currency", (value) => (raw.currency = value));
  scalar("basis", (value) => (raw.priceBasis = readBasis(value)));
  scalar("premium", (value) => (raw.premiumPercent = value));
  scalar("fee", (value) => (raw.premiumFixed = value));
  scalar("sold_on", (value) => (raw.soldOn = value));
  scalar("auction", (value) => (raw.auctionName = value));
  scalar("lot", (value) => (raw.lotNo = value));
  scalar("url", (value) => (raw.url = value));
  const platform = sent("platform");
  const house = sent("house");
  if (platform !== null) {
    raw.platformId = resolvePlatform(platform, (await readCollectionVocabulary(context)).platforms);
    changed = true;
  }
  if (house !== null) {
    raw.auctionHouseId = resolveSeller(house, await loadSellerCandidates(context), "house");
    changed = true;
  }
  if (clear.has("premium")) raw.premiumPercent = "";
  if (clear.has("fee")) raw.premiumFixed = "";
  if (clear.has("house")) raw.auctionHouseId = null;
  if (clear.has("auction")) raw.auctionName = "";
  if (clear.has("lot")) raw.lotNo = "";
  if (clear.has("url")) raw.url = "";
  if (!changed) throw invalidRequest("Nothing to change was sent. Send a field to correct, or `clear`.");

  try {
    await updatePriceObservation(context.ownerId, observationId, raw);
  } catch (err) {
    if (err instanceof DuplicatePriceObservationError) {
      throw invalidRequest(
        `${err.message} The observation already recording it is ${err.existingId}; correct or delete that one instead. Nothing was changed.`,
        [err.existingId]
      );
    }
    if (err instanceof PriceObservationError) throw invalidRequest(`${err.message} Nothing was changed.`);
    throw err;
  }
  const [read] = await agentObservations(context, [await loadObservation(context, observationId)]);
  return read;
}

export const updatePriceObservationOperation: Operation = {
  name: "update_price_observation",
  method: "PATCH",
  path: "/price-observations/{observationId}",
  description:
    "Correct a recorded price observation — a misread price, day or lot, a condition or variant established later, the wrong house. Only what is sent changes; `clear` empties an optional field. A new stamp moves it, named as `record_price_observations` names one. A new day or currency reads that day's ECB rate again, as does any correction of one with no rate yet. A correction making it the same source lot as another observation is refused with that one.",
  writes: true,
  parameters: [
    OBSERVATION_ID,
    { name: "stamp", in: "body", type: "string", required: false, description: "Move it to this stamp — an id, `st 123`, or a catalogue number naming only it." },
    { name: "condition", in: "body", type: "string", required: false, description: "A grade's name, abbreviation or id; `?` when the listing does not establish it." },
    { name: "certificate", in: "body", type: "string", required: false, description: "A certificate status's name or id, `none`, or `?` when whether there is one is not established." },
    { name: "format", in: "body", type: "string", required: false, description: "A format's name or id; `single` for a single stamp." },
    { name: "price", in: "body", type: "string", required: false, description: "The price as the page states it." },
    { name: "currency", in: "body", type: "string", required: false, description: "The currency of the price, such as EUR." },
    { name: "basis", in: "body", type: "string", required: false, description: "`hammer`, or `all_in` for a price with the premium in it." },
    { name: "premium", in: "body", type: "string", required: false, description: "The buyer's premium, in percent." },
    { name: "fee", in: "body", type: "string", required: false, description: "A per-lot fee, in the price's currency." },
    { name: "sold_on", in: "body", type: "string", required: false, description: "The day of the sale, yyyy-mm-dd." },
    { name: "platform", in: "body", type: "string", required: false, description: "The platform's name from `get_collection_vocabulary`, or its id." },
    { name: "house", in: "body", type: "string", required: false, description: "The auction house — a contact's name or id; `create_seller` adds one." },
    { name: "auction", in: "body", type: "string", required: false, description: "The house's sale, as it names it." },
    { name: "lot", in: "body", type: "string", required: false, description: "The lot number." },
    { name: "url", in: "body", type: "string", required: false, description: "The result's address." },
    {
      name: "clear",
      in: "body",
      type: "string[]",
      required: false,
      description: "Optional fields to empty: the premium, the fee, the house, the auction, the lot number or the address.",
      values: CLEARABLE,
    },
  ],
  result: {
    kind: "object",
    description: "The observation as it now stands, in `list_price_observations`' shape.",
  },
  handler: async (context, params) => correctPriceObservation(context, params),
};

// ── delete_price_observation ─────────────────────────────────────────────────

async function removeObservation(context: OperationContext, params: ParsedParams) {
  const observationId = requiredString(params, "observationId");
  const view = await loadObservation(context, observationId);
  await deletePriceObservation(context.ownerId, observationId);
  return { deleted: observationId, stampId: view.stampId };
}

export const deletePriceObservationOperation: Operation = {
  name: "delete_price_observation",
  method: "DELETE",
  path: "/price-observations/{observationId}",
  description:
    "Delete a price observation recorded by mistake — one that is not a result of this stamp at all. It leaves every figure it was in. To fix a misread field, correct it with `update_price_observation` instead.",
  writes: true,
  parameters: [OBSERVATION_ID],
  result: { kind: "object", description: "`deleted`, the observation's id, and `stampId`, the stamp it was recorded on." },
  handler: async (context, params) => removeObservation(context, params),
};
