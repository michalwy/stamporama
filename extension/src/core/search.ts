// The instance's answer to a collection search (#529), mirrored by hand exactly as `capture.ts`
// mirrors the capture outcome and `decisions.ts` the matcher's — the extension is a separate build
// with no import path into the app.
//
// Three groups, because the collector's question has three shapes: *is this stamp in my catalog*,
// *which issue is it from*, and *which piece in hand is it*. The stamps group carries the answer the
// context menu was invoked for — `copies` is what "do I already own this" means once a catalog
// number has been resolved to a stamp.
//
// `url` is **finished** by the time the window sees a row: the instance answers a relative path and
// the origin is the one the profile authenticated against (`search-client.ts`), never one the answer
// could name.

/** A stamp's subtype (#340), or null for a base stamp. */
export interface SubtypeLabel {
  name: string;
  isDefault: boolean;
}

export type WantPriority = "high" | "normal" | "low";

/** One open want, in the want list's own wording per axis (#532) — *which* condition is wanted is
 *  most of the answer at an auction. `here` and `coming` are **this want's** own copies, not the
 *  stamp's: a mint-only want reads zero while a used copy sits in the drawer, and both are true. */
export interface SearchWant {
  conditions: string;
  certificate: string;
  format: string;
  priority: WantPriority;
  here: number;
  coming: number;
}

export interface SearchWants {
  openCount: number;
  topPriority: WantPriority;
  wants: SearchWant[];
}

export interface SearchStamp {
  stampId: string;
  name: string | null;
  issuedYear: number | null;
  areaName: string | null;
  issueName: string | null;
  issueYear: number | null;
  catalogNumbers: string[];
  subtype: SubtypeLabel | null;
  hasVariants: boolean;
  isVariant: boolean;
  /** Copies held of this stamp exactly. Zero reads as *not held*, which is an answer. */
  copies: number;
  /** Copies held under its variant descendants — why an umbrella with pieces filed one level down
   *  does not read as *not held*. */
  variantCopies: number;
  /** The open wants (#532), or null when there are none — the figure the window is opened for.
   *  Holding a copy does not close a want, so *held* and *wanted* are independent answers, and the
   *  second is the one that decides a bid. */
  wants: SearchWants | null;
  url: string;
}

export interface SearchIssue {
  issueId: string;
  name: string | null;
  year: number | null;
  url: string;
}

export interface SearchCopy {
  itemId: string;
  itemNo: number;
  stampName: string | null;
  issueName: string | null;
  catalogNumbers: string[];
  conditionName: string;
  formatName: string | null;
  locationRef: string | null;
  /** What the copy is *for* (#99/#550): three independent flags, never one state — a duplicate kept
   *  in the collection until it sells is both in the collection and for sale. */
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  url: string;
}

export interface SearchAnswer {
  /** What the instance actually searched for — the window echoes it, so a trimmed query and the
   *  results below can never describe different texts. */
  query: string;
  stamps: SearchStamp[];
  issues: SearchIssue[];
  copies: SearchCopy[];
}

/** True when the answer holds nothing at all — the one state worth a sentence of its own, since an
 *  empty screen and a screen that has not been asked yet look identical otherwise. */
export function isEmptyAnswer(answer: SearchAnswer): boolean {
  return answer.stamps.length === 0 && answer.issues.length === 0 && answer.copies.length === 0;
}

/**
 * One row per open want (#529): the **Wants** section is the first thing in the window, so a want is
 * a row of its own rather than a chip hanging off a stamp. A stamp wanted in two conditions is two
 * decisions, and collapsing them to *2 open* would hide the very fact the section exists to state.
 *
 * The stamp travels beside its want, because the row still has to say what it is about.
 */
export interface WantedRow {
  stamp: SearchStamp;
  want: SearchWant;
}

/** Every open want across the matched stamps, most urgent first, each still carrying its stamp. */
export function wantedRows(stamps: readonly SearchStamp[]): WantedRow[] {
  const rank: Record<WantPriority, number> = { high: 0, normal: 1, low: 2 };
  return stamps
    .flatMap((stamp) => (stamp.wants?.wants ?? []).map((want) => ({ stamp, want })))
    .sort((a, b) => rank[a.want.priority] - rank[b.want.priority]);
}

/**
 * What is actually being looked for, in the want list's own wording per axis.
 *
 * Stated rather than counted, because *which* condition is wanted is the answer at an auction:
 * `Mint never hinged · Single` is a decision, `1 want` is a prompt to go and look it up.
 */
export function wantAxesLabel(want: SearchWant): string {
  return [want.conditions, want.certificate, want.format].filter(Boolean).join(" · ");
}

/**
 * What is already answering this want, said only when something is: copies that would satisfy it,
 * and copies on their way to it.
 *
 * *Coming* is the one that stops a second purchase of something already ordered; *here* is the
 * upgrade case — a want left open beside a copy that satisfies it on paper is a want for a better
 * one. Empty when neither is true, so the ordinary row stays quiet.
 */
export function wantProgressLabel(want: SearchWant): string {
  const parts: string[] = [];
  if (want.here > 0) parts.push(`${want.here} already answer${want.here === 1 ? "s" : ""} it`);
  if (want.coming > 0) parts.push(`${want.coming} on the way`);
  return parts.join(" · ");
}

/** The priority as the chip says it. */
export const WANT_PRIORITY_LABEL: Record<WantPriority, string> = {
  high: "High priority",
  normal: "Wanted",
  low: "Low priority",
};

/** One disposition chip: the app's own label, and the token its colour is keyed off. */
export interface CopyDisposition {
  key: "inCollection" | "forSale" | "forTrade";
  label: string;
  token: "collection" | "sale" | "trade";
}

const COPY_DISPOSITIONS: readonly CopyDisposition[] = [
  { key: "inCollection", label: "In collection", token: "collection" },
  { key: "forSale", label: "For sale", token: "sale" },
  { key: "forTrade", label: "For trade", token: "trade" },
];

/**
 * What a copy is *for*, as chips (#550).
 *
 * The inventory row's own three flags, in the app's own order and wording (#99): a copy row here is
 * that row seen from an auction, and a second vocabulary for the same three ticks would make the two
 * screens disagree about what the collector already decided. All three can be true at once — they
 * are independent flags, not a state — so this returns a list rather than picking one.
 *
 * A copy with **none** of them set is silent, exactly as it is in the app. That is a copy whose
 * disposition has not been decided, and inventing a *No disposition* chip here would state something
 * the collector never said.
 */
export function copyDispositions(copy: SearchCopy): CopyDisposition[] {
  return COPY_DISPOSITIONS.filter((d) => copy[d.key]);
}

/**
 * How a stamp's holding reads. Two figures rather than one sum (#528): what is held *of this stamp*
 * and what is held of the variants under it are different facts, and adding them would claim copies
 * of a specific variant as copies of the umbrella.
 */
export function holdingLabel(stamp: SearchStamp): string {
  const own = stamp.copies === 1 ? "1 copy" : `${stamp.copies} copies`;
  if (stamp.variantCopies === 0) return stamp.copies === 0 ? "Not held" : own;
  const variants = `${stamp.variantCopies} under variants`;
  return stamp.copies === 0 ? variants : `${own} · ${variants}`;
}
