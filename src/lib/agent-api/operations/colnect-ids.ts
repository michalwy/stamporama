import "server-only";
import { prisma } from "../../db";
import { clearColnectMatch, confirmColnectMatch, findColnectIdHolders } from "../../colnect";
import { colnectIdHeld, parseAgentColnectId, type AgentColnectIdWrite } from "../colnect-ids";
import { invalidRequest } from "../errors";
import { optionalBoolean, optionalString, requiredString } from "../params";
import { loadStampLabels, resolveStampRefs, stampNoOf } from "./stamp-refs";
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
