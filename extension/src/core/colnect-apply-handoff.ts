// The **Colnect apply handoff** (#689): how "carry this list difference out on Colnect" crosses
// from the instance's own report screen into the extension, and how the run's progress crosses back.
//
// The listing handoff's contract again (#409), on a fourth element and for the same reason: the page
// writes a task into a hidden node as JSON, the extension answers with `data-*` attributes on that
// same node, and the page keeps owning it — React re-renders it, so text in and attributes out is
// the only direction of travel that survives. A separate node rather than another task type on an
// existing one, because the answers must not overwrite each other.
//
// What is different from every handoff before it is what happens at the far end. The listing handoff
// *fills a form and stops*; this one **writes to a Colnect account** — see ADR-0042 for that
// decision, what is written, and why the endpoints being undocumented is designed for rather than
// hoped about.
//
// Mirrored by hand in `src/app/c/[collectionSlug]/colnect/assistant-apply-handoff.ts` — separate
// builds, no import path between them, exactly as the listing, match and registration contracts are.

/** Element id the worklist lives in, and the node whose attributes carry progress back. */
export const APPLY_ELEMENT_ID = "stamporama-assistant-colnect-apply";

/** Which way one item goes on Colnect — `+` onto the list, `-` off it. Colnect's own `val`. */
export type ApplyDirection = "+" | "-";

/** One thing to do. `kind` is the report bucket it came from, carried so the instance can mark
 *  *that* difference done as the item lands rather than guessing at a kind. */
export interface ApplyItem {
  colnectId: string;
  direction: ApplyDirection;
  kind: string;
}

/**
 * What the page writes into the element when the collector confirms a run.
 *
 * `lt` sits on the task rather than on each item because a run **is** one list: the report is drawn
 * for one mapping at a time and no gesture mixes two. Twenty-five thousand copies of the same
 * integer would be twenty-five thousand chances for one of them to name the wrong list.
 */
export interface ApplyTask {
  /** Which instance and collection to report progress to. The origin is the page's own. */
  collectionId: string;
  /** Colnect's list id — 2 Collection, 3 Swap, 4 Wish, 5 Sell, or a custom list's own number. */
  lt: number;
  /** What the list is called here, for the sentences the run reports. */
  label: string;
  items: ApplyItem[];
}

export interface ApplyHandoff {
  v: 1;
  /** Identifies this run, so an answer states which one it answers. Any non-empty string. */
  requestId: string;
  task: ApplyTask;
}

/**
 * How far a run has got.
 *
 * - `running` — accepted, and a Colnect page is being found or opened.
 * - `applying` — writes are going out at the throttle. The report carries the counts.
 * - `paused` — Colnect is rate-limiting, or the run was interrupted. **Nothing is lost**: the
 *   worklist and the cursor are written down, and the run continues from where it stopped. Its own
 *   state rather than `error` because nothing failed and nothing needs deciding.
 * - `done` — the worklist is exhausted. The report says how many landed and how many did not.
 * - `error` — the run stopped and will not continue on its own: no Colnect page could be reached,
 *   or the site answered something this build cannot classify (ADR-0042: a run stops, it does not
 *   retry blind).
 */
export type ApplyHandoffState = "running" | "applying" | "paused" | "done" | "error";

export const APPLY_STATE_ATTRIBUTE = "data-apply-state";
export const APPLY_REQUEST_ATTRIBUTE = "data-apply-request";
export const APPLY_MESSAGE_ATTRIBUTE = "data-apply-message";
export const APPLY_REPORT_ATTRIBUTE = "data-apply-report";

/** The numbers behind a state, as JSON in {@link APPLY_REPORT_ATTRIBUTE}. The message alone says how
 *  it is going; this is what the screen draws a progress bar off. */
export interface ApplyHandoffReport {
  /** How many items the run holds in all. */
  total: number;
  /** Written on Colnect and accepted. */
  applied: number;
  /** Items Colnect answered `410` for — the catalogue item changed underneath. Reported per item
   *  and skipped; the run carries on, because one changed item says nothing about the next. */
  changed: number;
  /** Items that failed for any other reason the run could classify without stopping. */
  failed: number;
}

/** Validate whatever the page wrote into the element, or `null`.
 *
 * The origin is one the collector registered, so this is a boundary between the page's JSON and a
 * typed value rather than a trust boundary — but a half-written node (React renders the element
 * before the dialog is confirmed) must read as "no handoff" rather than as a broken one. Items are
 * checked one by one and a malformed one is **dropped**: a run is thousands of them, and losing the
 * whole worklist over one bad row would be the wrong trade. */
export function parseApplyHandoff(raw: string | null | undefined): ApplyHandoff | null {
  if (!raw || !raw.trim()) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const h = data as Record<string, unknown>;
  if (h.v !== 1) return null;

  const requestId = typeof h.requestId === "string" ? h.requestId.trim() : "";
  if (!requestId) return null;

  const task = h.task;
  if (typeof task !== "object" || task === null) return null;
  const t = task as Record<string, unknown>;
  const collectionId = typeof t.collectionId === "string" ? t.collectionId.trim() : "";
  if (!collectionId) return null;
  const lt = typeof t.lt === "number" && Number.isFinite(t.lt) ? t.lt : null;
  if (lt === null) return null;
  if (!Array.isArray(t.items)) return null;

  const items = t.items.flatMap((entry): ApplyItem[] => {
    const item = entry as Record<string, unknown>;
    const colnectId = typeof item?.colnectId === "string" ? item.colnectId.trim() : "";
    const direction = item?.direction;
    if (!colnectId || (direction !== "+" && direction !== "-")) return [];
    return [
      { colnectId, direction, kind: typeof item.kind === "string" ? item.kind : "only-local" },
    ];
  });
  if (items.length === 0) return null;

  return {
    v: 1,
    requestId,
    task: {
      collectionId,
      lt,
      label: typeof t.label === "string" ? t.label : `list ${lt}`,
      items,
    },
  };
}

/** One sentence for {@link APPLY_MESSAGE_ATTRIBUTE}. English and complete: the page renders it as it
 *  stands, exactly as it does the listing handoff's. */
export function describeApplyProgress(
  state: ApplyHandoffState,
  report: ApplyHandoffReport,
  label: string
): string {
  const done = report.applied + report.changed + report.failed;
  switch (state) {
    case "running":
      return `Opening Colnect to apply ${report.total} ${report.total === 1 ? "change" : "changes"} to ${label}…`;
    case "applying":
      return `${done} of ${report.total} applied on Colnect. This is paced to about one every other second — leave it running.`;
    case "paused":
      return `Paused at ${done} of ${report.total}: Colnect is asking for a slower pace. Nothing is lost — start it again and it carries on from here.`;
    case "done":
      return report.changed + report.failed === 0
        ? `All ${report.applied} applied on ${label}.`
        : `${report.applied} applied on ${label}; ${report.changed + report.failed} could not be and are still on the report.`;
    case "error":
      return `The run stopped after ${done} of ${report.total}. Nothing is lost — what landed is already marked done.`;
  }
}
