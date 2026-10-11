/**
 * The operational **Dashboard**'s shape (#1808; ADR-0067) — the work waiting on the collector,
 * gathered from the Sales, Intake, Offers, Auctions and Trades screens onto one screen.
 *
 * Pure, so the shape and its rules are unit-tested without Prisma; `dashboard.ts` holds the reads.
 *
 * - **Five sections, fixed** — decided with the collector on 2026-10-11. What each one holds is its
 *   own issue (#1809–#1813); this file only says what a section *is*.
 * - **A section is groups, a group is a count and its rows.** The dashboard decides nothing: every
 *   row links to the screen where the thing is dealt with, and every group to that screen filtered
 *   to exactly its set — the bell's rule (#367), for the same reason.
 * - **Where a group means what a bell group means, both read the same source** (ADR-0067), so the
 *   two can never disagree. {@link dashboardGroupFromBell} is that hand-over: a bell group is already
 *   a dashboard group less its severity and its collapse, which are the panel's decisions.
 * - **An empty group is shown, with its zero**, so a quiet dashboard reads as *nothing to do* and
 *   not as *nothing loaded*. Whether a group is empty is {@link isEmptyGroup}'s, never a filter that
 *   drops it.
 */

export type DashboardSectionId = "sales" | "incoming-purchases" | "offers" | "auctions" | "trades";

export interface DashboardSectionSpec {
  id: DashboardSectionId;
  title: string;
  /**
   * Collection-relative, the screen the section's work is mostly done on. The section's heading
   * links there, and the screen reads its sidebar tint off it (`sectionTintForHref`) — the colour
   * the collector already knows that work by, rather than a second palette.
   */
  href: string;
}

/** The five sections, in the order the screen lays them out. */
export const DASHBOARD_SECTIONS: readonly DashboardSectionSpec[] = [
  { id: "sales", title: "Sales", href: "sales" },
  { id: "incoming-purchases", title: "Incoming purchases", href: "purchases" },
  { id: "offers", title: "Offers to handle", href: "offers" },
  { id: "auctions", title: "Auctions I bid in", href: "auctions" },
  { id: "trades", title: "Trades", href: "trades" },
];

export function isDashboardSectionId(value: string): value is DashboardSectionId {
  return DASHBOARD_SECTIONS.some((s) => s.id === value);
}

export function dashboardSectionSpec(id: DashboardSectionId): DashboardSectionSpec {
  const spec = DASHBOARD_SECTIONS.find((s) => s.id === id);
  if (!spec) throw new Error(`Unknown dashboard section: ${id}`);
  return spec;
}

/** One thing waiting — the bell's `ActionItem`, structurally, so a group can move between the two. */
export interface DashboardItem {
  /** Unique within its group. */
  key: string;
  label: string;
  /** Muted second line: whatever names the item's context. */
  detail: string | null;
  /** The instant the item is about, ISO, formatted client-side; null where it is about none. */
  at: string | null;
  /** Collection-relative — the screen where this one thing is dealt with. */
  href: string;
}

export interface DashboardGroup {
  /** Unique within the dashboard. */
  id: string;
  title: string;
  /** Everything matching; {@link items} is its head, oldest or most urgent first. */
  count: number;
  items: DashboardItem[];
  /** Collection-relative — the screen filtered to exactly this group's set. */
  href: string;
}

export interface DashboardSection extends DashboardSectionSpec {
  /** In the order the section's providers return them — a group is never dropped for being empty. */
  groups: DashboardGroup[];
}

/**
 * How many rows a group lists before it says *N more →*. Larger than the bell's head, because this
 * is a screen of work rather than a panel of exceptions, but still a cap: past it a group is a
 * quantity, and its own screen is where the rest is read.
 */
export const DASHBOARD_ROW_LIMIT = 10;

export function isEmptyGroup(group: DashboardGroup): boolean {
  return group.count === 0;
}

/** The rows a group has beyond those it lists. */
export function remainingCount(group: DashboardGroup): number {
  return Math.max(0, group.count - group.items.length);
}

/** Holds a group to {@link DASHBOARD_ROW_LIMIT} rows, keeping its count. */
export function capGroup(group: DashboardGroup, limit: number = DASHBOARD_ROW_LIMIT): DashboardGroup {
  return group.items.length > limit ? { ...group, items: group.items.slice(0, limit) } : group;
}

/** Everything waiting in a section — the figure beside its heading. */
export function sectionTotal(section: Pick<DashboardSection, "groups">): number {
  return section.groups.reduce((sum, g) => sum + g.count, 0);
}

/**
 * A bell group as a dashboard group — the shared-source rule's one hand-over (ADR-0067). The bell's
 * severity and collapse are how *its panel* reads a group, so they stay behind; everything that
 * says what the group *is* comes across untouched.
 */
export function dashboardGroupFromBell(group: {
  id: string;
  title: string;
  count: number;
  items: DashboardItem[];
  href: string;
}): DashboardGroup {
  return {
    id: group.id,
    title: group.title,
    count: group.count,
    items: group.items.map(({ key, label, detail, at, href }) => ({ key, label, detail, at, href })),
    href: group.href,
  };
}
