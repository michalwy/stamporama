// Mirror of the Stamporama matcher response (#250) — kept in sync by hand since the extension is a
// separate build with no import path into the app.

export interface Candidate {
  stampId: string;
  name: string | null;
  issuedYear: number | null;
  /** The rest of the stamp's date (#655), so both sides can be read to the day. */
  issuedMonth: number | null;
  issuedDay: number | null;
  areaName: string | null;
  /** Issue the stamp belongs to, shown for orientation. */
  issueName: string | null;
  /** Lead photo of the stamp, fetched through the collection-scoped serving route. */
  photoId: string | null;
  /** Our numbers, each marked against what the Colnect item prints. */
  catalogNumbers: NumberView[];
  /** What the item would add to this stamp, and what it disagrees on (#280). Empty when the
   *  backfill is switched off. */
  backfill: BackfillProposal[];
  /** What the item's printed date of issue would add to this stamp, or disagrees with it about
   *  (#655). Null when the date sync is switched off, the page states none, or it tells us nothing
   *  we don't already hold. */
  dateProposal: DateProposal | null;
  /** What the page's stated attributes would add to this stamp, disagree with it about, or name in
   *  a word the collection's mapping does not cover (#739). Empty when the attribute sync is
   *  switched off, the page states none, or the two sides already agree about every one of them. */
  attributes: AttributeProposal[];
  existingColnectId: string | null;
}

/**
 * One decided stamp attribute (#739) — the date proposal five fields wider, plus the one status a
 * date cannot have.
 *
 * `would-fill`/`filled` add what our stamp states nothing for and destroy nothing; `conflict` is a
 * value the two sides state differently, reported and left alone until the collector settles it;
 * `unmapped` is a Colnect word the collection's attribute mapping does not cover, which is reported
 * and **never** written — nothing here invents a dictionary row.
 */
export type AttributeStatus = "would-fill" | "filled" | "conflict" | "unmapped";

export interface AttributeProposal {
  /** Which of the six — `denomination`, `perforation`, `color`, `watermark`, `paper`, `printing`. */
  field: string;
  /** How the attribute is named on screen, resolved by the instance so the window carries no
   *  vocabulary of its own. */
  fieldLabel: string;
  status: AttributeStatus;
  /** What a fill or an overwrite would store, as it reads. */
  label: string;
  /** What our stamp states today, or null when it states nothing. */
  currentLabel: string | null;
  /** What Colnect prints, verbatim — and, on an `unmapped` row, the word to map in Settings. */
  colnectLabel: string;
}

/**
 * One decided date proposal (#655). `would-fill`/`filled` add the components our stamp lacks and
 * destroy nothing; `conflict` is a component the two sides state differently, reported and left
 * alone until the collector settles it.
 */
export type DateStatus = "would-fill" | "filled" | "conflict";

export interface DateProposal {
  status: DateStatus;
  date: { year: number | null; month: number | null; day: number | null };
  /** The proposed date formatted — what a fill would store, or what an overwrite would put in
   *  place of ours. */
  label: string;
  /** The stamp's date today, formatted. Null when it carries none. */
  currentLabel: string | null;
  /** What Colnect prints, formatted. */
  colnectLabel: string;
  /** For `conflict`: which components the two sides disagree about. */
  conflictingFields?: ("year" | "month" | "day")[];
}

/**
 * One decided backfill reference (#280): a catalog number Colnect prints that we could add, or the
 * reason we won't. `would-fill`/`filled` carry the bare number to store; the rest carry none.
 */
export type BackfillStatus =
  | "would-fill"
  | "filled"
  | "conflict"
  | "skipped-no-area-prefix"
  | "prefix-mismatch"
  | "duplicate";

export interface BackfillProposal {
  catalog: string;
  printedNumber: string;
  catalogVendorId: string;
  vendorAbbreviation: string;
  status: BackfillStatus;
  number: string | null;
  label: string;
  existingNumber?: string;
  /** For `conflict`: the bare number "use Colnect's number" (#433) would store instead, already
   *  resolved against the stamp's own area prefix. Null when the printed value cannot be turned
   *  into one we would store, and so when there is nothing to offer. */
  overwriteNumber?: string | null;
  /** Label of {@link BackfillProposal.overwriteNumber}, for naming the action. */
  overwriteLabel?: string;
  /** Written despite colliding with an existing catalog identity (collection is in warn mode). */
  duplicateWarning?: boolean;
  duplicateStampNames?: string[];
}

/** The mirror of {@link RefStatus}, for one of our own numbers seen from the Colnect item. */
export type MineStatus = "matched" | "conflict" | "only-mine";

export interface NumberView {
  label: string;
  status: MineStatus;
}

/** What one Colnect-printed catalog ref means against the stamp we resolved to. See the server. */
export type RefStatus = "matched" | "missing" | "conflict" | "unmapped" | "unknown";

export interface RefView {
  catalog: string;
  number: string;
  status: RefStatus;
}

export type MatchResult =
  | {
      colnectId: string;
      status: "auto";
      stampId: string;
      written: boolean;
      alreadySet: boolean;
      /** The matched stamp, for showing which stamp the ID landed on. */
      stamp: Candidate | null;
      /** Every ref printed on the Colnect page, classified against that stamp. */
      refs: RefView[];
    }
  | {
      colnectId: string;
      status: "needs-confirm";
      reason: string;
      candidates: Candidate[];
      refs: RefView[];
    }
  | { colnectId: string; status: "skipped"; reason: string; refs: RefView[] };

/**
 * Whether a "needs your decision" row is one the collector has, in effect, already answered (#305):
 * every stamp it could be linked to already carries a Colnect ID. The commonest shape is
 * `existing-different` — our stamp is linked to a neighbouring Colnect item, and the matcher never
 * silently overwrites (#250), so the same row comes back on every re-scan of the page.
 *
 * A row keeping one free candidate is *not* resolved: that free stamp is most likely the answer, so
 * hiding the row would hide the work.
 */
export function isAlreadyLinkedElsewhere(r: MatchResult): boolean {
  return (
    r.status === "needs-confirm" &&
    r.candidates.length > 0 &&
    r.candidates.every((c) => c.existingColnectId !== null)
  );
}

/**
 * What the toolbar badge counts for a page (#283): the rows that still owe the collector something —
 * every `needs-confirm`, plus every `auto` whose ID is not on the stamp yet. `needsConfirm` comes
 * back beside the total because the badge's *colour* says whether a decision is required, which is a
 * different question from how much is left.
 *
 * Shared by the two things that set that badge — the load-time dry-run and the window pushing its
 * results back after a write — so a page counted before any writing and the same page counted after
 * are counted the same way. A row already written is excluded here rather than only by the caller:
 * at load time nothing is written and the distinction is invisible, which is exactly how the badge
 * came to keep counting work that was already done.
 */
export function badgeTodo(results: MatchResult[]): { todo: number; needsConfirm: number } {
  const needsConfirm = results.filter((r) => r.status === "needs-confirm").length;
  const pendingAuto = results.filter(
    (r) => r.status === "auto" && !r.alreadySet && !r.written
  ).length;
  return { todo: needsConfirm + pendingAuto, needsConfirm };
}
