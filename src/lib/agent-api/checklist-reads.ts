// What the checklist operations answer with, the order they list checklists in, and their refusals
// (#1512).
//
// A checklist (#531, ADR-0031) is a named list of stamps that counts as one complete unit, anchored
// to one issue or spanning several (#1416). What it *is*, and how complete it is, belong to
// `src/lib/checklists.ts` and `issue-completeness.ts`; this module only states one to an agent.
//
// Pure: no Prisma, typed structurally, so `pnpm test:unit` holds every rule here.

import { invalidRequest, type ApiError } from "./errors";
import { compact } from "./collection-reads";
import type { AgentCatalogResolution } from "./catalog-resolve";

/** An issue a checklist belongs to or reaches. */
export interface AgentChecklistIssue {
  readonly issueId: string;
  readonly name?: string;
  readonly year?: number;
}

/** One checklist, whole: a `list_checklists` row is everything but its stamps. */
export interface AgentChecklist {
  readonly checklistId: string;
  readonly name: string;
  /** The name in other languages, language → name (#1308). Absent when it has none of its own. */
  readonly translatedNames?: Readonly<Record<string, string>>;
  /** Anchored to no issue (#1416). */
  readonly spansIssues: boolean;
  /** Its own issue; absent on a checklist spanning issues. */
  readonly issue?: AgentChecklistIssue;
  /** On a checklist spanning issues only: every issue one of its stamps is filed under. */
  readonly coversIssues?: readonly AgentChecklistIssue[];
  readonly stampCount: number;
  /** The albums printing it (#755) — why `delete_checklist` would refuse. Absent when none do. */
  readonly albums?: readonly string[];
  readonly path: string;
}

export interface ChecklistRow {
  readonly id: string;
  readonly name: string;
  readonly nameByLanguage: Readonly<Record<string, string>>;
  readonly issue: { readonly id: string; readonly name: string | null; readonly year: number | null } | null;
  readonly coversIssues: readonly { readonly id: string; readonly name: string | null; readonly year: number | null }[];
  readonly stampCount: number;
  readonly albums: readonly string[];
}

function issueOf(issue: { id: string; name: string | null; year: number | null }): AgentChecklistIssue {
  return compact({ issueId: issue.id, name: issue.name ?? undefined, year: issue.year ?? undefined });
}

export function agentChecklist(row: ChecklistRow, path: string): AgentChecklist {
  return compact({
    checklistId: row.id,
    name: row.name,
    translatedNames: Object.keys(row.nameByLanguage).length > 0 ? { ...row.nameByLanguage } : undefined,
    spansIssues: row.issue === null,
    issue: row.issue ? issueOf(row.issue) : undefined,
    coversIssues: row.issue === null ? row.coversIssues.map(issueOf) : undefined,
    stampCount: row.stampCount,
    albums: row.albums.length > 0 ? [...row.albums] : undefined,
    path,
  });
}

/** What a checklist is sorted by in `list_checklists`. */
export interface ChecklistOrderKey {
  readonly id: string;
  readonly sortOrder: number;
  readonly createdAt: Date;
  /** Null for a checklist spanning issues. */
  readonly issue: { readonly year: number | null; readonly issueNo: number; readonly id: string } | null;
}

/**
 * The order `list_checklists` reads in: the checklists spanning issues first, in the order the
 * Checklists screen shows them (#1416), then each issue's own in the order the Issues list reads —
 * by year, unknown last, then by issue number — and within an issue in the collector's order, which
 * is `sortOrder` then `createdAt` everywhere (`checklists.ts`).
 */
export function compareChecklistOrder(a: ChecklistOrderKey, b: ChecklistOrderKey): number {
  if ((a.issue === null) !== (b.issue === null)) return a.issue === null ? -1 : 1;
  if (a.issue && b.issue) {
    const byIssue =
      (a.issue.year ?? Number.MAX_SAFE_INTEGER) - (b.issue.year ?? Number.MAX_SAFE_INTEGER) ||
      a.issue.issueNo - b.issue.issueNo ||
      a.issue.id.localeCompare(b.issue.id);
    if (byIssue !== 0) return byIssue;
  }
  return (
    a.sortOrder - b.sortOrder ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

/** One stamp on a checklist, where it stands in the set's order (#764). */
export interface AgentChecklistStamp {
  /** 1 is the first stamp the set reads. */
  readonly position: number;
  readonly stampId: string;
  readonly stampNo: number;
  readonly catalogNumbers: readonly string[];
  readonly name?: string;
}

/** A stamp named by a call, as the collector reads it. */
export interface AgentNamedStamp {
  readonly stampId: string;
  readonly stampNo: number;
  readonly catalogNumbers: readonly string[];
}

/** An entry a lenient call could not turn into one stamp, and why. */
export interface AgentUnfoundStamp {
  readonly input: string;
  readonly reason: string;
}

/**
 * Why a stamp reference named no single stamp, in a sentence — the three failures the resolver has,
 * worded as `unresolvedStamps` words them for the calls that refuse instead (`size-reads.ts`).
 */
export function unfoundStamp(resolution: AgentCatalogResolution): AgentUnfoundStamp {
  if (resolution.verdict === "ambiguous") {
    const candidates = resolution.stamps.map((stamp) => `${stamp.matchedNumber} (${stamp.stampId})`);
    return { input: resolution.input, reason: `matches ${resolution.stamps.length} stamps: ${candidates.join(", ")}; send the id` };
  }
  if (resolution.verdict === "unknown_vendor") {
    const kept = resolution.acceptedVendors?.join(", ") || "none";
    return { input: resolution.input, reason: `names a catalogue this collection does not keep (catalogues kept: ${kept})` };
  }
  return { input: resolution.input, reason: "is no stamp id and no catalogue number of a stamp in this collection" };
}

/** A shortened list of stamps for a sentence: their first catalogue number, else their id. */
function describeStamps(stamps: readonly AgentNamedStamp[], limit = 10): string {
  const shown = stamps.slice(0, limit).map((stamp) => stamp.catalogNumbers[0] ?? stamp.stampId);
  const more = stamps.length > shown.length ? ` and ${stamps.length - shown.length} more` : "";
  return `${shown.join(", ")}${more}`;
}

/**
 * The refusal for stamps that are not filed under the issue a checklist belongs to. An issue's own
 * checklist holds that issue's stamps — its editor offers nothing else (ADR-0020 §7, ADR-0031 §5) —
 * and a stamp of another publication counted in its set is exactly what the anchor prevents.
 */
export function stampsNotOnIssue(
  checklistName: string,
  issueName: string | null,
  stamps: readonly AgentNamedStamp[]
): ApiError {
  const issue = issueName ? `"${issueName}"` : "its issue";
  return invalidRequest(
    `"${checklistName}" is ${issue}'s own checklist and holds only stamps filed under that issue; ${describeStamps(stamps)} ${stamps.length === 1 ? "is" : "are"} not. Nothing was added. Add ${stamps.length === 1 ? "it" : "them"} to a checklist spanning issues instead, or leave filing ${stamps.length === 1 ? "it" : "them"} under the issue to the collector.`
  );
}

/**
 * The refusal for deleting a checklist an album prints. On the screen the confirmation names the
 * albums and the delete takes each one's card with it (#1416); through the API it is refused, so no
 * printed page loses its block without the collector having looked.
 */
export function checklistInUse(checklistName: string, albums: readonly { id: string; name: string }[]): ApiError {
  const names = albums.map((album) => `"${album.name}"`).join(", ");
  return invalidRequest(
    `"${checklistName}" is printed in ${albums.length === 1 ? "the album" : `${albums.length} albums`} ${names}, and deleting it would take its card out of ${albums.length === 1 ? "it" : "each"}. Nothing was deleted. The collector takes it out of ${albums.length === 1 ? "that album" : "those albums"} first, or deletes it on the screen.`
  );
}
