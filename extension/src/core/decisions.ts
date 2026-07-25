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
  existingColnectId: string | null;
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
