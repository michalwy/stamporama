// How a side of a trade is **arranged** (#637): the levels it can be broken up by, and the pure
// pass that applies them.
//
// Why grouping and not a hand-set order. A trade list is read by two people looking for the same
// thing — *what is in here, and does it match*. That question is answered by the material's own
// axes, every one of which is already on the line: where it is from, when, which series, what state
// it is in. A hand order encodes the same intent as a fact nobody can see and nothing can check: it
// survives only as long as the person who dragged it remembers why, it says nothing to the partner
// reading their copy, and it is stale the moment a line is added. Switching *Issue* on says the same
// thing out loud, and stays true.
//
// The levels **nest in a fixed order**: area › year › issue › condition. That is the order the
// material contains itself — an issue belongs to a year belongs to an area — and a re-orderable
// hierarchy would only offer arrangements (year above area) that produce the same leaves under
// headings in an order nobody reads. Condition sits last because it is the one axis that is not
// about identity: it is a property of the piece, cutting across every level above it.
//
// Nothing here is a filter. Every line lands in exactly one leaf whichever levels are on, and with
// none on the list is flat — the default, because most trades are small enough that a heading over
// three lines is furniture.
//
// **Pure, and in `lib/` rather than beside the screen, because the arrangement is the server's.**
// The two sides page (a trade list can run long), and a group computed over one page is a group that
// lies about the pages not fetched yet — so the domain arranges the whole side, then hands out a
// page of it. The client only draws the headings this produces.

import { buildAreaPath } from "./area-path";
import type { CollectionAreaData } from "./areas";

/** The axes a side can be broken up by, in the order they nest. */
export const TRADE_GROUP_LEVELS = ["area", "year", "issue", "condition"] as const;

export type TradeGroupLevel = (typeof TRADE_GROUP_LEVELS)[number];

/** What each level is called on its chip. *Condition* names the axis by its lead member: the
 *  certificate rides with it because the two together are what a state actually is (ADR-0006 §2 — a
 *  null certificate is a value), and "Condition + certificate" on a chip is a chip nobody reads. */
export const TRADE_GROUP_LABEL: Record<TradeGroupLevel, string> = {
  area: "Area",
  year: "Year",
  issue: "Issue",
  condition: "Condition",
};

/** The hint on each chip, saying what the level does before it is pressed. */
export const TRADE_GROUP_HINT: Record<TradeGroupLevel, string> = {
  area: "Break both sides up by the area the stamps are from.",
  year: "Break both sides up by the year the stamps were issued.",
  issue: "Break both sides up by the series the stamps belong to.",
  condition: "Break both sides up by condition and certificate together — one state, not two axes.",
};

const VALID_LEVEL = new Set<string>(TRADE_GROUP_LEVELS);

export function isTradeGroupLevel(value: string): value is TradeGroupLevel {
  return VALID_LEVEL.has(value);
}

/**
 * Untrusted level names — a query string, a stored preference — narrowed to what this build knows
 * and put back into **nesting order**.
 *
 * The order is this module's, never the order they happened to be switched on in: *area then issue*
 * and *issue then area* are the same arrangement asked for two ways, and honouring the click order
 * would make one of them draw a heading tree nobody can read.
 */
export function readTradeGroupLevels(raw: Iterable<string>): TradeGroupLevel[] {
  const on = new Set([...raw].filter(isTradeGroupLevel));
  return TRADE_GROUP_LEVELS.filter((level) => on.has(level));
}

/**
 * The four axes, read off a line of either side.
 *
 * Both the give side's copies (`ItemListItem`) and `TradeReceiveLineData` already carry every field
 * below under these very names, so neither side needs a translation step — which is why the shape is
 * spelled out here rather than one side's type being reused for the other. The two sides describe
 * completely different things, a copy that exists and material in nobody's inventory, and the fact
 * that they share these four axes is exactly what lets the two columns be read against each other.
 */
export interface TradeGroupSubject {
  areaId: string | null;
  issuedYear: number | null;
  issueId: string | null;
  issueName: string | null;
  issueYear: number | null;
  conditionId: string;
  conditionAbbreviation: string;
  conditionName: string;
  certificateStatusId: string | null;
  certificateStatusAbbreviation: string | null;
  certificateStatusName: string | null;
}

/** One heading: what it says, and how many lines are under it. */
export interface TradeGroupHeading {
  key: string;
  level: TradeGroupLevel;
  label: string;
  /** The muted second half — a year beside an issue's name, the full words behind an abbreviation —
   *  and null where the label already says everything. */
  detail: string | null;
  /** Lines under it at any depth. Counted over the **whole** side, not over the page: a heading that
   *  said "3" because only three had been scrolled to would be worse than no figure at all. */
  count: number;
  /** Pieces under it, which on the receive side is not the line count — three lines can be thirty
   *  stamps. Equal to `count` on the give side, where a line is always one copy. */
  pieces: number;
}

/** A side, arranged: the rows in heading order, each carrying the path of headings it sits under. */
export interface TradeArrangement<T> {
  rows: { row: T; path: string[] }[];
  /** Every heading in play, by key — the client looks a path entry up here rather than being sent
   *  the same words once per row. */
  headings: Record<string, TradeGroupHeading>;
}

/** What the collection needs to say for a heading to have words on it. */
export interface TradeGroupContext {
  areas: CollectionAreaData[];
  /** Condition ids in the collection's **own display order**. `StampCondition.sortOrder` is display
   *  order and not a quality scale (ADR-0032: `U` and `MNG` are cancellation and gum, not two points
   *  on one line), so nothing here calls one condition better than another — it only puts them in
   *  the order the collector sees everywhere else. One missing from the dictionary sorts last rather
   *  than being dropped: the line is on the trade whatever became of the dictionary row. */
  conditionOrder: readonly string[];
}

/** A heading's identity, its words, and where it sorts among its siblings. */
interface Bucket {
  id: string;
  label: string;
  detail: string | null;
  /** Two parts: the first separates *has a value* from *has none*, so an unknown sinks to the bottom
   *  whatever the second says. */
  sort: [number, number | string];
}

function bucketFor(
  level: TradeGroupLevel,
  subject: TradeGroupSubject,
  ctx: TradeGroupContext,
  areaPaths: Map<string, string>
): Bucket {
  switch (level) {
    case "area": {
      const label = subject.areaId ? (areaPaths.get(subject.areaId) ?? "") : "";
      return {
        id: subject.areaId ?? "__none__",
        label: label || "No area",
        detail: null,
        sort: [subject.areaId && label ? 0 : 1, label],
      };
    }
    case "year": {
      const year = subject.issuedYear;
      return {
        id: year === null ? "__none__" : String(year),
        label: year === null ? "No year" : String(year),
        detail: null,
        // **Oldest first**, which is how a stamp list is read — album and catalogue order, and the
        // order both sides will pack in. Deliberately not the newest-first the year *facets* use:
        // those are a filter picker, where what you reach for is what arrived recently.
        sort: [year === null ? 1 : 0, year ?? 0],
      };
    }
    case "issue": {
      const label = subject.issueName ?? (subject.issueId ? "(unnamed issue)" : "No issue");
      return {
        id: subject.issueId ?? "__none__",
        label,
        detail: subject.issueYear === null ? null : String(subject.issueYear),
        sort: [subject.issueId ? 0 : 1, `${subject.issueYear ?? 9999}:${label}`],
      };
    }
    case "condition": {
      const rank = ctx.conditionOrder.indexOf(subject.conditionId);
      // The certificate rides **with** the condition rather than forming a level of its own: what
      // state a stamp is in *is* the pair, and splitting them would put "Used" and "Used + Attest"
      // under headings a level apart while they are one answer to one question.
      const cert = subject.certificateStatusAbbreviation;
      return {
        id: `${subject.conditionId}:${subject.certificateStatusId ?? "__none__"}`,
        label: cert ? `${subject.conditionAbbreviation} + ${cert}` : subject.conditionAbbreviation,
        detail: cert
          ? `${subject.conditionName} · ${subject.certificateStatusName}`
          : subject.conditionName,
        // Dictionary order, unknown condition last; **no certificate first** within a condition,
        // because that is what most material is and it reads as the plain case.
        sort: [
          rank === -1 ? 1 : 0,
          `${String(rank === -1 ? 9999 : rank).padStart(5, "0")}:${
            subject.certificateStatusId === null ? "" : (cert ?? "￿")
          }`,
        ],
      };
    }
  }
}

/**
 * Arrange a side.
 *
 * With no levels on, the rows come back in the order they were given — the flat list — with no
 * headings at all. Flat is the *absence* of grouping, not one group holding everything, and a single
 * heading saying so is a line of furniture over the whole side.
 *
 * Within a leaf the rows keep the order they arrived in, which is the order they were entered. The
 * headings sort by their axis, because a heading order that depended on which line happened to be
 * typed first would move every time a line was added.
 */
export function arrangeByGroups<T>(
  rows: readonly T[],
  subjectOf: (row: T) => TradeGroupSubject,
  piecesOf: (row: T) => number,
  levels: readonly TradeGroupLevel[],
  ctx: TradeGroupContext
): TradeArrangement<T> {
  if (levels.length === 0) {
    return { rows: rows.map((row) => ({ row, path: [] })), headings: {} };
  }

  // Area paths once for the pass rather than per row: a side of two thousand lines would otherwise
  // walk the area tree two thousand times to print the same dozen headings.
  const areaPaths = new Map<string, string>();
  for (const area of ctx.areas) {
    areaPaths.set(area.id, buildAreaPath(ctx.areas, area.id) ?? area.name);
  }

  const headings: Record<string, TradeGroupHeading> = {};

  /** Every row's full path, computed once so the sort and the output agree by construction. */
  const withPath = rows.map((row) => {
    const subject = subjectOf(row);
    const buckets: Bucket[] = [];
    const path: string[] = [];
    let key = "";
    for (const level of levels) {
      const bucket = bucketFor(level, subject, ctx, areaPaths);
      key = `${key}/${level}:${bucket.id}`;
      buckets.push(bucket);
      path.push(key);
      const heading = headings[key];
      if (heading) {
        heading.count += 1;
        heading.pieces += piecesOf(row);
      } else {
        headings[key] = {
          key,
          level,
          label: bucket.label,
          detail: bucket.detail,
          count: 1,
          pieces: piecesOf(row),
        };
      }
    }
    return { row, path, buckets };
  });

  // One stable sort over the whole side: comparing the bucket sort keys level by level puts every
  // row under its heading and every heading among its siblings, without building and flattening a
  // tree that would only be flattened again for the page.
  withPath.sort((a, b) => {
    for (let i = 0; i < levels.length; i++) {
      const cmp = compareSort(a.buckets[i].sort, b.buckets[i].sort);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  return { rows: withPath.map(({ row, path }) => ({ row, path })), headings };
}

function compareSort(a: Bucket["sort"], b: Bucket["sort"]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (typeof a[1] === "number" && typeof b[1] === "number") return a[1] - b[1];
  return String(a[1]).localeCompare(String(b[1]), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
