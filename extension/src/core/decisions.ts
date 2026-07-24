// Mirror of the Stamporama matcher response (#250) — kept in sync by hand since the extension is a
// separate build with no import path into the app.

export interface Candidate {
  stampId: string;
  name: string | null;
  issuedYear: number | null;
  areaName: string | null;
  /** Issue the stamp belongs to, shown for orientation. */
  issueName: string | null;
  catalogNumbers: string[];
  existingColnectId: string | null;
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
    }
  | { colnectId: string; status: "needs-confirm"; reason: string; candidates: Candidate[] }
  | { colnectId: string; status: "skipped"; reason: string };
