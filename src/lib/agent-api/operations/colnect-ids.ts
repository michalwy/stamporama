import "server-only";
import { prisma } from "../../db";
import { clearColnectMatch, confirmColnectMatch, findColnectIdHolders } from "../../colnect";
import { checkBatchSize, parsePairFields, refusalOf, refused } from "../batch";
import {
  COLNECT_PAIR_EXAMPLE,
  COLNECT_PAIR_FIELDS,
  MAX_COLNECT_ID_PAIRS,
  colnectIdHeld,
  parseAgentColnectId,
  stampNamedTwice,
  summarizeColnectIdPairs,
  type AgentColnectIdBatch,
  type AgentColnectIdPairAnswer,
  type AgentColnectIdWrite,
} from "../colnect-ids";
import { invalidRequest, isApiError } from "../errors";
import { optionalBoolean, optionalString, requiredString, stringList } from "../params";
import { loadStampLabels, resolveStampRefs, resolveStampRefsEach, stampNoOf } from "./stamp-refs";
import type { Operation, OperationContext, ParsedParams } from "../types";

// A stamp's Colnect item-ID through the agent API (#1445) — the link listing on Colnect, the Colnect
// links and the list sync all read, supplied by an assistant that has the stamp's Colnect page or a
// Colnect export in front of it.
//
// **It is written the one way an item-ID is ever written**: `confirmColnectMatch`, the Assistant's
// match confirmation and the collector's own item-ID field (#741) alike, onto `Stamp.colnectId`
// (#247). So everything that reads an ID reads this one at once. A clear is `clearColnectMatch`, the
// same one field. Nothing else about the stamp is touched — a match made from a Colnect page also
// fills numbers and a date, and that is the Assistant's walk, not this.
//
// **One ID names one stamp**, and an ID another stamp carries is refused with the holder named rather
// than moved: which of the two is right is the collector's to say. Changing or clearing an ID the
// stamp already carries is allowed, and the answer names the ID it replaced.
//
// **On an umbrella the ID is a claim about the umbrella itself.** Listing an unknown-variant umbrella
// under its cheapest variant is resolved at listing time from the variant's own ID (#616) and is never
// written back here — nothing in this module reads a variant to decide what to write.
//
// **A forgery is written like any stamp.** #1445 proposed refusing one; #1007 was closed on
// 2026-09-08 because a forgery is an ordinary variant with no special treatment, and the collector
// confirmed that on 2026-09-28.

const STAMP_PARAMETER_DESCRIPTION =
  "The stamp: its id, its short number (`st 123`), or a catalogue number that names only it — `Mi 123a`, as `resolve_catalog_numbers` reads one. A number reaching several stamps is refused with their ids.";

async function writeColnectId(context: OperationContext, params: ParsedParams): Promise<AgentColnectIdWrite> {
  const raw = optionalString(params, "colnect_id");
  const clear = optionalBoolean(params, "clear") ?? false;
  if ((raw !== null) === clear) {
    throw invalidRequest(
      'Send exactly one of "colnect_id", to set or change the stamp\'s Colnect ID, and "clear": true, to take it off.',
      ["colnect_id", "clear"]
    );
  }
  const colnectId = raw === null ? null : parseAgentColnectId(raw, "colnect_id");
  const [stampId] = await resolveStampRefs(context, [requiredString(params, "stamp")], "stamp");
  return writeStampColnectId(context, stampId, colnectId);
}

/** One stamp's ID set, changed or — with null — cleared, on `set_stamp_colnect_id`'s rules. */
async function writeStampColnectId(
  context: OperationContext,
  stampId: string,
  colnectId: string | null
): Promise<AgentColnectIdWrite> {
  const before = (
    await prisma.stamp.findUniqueOrThrow({ where: { id: stampId }, select: { colnectId: true } })
  ).colnectId;

  let status: AgentColnectIdWrite["status"];
  if (colnectId === null) {
    const removed = await clearColnectMatch(context.ownerId, context.collectionId, stampId);
    status = removed === null ? "unchanged" : "cleared";
  } else if (before === colnectId) {
    status = "unchanged";
  } else {
    const holders = await findColnectIdHolders(context.ownerId, context.collectionId, colnectId, stampId);
    if (holders.length > 0) {
      const labels = await loadStampLabels(context, holders);
      throw colnectIdHeld(
        colnectId,
        holders.map((id) => ({
          stampId: id,
          name: labels.get(id)?.name ?? null,
          catalogNumbers: labels.get(id)?.catalogNumbers ?? [],
        }))
      );
    }
    await confirmColnectMatch(context.ownerId, context.collectionId, { colnectId, stampId, allowOverwrite: true });
    status = "written";
  }

  const labels = await loadStampLabels(context, [stampId]);
  const now = colnectId ?? (status === "unchanged" ? before : null);
  return {
    status,
    stampId,
    stampNo: stampNoOf(labels, stampId),
    catalogNumbers: labels.get(stampId)?.catalogNumbers ?? [],
    ...(now !== null ? { colnectId: now } : {}),
    ...(status !== "unchanged" && before !== null ? { replaced: before } : {}),
  };
}

export const setStampColnectIdOperation: Operation = {
  name: "set_stamp_colnect_id",
  method: "POST",
  path: "/stamp-colnect-id",
  description:
    "Set, change or clear one stamp's Colnect ID — the item-ID in its Colnect address, which listing on Colnect, the Colnect links and the Colnect list sync all read, and which `get_stamp` reports as `colnectId`. Send `colnect_id` to set or change it, or `clear` to take it off. An ID another stamp already has is refused with that stamp named: one Colnect ID names one stamp. On a stamp with variants the ID is a claim about that stamp itself — never set a variant's ID on its parent to list it; listing picks the cheapest variant on its own. Nothing else about the stamp changes.",
  writes: true,
  parameters: [
    { name: "stamp", in: "body", type: "string", required: true, description: STAMP_PARAMETER_DESCRIPTION },
    {
      name: "colnect_id",
      in: "body",
      type: "string",
      required: false,
      description:
        "The Colnect item-ID — `1133075` — or the stamp's Colnect address, from which the ID is read. Replaces an ID the stamp already carries.",
    },
    {
      name: "clear",
      in: "body",
      type: "boolean",
      required: false,
      description: "True to take the stamp's Colnect ID off. Send it instead of `colnect_id`.",
    },
  ],
  result: {
    kind: "object",
    description:
      "`status` is `written`, `cleared`, or `unchanged` when the stamp already carried exactly this (or, on a clear, none). `colnectId` is the ID the stamp carries now, and `replaced` the one a change or a clear took off — the collector can restore it on the stamp's screen.",
  },
  handler: async (context, params) => writeColnectId(context, params),
};

// ── set_stamp_colnect_ids (#2173) ──────────────────────────────────────────

// **The single write, a pair at a time, in the order sent.** Each pair is `set_stamp_colnect_id`'s
// rules exactly — the same reading of the ID, the same refusal of one another stamp holds — so a pair
// later in the call sees what an earlier one wrote: two pairs giving one ID to two stamps write the
// first and refuse the second, naming it. A stamp named twice is refused the second time rather than
// written twice. A clear stays the single call's: nobody clears a catalogue's IDs in bulk.

export async function writeColnectIdPairs(context: OperationContext, params: ParsedParams): Promise<AgentColnectIdBatch> {
  const entries = stringList(params, "pairs");
  checkBatchSize(entries, "pairs", MAX_COLNECT_ID_PAIRS, "pair", COLNECT_PAIR_EXAMPLE);
  const parsed = entries.map((entry) => parsePairFields(entry, COLNECT_PAIR_FIELDS, COLNECT_PAIR_EXAMPLE));
  const stamps = await resolveStampRefsEach(
    context,
    parsed.flatMap((p) => (p.ok ? [p.fields.get("stamp")!] : []))
  );

  const seen = new Map<string, number>();
  const pairs: AgentColnectIdPairAnswer[] = [];
  for (const [index, entry] of entries.entries()) {
    const p = parsed[index];
    if (!p.ok) {
      pairs.push({ ...refused(index, p.reason), entry });
      continue;
    }
    const stamp = stamps.get(p.fields.get("stamp")!.trim())!;
    if ("reason" in stamp) {
      pairs.push({ ...refused(index, stamp.reason, stamp.accepted), entry });
      continue;
    }
    const earlier = seen.get(stamp.stampId);
    if (earlier !== undefined) {
      pairs.push({ ...refused(index, stampNamedTwice(earlier), [stamp.stampId]), entry });
      continue;
    }
    seen.set(stamp.stampId, index);
    try {
      const colnectId = parseAgentColnectId(p.fields.get("colnect_id")!, "colnect_id");
      const answer = await writeStampColnectId(context, stamp.stampId, colnectId);
      pairs.push({ index, entry, ...answer, status: answer.status === "unchanged" ? "unchanged" : "written" });
    } catch (err) {
      if (!isApiError(err)) console.error("[api/v1] set_stamp_colnect_ids pair failed", err);
      pairs.push({ ...refusalOf(index, err), entry });
    }
  }
  return summarizeColnectIdPairs(pairs);
}

export const setStampColnectIdsOperation: Operation = {
  name: "set_stamp_colnect_ids",
  method: "POST",
  path: "/stamp-colnect-ids",
  description:
    "Set or change the Colnect IDs of many stamps in one call — up to 100 `stamp → colnect_id` pairs, as when a Colnect export or a catalogue's Colnect pages are matched to the stamps here. Each pair follows `set_stamp_colnect_id`'s rules exactly and is answered on its own: written, unchanged when the stamp already carries that ID, or refused with the reason — an ID another stamp has, a stamp no reference names, the same stamp twice. A refused pair does not stop the others. Pairs are applied in the order sent, so an ID given to two stamps in one call goes to the first. To take an ID off, use `set_stamp_colnect_id` with `clear`.",
  writes: true,
  parameters: [
    {
      name: "pairs",
      in: "body",
      type: "string[]",
      required: true,
      description: `One pair per entry, at most ${MAX_COLNECT_ID_PAIRS}, as \`name=value\` pairs separated by \`;\`: ${COLNECT_PAIR_EXAMPLE}. \`stamp\` is the stamp's id, its short number (\`st 123\`) or a catalogue number naming only it; \`colnect_id\` the Colnect item-ID or the stamp's Colnect address.`,
    },
  ],
  result: {
    kind: "object",
    description:
      "The counts `written`, `unchanged` and `refused`, and `pairs` in the order sent — each with its `index` and the `entry` as sent, and then `set_stamp_colnect_id`'s answer (`status` `written` or `unchanged`, `stampId`, `stampNo`, `catalogNumbers`, `colnectId`, `replaced` with the ID a change took off), or `status: refused` with the `reason` and, where it names stamps, their ids in `accepted`.",
  },
  handler: async (context, params) => writeColnectIdPairs(context, params),
};
