// A copy going into an offer that is already in an open offer elsewhere (#2339), and the copy of the
// same stamp, listed nowhere, that could go in its place.
//
// Making an offer from a copy already listed is sometimes meant — the same copy on two platforms —
// and nothing here refuses it. What is said is which copies are, where, and the twin: a copy of the
// same stamp in the same condition and format, held and for sale, in no open offer and not already
// among the copies being made. Its faults and certificate follow the copy: a twin that differs on
// either is suggested only when no exact one is free, and the difference is named. Among several, the
// one the Copies list puts first — the order the caller hands the candidates in.
//
// Pure (no React / Prisma): the read (`listed-elsewhere.ts`) and every dialog that shows the note use
// these.

import { formatItemNo } from "./item-number";

/** An open offer a copy is already in. */
export interface ListedElsewhereOffer {
  offerId: string;
  offerNo: number;
  platformName: string;
}

/** The copy suggested in place of a listed one. */
export interface ListedElsewhereTwin {
  itemId: string;
  itemNo: number;
  /** What sets it apart from the listed copy — its certificate or faults — or null for an exact twin. */
  difference: string | null;
}

/** One copy being made into an offer that is already in an open offer elsewhere. */
export interface ListedElsewhereCopy {
  itemId: string;
  itemNo: number;
  /** Every open offer it is in, lowest number first. */
  offers: ListedElsewhereOffer[];
  /** A copy of the same stamp listed nowhere, or null when there is none — the copy is then only named. */
  twin: ListedElsewhereTwin | null;
}

/** What the twin rule asks of a copy. */
export interface TwinCopy {
  itemId: string;
  stampId: string;
  /** Null for a piece (#2383), which is never twinnable. */
  conditionId: string | null;
  formatId: string | null;
  certificateStatusId: string | null;
  faultIds: readonly string[];
  /** False for a piece — several stamps, or one on a cover (#2383) — or a copy whose stamp is not
   *  known for sure (ADR-0044, ADR-0065): *the same stamp* is not one stamp there, so such a copy
   *  neither has nor is a twin. */
  twinnable: boolean;
}

/** Copies that may stand in for each other on the stamp, the condition and the format. */
export function twinKey(copy: Pick<TwinCopy, "stampId" | "conditionId" | "formatId">): string {
  return `${copy.stampId}|${copy.conditionId}|${copy.formatId ?? ""}`;
}

function sameFaults(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** A twin with the same certificate and the same faults as the copy. */
export function isExactTwin(copy: TwinCopy, twin: TwinCopy): boolean {
  return copy.certificateStatusId === twin.certificateStatusId && sameFaults(copy.faultIds, twin.faultIds);
}

/**
 * Which candidate stands in for which listed copy: for each copy, in the order given, the first free
 * candidate that is an exact twin, else the first free one of the same stamp, condition and format.
 * A candidate is given to one copy only. `candidates` comes in the Copies list's order.
 */
export function assignTwins(copies: readonly TwinCopy[], candidates: readonly TwinCopy[]): Map<string, TwinCopy> {
  const byKey = new Map<string, TwinCopy[]>();
  for (const candidate of candidates) {
    if (!candidate.twinnable) continue;
    const key = twinKey(candidate);
    byKey.set(key, [...(byKey.get(key) ?? []), candidate]);
  }
  const taken = new Set<string>();
  const assigned = new Map<string, TwinCopy>();
  for (const copy of copies) {
    if (!copy.twinnable) continue;
    const free = (byKey.get(twinKey(copy)) ?? []).filter((c) => c.itemId !== copy.itemId && !taken.has(c.itemId));
    const twin = free.find((c) => isExactTwin(copy, c)) ?? free[0];
    if (!twin) continue;
    taken.add(twin.itemId);
    assigned.set(copy.itemId, twin);
  }
  return assigned;
}

/** Names for the difference sentence: a certificate status's and a fault's. */
export interface TwinNames {
  certificate: (id: string) => string;
  fault: (id: string) => string;
}

/**
 * What sets a twin apart from the copy, as the note says it — *no certificate; with Thin* — or null
 * when nothing does. The twin's side is stated, since the twin is what would go out.
 */
export function twinDifference(copy: TwinCopy, twin: TwinCopy, names: TwinNames): string | null {
  const parts: string[] = [];
  if (copy.certificateStatusId !== twin.certificateStatusId) {
    parts.push(twin.certificateStatusId ? names.certificate(twin.certificateStatusId) : "no certificate");
  }
  const copyFaults = new Set(copy.faultIds);
  const twinFaults = new Set(twin.faultIds);
  const added = twin.faultIds.filter((id) => !copyFaults.has(id)).map(names.fault);
  const missing = copy.faultIds.filter((id) => !twinFaults.has(id)).map(names.fault);
  if (added.length > 0) parts.push(`with ${added.join(", ")}`);
  if (missing.length > 0) parts.push(`without ${missing.join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : null;
}

/** *#7375 is on Facebook #3012* — the copy and every open offer it is in. */
export function listedElsewhereSentence(copy: ListedElsewhereCopy): string {
  const offers = copy.offers.map((offer) => `${offer.platformName} #${offer.offerNo}`);
  const where =
    offers.length <= 1 ? (offers[0] ?? "") : `${offers.slice(0, -1).join(", ")} and ${offers[offers.length - 1]}`;
  return `${formatItemNo(copy.itemNo)} is on ${where}`;
}

/** *#7401 is listed nowhere* — the twin, and how it differs when it does. */
export function twinSentence(twin: ListedElsewhereTwin): string {
  return `${formatItemNo(twin.itemNo)} is listed nowhere${twin.difference ? ` (${twin.difference})` : ""}`;
}

/** Every swap *Swap all* makes: each listed copy that has a twin, to that twin. */
export function swapAllPairs(copies: readonly ListedElsewhereCopy[]): { from: string; to: string }[] {
  return copies.flatMap((copy) => (copy.twin ? [{ from: copy.itemId, to: copy.twin.itemId }] : []));
}

/** The copies with the swaps made: each swapped copy replaced by its twin where it stood. */
export function applySwaps(itemIds: readonly string[], swaps: ReadonlyMap<string, string>): string[] {
  return itemIds.map((id) => swaps.get(id) ?? id);
}
