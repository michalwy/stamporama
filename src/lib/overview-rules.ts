/**
 * Pure rules behind the Overview screen's tiles (#649–#651; decided in #397).
 *
 * The Overview states aggregates and links into the list screens that hold the rows — every
 * figure here is a roll-up of reads that already exist (`checklist-completeness`,
 * `purchase-return`, the growth event dates), never a new claim about the data. Kept pure so the
 * tile arithmetic unit-tests without Prisma; `overview.ts` owns the I/O.
 */

// ── Growth ────────────────────────────────────────────────────────────────────

/** One month's count as the raw SQL hands it back: `month` is `YYYY-MM` in UTC. */
export interface MonthBucket {
  month: string;
  count: number;
}

export interface GrowthMonth {
  /** `YYYY-MM`, UTC. */
  month: string;
  copies: number;
  issues: number;
}

/** `YYYY-MM` (UTC) for a date — the growth series' bucket key. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * The growth series for the tile: the last `months` calendar months **including the current
 * one**, oldest first, every month present — a month nothing was added in is a zero, not a hole,
 * because a gap in a timeline is information and a missing entry is not. `now` is a parameter so
 * the window is testable; the buckets come from event dates (`Item.createdAt`, `Issue.createdAt`)
 * per #397's "history is recorded, not reconstructed" — creation instants are the one history
 * current state already carries.
 */
export function buildGrowthSeries(
  copies: MonthBucket[],
  issues: MonthBucket[],
  months: number,
  now: Date
): GrowthMonth[] {
  const copiesByMonth = new Map(copies.map((b) => [b.month, b.count]));
  const issuesByMonth = new Map(issues.map((b) => [b.month, b.count]));
  const series: GrowthMonth[] = [];
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  for (let i = months - 1; i >= 0; i -= 1) {
    const key = monthKey(new Date(Date.UTC(year, month - i, 1)));
    series.push({
      month: key,
      copies: copiesByMonth.get(key) ?? 0,
      issues: issuesByMonth.get(key) ?? 0,
    });
  }
  return series;
}

// ── Checklists ────────────────────────────────────────────────────────────────

/** One checklist's completeness as the tally reads it — the `owned` / `requiredCount` pair the
 * issue-group completeness read already computes (#133/#594). */
export interface ChecklistProgress {
  checklistId: string;
  issueId: string;
  name: string;
  owned: number;
  requiredCount: number;
}

export interface ChecklistTally {
  /** Checklists with at least one required stamp. An empty checklist claims nothing and is
   * counted nowhere — 0/0 is not "complete" (`checklist-completeness-rules.ts`'s own rule). */
  total: number;
  complete: number;
  partial: number;
  untouched: number;
  /** The part-done checklist closest to complete — where the next copy does the most. Null when
   * nothing is part-done. */
  closest: ChecklistProgress | null;
}

/**
 * Complete / part-done / untouched over every checklist, and which one is closest to done.
 * Closest is the highest owned/required fraction below 1; ties break to the fewer missing stamps
 * (the smaller remaining effort), then to id so the answer is stable across reads.
 */
export function tallyChecklists(rows: ChecklistProgress[]): ChecklistTally {
  const counted = rows.filter((r) => r.requiredCount > 0);
  let complete = 0;
  let untouched = 0;
  let closest: ChecklistProgress | null = null;
  for (const row of counted) {
    if (row.owned >= row.requiredCount) {
      complete += 1;
      continue;
    }
    if (row.owned === 0) {
      untouched += 1;
      continue;
    }
    if (!closest || closerToDone(row, closest)) closest = row;
  }
  return {
    total: counted.length,
    complete,
    partial: counted.length - complete - untouched,
    untouched,
    closest,
  };
}

function closerToDone(a: ChecklistProgress, b: ChecklistProgress): boolean {
  const fa = a.owned / a.requiredCount;
  const fb = b.owned / b.requiredCount;
  if (fa !== fb) return fa > fb;
  const missingA = a.requiredCount - a.owned;
  const missingB = b.requiredCount - b.owned;
  if (missingA !== missingB) return missingA < missingB;
  return a.checklistId < b.checklistId;
}

// ── Breakdown areas (#1330) ───────────────────────────────────────────────────

export interface AreaNode {
  id: string;
  parentId: string | null;
  name: string;
}

export interface AreaBreakdown {
  /** True when the collector chose the areas; false is the default split by top-level areas. */
  chosen: boolean;
  /** The areas to break down by, in the tree's own order (depth first, siblings as given). */
  areaIds: string[];
  /** Areas lying under none of them — what the *Other* line ranges over. Always empty by default,
   * since the top-level areas cover the whole tree. */
  outsideAreaIds: string[];
}

/**
 * Which areas the Overview breaks the collection down by (#1330): the ones the collector chose, at
 * any depth, or — with nothing chosen — the top-level areas, as before. A chosen id no longer in the
 * tree is ignored; if none is left the default applies. `areas` must arrive in sibling order (the
 * tree read's `sortOrder, name`), and the result is in depth-first tree order so a nested pair reads
 * parent before child.
 */
export function resolveAreaBreakdown(areas: AreaNode[], chosenIds: string[]): AreaBreakdown {
  const ordered = treeOrder(areas);
  const chosenSet = new Set(chosenIds);
  const chosen = ordered.filter((a) => chosenSet.has(a.id)).map((a) => a.id);
  if (chosen.length === 0) {
    return {
      chosen: false,
      areaIds: ordered.filter((a) => a.parentId == null).map((a) => a.id),
      outsideAreaIds: [],
    };
  }
  const covered = new Set(chosen);
  const outsideAreaIds = ordered
    .filter((a) => !ancestorsAndSelf(areas, a.id).some((id) => covered.has(id)))
    .map((a) => a.id);
  return { chosen: true, areaIds: chosen, outsideAreaIds };
}

/** Depth first from the roots, siblings in the order given. An area whose parent is missing is
 * treated as a root; a cycle is cut rather than followed. */
function treeOrder<T extends AreaNode>(areas: T[]): T[] {
  const ids = new Set(areas.map((a) => a.id));
  const children = new Map<string | null, T[]>();
  for (const area of areas) {
    const parent = area.parentId && ids.has(area.parentId) ? area.parentId : null;
    const list = children.get(parent);
    if (list) list.push(area);
    else children.set(parent, [area]);
  }
  const out: T[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | null) => {
    for (const area of children.get(parentId) ?? []) {
      if (seen.has(area.id)) continue;
      seen.add(area.id);
      out.push(area);
      visit(area.id);
    }
  };
  visit(null);
  return out;
}

/** The area and every ancestor above it, nearest first — guarded against a cycle. */
export function ancestorsAndSelf(areas: AreaNode[], areaId: string): string[] {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const out: string[] = [];
  const seen = new Set<string>();
  let node = byId.get(areaId);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    out.push(node.id);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return out;
}

// ── Coverage by area ──────────────────────────────────────────────────────────

export interface AreaCoverage {
  areaId: string;
  name: string;
  owned: number;
  required: number;
  checklistCount: number;
}

export interface AreaCoverageRollup {
  /** True when the rows are the collector's chosen areas (#1330) rather than the top level. */
  chosen: boolean;
  /** Breakdown areas with at least one non-empty checklist under them, **worst-covered first** —
   * the tile points at where the collection is thin (#651). */
  tracked: AreaCoverage[];
  /** Breakdown areas with no checklist anywhere in their subtree. Said outright rather than
   * reported as 100%: coverage is only meaningful where a checklist defines the denominator. */
  untracked: { areaId: string; name: string }[];
  /** Everything outside the chosen areas (#1330), so the breakdown still accounts for the whole
   * collection. Null when nothing lies outside them — always, by default. `checklistCount` 0 is
   * *not tracked*, never complete. */
  other: { owned: number; required: number; checklistCount: number } | null;
}

/**
 * Checklist completeness rolled up to the breakdown areas (#651, #1330): the top-level areas — the
 * level a collection is scanned at ("how is Poland doing") — or the areas the collector chose, at any
 * depth. Each covers its whole subtree, so with a nested pair chosen an issue counts under both and
 * nothing is summed across them. An issue under none of the chosen areas counts under *Other*; an
 * issue whose area is missing from the tree is skipped rather than invented.
 */
export function rollUpAreaCoverage(
  areas: AreaNode[],
  issues: { issueId: string; areaId: string }[],
  checklists: { issueId: string; owned: number; requiredCount: number }[],
  chosenIds: string[] = []
): AreaCoverageRollup {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const breakdown = resolveAreaBreakdown(areas, chosenIds);
  const breakdownSet = new Set(breakdown.areaIds);

  // For each issue, the breakdown areas holding it — none means *Other* (only possible when chosen).
  const holdersByIssue = new Map<string, string[]>();
  for (const issue of issues) {
    if (!byId.has(issue.areaId)) continue;
    holdersByIssue.set(
      issue.issueId,
      ancestorsAndSelf(areas, issue.areaId).filter((id) => breakdownSet.has(id))
    );
  }

  const coverage = new Map<string, AreaCoverage>();
  let other = { owned: 0, required: 0, checklistCount: 0 };
  for (const row of checklists) {
    if (row.requiredCount <= 0) continue;
    const holders = holdersByIssue.get(row.issueId);
    if (!holders) continue;
    if (holders.length === 0) {
      other = {
        owned: other.owned + row.owned,
        required: other.required + row.requiredCount,
        checklistCount: other.checklistCount + 1,
      };
      continue;
    }
    for (const areaId of holders) {
      const entry = coverage.get(areaId);
      if (entry) {
        entry.owned += row.owned;
        entry.required += row.requiredCount;
        entry.checklistCount += 1;
      } else {
        coverage.set(areaId, {
          areaId,
          name: byId.get(areaId)?.name ?? "",
          owned: row.owned,
          required: row.requiredCount,
          checklistCount: 1,
        });
      }
    }
  }

  const tracked = [...coverage.values()].sort((a, b) => {
    const fa = a.owned / a.required;
    const fb = b.owned / b.required;
    if (fa !== fb) return fa - fb;
    // Same fraction: the bigger gap first — more missing stamps is the thinner spot.
    const missingA = a.required - a.owned;
    const missingB = b.required - b.owned;
    if (missingA !== missingB) return missingB - missingA;
    return a.name.localeCompare(b.name);
  });

  const untracked = breakdown.areaIds
    .filter((id) => !coverage.has(id))
    .map((id) => ({ areaId: id, name: byId.get(id)?.name ?? "" }));

  return {
    chosen: breakdown.chosen,
    tracked,
    untracked,
    other: breakdown.outsideAreaIds.length > 0 ? other : null,
  };
}

// ── Purchase ROI ──────────────────────────────────────────────────────────────

/** The slice of {@link import("./purchase-return").PurchaseReturn} the classification reads. */
export interface PurchaseReturnFigures {
  realized: string;
  netReturn: string;
  spent: { totalCostBasis: string; knownCount: number; pendingCount: number; noneCount: number };
}

export interface PurchaseRecoupTally {
  /** Purchases the figures range over — those with at least one arrived copy. */
  measured: number;
  /** Known spend, and the sales attributed to it have covered it (`netReturn >= 0`). */
  recouped: number;
  /** Known spend still ahead of what came back. */
  outstanding: number;
  /** No settled cost at all yet (every copy pending or uncosted) — neither recouped nor
   * outstanding, because there is no figure to have returned. */
  uncosted: number;
  /** Purchases whose spend is not final (some copies still in an open lot, #123). Their
   * `recouped`/`outstanding` call may move once the pool is worked out. */
  pendingCostCount: number;
  /** Σ known spend across the measured purchases, 2 dp. */
  spent: string;
  /** Σ attributed net proceeds across the measured purchases, 2 dp. */
  realized: string;
}

/** Which purchases have returned their cost and which are still outstanding (#650). */
export function classifyPurchaseReturns(returns: PurchaseReturnFigures[]): PurchaseRecoupTally {
  let recouped = 0;
  let outstanding = 0;
  let uncosted = 0;
  let pendingCostCount = 0;
  let spentCents = 0;
  let realizedCents = 0;
  for (const r of returns) {
    const spend = Math.round(Number(r.spent.totalCostBasis) * 100);
    spentCents += spend;
    realizedCents += Math.round(Number(r.realized) * 100);
    if (r.spent.pendingCount > 0) pendingCostCount += 1;
    if (spend <= 0) uncosted += 1;
    else if (Number(r.netReturn) >= 0) recouped += 1;
    else outstanding += 1;
  }
  return {
    measured: returns.length,
    recouped,
    outstanding,
    uncosted,
    pendingCostCount,
    spent: (spentCents / 100).toFixed(2),
    realized: (realizedCents / 100).toFixed(2),
  };
}
