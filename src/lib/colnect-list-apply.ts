import "server-only";
import { prisma } from "./db";
import {
  listColnectReportKeys,
  readColnectLocalCondQty,
  setColnectReportDone,
  type ColnectCondQtyRow,
} from "./colnect-list-report";
import type { ColnectReportFilters } from "./colnect-list-report";
import {
  isColnectListDifferenceKind,
  type ColnectListSourceOfTruth,
} from "./colnect-list-sync-rules";

// **The worklist the extension applies on Colnect** (#689) — the server half of the first thing in
// this repo that ever *writes* to a Colnect account.
//
// Nothing here talks to Colnect. It cannot: Colnect has no API, and the only credentials that could
// reach the account are the collector's own cookies in their own browser. What this module produces
// is a **list of intentions** — this item onto that list, that item off it — which the Assistant
// then carries out on a colnect.com page, one throttled request at a time. See ADR-0042 for the
// decision and its risks; `docs/agents/extension.md` for the run itself.
//
// **An addition carries the quantity and the grades this side holds** (#704, amending ADR-0042).
// It used to carry membership and nothing else, on the reasoning that a stamp with copies of two
// grades has no single Colnect grade to send. Colnect holds *several* conditions per list entry, so
// it does have one — two rows — and, more to the point, not writing a grade is not the same as
// leaving it alone: on an entry the run has just created, silence hands the decision to the list's
// own defaults, which is how `Here 2 × MNH` landed over there as `1 × MNH`.
//
// Entries **already** on the list are still not touched. Correcting those needs to read what Colnect
// currently holds, and the one call that could is `act=check&val=+`, which was verified on
// 2026-08-27 to *reset* an existing entry to the list defaults rather than report it. Correcting
// those is #705, and it starts by settling what an export says Colnect holds.
//
// A condition this collection has never mapped to a Colnect grade (#404) is **not written and is
// reported** — the collector's rule, and the same refusal to guess the report's own grade silence is.
//
// **A removal is guarded by the snapshot's age; an addition is not.** They are not symmetrical acts.
// Adding something the collection holds *now* is right whatever the file's age — the local side was
// read this second. Removing is the act taken purely on the strength of the file: the report says
// "Colnect has this and you do not", and if that file is three weeks old the collector may have
// added the item there since, deliberately. So a run that removes anything refuses against a stale
// export and names the import as the way through. This is the issue's own rule — *removals only
// from what the report actually saw*.

/**
 * How old an export may be before its **removals** are refused, in days.
 *
 * Seven, because that is roughly the rhythm this loop runs at — export, work through the report,
 * export again — and because a week is long enough that a collector will have forgotten what they
 * did on Colnect in the meantime, which is exactly the condition a blind bulk removal is dangerous
 * under. Counted from Colnect's own `exportedAt` where the preamble gave one, and from `importedAt`
 * only where it did not: a file exported in March and loaded this morning is three months old.
 */
export const COLNECT_APPLY_MAX_SNAPSHOT_AGE_DAYS = 7;

/** Which way one item goes on Colnect — `+` onto the list, `-` off it. Colnect's own `val`. */
export type ColnectApplyDirection = "+" | "-";

/** One thing to do on Colnect. */
export interface ColnectApplyItem {
  colnectId: string;
  direction: ColnectApplyDirection;
  /** The bucket it came from, carried so that applying it can mark **that** difference done on the
   *  report (#686) rather than guessing at a kind. */
  kind: string;
  /** What this side holds, a row per grade (#704) — Colnect's own condition ids. Present only on an
   *  addition, and empty where no grade can be stated. */
  rows?: ColnectCondQtyRow[];
  /** A count to state where no grade can be: a stamp whose open wants name no single condition. The
   *  run writes it against whatever grade Colnect's own entry carries and leaves that grade alone. */
  ungraded?: number;
}

/**
 * A run, as it is handed to the Assistant.
 *
 * `lt` sits on the run rather than on each item, because a run *is* one list: the report is drawn
 * for one mapping at a time and there is no gesture that mixes two. Twenty-five thousand copies of
 * the same integer would be twenty-five thousand chances for one of them to be the wrong list.
 */
export interface ColnectApplyWorklist {
  lt: number;
  label: string;
  items: ColnectApplyItem[];
  additions: number;
  removals: number;
  /** The export the removals would be taken on the strength of. */
  snapshot: {
    fileName: string;
    /** Colnect's own timestamp, ISO-8601, or null where the preamble gave none. */
    exportedAt: string | null;
    importedAt: string;
    /** Whole days since the export was taken — Colnect's stamp where there is one. */
    ageDays: number;
  };
  /** False when the snapshot is too old to remove anything on the strength of. The additions still
   *  stand, and `items` still holds only them. */
  removalsAllowed: boolean;
  /** Why removals were dropped, in a sentence the screen prints. Null where they were not. */
  removalsRefused: string | null;
  /** Additions holding copies in a condition with no Colnect mapping (#404, #704). Their grade is
   *  not written and not guessed; this is what the dialog says so before an hour-long run. */
  unmappedConditions: number;
  /** That, as a sentence, or null where there are none. */
  unmappedConditionsNote: string | null;
}

/** Raised when a worklist is asked for a list that cannot produce one. */
export class ColnectApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColnectApplyError";
  }
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** Whole days between then and now, floored — the unit the guard and the sentence both use. */
function ageInDays(since: Date, now: Date): number {
  return Math.floor((now.getTime() - since.getTime()) / 86_400_000);
}

/**
 * What the Assistant should do on Colnect for one list, under the report's own filters.
 * Owner-authorized.
 *
 * The two directions, and nothing else:
 *   • **Missing on Colnect** → `+`. The predicate holds here and the list does not name it.
 *   • **Extra on Colnect**, where the mapping's `sourceOfTruth` is `local` → `-`. This side is the
 *     one that wins, so the item should come off the list. Where Colnect wins instead, the answer
 *     is to adopt it here (#687/#688) and there is nothing to do *there*.
 *   • **Quantity**, **Grade**, **Not comparable** → nothing. Membership only, and a row that was
 *     never checked is not a row to act on.
 *
 * Rows already put away — marked done, or accepted as a standing divergence — are excluded by the
 * report's own filters, which is right: a run should carry out what the screen shows.
 */
export async function getColnectApplyWorklist(
  ownerId: string,
  collectionId: string,
  lt: number,
  filters: ColnectReportFilters = {},
  now: Date = new Date()
): Promise<ColnectApplyWorklist> {
  await assertCollectionOwner(ownerId, collectionId);
  const mapping = await prisma.colnectListMapping.findFirst({
    where: { collectionId, lt, enabled: true },
    select: {
      label: true,
      sourceOfTruth: true,
      snapshot: { select: { fileName: true, exportedAt: true, importedAt: true } },
    },
  });
  if (!mapping) throw new ColnectApplyError("That Colnect list is not set up for sync.");
  if (!mapping.snapshot) {
    throw new ColnectApplyError(
      "That Colnect list holds no import, so there is no difference to apply."
    );
  }

  const keys = await listColnectReportKeys(ownerId, collectionId, lt, {
    ...filters,
    buckets: ["only-local", "only-colnect"],
    includeHidden: false,
  });

  const takenLocally = (mapping.sourceOfTruth as ColnectListSourceOfTruth) === "local";
  const additions: ColnectApplyItem[] = [];
  const removals: ColnectApplyItem[] = [];
  for (const key of keys) {
    if (key.bucket === "only-local") {
      additions.push({ colnectId: key.colnectId, direction: "+", kind: key.bucket });
    } else if (key.bucket === "only-colnect" && takenLocally) {
      removals.push({ colnectId: key.colnectId, direction: "-", kind: key.bucket });
    }
  }

  // What each addition should land as (#704). One query for the whole worklist rather than one per
  // item: a first Swap pass is thousands of additions, and the run reads this once before it starts.
  // Removals carry none — there is nothing to state about an entry that is going away.
  const held = await readColnectLocalCondQty(
    ownerId,
    collectionId,
    lt,
    additions.map((item) => item.colnectId)
  );
  let unmappedConditions = 0;
  for (const item of additions) {
    const local = held.get(item.colnectId);
    item.rows = local?.rows ?? [];
    if (local?.ungraded) item.ungraded = local.ungraded;
    if (local?.unmapped) unmappedConditions += 1;
  }

  const takenAt = mapping.snapshot.exportedAt ?? mapping.snapshot.importedAt;
  const ageDays = ageInDays(takenAt, now);
  const removalsAllowed = ageDays <= COLNECT_APPLY_MAX_SNAPSHOT_AGE_DAYS;

  return {
    lt,
    label: mapping.label,
    items: removalsAllowed ? [...additions, ...removals] : additions,
    additions: additions.length,
    removals: removalsAllowed ? removals.length : 0,
    snapshot: {
      fileName: mapping.snapshot.fileName,
      exportedAt: mapping.snapshot.exportedAt?.toISOString() ?? null,
      importedAt: mapping.snapshot.importedAt.toISOString(),
      ageDays,
    },
    removalsAllowed,
    unmappedConditions,
    unmappedConditionsNote:
      unmappedConditions === 0
        ? null
        : `${unmappedConditions} of the additions ${unmappedConditions === 1 ? "holds a copy" : "hold copies"} in a condition you have not mapped to a Colnect grade. Those copies are left out of what is written rather than guessed at — map the condition under Settings → Colnect if you want them counted.`,
    removalsRefused:
      removalsAllowed || removals.length === 0
        ? null
        : `${removals.length} ${removals.length === 1 ? "removal was" : "removals were"} left out: this export is ${ageDays} days old, and removing something on the strength of a file that age would undo whatever you have done on Colnect since. Load a fresh export first.`,
  };
}

/**
 * Mark a batch of differences done on Colnect, from the run that carried them out (#689/#686).
 * Owner-authorized.
 *
 * A batch rather than one call per item, because the run is paced at roughly one write every other
 * second and a second request beside each of them would double the traffic for no gain — but small
 * batches rather than one at the end, because the point of the mark is that the report and the run
 * never disagree about what has already been carried out. A crash mid-run leaves the report
 * describing exactly what got through.
 *
 * The claim is the same one the collector makes by hand from the row's menu, and dies the same way:
 * it hangs off the snapshot, so the next import checks it against a fresh reading of Colnect.
 */
export async function markColnectApplied(
  ownerId: string,
  collectionId: string,
  lt: number,
  marks: readonly { colnectId: string; kind: string }[]
): Promise<{ marked: number }> {
  await assertCollectionOwner(ownerId, collectionId);
  let marked = 0;
  for (const mark of marks) {
    const colnectId = mark.colnectId?.trim();
    // A mark naming a kind this build does not file rows under is skipped rather than fatal: it is
    // one row of a long run, and losing the run over it would be worse than losing the claim.
    if (!colnectId || !isColnectListDifferenceKind(mark.kind)) continue;
    await setColnectReportDone(ownerId, collectionId, lt, colnectId, mark.kind, true);
    marked += 1;
  }
  return { marked };
}
