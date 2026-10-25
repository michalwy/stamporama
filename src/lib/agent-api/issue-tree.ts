import { invalidRequest, type ApiError } from "./errors";

// A stamp between issues and an empty issue deleted, on the agent API (#2169, #2172): the refusals
// an agent is told, pure so they are unit-tested without the database.
//
// **Moving a stamp to another issue is the screen's *Move to another issue…***, and the collector
// kept the screen's area rule (2026-10-25): the target is an issue of the same area, which is all
// the screen's picker offers. What the API adds is that the stamp's checklist places follow it, and
// that a number reading differently under the target's own prefix is refused when another stamp
// already has it — the screen's move checks neither.

/** An issue as a sentence names it: `iss 12 "Freimarken" (1950)`. */
export function spokenIssue(issue: { issueNo: number; name: string | null; year: number | null }): string {
  const name = issue.name ? ` "${issue.name}"` : "";
  const year = issue.year !== null ? ` (${issue.year})` : "";
  return `iss ${issue.issueNo}${name}${year}`;
}

/** A stamp of the collection that already has the identity a moved stamp would take. */
export interface MoveHolder {
  readonly stampId: string;
  readonly name: string | null;
  readonly issueName: string | null;
  readonly issueYear: number | null;
}

/** One identity — `Mi·GG 5` — a moved stamp would read as under the target, and who already has it. */
export interface MoveCollision {
  readonly label: string;
  /** The moved stamp that would carry it, as a sentence names it. */
  readonly stamp: string;
  readonly holders: readonly MoveHolder[];
}

function describeHolder(holder: MoveHolder): string {
  const series = [holder.issueName, holder.issueYear].filter((part) => part !== null && part !== "").join(", ");
  const name = holder.name ? `"${holder.name}"` : "a stamp";
  return `${name}${series ? ` in ${series}` : ""} (id ${holder.stampId})`;
}

/**
 * The refusal for a move that would give a stamp a catalogue identity — catalogue, prefix, number
 * (#85) — another stamp already has, because the target issue files the catalogue under another
 * prefix than the source (#377). Refused whatever the duplicate setting says, as `update_issue`
 * refuses a prefix change (#1606). Both stamps are named; the holders' ids are in `accepted`.
 */
export function moveCollisions(target: string, collisions: readonly MoveCollision[]): ApiError {
  const lines = collisions.map(
    (collision) => `${collision.stamp} would read as ${collision.label} under ${target}, which is already ${collision.holders.map(describeHolder).join(" and ")}`
  );
  return invalidRequest(
    `${lines.join("; ")}. Nothing was moved. A catalogue number names one stamp here, so a move that makes two stamps share one is refused — correct the numbers, or the target issue's prefix, first.`,
    [...new Set(collisions.flatMap((collision) => collision.holders.map((holder) => holder.stampId)))]
  );
}

/** The refusal for deleting an issue that still has stamps (#2172). */
export function issueHasStampsMessage(issue: string, stampCount: number, topLevelCount: number): string {
  const stamps = stampCount === 1 ? "1 stamp" : `${stampCount} stamps`;
  const variants = stampCount - topLevelCount;
  const split = variants > 0 ? ` (${topLevelCount} at the top level and ${variants} ${variants === 1 ? "variant" : "variants"})` : "";
  return `${issue} is not deleted: it has ${stamps}${split}. Only an issue with no stamps is deleted here. Move them to another issue with \`move_stamp_to_issue\`, or delete those nothing holds with \`delete_stamp\` and \`delete_stamp_variant\`, first. Nothing was changed.`;
}

/**
 * The refusal for deleting an issue whose checklist an album prints (#2172). The issue's delete
 * takes its checklists, and with them each album's card for one — `delete_checklist` refuses that
 * (#1512), so deleting the issue does too.
 */
export function issueChecklistsInAlbumsMessage(
  issue: string,
  printed: readonly { checklist: string; albums: readonly string[] }[]
): string {
  const lines = printed.map(
    (entry) => `"${entry.checklist}" is printed in ${entry.albums.map((album) => `"${album}"`).join(", ")}`
  );
  return `${issue} is not deleted: ${lines.join("; ")}, and deleting the issue would take its card out of ${printed.length === 1 && printed[0].albums.length === 1 ? "that album" : "those albums"}. The collector takes it out of the album first, or deletes the issue on the screen. Nothing was changed.`;
}
