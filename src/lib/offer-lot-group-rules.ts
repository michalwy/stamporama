// A group of lots worked on together from one screen (#2313): a Facebook post's lots, or a proposal's.
// Both are ordinary offers numbered in an order of their own, and the tools a post's screen grew for
// its lots — every lot's photo settings at once, their texts and titles at once, their order — work on
// a proposal's the same way, through one implementation (`offer-lot-groups.ts`) that is told which
// group it is working on. Pure: the client names the group, the server checks it.

export type LotGroupKind = "post" | "proposal";

/** Which group of lots a tool works on: a Facebook post's, or a proposal's. */
export interface LotGroup {
  kind: LotGroupKind;
  id: string;
}

/** The group as handed over from the browser, or null when it is not one. */
export function parseLotGroup(raw: unknown): LotGroup | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { kind, id } = raw as Record<string, unknown>;
  if ((kind !== "post" && kind !== "proposal") || typeof id !== "string" || id.length === 0) return null;
  return { kind, id };
}

/** How a sentence names the group: `post #4`, `proposal #2`. */
export function lotGroupName(kind: LotGroupKind, no: number): string {
  return `${kind} #${no}`;
}

/** A lot as the group's dialogs name it: *Lot 3* with its offer's number and title. */
export interface GroupLotLabel {
  offerId: string;
  offerNo: number;
  lotNo: number | null;
  title: string;
}
