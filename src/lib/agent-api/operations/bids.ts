import "server-only";
import { COMMON_CURRENCIES } from "../../currencies";
import { recommendBidForLines } from "../../bid-recommendations";
import { bidLine, bidRecommendation } from "../bid-reads";
import { invalidRequest, notFound } from "../errors";
import { optionalInteger, optionalString, requiredString, stringList } from "../params";
import { resolveOptionalVocabularyValue, resolveVocabularyValue } from "../vocabulary";
import { readCollectionVocabulary } from "./vocabulary";
import type { AgentBidRecommendation } from "../bid-reads";
import type { Operation, OperationContext, ParameterSpec, ParsedParams } from "../types";

// **What a lot is worth bidding, for a lot this collection does not hold** (#1168) — the fourth
// agent workflow, and the first that is a query about something no record here describes.
//
// ## The workflow, because it decides the shape
//
// The agent is deciding **whether an auction is worth looking at at all**. There is no
// `AuctionSale`, no `AuctionLot` and no `AuctionLotLine`: it has the auctioneer's description of a
// stamp and an opening price, and it wants one thing — if the opening price is above the
// recommendation, drop it and move on. So this is a **stateless query** rather than a read of
// anything, and `writes: false` is literal: it stores nothing at all.
//
// ## Why the agent must not do this arithmetic itself
//
// `find_unlisted_copies` already hands it `catalogValue` and `marketValue` and its own description
// says what they are: *"they answer different questions, so both are given and neither is a
// recommendation."* A bid recommendation is arithmetic **over** those — an anchor per line,
// quantity multiplying it (ADR-0020), a band in percent of the fair figure (#508), and the buyer's
// premium subtracted to get from an all-in valuation to the hammer price that may be typed. An
// agent reconstructing that from two numbers would be **a second valuation rule beside the existing
// one**, which is the defect class this page forbids and the one no test can see.
//
// **So this operation computes nothing.** `recommendBidForLines` goes through `valuateLineSpecs`
// (`valuateItemRows`, the unknown-variant rollup #238, format pricing ADR-0020, `lotLineValueOf`),
// `loadAnchorContext` + `anchorLine` (#510's market-then-catalogue-times-learned-ratio rule) and
// `recommendBid` (#509) — **every one of them the same function the lots screen goes through**. The
// agent's figure and the figure on the lot row are one figure by construction.
//
// ## The four questions #1168 named, and how each is answered
//
// | question | answer |
// | --- | --- |
// | currency | the caller names one; default the collection's base currency |
// | fees | two optional parameters, and the answer **echoes what it used** |
// | how the stamp is named | `stamp_ids` from `search_collection`, not #708's resolver |
// | one line or several | several, in `match_wants`' shape: the stamps, at one grade |
//
// **Currency.** The three figures are all-in in *some* currency and the fees are in that same one,
// so answering in the collector's base currency about a house listing in EUR would be arithmetic on
// nothing. The default is the base currency because it always has a rate, and because it is the one
// currency `get_collection_vocabulary` already hands over as a scalar. **`unconvertible` survives
// it**: a market median with no rate into the currency asked for is reported as unconvertible and
// never as unpriced, exactly as a sale currency with no rate behaves on the lots screen.
//
// **Fees** are `bid-reads.ts`'s subject and the reasoning is there rather than repeated here.
//
// **How the stamp is named — and #708's resolver is *not* the route for this half.** #708 resolves
// per-collection, cuid-keyed **vocabularies**, and a stamp is not one of them; it has no vocabulary
// entry to match a name against. The established route for a stamp id on this surface is
// `search_collection` (#710), which is what `list_wants`, `match_wants`, `list_holdings` and
// `find_checklist_gaps` all say, and it searches catalogue numbers over free text — which is
// exactly what the agent holds. #708's resolver **does** own the other three axes, and it is used
// for every one of them.
//
// **One line or several: several.** An auction lot is usually a run, `recommendBid` already takes a
// list and ADR-0029 §6 makes a lot the sum of its lines. #706 keeps parameter types to scalars and
// string lists, so a per-line object is not expressible without widening the surface for one
// operation — and `match_wants` met the identical problem and answered it with a list of stamps at
// one stated grade. **What that cannot express is a lot mixing grades**, which is said on the
// operation rather than left to be discovered: calling twice and adding does not substitute for it,
// because a fixed premium is charged once per lot and two answers are therefore not additive.

/**
 * How many lines one question may describe.
 *
 * **Hard, and refused rather than trimmed**, which is the list conventions' own rule (#706) for the
 * same reason: an answer built from part of what was asked, with nothing saying so, is a confident
 * answer to a different question — and here it would be a *fair* figure quietly missing lines.
 */
export const MAX_BID_LINES = 100;

const PARAMETERS: readonly ParameterSpec[] = [
  {
    name: "stamp_ids",
    in: "query",
    type: "string[]",
    required: true,
    description:
      "The stamps the lot is described as holding, resolved to this collection's own ids with `search_collection` — which searches catalogue numbers, so the auctioneer's `Mi 1-12` is what you search for. One id for a single-stamp lot; the whole run for a set. Send the stamps at one grade per call.",
  },
  {
    name: "condition",
    in: "query",
    type: "string",
    required: true,
    description:
      "The grade the lot is described as being in. Required, and not for tidiness: a catalogue prices each grade separately and a market median is kept per grade, so what a lot is worth is unanswerable about material whose grade is unstated. Takes a name or abbreviation from `get_collection_vocabulary` (`MNH` works) or an id.",
  },
  {
    name: "certificate",
    in: "query",
    type: "string",
    required: false,
    description:
      "The certificate the lot is described as carrying. Leave it out for a lot with none, which is what most are — matching is exact, so a lot with an Attest is priced only where a price exists at that level.",
  },
  {
    name: "format",
    in: "query",
    type: "string",
    required: false,
    description:
      "The physical format: a pair, a block, a strip. Leave it out for singles. A multiple is never valued as so many singles — it is priced at its own figure, or at the single's times this collection's factor for that format, and is otherwise unpriced.",
  },
  {
    name: "quantity",
    in: "query",
    type: "integer",
    required: false,
    description:
      "How many of each stamp the lot holds, at that grade. Defaults to 1, which is the usual case for a run. A block of four is one of these at the block format, never four singles.",
  },
  {
    name: "currency",
    in: "query",
    type: "string",
    required: false,
    description:
      "The currency to answer in — the auction house's, so the figures can be compared with the opening price as it is printed. Defaults to the collection's base currency, which `get_collection_vocabulary` states.",
    values: COMMON_CURRENCIES,
  },
  {
    name: "premium_percent",
    in: "query",
    type: "string",
    required: false,
    description:
      "The buyer's premium this house charges, as a percentage of the hammer price — `20` for 20%, `22.5` for 22.5%. Send it as text so nothing is lost rounding it. **Leave it out and the hammer prices come back equal to the all-in valuations, which overstates what you may bid**; the answer says which fees it used, so you can tell.",
  },
  {
    name: "premium_fixed",
    in: "query",
    type: "string",
    required: false,
    description:
      "A flat per-lot fee charged on top of the percentage, in the same currency as the answer. Both apply — a house charging 20% plus a lot fee is one set of terms, not two. Shipping is deliberately not taken: it belongs to the parcel rather than to the lot.",
  },
];

/** A money-ish parameter, refused rather than silently read as zero. */
function feeAmount(params: ParsedParams, name: string, what: string): string | undefined {
  const raw = optionalString(params, name);
  if (raw === null) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw invalidRequest(
      `"${raw}" is not ${what}. Send a number with at most two decimal places, as text — \`20\` or \`22.5\`.`
    );
  }
  return raw;
}

export async function readBidRecommendation(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentBidRecommendation> {
  const vocabulary = await readCollectionVocabulary(context);

  // Duplicates collapse: a lot holding the same stamp twice at the same grade is one line of
  // quantity two, which is what `quantity` is for. Two identical lines would double the figure.
  const stampIds = [...new Set(stringList(params, "stamp_ids"))];
  if (stampIds.length === 0) {
    throw invalidRequest(
      '"stamp_ids" is empty. Resolve the stamps the lot is described as holding with `search_collection` and send their ids.'
    );
  }
  if (stampIds.length > MAX_BID_LINES) {
    throw invalidRequest(
      `A recommendation covers at most ${MAX_BID_LINES} stamps and ${stampIds.length} were sent. Ask about the lot in parts — but note the figures are not additive across calls, because a fixed premium is charged once per lot.`
    );
  }

  const conditionId = resolveVocabularyValue(
    requiredString(params, "condition"),
    vocabulary.conditions,
    { vocabulary: "condition", parameter: "condition" }
  );
  const certificateStatusId = resolveOptionalVocabularyValue(
    optionalString(params, "certificate"),
    vocabulary.certificateStatuses,
    { vocabulary: "certificate status", parameter: "certificate" }
  );
  const formatId = resolveOptionalVocabularyValue(
    optionalString(params, "format"),
    vocabulary.formats,
    { vocabulary: "format", parameter: "format" }
  );

  const quantity = optionalInteger(params, "quantity") ?? 1;
  if (quantity < 1) {
    throw invalidRequest(
      `"quantity" is ${quantity}. A lot holds at least one of each stamp it is described as holding.`
    );
  }

  const currency = optionalString(params, "currency") ?? vocabulary.baseCurrency;
  const result = await recommendBidForLines(
    context.collectionId,
    currency,
    stampIds.map((stampId) => ({
      stampId,
      conditionId,
      certificateStatusId,
      formatId,
      quantity,
    })),
    {
      premiumPercent: feeAmount(params, "premium_percent", "a percentage"),
      premiumFixed: feeAmount(params, "premium_fixed", "an amount"),
    }
  );

  // **A stamp that is not in this collection is refused rather than quietly dropped**, which is
  // `match_wants`' rule and #710's: a line missing from the sum would make `fair` read as the
  // lot's worth while describing less than the lot, and the mistake behind it — an id from
  // somewhere other than this collection — is one the agent can fix in one turn.
  if (result.unknownStampIds.length > 0) {
    const count = result.unknownStampIds.length;
    throw notFound(
      `${count === 1 ? "This stamp is" : `${count} of these stamps are`} not in this token's collection: ${result.unknownStampIds.slice(0, 5).join(", ")}. Resolve them with \`search_collection\` first — a recommendation that silently left them out would describe a smaller lot than the one you asked about.`
    );
  }

  const conditionName =
    vocabulary.conditions.find((entry) => entry.id === conditionId)?.name ?? conditionId;
  const certificateName =
    certificateStatusId === null
      ? null
      : (vocabulary.certificateStatuses.find((entry) => entry.id === certificateStatusId)?.name ??
        certificateStatusId);
  const formatName =
    formatId === null
      ? null
      : (vocabulary.formats.find((entry) => entry.id === formatId)?.name ?? formatId);

  return bidRecommendation(
    result,
    result.lines.map((line) =>
      bidLine(line, {
        condition: conditionName,
        certificate: certificateName,
        format: formatName,
      })
    )
  );
}

export const recommendBidOperation: Operation = {
  name: "recommend_bid",
  method: "GET",
  path: "/bid-recommendation",
  description:
    "What a lot would be worth bidding, for a lot nothing here records — an auction you are deciding whether to look at at all. Describe what the auctioneer says the lot holds (the stamps, the grade, the certificate, the format, how many of each) and get back three figures: a floor under which it is a bargain, a fair figure the recorded evidence supports, and a walk-away past which it belongs to somebody else. If the opening price is above the walk-away, drop it. Nothing is created and nothing is stored; this reads the collection's own price evidence and computes. Do **not** work this out yourself from `catalogValue` and `marketValue` — those are evidence and neither is a recommendation, and an arithmetic of your own would disagree with what the collector sees on their own screen.",
  writes: false,
  parameters: PARAMETERS,
  result: {
    kind: "object",
    description:
      "Three levels, each stated twice: `allIn` is what the lot is worth **including** the buyer's premium, and `bid` is the highest hammer price whose all-in still fits inside it — the figure a bid box takes. **`bid` is absent when the fees alone consume the level**, which is a real answer and not a zero: at that premium there is no hammer price that stays inside the figure. **All three levels are absent when nothing could price a single line** — a lot that cannot be valued is unanswered, not worthless — so `fair` missing is never `0.00`. Three unpriceable cases are kept apart and must stay apart when you report them: `unanchoredLines` counts lines nothing prices at all, `unconvertibleLines` counts lines that **have** a value which no rate carries into this currency (those are priced, and telling the collector to enter a value would be wrong), and a consumed level is the third. The figures cover only the lines that were anchored, so a non-zero count of either means the total is partial. Each line says what anchored it: `market` is a median of what copies of that exact key actually fetched, with its sample size; `catalogue` is the book's figure times the ratio this collection's own auction results have learned for that area, grade and period, with the bucket named so it can be argued with. `owned` is how many the collection already holds — evidence for you to weigh, never something that moved a figure. `floorPercent` and `walkAwayPercent` are the collector's own trading style rather than a measured spread. `premiumPercent` and `premiumFixed` echo the fees you sent; if they are absent, no fees were applied and every `bid` equals its `allIn`, which **overstates** what may actually be bid. The figures describe the one grade you asked about: a lot mixing grades cannot be answered in one call, and answers from two calls do not add, because a fixed premium is charged once per lot.",
  },
  handler: async (context, params) => readBidRecommendation(context, params),
};
