import "server-only";
import { prisma } from "../../db";
import { setCopyStamp } from "../../item-candidates";
import { setPieceValuation } from "../../carrier-values";
import {
  FRANKINGS,
  VALUATION_METHODS,
  isFranking,
  isValuationMethod,
} from "../../piece-valuation";
import { invalidRequest, notFound } from "../errors";
import { optionalString, requiredString, stringList } from "../params";
import type { AgentCopyDetail } from "../collection-reads";
import type { Operation, OperationContext, ParsedParams } from "../types";
import { readCopy } from "./records";
import { stampIdsFromRefs } from "./stamp-refs";

// What a copy **is** — its stamp, or the stamps it might be (#1651, ADR-0065).
//
// The API's first write on a copy's identity. It is the app's own write (`setCopyStamp`), the one the
// copy dialog, identification and settling all go through, so every check the app makes is made here
// in the same words: at least one stamp, all from this collection, no candidate set on a copy that
// carries several stamps, and every variant of one umbrella stored as the umbrella. It creates no
// copy, as the purchase writes create none (#1390): a copy comes into being when the collector
// records it.

export async function setCopyStampFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentCopyDetail> {
  const copyId = requiredString(params, "copy_id");
  const copy = await prisma.item.findFirst({
    where: { id: copyId, collectionId: context.collectionId },
    select: { id: true },
  });
  if (!copy) {
    throw notFound(
      `No copy with id "${copyId}" is in this token's collection. Use \`list_holdings\` or \`search_collection\` to find the right id.`
    );
  }

  const refs = [...new Set(stringList(params, "stamp_ids"))];
  if (refs.length === 0) {
    throw invalidRequest(
      '"stamp_ids" is empty. Send the one stamp the copy is, or two or more it might be. Nothing was changed.'
    );
  }
  const stampIds = [...new Set(await stampIdsFromRefs(context, refs, "stamp_ids"))];
  const known = await prisma.stamp.count({
    where: { id: { in: stampIds }, collectionId: context.collectionId },
  });
  if (known !== stampIds.length) {
    throw invalidRequest(
      '"stamp_ids" names a stamp that is not in this collection. Use `search_collection` or `resolve_catalog_numbers` to find the right ids. Nothing was changed.'
    );
  }

  try {
    await setCopyStamp(context.ownerId, copyId, stampIds, optionalString(params, "note"));
  } catch (error) {
    // The domain's refusals are sentences a collector can act on; they reach the agent as such.
    throw invalidRequest(`${error instanceof Error ? error.message : String(error)} Nothing was changed.`);
  }
  return readCopy(context, Object.freeze({ copy_id: copyId }));
}

export const setCopyStampOperation: Operation = {
  name: "set_copy_stamp",
  method: "PATCH",
  path: "/copies/{copy_id}/stamp",
  description:
    "Say which stamp a copy is — or, when that cannot be decided from the piece, which stamps it might be: *Mi 123aI or 123bI* when the type is known and the colour is not, or *Mi 85 or Mi 101* when the watermark that tells two issues apart cannot be read. One stamp identifies the copy as that stamp (a stamp that has variants means *some variant of it, not known which*). Two or more record a **candidate set**: the copy is valued and listed for sale at its cheapest candidate, named *X or Y*, and marked as having its variant still to settle. Every variant of one stamp sent together is stored as that stamp. Use it to set a set, to narrow one (send fewer candidates), or to settle one (send the one it turned out to be). It changes an existing copy only — no copy is created — and is refused on a copy carrying several stamps.",
  writes: true,
  parameters: [
    {
      name: "copy_id",
      in: "path",
      type: "string",
      required: true,
      description: "The copy, as `list_holdings` or `get_copy` reports it.",
    },
    {
      name: "stamp_ids",
      in: "body",
      type: "string[]",
      required: true,
      description:
        "The stamp the copy is, or the two or more it might be — from `search_collection` or `resolve_catalog_numbers`, from one series or several. A stamp may also be named by its short number, `st 123`.",
    },
    {
      name: "note",
      in: "body",
      type: "string",
      required: false,
      description:
        "Why — what told the variants apart, or why they cannot be. Kept in the copy's refinement history when the copy is re-pointed.",
    },
  ],
  result: {
    kind: "object",
    description:
      "The copy as `get_copy` now reads it. A copy with a candidate set carries `candidates` — the label, each stamp, and either the stamp they share or `acrossTrees` — and `variantToSettle`.",
  },
  handler: async (context, params) => setCopyStampFromParams(context, params),
};

// How a piece is valued (#2359; ADR-0076): its franking and the copy's own valuation method. A
// separate write from the stamp's because it says nothing about what the copy is.

/** The `valuation_method` value that drops the copy's own method, so it follows its area. */
const FOLLOW_AREA = "area";

export async function setCopyValuationFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentCopyDetail> {
  const copyId = requiredString(params, "copy_id");
  const copy = await prisma.item.findFirst({
    where: { id: copyId, collectionId: context.collectionId },
    select: { id: true },
  });
  if (!copy) {
    throw notFound(
      `No copy with id "${copyId}" is in this token's collection. Use \`list_holdings\` or \`search_collection\` to find the right id.`
    );
  }
  const franking = optionalString(params, "franking");
  const method = optionalString(params, "valuation_method");
  if (franking === null && method === null) {
    throw invalidRequest(
      'Send "franking", "valuation_method" or both. Nothing was changed.'
    );
  }
  if (franking !== null && !isFranking(franking)) {
    throw invalidRequest(
      `"franking" must be one of ${FRANKINGS.join(", ")}. Nothing was changed.`
    );
  }
  if (method !== null && method !== FOLLOW_AREA && !isValuationMethod(method)) {
    throw invalidRequest(
      `"valuation_method" must be one of ${VALUATION_METHODS.join(", ")}, or "${FOLLOW_AREA}" to follow the copy's area. Nothing was changed.`
    );
  }
  await setPieceValuation(context.ownerId, copyId, {
    franking: franking ?? undefined,
    method: method === null ? undefined : isValuationMethod(method) ? method : null,
  });
  return readCopy(context, Object.freeze({ copy_id: copyId }));
}

export const setCopyValuationOperation: Operation = {
  name: "set_copy_valuation",
  method: "PATCH",
  path: "/copies/{copy_id}/valuation",
  description:
    "Say how a **piece** is valued — a cover, a fragment, several stamps on one piece of paper, whose catalogue value is computed from its stamps' prices by a valuation method. `franking` is how the cover was franked and posted: `rate_correct` (franked for the postal rate, the default), `philatelic_posted` (overfranked, a set cover and the like, genuinely posted) or `not_posted`. `valuation_method` is the copy's own method — `sum_of_used`, `michel`, `fischer` or `fischer_fp_fw_fm` — overriding the one its area gives, or `area` to follow the area again. Send either or both. It changes an existing copy only; on a copy that is not a piece the franking is kept for when it becomes one and changes no value.",
  writes: true,
  parameters: [
    {
      name: "copy_id",
      in: "path",
      type: "string",
      required: true,
      description: "The copy, as `list_holdings` or `get_copy` reports it.",
    },
    {
      name: "franking",
      in: "body",
      type: "string",
      required: false,
      description: "`rate_correct`, `philatelic_posted` or `not_posted`.",
    },
    {
      name: "valuation_method",
      in: "body",
      type: "string",
      required: false,
      description:
        "`sum_of_used`, `michel`, `fischer`, `fischer_fp_fw_fm`, or `area` to drop the copy's own method.",
    },
  ],
  result: {
    kind: "object",
    description:
      "The copy as `get_copy` now reads it; on a piece, `catalogValue.piece` names the method, where it came from, the franking and any missing price.",
  },
  handler: async (context, params) => setCopyValuationFromParams(context, params),
};
