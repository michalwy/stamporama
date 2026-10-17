// Browsing on the phone (#2005, ADR-0072): area → year → issue → stamp, for the stamp in hand whose
// catalogue number is not known. Pure, so the unit suite holds it — the reads behind it are the
// desk's own (`phone-browse.ts`), and nothing here decides a figure, only how a level is laid out
// and how a stamp's marks read.

import type { WantPriority } from "./want-rules";

/** An area as the browse reads it: the tree's own shape, in the desk's order. */
export interface PhoneBrowseAreaSource {
  id: string;
  name: string;
  parentId: string | null;
}

/** A sub-area offered on a level: where it goes and how much is filed under it. */
export interface PhoneBrowseAreaRow {
  id: string;
  name: string;
  /** Issues filed in the area **and every area under it** — what opening it leads to. */
  issueCount: number;
}

/**
 * The sub-areas of one level — the top-level areas for `null` — each with the issues filed anywhere
 * under it. The areas arrive in the desk's order (`sortOrder`, then name) and keep it. Issue counts
 * are each area's **own**, rolled up here, as the desk's area rail rolls them (#843).
 */
export function phoneAreaChildren(
  areas: readonly PhoneBrowseAreaSource[],
  ownIssueCounts: ReadonlyMap<string, number>,
  parentId: string | null
): PhoneBrowseAreaRow[] {
  const childrenOf = new Map<string | null, PhoneBrowseAreaSource[]>();
  for (const area of areas) {
    const list = childrenOf.get(area.parentId) ?? [];
    list.push(area);
    childrenOf.set(area.parentId, list);
  }
  const subtreeCount = (id: string): number => {
    let total = 0;
    const stack = [id];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const next = stack.pop()!;
      // A cycle cannot be written, but a count that never ends is a worse failure than a wrong one.
      if (seen.has(next)) continue;
      seen.add(next);
      total += ownIssueCounts.get(next) ?? 0;
      for (const child of childrenOf.get(next) ?? []) stack.push(child.id);
    }
    return total;
  };
  return (childrenOf.get(parentId) ?? []).map((area) => ({
    id: area.id,
    name: area.name,
    issueCount: subtreeCount(area.id),
  }));
}

/** The area's ancestors, outermost first, the area itself left out — the line above a level's title. */
export function phoneAreaAncestors(
  areas: readonly PhoneBrowseAreaSource[],
  areaId: string
): PhoneBrowseAreaSource[] {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const out: PhoneBrowseAreaSource[] = [];
  const seen = new Set<string>([areaId]);
  let parentId = byId.get(areaId)?.parentId ?? null;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    out.unshift(parent);
    seen.add(parentId);
    parentId = parent.parentId;
  }
  return out;
}

/** `12 issues`, `1 issue`, `No issues` — what a row promises before it is opened. */
export function phoneIssueCountText(count: number): string {
  if (count === 0) return "No issues";
  return `${count} ${count === 1 ? "issue" : "issues"}`;
}

/** `12 stamps`, `1 stamp`, `No stamps`. */
export function phoneStampCountText(count: number): string {
  if (count === 0) return "No stamps";
  return `${count} ${count === 1 ? "stamp" : "stamps"}`;
}

/** A year as a row and a title says it — the desk's *No year* for the bucket without one (#703). */
export function phoneYearLabel(year: number | null): string {
  return year === null ? "No year" : String(year);
}

/** An issue's name as the desk's groupings say it, an unnamed one included. */
export function phoneIssueName(name: string | null): string {
  return name?.trim() || "Untitled issue";
}

/** A stamp of an issue, as far as laying the list out needs. */
export interface PhoneIssueStampSource {
  stampId: string;
  parentId: string | null;
}

/**
 * An issue's stamps in the desk's order (#549), each variant under the stamp it varies and drawn one
 * step in. A variant whose parent is not on this issue stands at the top level, as the desk's tree
 * files it.
 */
export function phoneIssueStampRows<T extends PhoneIssueStampSource>(
  stamps: readonly T[]
): { stamp: T; depth: number }[] {
  const onIssue = new Set(stamps.map((s) => s.stampId));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const stamp of stamps) {
    if (stamp.parentId !== null && onIssue.has(stamp.parentId) && stamp.parentId !== stamp.stampId) {
      const list = childrenOf.get(stamp.parentId) ?? [];
      list.push(stamp);
      childrenOf.set(stamp.parentId, list);
    } else {
      roots.push(stamp);
    }
  }
  const out: { stamp: T; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (stamp: T, depth: number) => {
    if (seen.has(stamp.stampId)) return;
    seen.add(stamp.stampId);
    out.push({ stamp, depth });
    for (const child of childrenOf.get(stamp.stampId) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // A stamp reached by neither — a parent loop the tree cannot hold — is still listed, never lost.
  for (const stamp of stamps) visit(stamp, 0);
  return out;
}

/** What a stamp in a browsed issue says at a glance: is it held, how many, is it wanted. */
export interface PhoneStampMarks {
  /** `2 held`, or `Not held` — the copies of this stamp exactly, as the desk's badge counts them. */
  held: string;
  /** Whether that line is the good news, so the screen can draw it so. */
  isHeld: boolean;
  /** `3 more under its variants` — the desk's second figure beside the badge (#528), when there are any. */
  variants: string | null;
  /** The open wants' loudest priority — the desk's want chip's colour — or null when not wanted. */
  wanted: WantPriority | null;
}

export function phoneStampMarks(
  copies: number,
  variantCopies: number,
  wants: { openCount: number; topPriority: WantPriority } | null
): PhoneStampMarks {
  return {
    held: copies > 0 ? `${copies} held` : "Not held",
    isHeld: copies > 0,
    variants: variantCopies > 0 ? `${variantCopies} more under its variants` : null,
    wanted: wants && wants.openCount > 0 ? wants.topPriority : null,
  };
}
