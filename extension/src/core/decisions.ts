// Mirror of the Stamporama matcher response (#250) — kept in sync by hand since the extension is a
// separate build with no import path into the app.

export interface Candidate {
  stampId: string;
  name: string | null;
  issuedYear: number | null;
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
  existingColnectId: string | null;
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
