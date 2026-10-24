import "server-only";
import { prisma } from "../../db";
import { reparentStampNode } from "../../issues";
import { deleteStamp } from "../../stamps";
import { invalidRequest, notFound } from "../errors";
import { optionalBoolean, optionalString, requiredString } from "../params";
import { variantHeldMessage, type VariantHolders } from "../variant-tree";
import { collectionPath, loadCollectionHeader } from "./reads-shared";
import { loadStampLabels, resolveStampRefs, stampIdFromRef, type StampLabel } from "./stamp-refs";
import type { Operation, OperationContext, ParsedParams } from "../types";

// The variant tree (#2140): move a stamp under another stamp of its issue, bring a variant up to
// stand on its own, and delete a variant nothing names. It lifts #1438's *nothing is deleted or
// moved* for the variant tree and for nothing else — base stamps, issues and catalogue numbers are
// still never deleted here, and no stamp moves between issues or is reordered.
//
// **Each is the stamp screen's own write.** A move is `reparentStampNode`, the tree row's *Move under
// another stamp…*, so its rules are the screen's: the parent is a member of the same issue, no stamp
// goes under its own variant, a stamp arriving under a parent with no subtype takes the collection's
// default, and it lands at the end of its new siblings. Its catalogue numbers, prices, size and
// checklist places are facts about the stamp and stay. A delete is `deleteStamp`, the delete dialog's.
//
// **The delete refuses more than the screen does**, and that is the collector's decision
// (2026-10-24): the screen takes a variant's copies, wants and price observations with it, and an
// agent must never take a record with a stamp it created by mistake. `variant-tree.ts` holds the list
// and the sentence.

/** A stamp as these answers name it. */
export interface AgentTreeStamp extends StampLabel {
  readonly stampId: string;
}

function treeStamp(labels: ReadonlyMap<string, StampLabel>, stampId: string): AgentTreeStamp {
  const label = labels.get(stampId);
  if (!label) throw new Error(`Stamp ${stampId} was named but not loaded.`);
  return { stampId, ...label };
}

/** How a stamp is named in a sentence: its first catalogue number, else its short number. */
function spoken(stamp: AgentTreeStamp): string {
  return stamp.catalogNumbers[0] ? `${stamp.catalogNumbers[0]} (st ${stamp.stampNo})` : `st ${stamp.stampNo}`;
}

async function loadTreeStamp(context: OperationContext, stampId: string) {
  const stamp = await prisma.stamp.findFirst({
    where: { id: stampId, collectionId: context.collectionId },
    select: {
      id: true,
      parentId: true,
      issueMemberships: { select: { issueId: true }, orderBy: { issueId: "asc" } },
    },
  });
  if (!stamp) {
    throw notFound(
      `No stamp with id "${stampId}" is in this token's collection. Use \`search_collection\` or \`resolve_catalog_numbers\` to find the right id.`
    );
  }
  return stamp;
}

const STAMP_ID_PARAMETER = {
  name: "stamp_id",
  in: "path",
  type: "string",
  required: true,
  description: "The stamp's id, as `search_collection` or `resolve_catalog_numbers` reports it. A stamp may also be named by its short number, `st 123`.",
} as const;

// ── Moving ─────────────────────────────────────────────────────────────────

/**
 * The issue the move is made in. A stamp is moved only within its issue, so a parent must share
 * one with it; when they share exactly one it is that one, and `issue_id` is needed only when they
 * share several.
 */
function moveIssue(
  memberships: readonly string[],
  parentMemberships: readonly string[] | null,
  issueParam: string | null
): string {
  if (memberships.length === 0) {
    throw invalidRequest("The stamp is filed under no issue, and a stamp is moved only within its issue. Add it to an issue on the collector's screen first.");
  }
  const shared = parentMemberships === null ? [...memberships] : memberships.filter((id) => parentMemberships.includes(id));
  if (shared.length === 0) {
    throw invalidRequest(
      "The new parent is not filed under the stamp's issue, and a stamp is moved only within its issue — a parent from another issue is refused, as on the collector's screen. Use a stamp of the same issue.",
      memberships
    );
  }
  if (issueParam !== null) {
    if (!shared.includes(issueParam)) {
      throw invalidRequest(
        parentMemberships === null
          ? `The stamp is not filed under the issue "${issueParam}". Use one of its issues.`
          : `The stamp and its new parent are not both filed under the issue "${issueParam}". Use one they share.`,
        shared
      );
    }
    return issueParam;
  }
  if (shared.length === 1) return shared[0];
  throw invalidRequest(
    parentMemberships === null
      ? 'The stamp is filed under several issues. Name the one whose tree it is brought up in with "issue_id".'
      : 'The stamp and its new parent share several issues. Name the one whose tree it moves in with "issue_id".',
    shared
  );
}

export async function moveStampVariantFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{
  stamp: AgentTreeStamp;
  issueId: string;
  from: AgentTreeStamp | null;
  to: AgentTreeStamp | null;
  moved: boolean;
  path: string;
  ownPricesKept: { priceCount: number; editions: string[]; note: string } | null;
}> {
  const stamp = await loadTreeStamp(context, await stampIdFromRef(context, requiredString(params, "stamp_id"), "stamp_id"));
  const parentRef = optionalString(params, "parent");
  const topLevel = optionalBoolean(params, "top_level") === true;
  if ((parentRef === null) === !topLevel) {
    throw invalidRequest('Send exactly one of "parent" — the stamp to move it under — or "top_level": true, to bring it up to stand on its own.');
  }
  const [parentId] = parentRef === null ? [null] : await resolveStampRefs(context, [parentRef], "parent");
  if (parentId === stamp.id) throw invalidRequest("A stamp cannot be moved under itself. Name another stamp as \"parent\".");
  const parent = parentId === null ? null : await loadTreeStamp(context, parentId);
  const issueId = moveIssue(
    stamp.issueMemberships.map((row) => row.issueId),
    parent ? parent.issueMemberships.map((row) => row.issueId) : null,
    optionalString(params, "issue_id")
  );

  // The collector's screen asks whether a priced stamp gaining its first variant keeps its prices
  // (#1573). This surface does not ask: the prices stay and the answer says so, as
  // `add_stamp_variants` does.
  let umbrellas;
  try {
    umbrellas = await reparentStampNode(context.ownerId, context.collectionId, issueId, stamp.id, parentId, "keep");
  } catch (error) {
    // The cycle guard's refusal names what the agent sent; everything else is not this surface's to relay.
    if (error instanceof Error && /own variant/.test(error.message)) {
      throw invalidRequest(`${error.message} The new parent is one of the stamp's own variants, or below one. Nothing was changed.`);
    }
    throw error;
  }
  const [umbrella] = umbrellas;

  const ids = [stamp.id, ...(stamp.parentId ? [stamp.parentId] : []), ...(parentId ? [parentId] : [])];
  const [labels, header] = await Promise.all([loadStampLabels(context, ids), loadCollectionHeader(context)]);
  return {
    stamp: treeStamp(labels, stamp.id),
    issueId,
    from: stamp.parentId ? treeStamp(labels, stamp.parentId) : null,
    to: parentId ? treeStamp(labels, parentId) : null,
    moved: stamp.parentId !== parentId,
    path: collectionPath(header, `/stamps/${stamp.id}`),
    ownPricesKept: umbrella
      ? {
          priceCount: umbrella.priceCount,
          editions: umbrella.editions,
          note: "The new parent became an umbrella with catalogue prices of its own, and they were kept. A price recorded on an umbrella overrides the value rolled up from its variants, so its value no longer follows them. Ask the collector whether to clear them, and clear them with `clear_catalog_prices` if so.",
        }
      : null,
  };
}

export const moveStampVariantOperation: Operation = {
  name: "move_stamp_variant",
  method: "POST",
  path: "/stamps/{stamp_id}/parent",
  description:
    "Move a stamp under another stamp of the same issue, so it becomes that stamp's variant, or bring a variant up to stand on its own at the top of its issue — the collector's own *Move under another stamp…*. Its own variants come with it. Its catalogue numbers, prices, size, copies and checklist places stay as they are; a stamp arriving with no subtype takes the collection's default, and it goes at the end of its new siblings. A parent from another issue, or one of the stamp's own variants, is refused. Nothing is ever moved between issues.",
  writes: true,
  parameters: [
    STAMP_ID_PARAMETER,
    {
      name: "parent",
      in: "body",
      type: "string",
      required: false,
      description: "The stamp to move it under — an id, a short number (`st 123`) or a catalogue number naming one stamp (`Mi 240`). Send this or `top_level`, not both.",
    },
    {
      name: "top_level",
      in: "body",
      type: "boolean",
      required: false,
      description: "`true` brings the stamp up to stand on its own, under no other stamp. Send this or `parent`, not both.",
    },
    {
      name: "issue_id",
      in: "body",
      type: "string",
      required: false,
      description: "The issue whose tree the move is made in. Needed only when the stamp and its new parent are both filed under more than one.",
    },
  ],
  result: {
    kind: "object",
    description:
      "`stamp`, the stamp moved; `from` and `to`, the parent it had and the one it has now (null for the top level); `moved`, false when it was already there; `issueId`; and the stamp's `path` in the app. `ownPricesKept` is null unless the stamp was the new parent's first variant while that parent carried catalogue prices of its own: then it gives their `priceCount` and `editions`, which were left in place and now override the value rolled up from the variants.",
  },
  handler: async (context, params) => moveStampVariantFromParams(context, params),
};

// ── Deleting ───────────────────────────────────────────────────────────────

async function loadVariantHolders(context: OperationContext, stampId: string): Promise<VariantHolders> {
  const { collectionId } = context;
  const [copies, offers, counts, variants] = await Promise.all([
    prisma.item.findMany({
      where: {
        collectionId,
        OR: [{ stampId }, { stamps: { some: { stampId } } }, { candidates: { some: { stampId } } }],
      },
      select: { itemNo: true },
      orderBy: { itemNo: "asc" },
    }),
    prisma.offer.findMany({
      where: { collectionId, listedVariants: { some: { OR: [{ stampId }, { variantStampId: stampId }] } } },
      select: { offerNo: true },
      orderBy: { offerNo: "asc" },
    }),
    prisma.stamp.findUniqueOrThrow({
      where: { id: stampId },
      select: { _count: { select: { wants: true, auctionLotLines: true, priceObservations: true, tradeLines: true } } },
    }),
    prisma.stamp.findMany({
      where: { parentId: stampId, collectionId },
      select: { stampNo: true },
      orderBy: { stampNo: "asc" },
    }),
  ]);
  return {
    copyNos: copies.map((row) => row.itemNo),
    offerNos: offers.map((row) => row.offerNo),
    wants: counts._count.wants,
    auctionLines: counts._count.auctionLotLines,
    priceObservations: counts._count.priceObservations,
    tradeLines: counts._count.tradeLines,
    variantNos: variants.map((row) => row.stampNo),
  };
}

export async function deleteStampVariantFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<{
  deleted: AgentTreeStamp & { parent: AgentTreeStamp; issueIds: string[] };
  removedWithIt: { cataloguePrices: number; translations: number; checklistPlaces: number; photos: number };
}> {
  const stamp = await loadTreeStamp(context, await stampIdFromRef(context, requiredString(params, "stamp_id"), "stamp_id"));
  const labels = await loadStampLabels(context, [stamp.id, ...(stamp.parentId ? [stamp.parentId] : [])]);
  const named = treeStamp(labels, stamp.id);
  if (stamp.parentId === null) {
    throw invalidRequest(
      `${spoken(named)} is a base stamp, not a variant, and a base stamp is never deleted through this API. The collector deletes it on the stamp's screen.`
    );
  }
  const message = variantHeldMessage(spoken(named), await loadVariantHolders(context, stamp.id));
  if (message) throw invalidRequest(message);

  const [cataloguePrices, counts] = await Promise.all([
    prisma.stampCatalogPrice.count({ where: { stampId: stamp.id } }),
    prisma.stamp.findUniqueOrThrow({
      where: { id: stamp.id },
      select: { _count: { select: { translations: true, checklistEntries: true, photos: true } } },
    }),
  ]);
  // `reparent` rather than `cascade`: with no variants under it the two delete the same one stamp,
  // and should a variant be added between the check above and this write, `reparent` moves it up
  // instead of deleting it.
  await deleteStamp(context.ownerId, stamp.id, "reparent");
  return {
    deleted: {
      ...named,
      parent: treeStamp(labels, stamp.parentId),
      issueIds: stamp.issueMemberships.map((row) => row.issueId),
    },
    removedWithIt: {
      cataloguePrices,
      translations: counts._count.translations,
      checklistPlaces: counts._count.checklistEntries,
      photos: counts._count.photos,
    },
  };
}

export const deleteStampVariantOperation: Operation = {
  name: "delete_stamp_variant",
  method: "DELETE",
  path: "/stamps/{stamp_id}",
  description:
    "Delete a variant created by mistake. Only a variant — a stamp filed under another — is deleted, and only when nothing names it: a variant with copies, offers, wants, auction lot lines, price observations, trade lines or variants of its own is refused with what holds it, for the collector to settle first. Its catalogue numbers, catalogue prices, translations, checklist places and photos go with it. A base stamp or an issue is never deleted here.",
  writes: true,
  parameters: [STAMP_ID_PARAMETER],
  result: {
    kind: "object",
    description:
      "`deleted`, the variant as it was — its id, short number, name, catalogue numbers, the `parent` it was filed under and its `issueIds` — and `removedWithIt`, how many catalogue prices, translations, checklist places and photos went with it.",
  },
  handler: async (context, params) => deleteStampVariantFromParams(context, params),
};
