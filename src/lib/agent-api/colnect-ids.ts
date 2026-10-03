// The pure half of setting a stamp's Colnect item-ID through the agent API (#1445): how an agent's
// value is read, what the answer says, and the refusal an ID another stamp holds earns.
//
// **The value is read the way the collector's own field reads it** (#741, `colnectItemIdInput`): a
// Colnect stamp address is reduced to its number and anything else is trimmed. It is deliberately not
// a validator — the item-ID is Colnect's identifier, not ours, and nothing here knows which numbers
// exist — so an agent holding the page's address can send it as readily as the bare number.
//
// Pure: no Prisma, so `pnpm test:unit` holds every rule here.

import { colnectItemIdInput } from "../colnect-link";
import { invalidRequest, type ApiError } from "./errors";

/** What `set_stamp_colnect_id` answers. */
export interface AgentColnectIdWrite {
  /** `written` set or changed the ID, `cleared` took it off, `unchanged` found it already so. */
  readonly status: "written" | "cleared" | "unchanged";
  readonly stampId: string;
  readonly stampNo: number;
  readonly catalogNumbers: string[];
  /** The ID the stamp carries now; absent once cleared. */
  readonly colnectId?: string;
  /** The ID a change or a clear replaced, so the collector can put it back on the stamp's screen. */
  readonly replaced?: string;
}

/** The item-ID out of what the agent sent, or a refusal naming the two spellings accepted. */
export function parseAgentColnectId(raw: string, parameter: string): string {
  const id = colnectItemIdInput(raw);
  if (!id) {
    throw invalidRequest(
      `"${parameter}" must be a Colnect item-ID — the number in the stamp's Colnect address, such as \`1133075\` — or that address itself; a Colnect address with no item-ID in it names no stamp.`
    );
  }
  return id;
}

/** One stamp already carrying the ID being set. */
export interface ColnectIdHolder {
  readonly stampId: string;
  readonly name: string | null;
  readonly catalogNumbers: readonly string[];
}

function describeHolder(stamp: ColnectIdHolder): string {
  const name = stamp.name ? `"${stamp.name}"` : "a stamp";
  const numbers = stamp.catalogNumbers.length > 0 ? `${stamp.catalogNumbers.join(", ")}, ` : "";
  return `${name} (${numbers}id ${stamp.stampId})`;
}

/**
 * The refusal for an item-ID another stamp in the collection already carries. One Colnect ID names one
 * stamp — the matcher never writes one onto a second (#250), and the list sync joins on it (#686) — so
 * the holder is named and its id is in `accepted`, and nothing is moved off it on the agent's say.
 */
export function colnectIdHeld(colnectId: string, holders: readonly ColnectIdHolder[]): ApiError {
  return invalidRequest(
    `Colnect item-ID ${colnectId} already belongs to ${holders.map(describeHolder).join(" and ")}. Nothing was written. One Colnect ID names one stamp here, so either this is that stamp's ID and the one you meant to set is another, or it sits on the wrong stamp — then clear it there first, with "clear": true, and set it here.`,
    holders.map((holder) => holder.stampId)
  );
}
