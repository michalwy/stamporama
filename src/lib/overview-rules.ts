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

// ── Coverage by area ──────────────────────────────────────────────────────────

export interface AreaNode {
  id: string;
  parentId: string | null;
  name: string;
}

export interface AreaCoverage {
  areaId: string;
  name: string;
  owned: number;
  required: number;
  checklistCount: number;
}

export interface AreaCoverageRollup {
  /** Root areas with at least one non-empty checklist under them, **worst-covered first** —
   * the tile points at where the collection is thin (#651). */
  tracked: AreaCoverage[];
  /** Root areas with no checklist anywhere in their subtree. Said outright rather than reported
   * as 100%: coverage is only meaningful where a checklist defines the denominator. */
  untracked: { areaId: string; name: string }[];
}

/**
 * Checklist completeness rolled up to the **root** areas — the level a collection is scanned at
 * ("how is Poland doing"), each root covering its whole subtree. An issue is attributed to its
 * area's root; an issue whose area is missing from the tree is skipped rather than invented.
 */
export function rollUpAreaCoverage(
  areas: AreaNode[],
  issues: { issueId: string; areaId: string }[],
  checklists: { issueId: string; owned: number; requiredCount: number }[]
): AreaCoverageRollup {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const rootOf = new Map<string, string>();
  const rootFor = (id: string): string | null => {
    const cached = rootOf.get(id);
    if (cached) return cached;
    // Walk up with a guard: a cycle in the tree must not hang the dashboard.
    const seen = new Set<string>();
    let node = byId.get(id);
    if (!node) return null;
    while (node.parentId && !seen.has(node.id)) {
      seen.add(node.id);
      const parent = byId.get(node.parentId);
      if (!parent) break;
      node = parent;
    }
    rootOf.set(id, node.id);
    return node.id;
  };

  const rootByIssue = new Map<string, string>();
  for (const issue of issues) {
    const root = rootFor(issue.areaId);
    if (root) rootByIssue.set(issue.issueId, root);
  }

  const coverage = new Map<string, AreaCoverage>();
  for (const row of checklists) {
    if (row.requiredCount <= 0) continue;
    const root = rootByIssue.get(row.issueId);
    if (!root) continue;
    const entry = coverage.get(root);
    if (entry) {
      entry.owned += row.owned;
      entry.required += row.requiredCount;
      entry.checklistCount += 1;
    } else {
      coverage.set(root, {
        areaId: root,
        name: byId.get(root)?.name ?? "",
        owned: row.owned,
        required: row.requiredCount,
        checklistCount: 1,
      });
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

  const untracked = areas
    .filter((a) => a.parentId == null && !coverage.has(a.id))
    .map((a) => ({ areaId: a.id, name: a.name }));

  return { tracked, untracked };
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
