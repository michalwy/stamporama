import { copyYear } from "./copy-sort";

/**
 * How a purchase lot's item list is piled up (#1189) — the axes, the key a copy falls under on
 * each, and the tree of headings they make together.
 *
 * A lot of any size is worked through as *the German material* and *everything from the fifties*,
 * and a flat run of copies cannot be read that way. Area and year of issue are the two the
 * collector asked for, and they are the two the sorting already runs on — hence {@link copyYear}
 * rather than a second reading of the same fields.
 *
 * **Three axes, one nesting order.** The chips are independent, but what they mean when several
 * are on is fixed here: area outside year outside issue. A stack the collector could reorder would
 * be a second thing to remember for a view whose whole point is that it needs no thinking about,
 * and the two orders a collector actually wants — *areas, and years inside them* — are this one.
 *
 * **Nothing is ever dropped.** A copy with no area, or no year, groups under a heading that says
 * it has none rather than being filed under a neighbour or left out: that is the case that goes
 * wrong most often, and it is settled here, once, for every axis.
 *
 * Pure — no Prisma, no React. The server builds the tree from the copies a read already enriched;
 * the client renders it and hands the leaf scope straight back as query parameters.
 */

/** The axes a lot's copies can be piled up on, in **nesting order**: outermost first. */
export const INTAKE_GROUP_AXES = ["area", "year", "issue"] as const;

export type IntakeGroupAxis = (typeof INTAKE_GROUP_AXES)[number];

/** The key of the group holding copies that have nothing on the axis. Shared with the existing
 * issue grouping, whose `"__none__"` this is. */
export const NO_GROUP_KEY = "__none__";

/** What grouping reads off a copy. `ItemListItem` is one shape of it. */
export interface GroupableCopy {
  areaId: string | null;
  issuedYear: number | null;
  issueYear: number | null;
  issueId: string | null;
  issueName: string | null;
  /** The owning lot's lifecycle status — `openCount` is the bulk-action target scope. */
  lotStatus: string | null;
}

/** One heading, with the headings nested beneath it. */
export interface IntakeGroupNode {
  axis: IntakeGroupAxis;
  /** The value's own id: an area id, a year as digits, an issue id — or {@link NO_GROUP_KEY}. */
  key: string;
  label: string;
  /** Copies under this heading **matching the list's active filters** (#623). A heading whose
   * copies are all filtered out is never emitted, so the view draws no empty group. */
  count: number;
  /** Of those, copies whose owning lot is still open. */
  openCount: number;
  /** `axis:key` from the root, joined by `/` — the React key and the collapse-state key. Stable
   * across reloads, which is what lets a collapsed heading stay collapsed. */
  path: string;
  children: IntakeGroupNode[];
}

/** The narrowing a node's copies answer to, accumulated down the tree — exactly the parameters
 * the leaf list is fetched with. */
export interface IntakeGroupScope {
  areaKey?: string;
  yearKey?: string;
  issueKey?: string;
}

const SCOPE_FIELD: Record<IntakeGroupAxis, keyof IntakeGroupScope> = {
  area: "areaKey",
  year: "yearKey",
  issue: "issueKey",
};

/** The scope a child adds to its parent's. Never mutates the parent's — sibling branches share it. */
export function withGroupScope(
  parent: IntakeGroupScope,
  axis: IntakeGroupAxis,
  key: string
): IntakeGroupScope {
  return { ...parent, [SCOPE_FIELD[axis]]: key };
}

/** The key a copy falls under on one axis. {@link NO_GROUP_KEY} when it has no value there. */
export function intakeGroupKey(axis: IntakeGroupAxis, item: GroupableCopy): string {
  if (axis === "area") return item.areaId ?? NO_GROUP_KEY;
  if (axis === "issue") return item.issueId ?? NO_GROUP_KEY;
  const year = copyYear(item);
  return year == null ? NO_GROUP_KEY : String(year);
}

/** Whether a copy belongs under `key` on `axis` — the in-memory half of the group scoping, and the
 * *same* reading {@link intakeGroupKey} counts by, so a heading's number and the rows beneath it
 * cannot come to disagree. */
export function matchesIntakeGroup(
  item: GroupableCopy,
  axis: IntakeGroupAxis,
  key: string | undefined
): boolean {
  return key == null || intakeGroupKey(axis, item) === key;
}

/** The axes a request asked for, in nesting order, from a comma-separated parameter. Anything
 * unrecognised or repeated drops out, so a stale bookmark degrades to fewer levels rather than
 * to an error. */
export function parseIntakeGroupAxes(raw: string | null | undefined): IntakeGroupAxis[] {
  if (!raw) return [];
  const asked = new Set(raw.split(","));
  return INTAKE_GROUP_AXES.filter((a) => asked.has(a));
}

/** The parameter form of {@link parseIntakeGroupAxes}, always in nesting order. */
export function formatIntakeGroupAxes(axes: readonly IntakeGroupAxis[]): string {
  return INTAKE_GROUP_AXES.filter((a) => axes.includes(a)).join(",");
}

export interface IntakeGroupLabels {
  /** Area id → the collector's name for it. A missing one is still a group; it is only nameless. */
  areaNameById: Map<string, string>;
}

/** The heading an issue group carries — the existing wording (#172), kept so turning the new
 * chips off leaves the view byte-identical to what it was. */
function issueLabel(item: GroupableCopy): string {
  return (
    [item.issueName || null, item.issueYear ? `(${item.issueYear})` : null]
      .filter(Boolean)
      .join(" ") || "Untitled issue"
  );
}

function nodeLabel(axis: IntakeGroupAxis, key: string, item: GroupableCopy, labels: IntakeGroupLabels): string {
  if (key === NO_GROUP_KEY) {
    return axis === "area" ? "No area" : axis === "year" ? "No year" : "No issue";
  }
  if (axis === "area") return labels.areaNameById.get(key) ?? "Unnamed area";
  if (axis === "year") return key;
  return issueLabel(item);
}

// Natural collation, so areas read the way the area tree does.
const AREA_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Order one level's headings. **`No …` always last**, on every axis: it is the leftovers pile and
 * a collector scanning for their material should not have to read past it.
 *
 * Otherwise each axis takes the order its own values have: areas by name, years chronologically,
 * and issues in the order the lot acquired them — which is what the by-issue view has always
 * shown, so turning the new chips off changes nothing.
 */
function sortLevel(axis: IntakeGroupAxis, nodes: IntakeGroupNode[]): IntakeGroupNode[] {
  if (axis === "issue") {
    const none = nodes.filter((n) => n.key === NO_GROUP_KEY);
    return [...nodes.filter((n) => n.key !== NO_GROUP_KEY), ...none];
  }
  return [...nodes].sort((a, b) => {
    if (a.key === NO_GROUP_KEY) return 1;
    if (b.key === NO_GROUP_KEY) return -1;
    return axis === "year"
      ? Number(a.key) - Number(b.key)
      : AREA_COLLATOR.compare(a.label, b.label);
  });
}

/**
 * The headings a set of copies makes under `axes`, nested in the order given.
 *
 * `[]` for no axes — an ungrouped list has no headings, which is what the caller renders as the
 * flat run of rows. Every copy lands in exactly one leaf on every level, so the counts down any
 * one branch always add back up to the level above.
 */
export function buildIntakeGroups(
  items: readonly GroupableCopy[],
  axes: readonly IntakeGroupAxis[],
  labels: IntakeGroupLabels
): IntakeGroupNode[] {
  const ordered = INTAKE_GROUP_AXES.filter((a) => axes.includes(a));
  return buildLevel(items, ordered, "", labels);
}

function buildLevel(
  items: readonly GroupableCopy[],
  axes: readonly IntakeGroupAxis[],
  parentPath: string,
  labels: IntakeGroupLabels
): IntakeGroupNode[] {
  const [axis, ...rest] = axes;
  if (!axis) return [];
  // Insertion order, so the issue axis keeps the first-added order it has always had; the other
  // axes are re-sorted below, and a stable starting order is what makes that sort deterministic.
  const buckets = new Map<string, { node: IntakeGroupNode; items: GroupableCopy[] }>();
  for (const it of items) {
    const key = intakeGroupKey(axis, it);
    let bucket = buckets.get(key);
    if (!bucket) {
      const path = parentPath ? `${parentPath}/${axis}:${key}` : `${axis}:${key}`;
      bucket = {
        node: {
          axis,
          key,
          label: nodeLabel(axis, key, it, labels),
          count: 0,
          openCount: 0,
          path,
          children: [],
        },
        items: [],
      };
      buckets.set(key, bucket);
    }
    bucket.node.count += 1;
    if (it.lotStatus === "open") bucket.node.openCount += 1;
    bucket.items.push(it);
  }
  for (const bucket of buckets.values()) {
    bucket.node.children = buildLevel(bucket.items, rest, bucket.node.path, labels);
  }
  return sortLevel(
    axis,
    [...buckets.values()].map((b) => b.node)
  );
}
